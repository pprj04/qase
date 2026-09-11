/**
 * Workflow capture and persistence.
 *
 * The agent already performs browser actions — click, fill, navigate, scroll.
 * This module converts those tool calls into structured WorkflowStep records
 * that persist with the session and can be promoted into named, reusable
 * workflows for later phases (test-case generation, regression replay).
 *
 * Credential safety: steps capture the *placeholder text* (`{{QA_PASSWORD}}`),
 * not the real secret. The redactor in secrets.js has already run on the tool
 * input before we see it, so any value that was a placeholder stays a
 * placeholder and any leaked secret is already masked.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emit } from './store.js';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_FILE = join(__dirname, '..', '.qase', 'workflows.json');

/* ── Tool → action mapping ──────────────────────────────────────── */

/** Browser tools that produce a workflow step. */
const BROWSER_ACTIONS = new Set([
	'browser_open', 'browser_click', 'browser_fill', 'browser_check',
	'browser_select', 'browser_select_option', 'browser_type', 'browser_key',
	'browser_press_key', 'browser_scroll', 'browser_hover', 'browser_screenshot',
	'browser_diagnostics', 'browser_snapshot'
]);

/** Maps SDK tool names to clean action verbs. */
const STEP_ACTIONS = {
	browser_open: 'navigate',
	browser_click: 'click',
	browser_fill: 'fill',
	browser_check: 'check',
	browser_select: 'select',
	browser_select_option: 'select',
	browser_type: 'type',
	browser_key: 'key',
	browser_press_key: 'key',
	browser_scroll: 'scroll',
	browser_hover: 'hover',
	browser_screenshot: 'screenshot',
	browser_diagnostics: 'diagnostics',
	browser_snapshot: 'snapshot'
};

/** Human-readable labels for each action verb. */
const ACTION_LABELS = {
	navigate: 'Navigated to',
	click: 'Clicked',
	fill: 'Filled',
	check: 'Toggled',
	select: 'Selected',
	type: 'Typed',
	key: 'Pressed key',
	scroll: 'Scrolled',
	hover: 'Hovered',
	screenshot: 'Captured screenshot',
	diagnostics: 'Checked console & network',
	snapshot: 'Read the page'
};

/* ── Target extraction ──────────────────────────────────────────── */

/**
 * Extracts the most useful identifying info from a browser tool's input.
 * Prefers CSS selectors, then falls back to role/name/text/url/key.
 */
function extractTarget(input) {
	if (!input || typeof input !== 'object') {
		return { target: undefined, label: '', value: undefined };
	}

	// Navigation: the target is the URL itself.
	if (input.url) {
		return { target: input.url, label: input.url, value: undefined };
	}

	// Element-targeting tools: prefer selector, then identifying attributes.
	const selector = input.selector || input.testId;
	const name = input.name || input.label || input.text || input.placeholder || input.role;
	const elementId = input.elementId;

	let target;
	if (selector) {
		target = selector;
	} else if (name) {
		target = name;
	} else if (elementId) {
		target = `[e${elementId}]`;
	}

	// Value for fill/type/select/key.
	let value;
	if (input.value !== undefined && input.value !== null && input.value !== '') {
		value = String(input.value);
	} else if (input.text !== undefined && input.text !== null && input.text !== '' && input.value === undefined) {
		// Some tools put the value in `text` instead of `value`.
		if (selector || name) {
			value = String(input.text);
		}
	}

	// Build a human-readable label fragment.
	let label;
	if (target && value !== undefined) {
		label = `${target} = ${value}`;
	} else if (target) {
		label = target;
	} else if (input.key) {
		label = input.key;
		target = input.key;
	}

	return { target, label: label ?? '', value };
}

/* ── Step capture ───────────────────────────────────────────────── */

/**
 * Converts a browser tool call into a WorkflowStep and appends it to the
 * session's capturedSteps array. Called from agent.js beginActivity().
 *
 * The input has already been redacted by secrets.js before we receive it,
 * so credential placeholders are preserved but real secrets are masked.
 *
 * B1: Now also stores toolCallId so the result can be correlated later
 * via finalizeStepOutcome(), and initializes an outcome object.
 */
