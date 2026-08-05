/**
 * Self-Healing Engine (Phase 17A).
 *
 * When a test step fails because a CSS selector broke (element moved,
 * class renamed, DOM structure changed), this module analyses the failure,
 * captures the current page DOM, and asks the LLM to find the replacement
 * selector.
 *
 * Flow:
 *   1. isSelectorFailure(stepResult) — does the failure look like a broken selector?
 *   2. capturePageDom(page) — extract a concise DOM snapshot from the live page
 *   3. analyzeFailure(testCase, stepResult, domSnapshot) — LLM finds replacement
 *   4. Returns { oldSelector, newSelector, confidence, reason, patchedStep }
 *
 * The caller (runWithRetry in replay.js) decides whether to apply the patch
 * based on the confidence threshold.
 */

import { getModelTier } from './config.js';
import { callLLM } from './testGen.js';

/* ── Constants ──────────────────────────────────────────────────── */

/** Failure error patterns that indicate a broken selector vs. a real app bug. */
const SELECTOR_FAILURE_PATTERNS = [
	/timeout.*exceeded/i,
	/element.*not found/i,
	/locator.*not visible/i,
	/strict mode violation/i,
	/could not find/i,
	/no element found/i,
	/waiting for selector/i,
	/element is not clickable/i,
	/element is detached/i
];

/** Actions that use CSS selectors (vs. URL or keyboard). */
const SELECTOR_ACTIONS = new Set(['click', 'fill', 'type', 'select', 'check', 'hover', 'scroll']);

/* ── Failure classification ─────────────────────────────────────── */

/**
 * Determines whether a step failure is likely caused by a broken selector
 * (as opposed to a timeout, network error, or assertion failure).
 *
 * @param {object} stepResult — { stepIndex, action, status, error }
 * @returns {boolean}
 */
export function isSelectorFailure(stepResult) {
	if (stepResult.status !== 'fail') return false;
	if (!SELECTOR_ACTIONS.has(stepResult.action)) return false;
	if (!stepResult.error) return false;
	return SELECTOR_FAILURE_PATTERNS.some(pattern => pattern.test(stepResult.error));
}

/* ── DOM capture ────────────────────────────────────────────────── */

/**
 * Extracts a concise snapshot of the page's interactive elements.
 * Instead of dumping the full DOM (which can be enormous), we extract
 * only the elements a selector could target: inputs, buttons, links,
 * and any element with id/class/data-testid attributes.
 *
 * @param {import('playwright').Page} page — live Playwright page
 * @returns {Promise<string>} compact DOM representation for the LLM
 */
export async function capturePageDom(page) {
	try {
		const elements = await page.evaluate(() => {
			const results = [];
			const interactiveSelectors = [
				'button', 'a', 'input', 'select', 'textarea',
				'[role="button"]', '[role="link"]', '[role="tab"]',
				'[onclick]', '[data-testid]', '[data-test]',
				'[id]:not([id=""])', '[class]:not([class=""])'
			];

			const seen = new Set();
			for (const selector of interactiveSelectors) {
				for (const el of document.querySelectorAll(selector)) {
					if (seen.has(el)) continue;
					seen.add(el);

					const tag = el.tagName.toLowerCase();
					const id = el.id || '';
					const classes = Array.from(el.classList).slice(0, 5).join('.');
					const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || '';
					const text = (el.textContent || '').trim().slice(0, 60);
					const href = el.getAttribute('href') || '';
					const type = el.getAttribute('type') || '';
					const name = el.getAttribute('name') || '';
					const placeholder = el.getAttribute('placeholder') || '';
					const role = el.getAttribute('role') || '';
					const ariaLabel = el.getAttribute('aria-label') || '';

					// Build a compact descriptor
					const parts = [`<${tag}`];
					if (id) parts.push(`#${id}`);
					if (classes) parts.push(`.${classes}`);
					if (testId) parts.push(`[data-testid="${testId}"]`);
					if (name) parts.push(`[name="${name}"]`);
					if (type) parts.push(`[type="${type}"]`);
					if (role) parts.push(`[role="${role}"]`);
					if (ariaLabel) parts.push(`[aria-label="${ariaLabel}"]`);
					if (placeholder) parts.push(`placeholder="${placeholder}"`);
					if (href) parts.push(`href="${href}"`);
					parts.push('>');
					if (text) parts.push(text);

					results.push(parts.join(' '));
				}
			}
			return results.slice(0, 300); // Cap at 300 elements to stay within token budget
		});

		return elements.join('\n');
	} catch (error) {
		console.warn(`[selfHeal] Failed to capture DOM: ${error.message}`);
		return '';
	}
}

