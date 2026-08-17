/**
 * Phase 17 — user-flow friction analysis.
 *
 * Pure module. Works over the workflow data already captured by Phase 0:
 *  - mission.context.phase8.workflowIntelligence (workflowEngine results), and/or
 *  - session-captured steps (workflows.js capturedSteps shape).
 *
 * Deterministic friction indicators:
 *  - EXCESSIVE_STEPS     : workflow took significantly more steps than its template expected
 *  - REPEATED_ENTRY      : the same input field (by label/name) filled >1 time across steps
 *  - RETRY_LOOP          : a failed step followed by an identical retry attempt(s)
 *  - MISSING_CONFIRMATION: a destructive action (delete/remove/discard) completed without any dialog
 *  - DEAD_END            : workflow ended blocked with no navigation onward
 *  - UNCLEAR_NEXT_ACTION : workflow passed but final step landed on the same URL it started (no visible state change)
 *
 * Every friction point records workflow, step refs, severity, confidence, evidence.
 */

export const FRICTION_TYPES = Object.freeze({
	EXCESSIVE_STEPS: 'EXCESSIVE_STEPS',
	REPEATED_ENTRY: 'REPEATED_ENTRY',
	RETRY_LOOP: 'RETRY_LOOP',
	MISSING_CONFIRMATION: 'MISSING_CONFIRMATION',
	DEAD_END: 'DEAD_END',
	UNCLEAR_NEXT_ACTION: 'UNCLEAR_NEXT_ACTION',
});

const DESTRUCTIVE_WORDS = /delete|remove|destroy|discard|purge/i;

/** severity per friction type (deterministic). */
const BASE_SEVERITY = {
	[FRICTION_TYPES.EXCESSIVE_STEPS]: 'low',
	[FRICTION_TYPES.REPEATED_ENTRY]: 'medium',
	[FRICTION_TYPES.RETRY_LOOP]: 'medium',
	[FRICTION_TYPES.MISSING_CONFIRMATION]: 'high',
	[FRICTION_TYPES.DEAD_END]: 'high',
	[FRICTION_TYPES.UNCLEAR_NEXT_ACTION]: 'medium',
};

/**
 * Analyze one workflow run.
 * wfRun shape (normalized from workflowEngine result or capturedSteps):
 * {
 *   name, status: 'pass'|'failed'|'blocked'|'partially_completed'|'not_tested',
 *   expectedSteps?: number,      // template expectation if known
 *   steps: [{ index, action, description, target, status: 'pass'|'failed'|'blocked',
 *             urlAfter, fieldsFilled?: [string], dialogAppeared?: boolean,
 *             error?: string }]
 *   urlStart?, urlEnd?
 * }
 */
export function analyzeWorkflowFriction(wfRun) {
	const points = [];
	if (!wfRun || !Array.isArray(wfRun.steps) || wfRun.steps.length === 0) return points;
	const steps = wfRun.steps;

	// EXCESSIVE_STEPS — 2x the expected (or heuristic cap 10) steps
	const expected = wfRun.expectedSteps && wfRun.expectedSteps > 0 ? wfRun.expectedSteps : 10;
	if (steps.length >= Math.max(6, expected * 2)) {
		points.push(mkPoint(wfRun, FRICTION_TYPES.EXCESSIVE_STEPS, steps.length - expected, {
			detail: `Workflow completed in ${steps.length} steps vs ${expected} expected`,
			evidence: steps.map(s => stepRef(wfRun, s)),
		}, 0.7));
	}

	// REPEATED_ENTRY — same field name filled more than once
	const fillCount = new Map();
	for (const s of steps) {
		for (const f of s.fieldsFilled ?? []) {
			const key = String(f).toLowerCase().trim();
			fillCount.set(key, (fillCount.get(key) ?? 0) + 1);
		}
	}
	for (const [field, count] of fillCount) {
		if (count > 1) {
			points.push(mkPoint(wfRun, FRICTION_TYPES.REPEATED_ENTRY, steps.length, {
				detail: `Field "${field}" re-entered ${count} times across the workflow`,
				evidence: steps.filter(s => (s.fieldsFilled ?? []).map(x => String(x).toLowerCase().trim()).includes(field)).map(s => stepRef(wfRun, s)),
			}, 0.85));
		}
	}

	// RETRY_LOOP — failed step followed by same action again
	for (let i = 1; i < steps.length; i++) {
		const prev = steps[i - 1], cur = steps[i];
		if (prev.status === 'failed' && cur.action && cur.action === prev.action && cur.target === prev.target) {
			points.push(mkPoint(wfRun, FRICTION_TYPES.RETRY_LOOP, i + 1, {
				detail: `Retry loop: step ${i} failed and step ${i + 1} repeats the same action (${cur.action})`,
				evidence: [stepRef(wfRun, prev), stepRef(wfRun, cur)],
			}, 0.8));
		}
	}

	// MISSING_CONFIRMATION — destructive action without dialog
	for (let i = 0; i < steps.length; i++) {
		const s = steps[i];
		const label = `${s.description ?? ''} ${s.action ?? ''}`.toLowerCase();
		if (DESTRUCTIVE_WORDS.test(label) && s.status === 'pass' && !s.dialogAppeared) {
			points.push(mkPoint(wfRun, FRICTION_TYPES.MISSING_CONFIRMATION, i + 1, {
				detail: `Destructive action at step ${i + 1} ("${label.trim().slice(0, 60)}") executed with no confirmation dialog`,
				evidence: [stepRef(wfRun, s)],
			}, 0.75));
		}
	}

	// DEAD_END — blocked outcome
	if (wfRun.status === 'blocked') {
		points.push(mkPoint(wfRun, FRICTION_TYPES.DEAD_END, steps.length, {
			detail: `Workflow "${wfRun.name}" ended BLOCKED — user cannot proceed`,
			evidence: steps.slice(-2).map(s => stepRef(wfRun, s)),
		}, 0.9));
	}

	// UNCLEAR_NEXT_ACTION — passed but landed where it started
	if (wfRun.status === 'pass' && wfRun.urlStart && wfRun.urlEnd && wfRun.urlStart === wfRun.urlEnd) {
		const lastFieldFill = steps.some(s => (s.fieldsFilled ?? []).length > 0);
		if (lastFieldFill) {
			points.push(mkPoint(wfRun, FRICTION_TYPES.UNCLEAR_NEXT_ACTION, steps.length, {
				detail: `Workflow passed but the final URL equals the start URL — no visible navigation or confirmation`,
				evidence: [stepRef(wfRun, steps[steps.length - 1]), { kind: 'navigation', detail: `urlStart=urlEnd=${wfRun.urlStart}` }],
			}, 0.6));
		}
	}

	return points;
}