export function captureStep(session, { toolName, input, toolCallId }) {
	if (!BROWSER_ACTIONS.has(toolName)) {
		return undefined;
	}

	const action = STEP_ACTIONS[toolName];
	if (!action) {
		return undefined;
	}

	const { target, label, value } = extractTarget(input);
	const verbLabel = ACTION_LABELS[action] ?? action;

	const step = {
		id: randomUUID(),
		ts: Date.now(),
		toolCallId: toolCallId ?? undefined,   // B1: correlate with tool_result
		action,
		target,
		label: label || undefined,
		displayLabel: verbLabel,
		value: value || undefined,
		url: session.targetUrl,
		outcome: { status: 'pending' }          // B1: finalized by finalizeStepOutcome
	};

	session.capturedSteps ??= [];
	session.capturedSteps.push(step);

	// Emit a live SSE event so the dashboard updates in real-time.
	emit(session, 'workflow_step', { step });

	return step;
}

/**
 * B1: Finalizes a captured step's outcome from the tool result.
 *
 * Called from agent.js when a tool_result arrives. Finds the step by
 * toolCallId and enriches its outcome object with what actually happened
 * after the action: success/failure, URL changes, page title, element
 * counts, console/network errors.
 *
 * This is the factual basis that the intelligence layer (B2) will consume
 * to reason about whether features actually work — not just whether their
 * pages exist.
 *
 * @param {object} session
 * @param {string} toolCallId — correlates to the step stored by captureStep
 * @param {string} toolName
 * @param {object} result — raw tool result (already redacted)
 */
export function finalizeStepOutcome(session, toolCallId, toolName, result) {
	if (!toolCallId || !session.capturedSteps) return;

	const step = session.capturedSteps.find(s => s.toolCallId === toolCallId);
	if (!step) return; // Not a browser action, or step already finalized

	const ok = result?.success !== false;

	const outcome = {
		status: ok ? 'success' : 'failed',
		urlAfter: null,
		titleAfter: null,
		error: null,
		elementsFound: null,
		consoleErrors: null,
		networkErrors: null,
		dialogAppeared: false,
		ts: Date.now()
	};

	// Extract URL and title (most tools return these)
	if (result?.url) {
		outcome.urlAfter = result.url !== step.url ? result.url : null;
	}
	if (result?.title) {
		outcome.titleAfter = result.title;
	}

	// Extract failure info
	if (!ok) {
		outcome.error = result?.error ?? result?.message ?? 'Action failed';
	}

	// Enrich from snapshot results
	if (toolName === 'browser_snapshot' || result?.elements !== undefined) {
		outcome.elementsFound = Array.isArray(result?.elements) ? result.elements.length : (result?.elementCount ?? null);
	}

	// Enrich from diagnostics results
	if (toolName === 'browser_diagnostics' || result?.console !== undefined) {
		const consoleErrors = Array.isArray(result?.console)
			? result.console.filter(e => e.level === 'error').length
			: null;
		const networkErrors = Array.isArray(result?.network)
			? result.network.filter(e => e.statusCode >= 400 || e.error).length
			: null;
		outcome.consoleErrors = consoleErrors;
		outcome.networkErrors = networkErrors;
	}

	// Detect dialogs (alert/confirm/prompt) — the SDK sometimes surfaces these
	if (result?.dialog || result?.dialogText || result?.alert) {
		outcome.dialogAppeared = true;
	}

	step.outcome = outcome;
	emit(session, 'step_outcome', { stepId: step.id, toolCallId, outcome });
}

/* ── Saved workflow persistence ─────────────────────────────────── */

let workflows = [];
let saveTimer = null;
let pendingWrite = false;

function loadWorkflows() {
	try {
		if (existsSync(WORKFLOWS_FILE)) {
			const raw = readFileSync(WORKFLOWS_FILE, 'utf-8');
			workflows = JSON.parse(raw);
		}
	} catch (err) {
		// M1-P4.4 Phase 5 â preserve damaged store for forensics, start empty.
		try {
			renameSync(WORKFLOWS_FILE, `${WORKFLOWS_FILE}.corrupt-${Date.now()}`);
			console.error(`[workflows] STORE CORRUPT: ${err.message}. File preserved â starting EMPTY.`);
		} catch {
			console.error(`[workflows] STORE CORRUPT: ${err.message} â starting EMPTY.`);
		}
		workflows = [];
	}
}