/* ── LLM-powered selector analysis ──────────────────────────────── */

/**
 * Asks the LLM to find a replacement selector for a broken one.
 *
 * @param {object} testCase — the test case being run
 * @param {object} failedStep — the step that failed { action, target, value }
 * @param {string} domSnapshot — compact DOM from capturePageDom()
 * @param {string} errorMessage — the Playwright error message
 * @returns {Promise<object>} { newSelector, confidence, reason }
 */
export async function analyzeFailure(testCase, failedStep, domSnapshot, errorMessage) {
	if (!domSnapshot) {
		return { newSelector: null, confidence: 0, reason: 'Could not capture page DOM for analysis.' };
	}

	const systemPrompt = `You are a test automation expert. A Playwright test step failed because the CSS selector no longer matches an element on the page.

Your job: analyze the page DOM and find the CSS selector for the element that the test was trying to interact with.

Return JSON ONLY — no markdown, no explanation outside JSON:
{
  "newSelector": "the new CSS selector",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation of why this is the right element"
}

Rules:
- The newSelector must be a valid CSS selector that Playwright's locator() accepts.
- Prefer the most specific selector (data-testid > id > class combination).
- Set confidence to 0 if you cannot identify the element with reasonable certainty.
- Look at the action type, the old selector, and the step description to infer intent.`;

	const userPrompt = `FAILED STEP:
  Action: ${failedStep.action}
  Old selector: ${failedStep.target}
  Value: ${failedStep.value || '(none)'}
  Test case: "${testCase.name}"
  Error: ${errorMessage}

TEST CONTEXT (prior steps for context):
${(testCase.steps || []).slice(0, 10).map((s, i) => `  ${i + 1}. ${s.action} ${s.target || ''} ${s.value || ''}`).join('\n')}

CURRENT PAGE DOM (interactive elements):
${domSnapshot}

Find the element the test was trying to interact with. Return JSON.`;

	try {
		const raw = await callLLM(systemPrompt, userPrompt);
		const parsed = parseHealResponse(raw);
		return parsed;
	} catch (error) {
		console.warn(`[selfHeal] LLM analysis failed: ${error.message}`);
		return { newSelector: null, confidence: 0, reason: `LLM analysis failed: ${error.message}` };
	}
}

/* ── Response parsing ───────────────────────────────────────────── */

/**
 * Robustly extracts the healing result from the LLM response.
 * Handles JSON wrapped in markdown code fences, extra text, etc.
 */
function parseHealResponse(raw) {
	// Try to extract JSON from code fences first.
	const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1].trim());
		} catch { /* fall through */ }
	}

	// Try direct JSON parse.
	try {
		return JSON.parse(raw.trim());
	} catch { /* fall through */ }

	// Try to find a JSON object in the text.
	const jsonMatch = raw.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]);
		} catch { /* fall through */ }
	}

	console.warn(`[selfHeal] Could not parse LLM response: ${raw.slice(0, 200)}`);
	return { newSelector: null, confidence: 0, reason: 'Could not parse LLM response.' };
}

/* ── Step patching ──────────────────────────────────────────────── */

/**
 * Creates a patched copy of a test case with the healed selector applied
 * to the failed step. Does NOT mutate the original.
 *
 * @param {object} testCase — original test case
 * @param {number} stepIndex — index of the failed step
 * @param {string} newSelector — the healed selector
 * @returns {object} a new test case object with the patched step
 */
export function patchTestCase(testCase, stepIndex, newSelector) {
	const patched = JSON.parse(JSON.stringify(testCase));
	if (patched.steps && patched.steps[stepIndex]) {
		patched.steps[stepIndex].target = newSelector;
		patched.steps[stepIndex]._healed = true;
		patched.steps[stepIndex]._originalTarget = testCase.steps[stepIndex].target;
	}
	return patched;
}

/**
 * Records a healing event for auditability.
 * Returns a compact object suitable for storing in the test result.
 */
export function createHealRecord(failedStep, analysis, stepIndex) {
	return {
		timestamp: Date.now(),
		stepIndex,
		action: failedStep.action,
		oldSelector: failedStep.target,
		newSelector: analysis.newSelector,
		confidence: analysis.confidence,
		reason: analysis.reason,
		applied: false
	};
}