function mkPoint(wfRun, type, step, { detail, evidence }, confidence) {
	return {
		id: `fx_${wfRun.name ? slug(wfRun.name) : 'wf'}_${type.toLowerCase()}_${step}`,
		workflow: wfRun.name ?? 'unknown-workflow',
		type,
		step,
		severity: BASE_SEVERITY[type],
		confidence,
		detail,
		evidence,
	};
}

function stepRef(wfRun, s) {
	return {
		kind: 'step_outcome',
		detail: `step ${s.index ?? '?'}: ${s.action ?? ''} ${s.target ?? ''} → ${s.status ?? '?'}`,
		workflow: wfRun.name,
	};
}

function slug(s) {
	return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
}

/**
 * Aggregate friction across workflow runs + summarize per workflow for the
 * USER_FLOW_FRICTION dimension.
 * Returns { frictionPoints, perWorkflow: [{workflow, steps, frictionCount, severityMax, confidence}] }
 */
export function analyzeFriction(workflowRuns = []) {
	const frictionPoints = [];
	for (const run of workflowRuns) frictionPoints.push(...analyzeWorkflowFriction(run));
	const byWf = new Map();
	for (const run of workflowRuns) {
		if (!byWf.has(run.name)) byWf.set(run.name, { workflow: run.name, steps: run.steps?.length ?? 0, frictionCount: 0, severityMax: 'none', confidence: 0 });
	}
	for (const p of frictionPoints) {
		const row = byWf.get(p.workflow);
		if (!row) continue;
		row.frictionCount++;
		row.severityMax = maxSeverity(row.severityMax, p.severity);
		row.confidence = Math.max(row.confidence, p.confidence);
	}
	return { frictionPoints, perWorkflow: [...byWf.values()] };
}

const SEV_ORDER = ['none', 'info', 'low', 'medium', 'high', 'critical'];
function maxSeverity(a, b) {
	return SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b;
}

/** Friction-based deduction for the USER_FLOW_FRICTION dimension (matches uxModel weights). */
export function frictionDimension(frictionPoints = []) {
	const WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3, info: 0.5 };
	let deduction = 0;
	const byType = new Map();
	for (const p of frictionPoints) {
		deduction += WEIGHTS[p.severity] ?? 0;
		byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
	}
	const tested = new Set(frictionPoints.map(p => p.workflow)).size;
	return {
		dimension: 'USER_FLOW_FRICTION',
		score: Math.max(0, Math.round(100 - deduction)),
		confidence: frictionPoints.length > 0 ? 0.8 : 0,
		evidenceCoverage: frictionPoints.length > 0 ? 0.8 : 0,
		decisive: frictionPoints.length,
		unverified: 0,
		occurrenceSummary: Object.fromEntries(byType),
	};
}
