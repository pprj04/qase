/**
 * LLM-powered test case generation.
 *
 * Given a saved workflow (its steps) and optionally the findings from the
 * session that produced it, asks the model to produce structured test cases
 * with steps and assertions that can later be replayed by the replay engine.
 *
 * The call is a direct OpenAI-compatible /chat/completions request — no
 * browser, no agent runtime.  The task is structured-data generation.
 */

import { getModelTier, VIEWPORT_PRESETS } from './config.js';
import { classifyError, isRetryableType, ERROR_TYPES } from './errorTypes.js';

/* ── Prompt construction ────────────────────────────────────────── */

/**
 * Builds the system + user messages for the LLM.
 *
 * @param {object} workflow  — the saved workflow with its steps
 * @param {array}  findings  — findings from the origin session (optional)
 */
export function buildTestCasePrompt(workflow, findings = []) {
	const system = `You are a senior QA engineer. You analyse user workflows captured from a website and produce structured, replayable test cases.

Each workflow is a sequence of browser actions (navigate, click, fill, select, key, scroll, hover, screenshot, diagnostics, snapshot). Each action has:
  - action: the verb
  - target: a CSS selector or descriptive label
  - value: the input value (if any)
  - displayLabel: a human-readable description

You must produce 1-3 test cases. Group actions that test a single user flow into one test case. Each test case MUST be compact: at most 8 steps, at most 5 assertions, at most 3 preconditions — the response is size-limited and truncated JSON is a hard failure. Each test case must have:
  - name: short, descriptive (e.g. "Login with valid credentials")
  - severity: "critical" | "high" | "medium" | "low" (impact if this flow breaks)
  - preconditions: array of strings (e.g. "User must be logged out")
  - steps: array of { action, target, value, description } — the replay steps
  - assertions: array of { type, target, expected, description }
  - viewport: the primary viewport for this test ("desktop", "tablet", "mobile", or "mobile_small")
  - viewports: array of additional viewports to also run this test at (for multi-viewport coverage)

Viewport presets: desktop (1440×900), tablet (768×1024), mobile (375×812), mobile_small (320×568).
Rules for viewport assignment:
  - Default to "desktop" if the flow is a standard web interaction.
  - If the workflow was captured at a specific viewport (e.g. mobile), set that as primary.
  - For navigation and layout-critical flows, add "tablet" and "mobile" to the viewports array for cross-device coverage.
  - For forms and input-heavy flows, default to desktop only.

Assertion types you can use:
  - url_is: current URL must exactly match expected
  - url_contains: current URL must contain expected substring
  - element_visible: an element matching target selector must be visible
  - element_hidden: an element matching target selector must NOT be visible
  - element_text: element matching target must contain expected text
  - element_enabled: element matching target must be enabled/clickable
  - no_console_errors: browser console must have no error-level messages
  - no_failed_requests: no network requests should have failed (4xx/5xx)
  - status_code: the expected HTTP status code

Rules:
  - Convert each workflow step into a test step. Use the workflow step's action/target/value directly.
  - SELECTOR GROUNDING: a step's target must be a CSS selector that Playwright locator() accepts (#id, .class, tag, [attr], a[href="..."], or a structural path with > combinators). If the workflow step's target is a human label or free text ("Save", "Lead Name", "textbox"), find the matching element's real selector from the workflow context; if you cannot determine it, OMIT that step rather than emit an unrunnable one. Never invent selectors for elements not present in the workflow.
  - ASSERTION GROUNDING: every assertion's target must be a real selector from the workflow steps and its expected value must come from what the workflow actually observed (values filled, sections navigated to). Do NOT invent assertions for elements or values that do not appear in the workflow.
  - ASSERTIONS RUN ONCE, AFTER ALL STEPS: expectations must describe the FINAL page state after the last step, never intermediate states. If the flow visits A then B, an assertion expecting the URL of A will fail by construction — only assert the end state.
  - NO INVENTED PERSISTENCE: only expect data to survive a reload when the workflow OBSERVED that (e.g. a value still present after a reload step). Demo apps often reset state on reload — if not observed, assert visibility/URL only.
  - Add at least one assertion after every critical action (navigation, form submit, login).
  - Keep credential placeholders like {{QA_PASSWORD}} exactly as-is — do not replace them.
  - If findings are provided, add assertions that specifically check for the bugs that were found.
  - Be concrete and specific. "Page loads" is too vague; "URL contains /dashboard" is good.
  - COMPACT OUTPUT: one step/assertion object per line, no unnecessary whitespace. The JSON array must be complete — pick fewer test cases rather than running out of output.

Respond with ONLY a JSON array of test cases. No markdown, no explanation, just the JSON.`;

	const workflowSummary = workflow.steps.map((step, i) => {
		const parts = [`${i + 1}. ${step.displayLabel ?? step.action}`];
		if (step.target) parts.push(`target: ${step.target}`);
		if (step.value) parts.push(`value: ${step.value}`);
		if (step.url && step.url !== workflow.targetUrl) parts.push(`on: ${step.url}`);
		// Grounding hint: outcome carries what actually happened (post-click
		// URL, page title) so the model can derive REAL assertions instead of
		// inventing expected values.
		const outcome = step.outcome;
		if (outcome && outcome.status === 'success' && (outcome.urlAfter || outcome.titleAfter)) {
			const seen = [outcome.urlAfter ? `landed on ${outcome.urlAfter}` : null, outcome.titleAfter ? `title "${outcome.titleAfter}"` : null]
				.filter(Boolean).join(', ');
			if (seen) parts.push(`observed: ${seen}`);
		}
		return parts.join(' | ');
	}).join('\n');

	const findingsSummary = findings.length > 0
		? findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}: ${f.actual}`).join('\n')
		: 'No findings from the original session.';

	const user = `Target site: ${workflow.targetUrl || 'unknown'}

