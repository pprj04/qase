/**
 * Agent runtime: turns browser + model into an autonomous QA tester.
 *
 * Each session owns a CleanSlate SDK runtime with a headless Chromium. The
 * agent calls browser_* tools to explore the site, files findings via
 * report_finding, and finishes with finish_qa_report.
 */

import { getModelTier, getPublicConfig, getConfig } from './config.js';
import { addActivity, addMessage, emit, liveFor, listSessions, setStatus, updateActivity } from './store.js';
import { redact, secretNames } from './secrets.js';
import { createQaTools } from './qaTools.js';
import { notifyReport } from './webhooks.js';
import { runAutonomyPipeline } from './pipeline.js';
import { captureStep, finalizeStepOutcome } from './workflows.js';
// R6-T2 — screenshot artifact persistence (byte-store + registry the
// evidence graph references; NOT a parallel evidence system).
import { persistScreenshotArtifact } from './artifactStore.js';
import { buildQaContext } from './prompt.js';
import { attachBrowserBridge } from './browserBridge.js';
import { planSessionExecution, attachBrowserstackRuntime, BrowserStackMissionError } from './browserstackAgentRuntime.js';
import { resolveDeviceContext } from './deviceContext.js';
import { validateTargetUrl, classifyUrlFast, installPageBoundary } from './targetGuard.js';
import {
	createExecutionHealth, markExecutionComponent, completeExecutionHealth,
	classifyExecutionFailure, applyExecutionFailure, shouldRetryExecutionFailure,
	EXECUTION_RETRY_LIMIT, EXECUTION_RETRY_DELAY_MS
} from './executionHealth.js';
import { ALL_TOOLS, CleanSlateNodeAgentRuntime, createNodeProviderConfiguration } from '@cleanslate/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Keep the browser alive indefinitely between turns. */
const BROWSER_IDLE_MS = 0;
/** How many times to retry on a model timeout. */
const MODEL_TIMEOUT_RETRIES = EXECUTION_RETRY_LIMIT;
const MODEL_TIMEOUT_RETRY_DELAY_MS = EXECUTION_RETRY_DELAY_MS;
/**
 * Maximum wall-clock time a single session turn is allowed to run.
 * After this the turn is aborted and retried or marked as 'error'.
 * This wraps the ENTIRE runTurn call (all internal model turns).
 * Set to 20 minutes to allow a full mission of 20+ agent turns.
 *
 * D2.1 — configurable via QASE_SESSION_TIMEOUT_MINUTES (5–120, default 20).
 * Deep missions (maxTurns 300 observed at ~9s/turn) need more than 20 min;
 * the clamp keeps the runaway-protection purpose intact.
 */
function resolveSessionTimeoutMs() {
	const raw = process.env.QASE_SESSION_TIMEOUT_MINUTES;
	if (raw === undefined || raw === '' || raw === null) return 20 * 60 * 1000;
	const n = Number(raw);
	if (!Number.isInteger(n)) {
		console.warn(`[agent] QASE_SESSION_TIMEOUT_MINUTES="${raw}" is not an integer — using default 20 min.`);
		return 20 * 60 * 1000;
	}
	if (n < 5 || n > 120) {
		console.warn(`[agent] QASE_SESSION_TIMEOUT_MINUTES=${n} outside the 5–120 range — clamping to ${n < 5 ? 20 : 120} min.`);
		return (n < 5 ? 20 : 120) * 60 * 1000;
	}
	return n * 60 * 1000;
}
const SESSION_TURN_TIMEOUT_MS = resolveSessionTimeoutMs();
// D2.1 — exported for tests; production code reads SESSION_TURN_TIMEOUT_MS.
export { resolveSessionTimeoutMs as __resolveSessionTimeoutMs };

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

/** The tools the agent is allowed to use.
 * HOTFIX D — the browser tool surface now matches the SDK registry 1:1.
 * The registry ships no browser_close / browser_select_option /
 * browser_press_key / browser_navigate_back (those names were dead entries:
 * calls could never run), and browser_get_url / browser_check /
 * browser_select / browser_key are safe QA-useful SDK tools that were
 * previously gated off while still being advertised — every denial burned a
 * real turn. Filesystem, shell, web-fetch and worker tools remain denied. */
const ALLOWED_TOOLS = new Set([
	// SDK registry browser tools (all of them)
	'browser_open', 'browser_get_url', 'browser_snapshot',
	'browser_click', 'browser_hover', 'browser_fill', 'browser_check',
	'browser_select', 'browser_type', 'browser_key', 'browser_scroll',
	'browser_screenshot', 'browser_diagnostics', 'browser_dialog',
	'browser_tabs', 'browser_new_tab', 'browser_select_tab',
	'browser_close_tab', 'browser_wait',
	// QA tools (registered in qaTools.js) + interaction tools
	'update_todo', 'ask_question', 'report_finding', 'finish_qa_report',
	'set_viewport'
]);

