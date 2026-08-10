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

You must produce 1-5 test cases. Group actions that test a single user flow into one test case. Each test case must have:
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
  - Convert each workflow step into a test step. Use the workflow step's action/target/value directly — do not invent new selectors.
  - Add at least one assertion after every critical action (navigation, form submit, login).
  - Keep credential placeholders like {{QA_PASSWORD}} exactly as-is — do not replace them.
  - If findings are provided, add assertions that specifically check for the bugs that were found.
  - Be concrete and specific. "Page loads" is too vague; "URL contains /dashboard" is good.

Respond with ONLY a JSON array of test cases. No markdown, no explanation, just the JSON.`;

	const workflowSummary = workflow.steps.map((step, i) => {
		const parts = [`${i + 1}. ${step.displayLabel ?? step.action}`];
		if (step.target) parts.push(`target: ${step.target}`);
		if (step.value) parts.push(`value: ${step.value}`);
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

Generate test cases from this workflow. Remember: respond with ONLY a JSON array.`;

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
		max_tokens: 4096
	};

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

			if (!content) {
				throw new Error('LLM returned an empty response.');
			}

			return content;
		} catch (error) {
			lastError = error;
			if (!isRetryableLLMError(error) || attempt >= LLM_MAX_RETRIES) {
				throw error;
			}
		}
	}

	throw lastError;
}

/* ── Response parsing ───────────────────────────────────────────── */

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

	const parsed = JSON.parse(text.slice(start, end + 1));

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
	const raw = await callLLM(system, user);
	const parsed = parseTestCases(raw);

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