Captured workflow: "${workflow.name}" (${workflow.steps.length} steps)
${workflowSummary}

Workflow viewport: ${workflow.viewport ? `${workflow.viewport.label ?? JSON.stringify(workflow.viewport)} (${workflow.viewport.width}×${workflow.viewport.height})` : 'desktop (1440×900)'}

Known findings from the original session:
${findingsSummary}

Generate test cases from this workflow. Remember: at most 3 test cases, compact JSON, complete array — respond with ONLY a JSON array.`;

	return { system, user };
}

/* ── LLM call ───────────────────────────────────────────────────── */

/**
 * Classifies an LLM error to determine whether it is retryable.
 *
 * Phase 1: delegates to the centralized classifyError() in errorTypes.js
 * so that error classification is consistent across the entire codebase.
 * Kept for backward compatibility — existing callers (selfHeal.js,
 * devIntelligence.js) import this function.
 */
export function isRetryableLLMError(error) {
	if (!error) return false;
	const type = classifyError(error);
	return isRetryableType(type);
}

const LLM_MAX_RETRIES = 2;
const LLM_RETRY_DELAY_MS = 3000;

/**
 * True when the error is the deterministic max_tokens truncation error.
 * A capped response will not get longer on retry — retrying wastes 40–120s
 * per attempt and delays the honest failure signal. The truncation-tolerant
 * parser in the caller salvages complete objects; if none parse, the error
 * surfaces immediately.
 */
function isMaxTokensTruncation(error) {
	return error?.finishReason === 'length';
}

/**
 * Makes a direct OpenAI-compatible chat completion request using the
 * project's configured model credentials. Returns the raw text response.
 *
 * Retries transient failures (timeout, 429, 5xx, empty response, network)
 * up to LLM_MAX_RETRIES times with LLM_RETRY_DELAY_MS delay between attempts.
 * Non-retryable failures (auth, bad request) are thrown immediately.
 */
export async function callLLM(systemPrompt, userPrompt) {
	const config = getModelTier('execution');

	if (!config.apiKey) {
		throw new Error('No API key configured. Open Settings and add your key.');
	}

	const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
	const url = `${baseUrl}/chat/completions`;

	// Build the message array. Some gateways reject a system role on
	// follow-up turns; since this is always a single-turn request, it's safe.
	const messages = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt }
	];

	const body = {
		model: config.model,
		messages,
		// D1: 4096 truncated real 85-step workflows mid-JSON-array (finish_reason
		// 'length') and parse failures surfaced as 'Could not find JSON in the
		// LLM response.' 16384 fits observed real-workflow test-case payloads;
		// if a response still hits the cap the finish_reason check below reports
		// it honestly instead of silently parsing garbage.
		max_tokens: 16_384
	};
	let finishReason = null;

	let lastError;
	for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			await new Promise(resolve => setTimeout(resolve, LLM_RETRY_DELAY_MS));
			console.error(`[llm] Retry attempt ${attempt}/${LLM_MAX_RETRIES} after: ${lastError.message}`);
		}

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.apiKey}`
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(120_000)
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => '');
				const err = new Error(`LLM request failed (${response.status}): ${errorText.slice(0, 300)}`);
				err.status = response.status;
				throw err;
			}

			const data = await response.json();
			const content = data?.choices?.[0]?.message?.content;
			finishReason = data?.choices?.[0]?.finish_reason ?? null;

			if (!content) {
				throw new Error('LLM returned an empty response.');
			}

			if (finishReason === 'length') {
				// Truncated output. Never masquerade as complete: mark the
				// error and attach the partial content so the caller can
				// salvage COMPLETE objects (parseTestCases' truncation-tolerant
				// builder) or fail honestly when nothing parses.
				const err = new Error(`LLM response hit the max_tokens limit (${body.max_tokens}) and was truncated.`);
				err.finishReason = 'length';
				err.partialContent = content;
				throw err;
			}

			return content;
		} catch (error) {
			lastError = error;
			if (isMaxTokensTruncation(error)) throw error;
			if (!isRetryableLLMError(error) || attempt >= LLM_MAX_RETRIES) {
				throw error;
			}
		}
	}

	throw lastError;
}