/** Display labels for activity feed entries. */
const ACTIVITY_LABELS = {
	browser_open: 'Opening',
	browser_get_url: 'Reading URL',
	browser_click: 'Clicking',
	browser_type: 'Typing',
	browser_fill: 'Filling',
	browser_check: 'Checking control',
	browser_select: 'Selecting option',
	browser_key: 'Pressing key',
	browser_hover: 'Hovering',
	browser_scroll: 'Scrolling',
	browser_screenshot: 'Screenshot',
	browser_snapshot: 'Snapshot',
	browser_diagnostics: 'Diagnostics',
	browser_wait: 'Waiting',
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
/**
 * R2-B/G2 — wait for a session's in-flight turn to settle (bounded), then
 * dispose resources + remove the workspace. Stopping a mission aborts the
 * controller, but the SDK's model socket can take a moment to unwind; if we
 * rm the workspace immediately the runtime's .state writes re-create it.
 * Bounded poll on record.running; total wait ≤ ~10s.
 */
export async function settleThenDispose(sessionId, { log = console.error } = {}) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const record = liveFor(sessionId);
		if (!record?.running) break;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (liveFor(sessionId)?.running) {
		log(`[r2b-cleanup] ${sessionId} turn still running after settle window — disposing anyway`);
	}
	return disposeSessionResources(sessionId, { log });
}

/**
 * R2-B — workspace root for a session (single source of truth, matches
 * ensureRuntime's mkdirSync). null when the caller passed a non-session id.
 */
export function workspacePathFor(sessionId) {
	return sessionId ? path.join(process.cwd(), '.qase', 'workspaces', sessionId) : null;
}

/**
 * R2-B/G2 — deterministic per-session cleanup: dispose bridge + runtime,
 * then remove the session workspace. Idempotent (safe when the browser is
 * already dead / bridge disposed / workspace missing), observable on
 * failure, and never touches paths outside .qase/workspaces/<sessionId>.
 * Returns a structured result for diagnostics (E of the R2-B contract).
 */
export async function disposeSessionResources(sessionId, { log = console.error } = {}) {
	const result = { sessionId, browserDisposed: false, workspaceRemoved: false, error: null };
	if (!sessionId) return result;
	// R2-B/G2 — remove the workspace FIRST, synchronously: every caller is
	// terminal-intent and no post-terminal reader exists, so removal must not
	// depend on the browser dispose completing (a hung model socket can stall
	// the bridge suspend indefinitely). Scratch-only dir; force rm is
	// idempotent and already-missing is fine.
	const dir = workspacePathFor(sessionId);
	if (dir) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			result.workspaceRemoved = true;
		} catch (err) {
			result.error = `rm: ${err?.message ?? err}`;
			log(`[r2b-cleanup] ${sessionId} workspace remove failed: ${err?.message ?? err}`);
		}
	}
	try {
		const record = liveFor(sessionId);
		try {
			record?.dispose?.();
			result.browserDisposed = true;
		} catch (err) {
			result.error = result.error ? `${result.error}; dispose: ${err?.message ?? err}` : `dispose: ${err?.message ?? err}`;
			log(`[r2b-cleanup] ${sessionId} dispose failed: ${err?.message ?? err}`);
		}
		liveFor(sessionId).dispose = undefined;
	} catch (err) {
		result.error = `${result.error ? `${result.error}; ` : ''}${err?.message ?? err}`;
		log(`[r2b-cleanup] ${sessionId} cleanup failed: ${err?.message ?? err}`);
	}
	return result;
}

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

/**
 * P0-F2 — resource ownership: which sessions have a LEGITIMATE hold on
 * their live browser, so another mission starting must NOT close it.
 *
 * `running` — a turn is executing right now.
 * `awaiting_input` — the agent asked the user a question; the browser IS
 *   the session's working state and must survive until answered, expired,
 *   or cancelled.
 *
 * Terminal states (done/error/interrupted/cancelled) and bare `idle` have
 * NO ownership hold: their browsers may be reclaimed by closeOtherBrowsers
 * (idle stays resumable via closeBrowser's suspend semantics — unchanged
 * from the pre-F2 behavior).
 */
const BROWSER_HOLD_STATUSES = new Set(['running', 'awaiting_input']);

function browserHasActiveHold(summary) {
	if (!summary) return false;
	if (BROWSER_HOLD_STATUSES.has(summary.status)) return true;
	// Defensive: a live turn flag without a status stamp (transition window)
	// still owns its browser — never kill mid-flight.
	return Boolean(liveFor(summary.id)?.running);
}

/**
 * Closes every other session's browser, so only one non-holding browser
 * remains. P0-F2: sessions that OWN their browser (running / awaiting_input,
 * see browserHasActiveHold) are never touched here — cleanup for those
 * happens at their genuine lifecycle end (terminate/expire/cancel) through
 * disposeSessionResources / closeBrowser / runResourceCleanup.
 */
async function closeOtherBrowsers(keepSessionId) {
	await Promise.all(
		listSessions()
			.filter(summary => summary.id !== keepSessionId)
			.map(summary => (browserHasActiveHold(summary) ? undefined : closeBrowser(summary.id)))
	);
}

// P0-F2 — test seam: the ownership rule is behavioral and cross-module, so
// the sweep is exposed (name-mangled, never called by production code) for
// regression tests. Returns which sessions were left untouched.
export async function __closeOtherBrowsersForTests(keepSessionId) {
	await closeOtherBrowsers(keepSessionId);
	return listSessions()
		.filter(summary => summary.id !== keepSessionId && browserHasActiveHold(summary))
		.map(summary => summary.id);
}