function persistWorkflowsSoon() {
	pendingWrite = true;
	if (saveTimer) {
		return;
	}
	saveTimer = setTimeout(() => {
		saveTimer = null;
		flushWorkflows();
	}, 250);
}

function flushWorkflows() {
	try {
		atomicWrite(WORKFLOWS_FILE, JSON.stringify(workflows, null, '\t'));
		pendingWrite = false;
	} catch (error) {
		console.error('Failed to persist workflows:', error.message);
	}
}

/** Immediately persist the in-memory workflows array to disk. */
export function saveWorkflowsRaw() {
	flushWorkflows();
}

/**
 * M1-P4.4 Phase 2 â graceful shutdown flush. Idempotent.
 */
export function flushWorkflowsForShutdown() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	if (!pendingWrite) return { dirty: false, ok: true };
	try {
		flushWorkflows();
		return { dirty: true, ok: true };
	} catch (err) {
		return { dirty: true, ok: false, error: err.message };
	}
}

/**
 * Backfill: assign defaultId to every workflow missing a projectId.
 * Returns the number updated.
 */
export function backfillProjectId(defaultId) {
	let count = 0;
	for (const w of workflows) {
		if (!w.projectId) {
			w.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) flushWorkflows();
	return count;
}

/**
 * Reassign: move all workflows from fromProjectId to toProjectId.
 * Returns the number moved.
 */
export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const w of workflows) {
		if (w.projectId === fromProjectId) {
			w.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) flushWorkflows();
	return count;
}

loadWorkflows();

/**
 * Promotes a session's captured steps into a named, persistent workflow.
 */
export function saveWorkflow(session, { name, tags }) {
	const steps = session.capturedSteps ?? [];
	if (steps.length === 0) {
		throw new Error('No captured steps to save.');
	}

	const workflow = {
		id: randomUUID(),
		sessionId: session.id,
		projectId: session.projectId,
		ownerUserId: session.ownerUserId ?? null,
		name: String(name ?? '').trim() || 'Untitled workflow',
		targetUrl: session.targetUrl ?? '',
		steps: steps.map(step => ({
			action: step.action,
			target: step.target,
			label: step.label,
			displayLabel: step.displayLabel,
			value: step.value,
			url: step.url
		})),
		tags: Array.isArray(tags) ? tags.map(String) : [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};

	workflows.push(workflow);
	persistWorkflowsSoon();
	return workflow;
}

export function listWorkflows({ projectId, targetUrl } = {}) {
	return workflows
		.filter(wf => {
			if (projectId && wf.projectId !== projectId) return false;
			if (targetUrl && wf.targetUrl !== targetUrl) return false;
			return true;
		})
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(wf => ({
			id: wf.id,
			ownerUserId: wf.ownerUserId ?? null,
			sessionId: wf.sessionId,
			projectId: wf.projectId,
			name: wf.name,
			targetUrl: wf.targetUrl,
			stepCount: (wf.steps ?? []).length,
			tags: wf.tags,
			createdAt: wf.createdAt,
			updatedAt: wf.updatedAt
		}));
}

export function getWorkflow(id) {
	return workflows.find(wf => wf.id === id);
}

export function updateWorkflow(id, patch) {
	const wf = workflows.find(w => w.id === id);
	if (!wf) {
		return undefined;
	}
	if (patch.name !== undefined) {
		wf.name = String(patch.name).trim();
	}
	if (patch.tags !== undefined) {
		wf.tags = Array.isArray(patch.tags) ? patch.tags.map(String) : [];
	}
	wf.updatedAt = Date.now();
	persistWorkflowsSoon();
	return wf;
}

export function deleteWorkflow(id) {
	const index = workflows.findIndex(w => w.id === id);
	if (index === -1) {
		return false;
	}
	workflows.splice(index, 1);
	persistWorkflowsSoon();
	return true;
}