/* ── Response parsing ───────────────────────────────────────────── */

/**
 * True when the array text has a closing bracket after the opening one.
 */
function hasCloseBracket(text, start, end) {
	return end !== -1 && start !== -1 && end > start;
}

/**
 * Builds a closed-array candidate from a truncated LLM response.
 * Finds the last COMPLETE object boundary — a "}," separator or a "}" at the
 * very end of the text — and closes the array there. Returns null when no
 * complete object boundary exists. A trailing object is only "complete" when
 * ALL its brackets and braces are balanced (a truncated nested array like
 * "steps":[{...} is NOT complete even if the text happens to end in "}").
 */
function buildTruncatedCandidate(text) {
	const start = text.indexOf('[');
	if (start === -1) return null;
	const inner = text.slice(start + 1);
	const sep = inner.lastIndexOf('},');
	if (sep !== -1 && bracketsBalanced(inner.slice(0, sep + 1))) {
		return `[${inner.slice(0, sep + 1)}]`;
	}
	// Single object truncated exactly at its close? ("[{...}" with no comma)
	const trimmed = inner.trimEnd();
	if (trimmed.endsWith('}') && trimmed.startsWith('{') && bracketsBalanced(trimmed)) {
		return `[${trimmed}]`;
	}
	return null;
}

/**
 * True when square brackets and braces are balanced and no stray closers
 * appear (ignoring characters inside JSON strings).
 */
function bracketsBalanced(fragment) {
	let depthS = 0, depthC = 0, inString = false, escape = false;
	for (const ch of fragment) {
		if (escape) { escape = false; continue; }
		if (ch === '\\') { escape = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '[') depthS += 1;
		else if (ch === ']') { depthS -= 1; if (depthS < 0) return false; }
		else if (ch === '{') depthC += 1;
		else if (ch === '}') { depthC -= 1; if (depthC < 0) return false; }
	}
	return depthS === 0 && depthC === 0 && !inString;
}
/**
 * Robustly extracts a JSON array from the LLM response text.
 * Handles markdown fences, leading/trailing text, and partial responses.
 *
 * @param {string} raw — the raw LLM response
 * @returns {array} parsed test case objects
 */