export async function ensureRuntime(session) {
	const record = liveFor(session.id);
	if (record.runtime) {
		return record;
	}
	// R1-G7 — mark the kick as pending for the whole construction window:
	// set before ANY await, cleared on every exit path (success, thrown
	// error, early returns). The governor's stuck detector reads this so a
	// slow (not stuck) runtime construction is never mis-finalized.
	record.pendingRuntimeKick = true;
	try {
	await useBundledChromium();
	// HOTFIX A — prove Chromium launches BEFORE the mission starts. A
	// missing system library must surface as browser='blocked'/target=
	// 'pending' with a dependency-missing classification, never as a
	// mid-mission browser failure (or worse, a fabricated pass).
	const preflight = await preflightLocalBrowser();
	if (!preflight.ok) {
		// HOTFIX A — structured failure: the code travels with the error so
		// classifyExecutionFailure never has to re-derive it from a string.
		const actionable = preflight.code === 'BROWSER_RUNTIME_DEPENDENCY_MISSING'
			? 'The local browser cannot start — required system libraries are missing. Install the browser system dependencies (npx playwright install-deps chromium) and restart QASE, then retry the run.'
			: 'The local browser could not be started. Review the browser diagnostic, then retry the run.';
		const err = new Error(actionable);
		err.code = preflight.code;
		err.diagnostic = preflight.error;
		err.executable = preflight.executable;
		// Truthful health state: the browser is BLOCKED (not merely pending),
		// the target was never reached, and this is not retryable from within
		// the run — the operator must install the missing dependencies.
		session.executionHealth = markExecutionComponent(session.executionHealth ?? createExecutionHealth(), 'browser', 'blocked');
		session.executionHealth = markExecutionComponent(session.executionHealth, 'target', 'pending');
		throw err;
	}

	const settings = getModelTier('discovery');
	const problem = getPublicConfig().problem;
	if (problem) {
		throw new Error(`${problem} Open Settings and add the endpoint details.`);
	}

	// B1 W6 — mission-scoped turn budget. Mission context.maxTurns wins over
	// the stored-config default; both are bounded by the hard ceiling of 500
	// at the API layer. The SDK enforces its configured maxTurns internally;
	// runTurn() adds an independent abort on the SAME limit using the
	// assistant_turn_start stream events, so the enforcement does not depend
	// on the SDK alone.
	//
	// TURN METRIC (W6 contract definition): one "turn" = one
	// `assistant_turn_start` event emitted by the agent SDK stream, i.e. one
	// full agent-loop iteration (model invocation + its tool executions +
	// intermediate reasoning), NOT a single model invocation, tool call, or
	// streamed token. When the SDK internally performs sub-iterations within
	// one `assistant_turn_start` window (observed as several model ops per
	// turn), those count as ONE turn under this metric. session.turnCount is
	// incremented only on this event — never fabricated, never derived from
	// operation counts.
	//
	// Enforcement layering: the SDK enforces `maxTurns` first (observed to
	// stop exactly at the limit in every B1 run: 8→8, 3→3, 2→2). The
	// independent backstop below aborts when turnCount EXCEEDS the limit —
	// i.e. if the SDK ever let a (limit+1)-th turn start, the backstop fires
	// on that event and the recorded turnCount is limit+1 (truthful). The
	// agent is then granted ONE budget-exhausted wrap-up turn to produce a
	// report rather than dying silently; that wrap-up is recorded as part of
	// the same aborted run and the mission status names the budget reached.
	// Externally visible invariant: requested N → execution stops at N (SDK)
	// or N+1 with an honest abort record (backstop).
	const effectiveMaxTurns = Number.isInteger(session.maxTurns) && session.maxTurns >= 1
		? Math.min(session.maxTurns, 500)
		: Number(settings.maxTurns);

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
		maxTurns: effectiveMaxTurns,
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
	// D1 — turn-budget awareness at the tool-result seam. The SDK injects
	// additionalContext only on turns 0–1 (shouldRefreshContextForTurn), so
	// the buildQaContext budget block goes stale immediately. The model sees a
	// tool result EVERY turn; appending the live remaining-budget count to the
	// LAST tool result of each turn would need turn-boundary knowledge we don't
	// have here — instead we annotate the two wrap-up-relevant tools and rely
	// on the system context for the rest. See appendBudgetNote below.
	const turnLimitForBudget = Number.isInteger(session.maxTurns) && session.maxTurns >= 1
		? session.maxTurns
		: null;
	const budgetNote = () => {
		if (turnLimitForBudget == null) return '';
		const remaining = turnLimitForBudget - (Number(session.turnCount) || 0);
		if (remaining <= 0) return '';
		if (remaining > 10) return '';
		return `\n[BUDGET] ${remaining} turn(s) of ${turnLimitForBudget} left. If fewer than 8: stop opening new areas, call report_finding for anything confirmed, then call finish_qa_report BEFORE the budget runs out — a run that hits the wall gets no model-authored report and generates no test cases.`;
	};
	headless.executeTool = async function* (toolName, input, toolCallId, signal) {
		// HOTFIX D — deterministic browser tool-argument validation. A model
		// tool call that cannot possibly succeed (e.g. a click with no locator
		// and no x/y point) is rejected HERE, before it costs a browser
		// round-trip, and returns a repair hint the model can act on in one
		// turn. The SDK's own locator() would eventually throw the same class
		// of error, but only after the call reached the browser layer.
		let invalidBrowserToolResult = null;
		if (toolName === 'browser_click' || toolName === 'browser_hover') {
			const locatorKeys = ['elementId', 'selector', 'testId', 'role', 'label', 'placeholder', 'text'];
			const hasLocator = locatorKeys.some(k => typeof input?.[k] === 'string' && input[k].trim());
			const roleNeedsName = typeof input?.role === 'string' && input.role.trim()
				&& (input.name === undefined || String(input.name).trim() === '');
			const hasPoint = Number.isFinite(input?.x) && Number.isFinite(input?.y);
			if ((!hasLocator && !hasPoint) || roleNeedsName) {
				invalidBrowserToolResult = {
					type: 'tool_result', toolName, toolCallId,
					result: {
						success: false,
						code: 'invalid_tool_arguments',
						error: roleNeedsName
							? `${toolName} rejected: role "${input.role}" requires a "name" (accessible name). Take a browser_snapshot and retry with elementId, role+name, selector, or x/y coordinates.`
							: `${toolName} rejected: no element reference. Provide one of elementId (from the latest browser_snapshot), selector, role+name, label, placeholder, text, or explicit x AND y coordinates.`
					}
				};
			}
		}
		// onToolStart became async (M1-P4.1 target validation) — its result is
		// not needed for the tool stream, so drift is fine.
		void Promise.resolve(record.onToolStart?.(toolName, input, toolCallId)).catch(() => {});
		if (invalidBrowserToolResult) {
			yield invalidBrowserToolResult;
			return;
		}
		const iterator = originalExecute(toolName, input, toolCallId, signal);
		let wrapped = false;
		for await (const part of iterator) {
			if (!wrapped && turnLimitForBudget != null && (part?.type === 'tool_result')
				&& !['finish_qa_report', 'ask_question'].includes(toolName)) {
				wrapped = true;
				const note = budgetNote();
				if (note && part.result && typeof part.result === 'object') {
					// Annotate a COPY — never mutate SDK-owned result objects.
					yield { ...part, result: { ...part.result, budget_note: note.trim() } };
					continue;
				}
			}
			yield part;
		}
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

	// C4 — BrowserStack attachment for explicitly-requesting sessions.
	// Ordering contract (spec §2.4): targetGuard wrap FIRST, then this attach,
	// then the local device wrap — and the device wrap is SKIPPED for
	// BrowserStack sessions (device semantics come from the caps; a BS
	// real-device page IS the device). Attach failure throws
	// BrowserStackMissionError — the mission fails truthfully; the runtime is
	// disposed below via the catch-all so no local Chromium is ever launched
	// as a substitute.
	const executionPlan = planSessionExecution(session, { config: getConfig() });
	if (executionPlan.mode === 'error') {
		try { runtime.dispose(); } catch { /* not started */ }
		throw new BrowserStackMissionError(executionPlan.error, { code: executionPlan.code });
	}
	if (executionPlan.mode === 'browserstack') {
		try {
			await attachBrowserstackRuntime(service, session, { config: getConfig() });
		} catch (attachError) {
			try { runtime.dispose(); } catch { /* not started */ }
			throw attachError;
		}
	}

	// ── Mobile/tablet device context (real emulation, not a CSS resize) ──
	// The SDK creates the browser context lazily with a fixed desktop
	// viewport. When a mission selected a device, the first page registration
	// recreates the context with the REAL Playwright device descriptor
	// (UA, viewport, DPR, isMobile, hasTouch). Desktop missions never take
	// this path — their context is created exactly as before.
	// C4: BrowserStack sessions skip this — their context was created with
	// real-device options at attach time.
	const deviceContext = executionPlan.mode === 'browserstack'
		? null
		: resolveDeviceContext(session.deviceRequest ?? null);
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
	record.pendingRuntimeKick = false;
	return record;
	} finally {
		// R1-G7 — clear on the throw path too: a FAILED kick is not a pending
		// kick; the stuck detector may legitimately finalize after it.
		record.pendingRuntimeKick = false;
	}
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
export async function runTurn(session, { task, resumeAnswer, retryAttempt = 0, hooks = null }) {
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
	if (!session.executionHealth || session.executionHealth.overall === 'failed') {
		const settings = getConfig();
		session.executionHealth = createExecutionHealth({
			provider: settings.provider,
			executionProvider: session.executionProvider ?? 'local'
		});
		emit(session, 'execution_health', { health: session.executionHealth });
	}

	// A turn that paused for credentials or a question stops its frame timer in
	// finally. Resuming continues on the existing page and may never call
	// browser_open again, so restart the stream here instead of waiting for a
	// navigation tool that might not come. Capture immediately to replace the
	// stale pre-pause frame before the agent's next action is shown.
	if (bridge.hasPage()) {
		bridge.startFrames();
		void bridge.captureFrame();
	} else {
		// P0-F5 — the browser was closed while this session was paused
		// (idle timer / reclaimed / died). It will be recreated lazily by the
		// next browser tool call, and restoreSession restarts the stream at
		// that moment. Tell the panel the truth in the meantime: the browser
		// is being re-established, not permanently absent. Without this the
		// UI sits on "No browser yet" while the agent visibly keeps working.
		emit(session, 'browser', { browser: { url: null, title: null, loading: true, action: 'reconnecting' } });
	}

	// Only the session being worked on keeps a browser open.
	void closeOtherBrowsers(session.id);

	// Message-shaped placeholders the streamed text accumulates into. Reasoning
	// gets its own bubble so the transcript can show the agent's thinking
	// alongside what it actually said, and so both survive a page reload.
	let assistant;
	let thinking;
	let retryAfterTimeout = false;

	// B1 W6 — independent turn enforcement. The SDK owns its own maxTurns,
	// but the contract must not depend on SDK behavior alone: count
	// assistant_turn_start events and hard-abort (with truthful recording)
	// once the limit is exceeded. This also gives the UI/API an honest
	// session.turnCount instead of a fabricated number.
	//
	// B2 fix — turnCount is now CUMULATIVE across every runTurn call in the
	// session's life (resumes, timeout retries, wrap-up continuations). Two
	// bugs this closes:
	//   1. The SDK builds a FRESH CleanSlateExecutionBudget per runTurn call
	//      (cleanSlateNodeAgentRuntime.js runMessages → new
	//      CleanSlateExecutionBudget(...)), so a "one wrap-up turn"
	//      continuation used to receive a brand-new full budget — the agent
	//      could silently spend another N turns on top of an exhausted
	//      budget (observed live: turnCount 6 → wrap-up call ran ~6 more
	//      SDK turns, while the recorded count showed 2).
	//   2. `let turnCount = 0` here OVERWROTE session.turnCount with the
	//      per-call count, hiding that spend from the API, the turn pool,
	//      and the decision engine.
	// A session is one mission iteration; only its FIRST runTurn call
	// starts from zero. The count still only moves on
	// assistant_turn_start — never fabricated, never derived from
	// operation counts.
	const turnLimit = Number.isInteger(session.maxTurns) && session.maxTurns >= 1
		? Math.min(session.maxTurns, 500)
		: null; // global default is enforced by the SDK only
	let turnCount = 0;
	if (session._turnsStarted) {
		turnCount = Number(session.turnCount) || 0; // continuation — cumulative
	} else {
		session._turnsStarted = true;
	}
	let limitAborted = false;
	// C3 (Phase 5) — set when the mid-session autonomy probe requested an
	// early settle through the abort seam (distinct from a budget abort).
	let earlyStopRequested = false;
	// B2 HARD INVARIANT — turnCount can NEVER exceed the authorized limit:
	//   turnCount > limit is only reachable when the SDK itself disobeys its
	//   own budget, and in that case the (limit+1)-th turn is ABORTED the
	//   instant it starts — recorded truthfully as an overspend event, never
	//   allowed to complete. The earlier B1 "one wrap-up model turn"
	//   concession (abort at limit+2) is REMOVED: a budget-exhausted session
	//   is closed out deterministically by finalizeTurnLimitedRun() at ZERO
	//   model cost. A budget of N can now spend at most N turns, full stop.
	const abortThreshold = turnLimit;

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
	// D2.1 — flag the abort cause so the catch cascade can attribute it
	// truthfully (wall-clock timeout, NOT turn budget, NOT user stop).
	let timeoutWallClock = false;
	let turnTimeoutTimer = setTimeout(() => {
		if (!controller.signal.aborted) {
			timeoutWallClock = true;
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
					session.executionHealth = markExecutionComponent(session.executionHealth, 'provider', 'healthy');
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
					// B1 W6 — count and enforce the mission turn budget.
					turnCount += 1;
					session.turnCount = turnCount;
					// C3 (Phase 5) — mid-session decision probe at a deterministic
					// boundary (every K turns, mission-linked sessions only). The
					// probe is read-only, never blocks the stream, and can only
					// REQUEST an early settle through the SAME abort seam the
					// budget uses. Fire-and-forget by design.
					if (typeof hooks?.onTurnBoundary === 'function') {
						try {
							const probe = hooks.onTurnBoundary(session, turnCount);
							if (probe && typeof probe.earlyStopRequested === 'boolean' && probe.earlyStopRequested) {
								limitAborted = false; // not a budget abort — an autonomy early-stop request
								controller.abort();
								earlyStopRequested = true;
							}
						} catch { /* probe is best-effort — never break the turn */ }
					}
					if (abortThreshold != null && turnCount > abortThreshold) {
						limitAborted = true;
						console.log(`[agent] turn limit (${turnLimit ?? 'wrap-up'}) exceeded (cumulative ${turnCount}) — aborting mission turn budget`);
						// B2 fix — the SDK's SSE emitter can surface the abort as
						// an exception thrown OUTSIDE this iterator (event
						// handler → process tick), escaping the catch below. The
						// abort is still required (it stops model spend); the
						// process-level guards in index.js convert the resulting
						// "Request was aborted" exception into a logged budget
						// stop instead of a server crash.
						controller.abort();
					}
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
					if (part.toolName?.startsWith('browser_')) {
						if (ok) {
							session.executionHealth = markExecutionComponent(session.executionHealth, 'browser', 'healthy');
							if (part.toolName === 'browser_open') {
								session.executionHealth = markExecutionComponent(session.executionHealth, 'target', 'healthy');
							}
						} else {
							const issue = classifyExecutionFailure(result?.error ?? result?.message ?? 'Browser action failed', {
								stage: 'browser_tool', toolName: part.toolName,
								executionProvider: session.executionProvider ?? 'local'
							});
							session.executionHealth = applyExecutionFailure(session.executionHealth, issue, { terminal: false });
						}
						emit(session, 'execution_health', { health: session.executionHealth });
					}
					updateActivity(session, id, {
						status: ok ? 'done' : 'failed',
						error: ok ? undefined : (result?.error ?? result?.message),
						summary: summariseResult(part.toolName, result)
					});
					// B1: Finalize the captured step's outcome from the tool result
					finalizeStepOutcome(session, part.toolCallId, part.toolName, result);
					openActivities.delete(part.toolCallId);

					// R6-T2 — persist REAL screenshot bytes when the
					// browser_screenshot tool produced them. Runs after the
					// step outcome is finalized so the artifact facts attach
					// to the captured step (and from there into the existing
					// STEP_OUTCOME evidence node — no duplicate nodes).
					// Truth table: captureAttempted always true for this tool;
					// artifactPersisted only when bytes landed on disk;
					// failure keeps the textual outcome AND records why.
					if (part.toolName === 'browser_screenshot') {
						try {
							const b64 = firstScreenshotBase64(result);
							const art = persistScreenshotArtifact({
								sessionId: session.id,
								missionId: session.missionId ?? null,
								ownerUserId: session.ownerUserId ?? null,
								toolCallId: part.toolCallId ?? null,
								base64: b64,
								mimeType: firstScreenshotMime(result),
								url: result?.url ?? null,
								title: result?.title ?? null
							});
							const step = session.capturedSteps?.find(s => s.toolCallId === part.toolCallId);
							if (step) {
								step.screenshot = {
									captureAttempted: true,
									persisted: art.persisted,
									artifactId: art.artifactId ?? null,
									status: art.status,
									bytes: art.bytes ?? 0,
									error: art.error ?? null,
									capturedAt: art.capturedAt
								};
							}
						} catch (artifactErr) {
							const step = session.capturedSteps?.find(s => s.toolCallId === part.toolCallId);
							if (step) {
								step.screenshot = {
									captureAttempted: true,
									persisted: false,
									artifactId: null,
									status: 'write_failed',
									bytes: 0,
									error: String(artifactErr?.message ?? artifactErr),
									capturedAt: Date.now()
								};
							}
						}
					}

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
			session.executionHealth = completeExecutionHealth(session.executionHealth);
			emit(session, 'execution_health', { health: session.executionHealth });
			setStatus(session, 'done');
			// Phase 1: Dispose browser resources when the session is done.
			// The conversation and report survive on disk; the Chromium
			// process should not linger consuming memory.
			void closeBrowser(session.id);
			record.dispose?.();
		} else {
			// B2 HARD INVARIANT — the SDK stopped at the turn limit with no
			// report (or the backstop aborted an overspending (N+1)-th turn).
			// There is NO budget left for another model turn, so the session
			// is settled 'done' immediately and finalizeTurnLimitedRun()
			// compiles the honest report DETERMINISTICALLY from the evidence
			// already collected (zero model turns). Budget N ⇒ ≤ N turns.
			session.executionHealth = completeExecutionHealth(session.executionHealth);
			emit(session, 'execution_health', { health: session.executionHealth });
			setStatus(session, 'done');
			void closeBrowser(session.id);
			record.dispose?.();
		}
		} catch (error) {
		if (limitAborted) {
			// B1 W6 / B2 — the mission turn budget was consumed or overspent.
			// This is NOT an error and NOT retryable: the session records the
			// TRUE turn count (which may read limit+1 when the SDK disobeyed
			// — recorded honestly, never allowed to complete work) and is
			// closed out deterministically by finalizeTurnLimitedRun().
			session.turnCount = turnCount;
			setStatus(session, 'done');
			addMessage(session, {
				role: 'system',
				text: `Turn budget of ${turnLimit} was reached. The agent was stopped after ${turnCount} turns.`,
				kind: 'error'
			});
			void closeBrowser(session.id);
			record?.dispose?.();
		} else if (earlyStopRequested) {
			// C3 (Phase 5) — the mid-session autonomy probe saw decision-grade
			// fail evidence (confirmed criticals / escalation-worthy state) and
			// REQUESTED an early settle. This is not an error: the session is
			// marked done and the NORMAL finalize path runs the authoritative
			// settle-gate decision (which may confirm STOP_FAIL with full
			// evidence — or disagree and continue). The probe never fabricates
			// a verdict; it only stops spending on a confirmed-bad target.
			session.turnCount = turnCount;
			setStatus(session, 'done');
			addMessage(session, {
				role: 'system',
				text: `Autonomy probe requested early settle after ${turnCount} turns (decision-grade evidence seen). Final verdict is computed by the settle gate.`,
			});
			void closeBrowser(session.id);
			record?.dispose?.();
		} else if (idleAborted) {
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
		} else if (timeoutWallClock) {
			// D2.1 — wall-clock session timeout. Not an error, not a budget
			// event, not a user stop: the run exceeded its authorized
			// wall-clock window. Settled 'done' so finalizeTurnLimitedRun()
			// compiles the honest deterministic report with TRUE attribution
			// (stopCause='wall_clock_timeout'); zero further model turns.
			session.turnCount = turnCount;
			session.stopCause = 'wall_clock_timeout';
			setStatus(session, 'done');
			addMessage(session, {
				role: 'system',
				text: `Session wall-clock timeout of ${SESSION_TURN_TIMEOUT_MS / 60000} minutes reached at turn ${turnCount}${turnLimit != null ? ` of ${turnLimit}` : ''}. Closing out from the evidence collected so far.`,
				kind: 'error'
			});
			void closeBrowser(session.id);
			record?.dispose?.();
		} else if (controller.signal.aborted) {
			setStatus(session, 'idle', 'Stopped by user.');
		} else if (shouldRetryExecutionFailure(
			classifyExecutionFailure(error, { stage: 'agent_turn', executionProvider: session.executionProvider ?? 'local' }),
			retryAttempt, MODEL_TIMEOUT_RETRIES
		)) {
			const issue = classifyExecutionFailure(error, { stage: 'agent_turn', executionProvider: session.executionProvider ?? 'local' });
			retryAfterTimeout = true;
			session.executionHealth = applyExecutionFailure(session.executionHealth, issue, {
				terminal: false, retryAttempt, maxRetries: MODEL_TIMEOUT_RETRIES
			});
			emit(session, 'execution_health', { health: session.executionHealth });
			setStatus(
				session,
				'running',
				`${issue.summary} Retrying automatically (${retryAttempt + 1}/${MODEL_TIMEOUT_RETRIES})…`
			);
		} else {
			const issue = classifyExecutionFailure(error, { stage: 'agent_turn', executionProvider: session.executionProvider ?? 'local' });
			session.executionHealth = applyExecutionFailure(session.executionHealth, issue, {
				terminal: true, retryAttempt, maxRetries: MODEL_TIMEOUT_RETRIES
			});
			emit(session, 'execution_health', { health: session.executionHealth });
			addMessage(session, { role: 'system', text: `${issue.summary} ${issue.nextAction}`, kind: 'error', failureCode: issue.code });
			setStatus(session, 'error', issue.summary);
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
			task: 'Continue from the latest transcript and browser state. The previous model request failed temporarily after the last successful step. Inspect the current state before acting, do not repeat completed or irreversible actions, and finish the remaining test plan.',
			retryAttempt: retryAttempt + 1,
			hooks
		});
	}
}

/**
 * B2 — DETERMINISTIC turn-budget close-out. ZERO model turns.
 *
 * When a turn-limited mission exhausts its budget without the agent calling
 * finish_qa_report, this compiles an honest report from the evidence ALREADY
 * collected (findings, coverage, visited pages/steps). It runs synchronously,
 * writes the same session.report shape the agent's own tool produces, and
 * explicitly marks the run as stopped at the budget.
 *
 * This replaces the B1 "one wrap-up model turn" design, whose fresh SDK
 * budget could spend up to 2 extra turns (observed live: authorized 6,
 * spent 8). Under B2's invariant, budget N ⇒ at most N model turns; the
 * close-out costs none.
 */
export function finalizeTurnLimitedRun(session) {
	if (!['done', 'idle'].includes(session.status)) return false;
	if (session.report) return false; // the agent filed its own report — nothing to do

	const findings = session.findings ?? [];
	const covered = (session.capturedSteps ?? [])
		.map(step => step?.title || step?.url || step?.label)
		.filter(Boolean);
	const uniqueCovered = [...new Set(covered)];
	const turnLimit = Number.isInteger(session.maxTurns) ? session.maxTurns : null;
	// D2.1 — truthful attribution: a wall-clock stop is NOT a budget stop.
	const wallClock = session.stopCause === 'wall_clock_timeout';

	session.report = {
		ts: Date.now(),
		// HOTFIX B — a run that hit the wall did NOT finish testing. Whatever
		// the findings say, the verdict must not read as a normal pass:
		// budget/wall-clock exhaustion is at best 'pass_with_issues' with an
		// explicit incomplete marker, never a clean pass.
		verdict: findings.some(f => f.severity === 'critical')
			? 'fail'
			: findings.length > 0
				? 'pass_with_issues'
				: 'inconclusive',
		executionOutcome: 'incomplete',
		outcomeReason: wallClock
			? 'session_wall_clock_timeout'
			: 'turn_budget_exhausted',
		summary: wallClock
			? `Run stopped at the session wall-clock timeout (${SESSION_TURN_TIMEOUT_MS / 60000} min, reached at turn ${Number(session.turnCount) || '?'}${turnLimit != null ? ` of ${turnLimit}` : ''}). ` +
				`This report was compiled deterministically from the evidence already collected (${findings.length} finding(s), ${uniqueCovered.length} covered area(s)); no additional testing was performed after the timeout.`
			: `Run stopped at the authorized turn budget${turnLimit != null ? ` (${turnLimit} turns)` : ''}. ` +
				`This report was compiled deterministically from the evidence already collected (${findings.length} finding(s), ${uniqueCovered.length} covered area(s)); no additional testing was performed after the budget was reached.`,
		covered: uniqueCovered,
		notCovered: [],
		recommendations: [
			wallClock
				? 'Rerun with a higher session timeout (QASE_SESSION_TIMEOUT_MINUTES) or a tighter scope so the run can complete its plan.'
				: 'Rerun with a higher authorized turn budget for deeper coverage of areas not yet explored.',
			...findings.slice(0, 5).map(f => `${f.severity?.toUpperCase() ?? 'ISSUE'}: ${f.title ?? 'finding'} — ${f.recommendation ?? f.description ?? ''}`.trim())
		],
		targetUrl: session.targetUrl ?? null,
		findings,
		bySeverity: findings.reduce((acc, f) => {
			const key = f.severity ?? 'unknown';
			acc[key] = (acc[key] ?? 0) + 1;
			return acc;
		}, {}),
		// Truthfulness marker: this close-out is deterministic, not model-authored.
		deterministicCloseOut: true
	};
	addMessage(session, {
		role: 'system',
		text: session.report.summary,
		kind: 'info'
	});
	// Deterministic post-hoc analysis — a CURATED subset of the capability
	// pipeline the agent's own finish_qa_report triggers (application
	// understanding, feature gaps → findings, mission finalize, decision
	// engine, knowledge write). These stages derive findings from evidence
	// ALREADY collected; none of them spend model turns. The expensive
	// auxiliary stages (test generation, browser smoke runs, schedules,
	// per-finding dev-intelligence LLM analysis) are skipped — a close-out
	// must settle in seconds-to-a-minute, not the 20+ minutes the full
	// pipeline can take. The flag lets finalizeMissionFromSession WAIT for
	// these findings before it writes the mission's terminal state (racing
	// it produced 'pass/100 with 0 findings' while 20 gap findings arrived
	// 20 minutes later).
	session._closeOutPipeline = true;
	session._deterministicCloseOut = true; // feature_gap skips enhanceGapsWithLLM
	emit(session, 'report', { report: session.report });
	notifyReport(session); // fire-and-forget webhook
	runAutonomyPipeline(session, {
		capabilityFilter: id => !['test_generation', 'smoke_run', 'schedule_create', 'dev_intelligence'].includes(id)
	}).catch(err => {
		// runAutonomyPipeline's own finally clears _closeOutPipeline; this
		// catch only logs — the mission still finalizes from the
		// deterministic report (possibly 0 findings, verdict 'inconclusive'),
		// never a fabricated pass.
		console.error(`[agent] deterministic close-out pipeline failed for ${session.id}:`, err?.message ?? err);
	});
	return true;
}

/**
 * R6-T2 — locate screenshot bytes in a browser_screenshot tool result.
 * SDK result shapes vary by provider (flat base64 / dataUrl / nested
 * image|screenshot object); accept the known ones, return null otherwise —
 * the artifact path then truthfully records not_attempted rather than
 * fabricating an artifact from a text-only result.
 */
function firstScreenshotBase64(result) {
	if (!result || typeof result !== 'object') return null;
	if (typeof result.base64 === 'string' && result.base64.length > 0) return result.base64;
	if (typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
		const comma = result.dataUrl.indexOf(',');
		if (comma > 0) return result.dataUrl.slice(comma + 1);
	}
	const nested = result.image ?? result.screenshot ?? result.artifact;
	if (nested && typeof nested === 'object') {
		if (typeof nested.base64 === 'string' && nested.base64.length > 0) return nested.base64;
		if (typeof nested.dataUrl === 'string' && nested.dataUrl.startsWith('data:')) {
			const comma = nested.dataUrl.indexOf(',');
			if (comma > 0) return nested.dataUrl.slice(comma + 1);
		}
	}
	return null;
}

function firstScreenshotMime(result) {
	if (typeof result?.mimeType === 'string' && result.mimeType.startsWith('image/')) return result.mimeType;
	if (typeof result?.dataUrl === 'string' && result.dataUrl.startsWith('data:image/')) {
		return result.dataUrl.slice(5, result.dataUrl.indexOf(';')) || 'image/jpeg';
	}
	return 'image/jpeg';
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
 * HOTFIX A — BROWSER RUNTIME PREFLIGHT.
 *
 * Proves the local Chromium can actually LAUNCH (process start + CDP
 * handshake) before any mission declares local-browser execution available.
 * An ELF-valid binary with missing shared libraries (libglib-2.0.so.0 etc.)
 * passes every file-level check and still fails at launch — so the only
 * honest preflight is a real launch. The result is cached for the process
 * lifetime: a Chromium that launched once keeps launching.
 *
 * Returns { ok, code, executable, error }. On failure code is
 * 'BROWSER_RUNTIME_DEPENDENCY_MISSING' (shared-library class) or
 * 'BROWSER_LAUNCH_FAILED' — callers set executionHealth
 * browser='blocked', target='pending' and never declare local execution
 * available.
 */
let browserPreflightResult = null;
export async function preflightLocalBrowser() {
	if (browserPreflightResult) return browserPreflightResult;
	await useBundledChromium();
	const executable = process.env.CLEANSLATE_BROWSER_EXECUTABLE;
	if (!executable) {
		browserPreflightResult = { ok: false, code: 'BROWSER_RUNTIME_DEPENDENCY_MISSING', executable: null, error: 'No Chromium executable found in the Playwright cache or on the system.' };
		return browserPreflightResult;
	}
	try {
		const { chromium } = await import('playwright');
		const browser = await chromium.launch({ headless: true, executablePath: executable, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
		await browser.close();
		browserPreflightResult = { ok: true, code: null, executable, error: null };
	} catch (error) {
		const msg = String(error?.message ?? error);
		// HOTFIX A — classify against the FULL message; Playwright's
		// shared-library evidence can sit thousands of chars into the error
		// text (observed at position ~2061 of 4763). Truncate only AFTER
		// classification, and keep the structured `code` authoritative.
		const dependencyMissing = /error while loading shared librar|cannot open shared object|\.so(\.\d+)?[^ ]*not found|cannot find.*lib/i.test(msg);
		browserPreflightResult = {
			ok: false,
			code: dependencyMissing ? 'BROWSER_RUNTIME_DEPENDENCY_MISSING' : 'BROWSER_LAUNCH_FAILED',
			executable,
			error: msg.slice(0, 2000)
		};
	}
	return browserPreflightResult;
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
