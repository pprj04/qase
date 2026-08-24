/**
 * Agent runtime: turns browser + model into an autonomous QA tester.
 *
 * Each session owns a CleanSlate SDK runtime with a headless Chromium. The
 * agent calls browser_* tools to explore the site, files findings via
 * report_finding, and finishes with finish_qa_report.
 */

import { getModelTier, getPublicConfig } from './config.js';
import { addActivity, addMessage, emit, liveFor, listSessions, setStatus, updateActivity } from './store.js';
import { redact, secretNames } from './secrets.js';
import { createQaTools } from './qaTools.js';
import { captureStep, finalizeStepOutcome } from './workflows.js';
import { buildQaContext } from './prompt.js';
import { attachBrowserBridge } from './browserBridge.js';
import { resolveDeviceContext } from './deviceContext.js';
import { validateTargetUrl, classifyUrlFast, installPageBoundary } from './targetGuard.js';
import { ALL_TOOLS, CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '@cleanslate/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Keep the browser alive indefinitely between turns. */
const BROWSER_IDLE_MS = 0;
/** How many times to retry on a model timeout. */
const MODEL_TIMEOUT_RETRIES = 2;
const MODEL_TIMEOUT_RETRY_DELAY_MS = 2000;
/**
 * Maximum wall-clock time a single session turn is allowed to run.
 * After this the turn is aborted and retried or marked as 'error'.
 * This wraps the ENTIRE runTurn call (all internal model turns).
 * Set to 20 minutes to allow a full mission of 20+ agent turns.
 */
const SESSION_TURN_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Maximum wall-clock time to wait without any meaningful progress
 * (tool result, assistant text, or model turn start). If the agent
 * goes silent for this long — typically because the model API is
 * stuck producing reasoning tokens or returned an empty response —
 * the turn is aborted and retried.
 *
 * Set to 5 minutes: long enough for any legitimate model response,
 * short enough to recover from hangs within a reasonable window.
 */
const MODEL_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** The tools the agent is allowed to use. */
const ALLOWED_TOOLS = new Set([
	'browser_open', 'browser_close', 'browser_click', 'browser_type',
	'browser_fill', 'browser_select_option', 'browser_press_key',
	'browser_hover', 'browser_scroll', 'browser_screenshot',
	'browser_snapshot', 'browser_diagnostics', 'browser_wait',
	'browser_navigate_back', 'browser_tabs',
	'browser_dialog', 'browser_new_tab', 'browser_select_tab', 'browser_close_tab',
	'update_todo', 'ask_question', 'report_finding', 'finish_qa_report',
	'set_viewport'
]);

/** Display labels for activity feed entries. */
const ACTIVITY_LABELS = {
	browser_open: 'Opening',
	browser_close: 'Closing browser',
	browser_click: 'Clicking',
	browser_type: 'Typing',
	browser_fill: 'Filling',
	browser_select_option: 'Selecting',
	browser_press_key: 'Pressing key',
	browser_hover: 'Hovering',
	browser_scroll: 'Scrolling',
	browser_screenshot: 'Screenshot',
	browser_snapshot: 'Snapshot',
	browser_diagnostics: 'Diagnostics',
	browser_wait: 'Waiting',
	browser_navigate_back: 'Going back',
	browser_tabs: 'Switching tab',
	browser_dialog: 'Handling dialog',
	browser_new_tab: 'Opening tab',
	browser_select_tab: 'Selecting tab',
	browser_close_tab: 'Closing tab',
	update_todo: 'Updating plan',
	ask_question: 'Asking',
	report_finding: 'Filing finding',
	finish_qa_report: 'Finishing report',
	set_viewport: 'Resizing viewport'
};

/**
 * Where the browser actually is right now, or undefined when none is open.
 * Read fresh rather than remembered, because that is the whole point of it.
 */
function liveBrowserUrl(record) {
	try {
		const page = record.bridge?.service?.activePage;
		if (!page || page.isClosed()) {
			// Suspended between turns; the saved location is where it resumes.
			return record.bridge?.saved?.url;
		}
		const url = page.url();
		return /^about:/.test(url) ? record.bridge?.saved?.url : url;
	} catch {
		return undefined;
	}
}

/**
 * Closes a session's browser without discarding its runtime, so the
 * conversation survives but the Chromium process does not linger. The SDK
 * relaunches on the next browser tool call, and the bridge replays the session
 * into it.
 */
export async function closeBrowser(sessionId) {
	const record = liveFor(sessionId);
	if (!record?.bridge) return;
	clearTimeout(record.idleTimer);
	record.idleTimer = undefined;
	// Phase 1: Always call suspend() to ensure service.dispose() runs,
	// which calls browser.close() to kill Chromium processes.
	// Previously, if hasPage() was false (page already closed), we'd skip
	// suspend entirely, leaving Chromium running as a zombie.
	try {
		await record.bridge.suspend();
	} catch (err) {
		console.error(`[agent] closeBrowser(${sessionId}) suspend failed: ${err.message}`);
	}
}

/** Closes every other session's browser, so only one is ever running. */
async function closeOtherBrowsers(keepSessionId) {
	await Promise.all(
		listSessions()
			.filter(summary => summary.id !== keepSessionId)
			.map(summary => (liveFor(summary.id).running ? undefined : closeBrowser(summary.id)))
	);
}

export async function ensureRuntime(session) {
	const record = liveFor(session.id);
	if (record.runtime) {
		return record;
	}
	await useBundledChromium();

	const settings = getModelTier('discovery');
	const problem = getPublicConfig().problem;
	if (problem) {
		throw new Error(`${problem} Open Settings and add the endpoint details.`);
	}

	// The agent has no filesystem tools, but the runtime still wants a root. A
	// per-session scratch directory means even a slipped write stays contained.
	const rootPath = path.join(process.cwd(), '.qase', 'workspaces', session.id);
	fs.mkdirSync(rootPath, { recursive: true });

	const configuration = createNodeProviderConfiguration({
		provider: settings.provider,
		model: settings.model,
		apiKey: settings.apiKey,
		baseUrl: settings.baseUrl || undefined,
		reasoningLevel: settings.reasoning,
		maxTurns: Number(settings.maxTurns),
		// Azure keeps its endpoint and deployment in their own fields. The one
		// URL box in Settings feeds both, and the SDK recognises an /openai/v1
		// endpoint and talks to it over the OpenAI-compatible path.
		azureEndpoint: settings.baseUrl || undefined,
		azureDeploymentName: settings.model,
		azureApiVersion: settings.apiVersion || undefined
	});

	const runtime = new CleanSlateNodeAgentRuntime({
		rootPath,
		workspaceStorageHome: path.join(rootPath, '.state'),
		configuration,
		sessionId: session.id,
		browserHeadless: settings.headless !== false,
		// This agent never runs commands. The SDK refuses by default; being
		// explicit means the policy survives an SDK default changing.
		approveCommand: async () => false,
		approveTool: async ({ toolName }) => ALLOWED_TOOLS.has(toolName),
		additionalContext: () => buildQaContext(session, liveBrowserUrl(record))
	});

	// CleanSlate's default continuation appends a fresh system message before
	// every follow-up user turn. Strict Anthropic-compatible gateways reject a
	// mid-conversation system role. The SDK already exposes the protocol-safe
	// continuation we need: keep the original system instruction and append only
	// the latest user message. The per-turn browser context is still included in
	// that user message by buildPromptContext(), so no guidance is lost.
	const sdkSession = runtime.agentSession;
	if (typeof sdkSession?.continueWithLatestUserMessage === 'function') {
		sdkSession.continueWithTurn = sdkSession.continueWithLatestUserMessage.bind(sdkSession);
	}

	// The registry is fixed at construction, so the QA tools are registered
	// afterwards through the headless runtime that actually resolves them.
	const qaTools = createQaTools(session);
	const headless = runtime.headlessRuntime;
	headless.options.tools = [...ALL_TOOLS, ...qaTools];
	for (const tool of qaTools) {
		headless.toolsByName.set(tool.name, tool);
	}
	// The prompt's tool list is built from ALL_TOOLS; extend it to match reality.
	const describeTools = runtime.getToolDescriptions.bind(runtime);
	runtime.getToolDescriptions = () => `${describeTools()}${qaTools
		.map(tool => `- ${tool.name}: ${tool.description}\n  Parameters: ${JSON.stringify(tool.parametersSchema)}`)
		.join('\n')}\n`;

	// The SDK's stream reports tool_result but never tool_start, so the only
	// way to know a tool has begun — and to show it as running — is to wrap the
	// executor the loop calls.
	const originalExecute = headless.executeTool.bind(headless);
	headless.executeTool = async function* (toolName, input, toolCallId, signal) {
		// onToolStart became async (M1-P4.1 target validation) — its result is
		// not needed for the tool stream, so drift is fine.
		void Promise.resolve(record.onToolStart?.(toolName, input, toolCallId)).catch(() => {});
		yield* originalExecute(toolName, input, toolCallId, signal);
	};

	const service = headless.getToolContext().browserAutomationService;
	const bridge = attachBrowserBridge(session, service);

	// M1-P4.1 — SSRF boundary for agent-driven pages. The SDK owns context
	// creation, so the boundary installs per PAGE at registration: every
	// navigation (initial open, new tabs, redirects) is classified; blocked
	// destinations abort and the tool call reports an honest navigation
	// failure. registerPage is the SDK's single funnel for pages (both the
	// default context's pages and any device-swapped context).
	const originalRegisterPageBase = service.registerPage.bind(service);
	service.registerPage = page => {
		// installPageBoundary is async (CDP Fetch.enable must complete before
		// the first navigation). The SDK calls registerPage synchronously right
		// before navigating, so we kick the attach off immediately; the route
		// base-layer installs synchronously inside the promise. Redirect chains
		// are caught by the CDP layer as soon as enable resolves; the SDK's
		// initial goto of an ALLOWED target is never delayed by this.
		void Promise.resolve(installPageBoundary(page)).catch(() => { /* best-effort add-on */ });
		originalRegisterPageBase(page);
	};

	// ── Mobile/tablet device context (real emulation, not a CSS resize) ──
	// The SDK creates the browser context lazily with a fixed desktop
	// viewport. When a mission selected a device, the first page registration
	// recreates the context with the REAL Playwright device descriptor
	// (UA, viewport, DPR, isMobile, hasTouch). Desktop missions never take
	// this path — their context is created exactly as before.
	const deviceContext = resolveDeviceContext(session.deviceRequest ?? null);
	if (deviceContext) {
		const originalRegisterPage = service.registerPage.bind(service);
		service.registerPage = page => {
			applyDeviceContext(service, page, deviceContext, originalRegisterPage);
		};
		session.device = deviceContext;
		emit(session, 'device', { device: deviceContext });
	}

	record.runtime = runtime;
	record.bridge = bridge;
	record.dispose = () => {
		bridge.dispose();
		try {
			runtime.dispose();
		} catch {
			// Disposing a runtime that never opened a browser is not an error.
		}
	};
	return record;
}

/**
 * Recreates the SDK's browser context as a REAL emulated device.
 *
 * The SDK's ensureContext() creates a desktop context (1440×900, desktop UA)
 * on first use. When a device is selected we must swap that context for one
 * built from the Playwright device registry BEFORE the agent drives the page:
 *
 *   1. remember the URL the SDK already navigated to (first open happens
 *      before registerPage fires),
 *   2. close the desktop context,
 *   3. create a context with the device's viewport / UA / DPR / touch flags,
 *   4. re-register + restore the page, navigating back to the remembered URL.
 *
 * Any failure falls back to the original desktop context so a bad device
 * request can never kill a mission.
 */
async function applyDeviceContext(service, page, deviceContext, originalRegisterPage) {
	try {
		const url = page.url();
		await service.context?.close();
		const descriptor = getDeviceDescriptor(deviceContext);
		service.context = await service.browser.newContext(descriptor);
		const devicePage = await service.context.newPage();
		originalRegisterPage(devicePage);
		service.activePage = devicePage;
		if (url && url !== 'about:blank') {
			try {
				await devicePage.goto(url, { waitUntil: 'commit', timeout: 15_000 }).catch(() => {});
			} catch {
				// Navigation failures leave the page on about:blank; the
				// agent's next browser action re-navigates anyway.
			}
		}
	} catch (err) {
		console.warn(`[device] Falling back to desktop context: ${err instanceof Error ? err.message : String(err)}`);
		try {
			service.context = await service.browser?.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
			const fallbackPage = await service.context?.newPage();
			if (fallbackPage) {
				originalRegisterPage(fallbackPage);
				service.activePage = fallbackPage;
			}
		} catch {
			// Nothing more we can do; the agent will surface the failure.
		}
	}
}

/** Raw Playwright context options for a resolved device context. */
function getDeviceDescriptor(deviceContext) {
	return {
		viewport: { width: deviceContext.viewport.width, height: deviceContext.viewport.height },
		userAgent: deviceContext.userAgent,
		deviceScaleFactor: deviceContext.deviceScaleFactor,
		isMobile: deviceContext.isMobile,
		hasTouch: deviceContext.hasTouch,
		acceptDownloads: true
	};
}

/**
 * Drives one turn and translates the SDK's stream into dashboard events.
 * Returns when the model stops — either because the task is done or because it
 * asked a blocking question.
 */
export async function runTurn(session, { task, resumeAnswer, retryAttempt = 0 }) {
	const record = await ensureRuntime(session);
	const { runtime, bridge } = record;
	if (record.running) {
		throw new Error('This session is already running. Stop it first.');
	}

	const controller = new AbortController();
	record.running = true;
	record.controller = controller;
	clearTimeout(record.idleTimer);
	record.idleTimer = undefined;
	session.pendingQuestion = undefined;
	setStatus(session, 'running');

	// A turn that paused for credentials or a question stops its frame timer in
	// finally. Resuming continues on the existing page and may never call
	// browser_open again, so restart the stream here instead of waiting for a
	// navigation tool that might not come. Capture immediately to replace the
	// stale pre-pause frame before the agent's next action is shown.
	if (bridge.hasPage()) {
		bridge.startFrames();
		void bridge.captureFrame();
	}

	// Only the session being worked on keeps a browser open.
	void closeOtherBrowsers(session.id);

	// Message-shaped placeholders the streamed text accumulates into. Reasoning
	// gets its own bubble so the transcript can show the agent's thinking
	// alongside what it actually said, and so both survive a page reload.
	let assistant;
	let thinking;
	let retryAfterTimeout = false;

	const appendText = (content, kind) => {
		if (!content) {
			return;
		}
		if (!assistant) {
			assistant = addMessage(session, { role: 'agent', text: '', kind });
		}
		assistant.text += content;
		emit(session, 'message_delta', { id: assistant.id, content, kind });
	};

	// Reasoning is streamed for the live strip but never stored: it belongs to
	// the moment, not the transcript, and a reloaded page should show what the
	// agent said rather than what it was mulling over an hour ago.
	const appendThinking = content => {
		if (!content) {
			return;
		}
		thinking ??= `think-${Date.now()}`;
		emit(session, 'message_delta', { id: thinking, content, role: 'thinking' });
	};

	const closeThinking = () => {
		if (!thinking) {
			return;
		}
		emit(session, 'message_done', { id: thinking, role: 'thinking' });
		thinking = undefined;
	};

	const openActivities = new Map();

	const beginActivity = async (toolName, input, toolCallId) => {
		closeThinking();
		const safeInput = redact(session.id, input);
		const activity = addActivity(session, {
			id: toolCallId,
			type: 'tool',
			toolName,
			label: ACTIVITY_LABELS[toolName] ?? toolName,
			detail: describeTarget(safeInput),
			input: safeInput,
			status: 'running'
		});
		openActivities.set(toolCallId ?? activity.id, activity.id);
		if (toolName === 'browser_open' && typeof input?.url === 'string') {
			// M1-P4.1 — the LLM-chosen URL must pass the same boundary as the
			// mission target before it becomes the session target. Blocked
			// URLs are simply not adopted (the page-level route boundary will
			// also stop the actual navigation).
			const chosen = await validateTargetUrl(input.url).catch(() => null);
			if (chosen?.ok) session.targetUrl ??= input.url;
		}
		// Capture browser actions as structured workflow steps.
		captureStep(session, { toolName, input: safeInput, toolCallId });
		return activity;
	};

	record.onToolStart = beginActivity;

	// Mission-level turn timeout guard. If the turn exceeds the limit,
	// abort the controller and mark the session as errored. This prevents
	// runaway agent loops from holding browser resources indefinitely.
	let turnTimeoutTimer = setTimeout(() => {
		if (!controller.signal.aborted) {
			controller.abort();
			addMessage(session, {
				role: 'system',
				text: `The session timed out after ${SESSION_TURN_TIMEOUT_MS / 60000} minutes.`,
				kind: 'error'
			});
		}
	}, SESSION_TURN_TIMEOUT_MS);
	turnTimeoutTimer.unref?.();

	// Per-model-call idle watchdog: if no meaningful progress (tool result,
	// assistant text, turn start) happens within MODEL_IDLE_TIMEOUT_MS,
	// abort the turn so the retry logic can recover. The model API
	// intermittently returns empty responses or hangs on reasoning, and
	// without this guard the agent waits indefinitely.
	let idleAborted = false;
	let idleTimer = setTimeout(() => {
		if (!controller.signal.aborted) {
			idleAborted = true;
			console.log(`[agent] Idle timeout (${MODEL_IDLE_TIMEOUT_MS / 1000}s) — aborting turn for retry`);
			controller.abort();
		}
	}, MODEL_IDLE_TIMEOUT_MS);
	idleTimer.unref?.();

	try {
		const stream = resumeAnswer === undefined
			? runtime.run(task, controller.signal)
			: runtime.resumePendingQuestion(resumeAnswer, controller.signal);

		for await (const part of stream) {
			switch (part.type) {
				case 'chat_text':
					// Anything it says out loud ends the thought that preceded it.
					closeThinking();
					appendText(part.content, part.kind);
					// Reset idle watchdog — the model produced visible output
					idleTimer.refresh();
					break;

				case 'chat_text_reset':
					assistant = undefined;
					break;

				case 'reasoning':
					appendThinking(part.content);
					// Refresh idle timer on reasoning tokens — without this the
					// watchdog fires during long reasoning phases (common with
					// extended-thinking models) even though the model is actively
					// producing output.
					idleTimer.refresh();
					break;

				case 'reasoning_reset':
					closeThinking();
					break;

				case 'assistant_turn_start':
					// Each model turn is a fresh chat bubble.
					assistant = undefined;
					closeThinking();
					emit(session, 'turn', { turnId: part.turnId, index: part.turnIndex });
					// Reset idle watchdog — a new model turn started
					idleTimer.refresh();
					break;

				case 'context_usage':
					session.contextUsage = {
						percentage: part.percentage,
						used: part.estimatedInputTokens,
						window: part.contextWindowTokens
					};
					emit(session, 'context', { context: session.contextUsage });
					break;

				case 'tool_start':
					// Not emitted by the SDK today; handled here in case it is.
					if (!openActivities.has(part.toolCallId)) {
						beginActivity(part.toolName, part.input, part.toolCallId);
					}
					break;

				case 'tool_result': {
					// A rejected or malformed call never reaches the executor, so
					// its result is the first thing seen of it.
					if (!openActivities.has(part.toolCallId)) {
						beginActivity(part.toolName, part.input, part.toolCallId);
					}
					const id = openActivities.get(part.toolCallId) ?? part.toolCallId;
					const result = redact(session.id, part.result);
					const ok = result?.success !== false;
					updateActivity(session, id, {
						status: ok ? 'done' : 'failed',
						error: ok ? undefined : (result?.error ?? result?.message),
						summary: summariseResult(part.toolName, result)
					});
					// B1: Finalize the captured step's outcome from the tool result
					finalizeStepOutcome(session, part.toolCallId, part.toolName, result);
					openActivities.delete(part.toolCallId);

					// Reset idle watchdog — a tool completed, proving progress
					idleTimer.refresh();

					if (part.toolName === 'update_todo' && ok) {
						session.todos = normaliseTodos(part.result, session.todos);
						emit(session, 'todos', { todos: session.todos });
					}
					if (part.toolName === 'browser_open' && ok && result?.url) {
						bridge.startFrames();
					}
					break;
				}

				case 'task_complete':
					emit(session, 'task_complete', { result: redact(session.id, part.result) });
					break;

				default:
					break;
			}
		}

		// The loop ends either because the work is done or because ask_question
		// suspended it. Only the runtime knows which.
		const pending = runtime.getPendingQuestion();
		if (pending) {
			session.pendingQuestion = {
				toolCallId: pending.toolCallId,
				...normaliseQuestion(pending.question)
			};
			emit(session, 'question', { question: session.pendingQuestion });
			setStatus(session, 'awaiting_input');
		} else if (session.report) {
			setStatus(session, 'done');
			// Phase 1: Dispose browser resources when the session is done.
			// The conversation and report survive on disk; the Chromium
			// process should not linger consuming memory.
			void closeBrowser(session.id);
			record.dispose?.();
		} else {
			setStatus(session, 'idle');
		}
	} catch (error) {
		if (idleAborted) {
			// Idle timeout — treat as retryable model timeout
			if (retryAttempt < MODEL_TIMEOUT_RETRIES) {
				retryAfterTimeout = true;
				setStatus(
					session,
					'running',
					`The model went silent. Retrying automatically (${retryAttempt + 1}/${MODEL_TIMEOUT_RETRIES})…`
				);
			} else {
				setStatus(session, 'idle', 'Model went silent after retries.');
			}
		} else if (controller.signal.aborted) {
			setStatus(session, 'idle', 'Stopped by user.');
		} else if (retryAttempt < MODEL_TIMEOUT_RETRIES && isRetryableModelTimeout(error)) {
			retryAfterTimeout = true;
			setStatus(
				session,
				'running',
				`The model response timed out. Retrying automatically (${retryAttempt + 1}/${MODEL_TIMEOUT_RETRIES})…`
			);
		} else {
			const message = error instanceof Error ? error.message : String(error);
			addMessage(session, { role: 'system', text: message, kind: 'error' });
			setStatus(session, 'error', message);
		}
	} finally {
		clearTimeout(turnTimeoutTimer);
		clearTimeout(idleTimer);
		closeThinking();
		record.running = false;
		record.controller = undefined;
		session.secretNames = secretNames(session.id);
		// One last frame so the panel shows where the run actually finished.
		void bridge.captureFrame();
		bridge.stopFrames();

		// The browser stays with the session unless a timeout was asked for.
		clearTimeout(record.idleTimer);
		record.idleTimer = undefined;
		if (BROWSER_IDLE_MS > 0) {
			// A paused run is likely to continue, so it waits proportionally longer.
			const idleMs = session.status === 'awaiting_input' ? BROWSER_IDLE_MS * 3 : BROWSER_IDLE_MS;
			record.idleTimer = setTimeout(() => {
				void closeBrowser(session.id);
			}, idleMs);
			record.idleTimer.unref?.();
		}
	}

	if (retryAfterTimeout) {
		if (MODEL_TIMEOUT_RETRY_DELAY_MS > 0) {
			await new Promise(resolve => setTimeout(resolve, MODEL_TIMEOUT_RETRY_DELAY_MS));
		}
		return runTurn(session, {
			task: 'Continue from the latest transcript and browser state. The previous model request timed out after the last successful step. Inspect the current state before acting, do not repeat completed or irreversible actions, and finish the remaining test plan.',
			retryAttempt: retryAttempt + 1
		});
	}
}

function summariseResult(toolName, result) {
	if (!result || typeof result !== 'object') {
		return undefined;
	}
	if (toolName === 'browser_diagnostics') {
		const errors = (result.console ?? []).filter(entry => entry.level === 'error').length;
		const failed = (result.network ?? []).filter(entry => entry.statusCode >= 400 || entry.error).length;
		return `${errors} console error(s), ${failed} failed request(s)`;
	}
	if (toolName === 'browser_snapshot') {
		return `${result.elements?.length ?? 0} elements on ${result.title || result.url || 'page'}`;
	}
	if (result.recorded) {
		return result.recorded;
	}
	if (result.url) {
		return result.title ? `${result.title} — ${result.url}` : result.url;
	}
	return undefined;
}

/** The todo tool accepts several shapes; the dashboard wants exactly one. */
function normaliseTodos(result, previous) {
	const raw = result?.items ?? result?.todos ?? result?.to_do ?? result?.checklist;
	if (!Array.isArray(raw)) {
		return previous;
	}
	const statusOf = value => {
		const status = String(value ?? '').toLowerCase();
		if (status === 'doing' || status === 'in_progress') {
			return 'in_progress';
		}
		if (status === 'done' || status === 'completed' || status === 'x') {
			return 'completed';
		}
		return 'pending';
	};
	return raw.map(item => {
		if (typeof item === 'string') {
			const match = item.match(/^\s*\[(.)\]\s*(.*)$/);
			return match
				? { text: match[2], status: match[1] === 'x' ? 'completed' : match[1] === '/' ? 'in_progress' : 'pending' }
				: { text: item, status: 'pending' };
		}
		return { text: item?.content ?? item?.text ?? '', status: statusOf(item?.status) };
	}).filter(item => item.text);
}

/** Flattens the ask_question payload into what the chat panel renders. */
function normaliseQuestion(question) {
	const payload = question?.planning_question ?? question ?? {};
	const options = Array.isArray(payload.options)
		? payload.options.map(option => (typeof option === 'string' ? { label: option } : option)).filter(Boolean)
		: [];
	const text = payload.question ?? '';
	return {
		question: text,
		summary: question?.summary,
		options,
		allowCustom: payload.allowCustom !== false,
		customLabel: payload.customLabel,
		placeholder: payload.placeholder,
		// Credential questions get a dedicated, non-echoing form in the UI.
		credentialLike: looksLikeCredentialRequest(text, options)
	};
}

const CREDENTIAL_HINT = /\b(credential|password|passcode|username|user name|login|log in|sign in|sign-in|email and password|account)\b/i;

function looksLikeCredentialRequest(text, options) {
	const haystack = [text, ...options.map(option => option.label ?? '')].join(' ');
	return CREDENTIAL_HINT.test(haystack);
}

/** True if the error looks like a transient model-side timeout or empty response. */
function isRetryableModelTimeout(error) {
	const message = error instanceof Error ? error.message : String(error);
	return /timeout|timed out|deadline exceeded|ETIMEDOUT|empty response|no content|MidStreamFallback|APIConnectionError|Upstream returned/i.test(message);
}

/**
 * Ensures the SDK's browser automation uses the Playwright-installed Chromium
 * binary. The SDK checks CLEANSLATE_BROWSER_EXECUTABLE, so we point it at the
 * Playwright cache.
 */
let chromiumInitialized = false;
async function useBundledChromium() {
	if (chromiumInitialized || process.env.CLEANSLATE_BROWSER_EXECUTABLE) return;
	chromiumInitialized = true;
	try {
		const { chromium } = await import('playwright');
		const candidate = chromium.executablePath();
		if (candidate) {
			// Verify the binary is valid (ELF magic check).
			const fd = fs.openSync(candidate, 'r');
			const header = Buffer.alloc(4);
			fs.readSync(fd, header, 0, 4, 0);
			fs.closeSync(fd);
			if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
				process.env.CLEANSLATE_BROWSER_EXECUTABLE = candidate;
				return;
			}
		}
	} catch {
		// Fall through to headless shell scan.
	}
	// Fallback: scan for chrome-headless-shell in the Playwright cache.
	try {
		const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
		if (fs.existsSync(cacheDir)) {
			const dirs = fs.readdirSync(cacheDir)
				.filter(name => name.startsWith('chromium_headless_shell-'))
				.sort().reverse();
			for (const dir of dirs) {
				const bin = path.join(cacheDir, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
				if (fs.existsSync(bin)) {
					process.env.CLEANSLATE_BROWSER_EXECUTABLE = bin;
					return;
				}
			}
		}
	} catch {
	// If we can't find a browser, the SDK will surface its own error.
	}
	// Fallback: use system Chrome/Chromium if available (Playwright cache may be corrupt).
	// /usr/bin/google-chrome-stable is a wrapper script — real binary at /opt/google/chrome/chrome.
	const sysBinaries = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
	for (const sysBin of sysBinaries) {
		if (fs.existsSync(sysBin)) {
			// Validate it's a real ELF binary
			try {
				const fd = fs.openSync(sysBin, 'r');
				const header = Buffer.alloc(4);
				fs.readSync(fd, header, 0, 4, 0);
				fs.closeSync(fd);
				if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
					process.env.CLEANSLATE_BROWSER_EXECUTABLE = sysBin;
					return;
				}
			} catch { /* not valid, try next */ }
		}
	}
}

/**
 * Builds a short human-readable description of what a tool call targets.
 * Used in the activity feed's detail field.
 */
function describeTarget(input) {
	if (!input || typeof input !== 'object') return undefined;
	if (input.url) return input.url;
	if (input.element || input.selector || input.ref) {
		const label = input.element ?? input.selector ?? input.ref;
		if (input.value !== undefined) {
			return `${label} = ${input.value}`;
		}
		return label;
	}
	if (input.text) return `"${input.text.slice(0, 60)}"`;
	if (input.key) return `⌨ ${input.key}`;
	if (input.query) return input.query;
	return undefined;
}