export function parseTestCases(raw) {
	if (typeof raw !== 'string') {
		throw new Error('LLM response is not a string.');
	}

	let text = raw.trim();

	// Strip markdown code fences if present.
	const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		text = fenceMatch[1].trim();
	}

	// Find the outermost JSON array.
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start === -1 || end === -1) {
		// Maybe it's a single object, not an array.
		const objStart = text.indexOf('{');
		const objEnd = text.lastIndexOf('}');
		if (objStart !== -1 && objEnd !== -1) {
			const obj = JSON.parse(text.slice(objStart, objEnd + 1));
			return [obj];
		}
		throw new Error('Could not find JSON in the LLM response.');
	}

	let parsed;
	try {
		parsed = JSON.parse(hasCloseBracket(text) ? text.slice(start, end + 1) : text.slice(start));
	} catch (error) {
		// Truncation salvage (D1): when the model runs out of output mid-array
		// (finish_reason "length"), the COMPLETE objects before the cut are
		// still valid test cases. Find the last object boundary the model
		// actually closed — a "}," separator OR a "}" at the very end of the
		// truncated text — close the array there, and keep the complete
		// objects. Only returns if what remains parses as a non-empty array
		// of step-bearing objects; otherwise the original error propagates
		// (never fabricate an empty success).
		const candidate = buildTruncatedCandidate(text);
		if (candidate) {
			try {
				const salvaged = JSON.parse(candidate);
				if (Array.isArray(salvaged) && salvaged.length > 0 && salvaged.every(tc => tc && typeof tc === 'object' && Array.isArray(tc.steps))) {
					return salvaged;
				}
			} catch { /* fall through to original error */ }
		}
		throw error;
	}

	if (!Array.isArray(parsed)) {
		return [parsed];
	}

	return parsed;
}

/* ── Orchestration ──────────────────────────────────────────────── */

/**
 * Generates test cases from a workflow by calling the LLM.
 *
 * @param {object} workflow  — the saved workflow
 * @param {array}  findings  — findings from the origin session
 * @returns {Promise<array>} raw test case objects (not yet persisted)
 */
export async function generateTestCasesFromWorkflow(workflow, findings = []) {
	const { system, user } = buildTestCasePrompt(workflow, findings);
	let parsed;
	let truncationError = null;
	try {
		parsed = parseTestCases(await callLLM(system, user));
	} catch (err) {
		if (err?.finishReason !== 'length' || !err.partialContent) throw err;
		// Salvage COMPLETE objects from the truncated payload; rethrow the
		// truncation error only when nothing parses.
		truncationError = err;
		console.error('[testgen] LLM response hit max_tokens — salvaging complete objects from truncated payload');
		parsed = parseTestCases(err.partialContent);
	}
	if (parsed.length === 0) {
		if (truncationError) throw truncationError;
		const e = new Error('LLM test-case generation produced no parseable test cases.');
		e.finishReason = 'empty';
		throw e;
	}

	// Normalise each record.
	return parsed.map(tc => {
		// Validate viewport against presets
		const vpKey = typeof tc.viewport === 'string' && VIEWPORT_PRESETS[tc.viewport]
			? tc.viewport : 'desktop';
		const extraViewports = Array.isArray(tc.viewports)
			? tc.viewports.filter(v => typeof v === 'string' && VIEWPORT_PRESETS[v] && v !== vpKey)
			: [];
		return {
			name: String(tc.name ?? 'Untitled test case').trim(),
			severity: ['critical', 'high', 'medium', 'low'].includes(tc.severity) ? tc.severity : 'medium',
			preconditions: Array.isArray(tc.preconditions)
				? tc.preconditions.map(String)
				: typeof tc.preconditions === 'string' ? [tc.preconditions] : [],
			steps: Array.isArray(tc.steps)
				? tc.steps.map(s => ({
					action: String(s.action ?? 'snapshot'),
					target: s.target ? String(s.target) : undefined,
					value: s.value !== undefined && s.value !== null ? String(s.value) : undefined,
					description: String(s.description ?? '')
				}))
				: [],
			assertions: Array.isArray(tc.assertions)
				? tc.assertions.map(a => ({
					type: String(a.type ?? 'custom'),
					target: a.target ? String(a.target) : undefined,
					expected: String(a.expected ?? ''),
					description: String(a.description ?? '')
				}))
				: [],
			viewport: vpKey,
			viewports: extraViewports
		};
	});
}
