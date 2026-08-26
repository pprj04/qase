/**
 * BUILD B2 — W3: Structured Decision Traces.
 *
 * Auditable record of every autonomy decision, using the user-locked 13-field
 * schema. CONSTRAINTS (non-negotiable):
 *   - NO raw chain-of-thought, NO prompts, NO page content, NO secrets.
 *   - Only structured metadata: ids, counters, enums, short reason/category.
 *   - Text fields pass through sanitizeText (strip control chars + tags, cap
 *     length) — same discipline decisionEngine.applySafetyOverride reasons use.
 *
 * Persistence follows the exact M1-P4.4 pattern (same as webhookDelivery.js):
 * JSON array at .qase/decision-traces.json, debounced atomicWrite, flush
 * registered with shutdown.js, bounded (MAX_MISSIONS missions × MAX_PER_MISSION
 * decisions — oldest missions evicted first).
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { registerStoreFlush } from './shutdown.js';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_FILE = join(__dirname, '..', '.qase', 'decision-traces.json');

/** Keep the trace store bounded: last 50 missions, 100 decisions each. */
const MAX_MISSIONS = 50;
const MAX_PER_MISSION = 100;
/** Hard cap for any string field (reason / category / signal keys). */
const MAX_TEXT = 300;

/** missionId -> trace[] (insertion-ordered map so "oldest mission" is well-defined). */
const traces = new Map();
let dirty = false;
let saveTimer = null;

function loadTraces() {
	try {
		if (!existsSync(TRACES_FILE)) return;
		const rows = JSON.parse(readFileSync(TRACES_FILE, 'utf8'));
		if (Array.isArray(rows)) {
			for (const row of rows) {
				if (row?.missionId && Array.isArray(row.decisions)) {
					traces.set(row.missionId, row.decisions.slice(0, MAX_PER_MISSION));
				}
			}
		}
	} catch (err) {
		console.error(`[decision-traces] corrupt — starting EMPTY (${err.message})`);
	}
}

function sanitize(value, cap = MAX_TEXT) {
	if (typeof value !== 'string') return undefined;
	return value
		.replace(/[\x00-\x1f\x7f]/g, '')
		.slice(0, cap);
}

function clampNonNegativeInt(value) {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function persistNow() {
	if (!dirty) return { dirty: false, ok: true };
	try {
		mkdirSync(dirname(TRACES_FILE), { recursive: true });
		const rows = [...traces.entries()].map(([missionId, decisions]) => ({ missionId, decisions }));
		atomicWrite(TRACES_FILE, JSON.stringify(rows, null, 2));
		dirty = false;
		return { dirty: true, ok: true };
	} catch (err) {
		return { dirty: true, ok: false, error: err.message };
	}
}

function persistSoon() {
	dirty = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		persistNow();
	}, 400);
	saveTimer.unref?.();
}

/**
 * Records one autonomy decision (the 13-field schema).
 * Fields: decision_id, mission_id, iteration, state, signals_used,
 * candidate_action, selected_action, reason, budget_before, budget_requested,
 * budget_granted, result, next_decision.
 *
 * `input` fields are validated + coerced; nothing user- or model-authored is
 * trusted beyond sanitize().
 */
export function recordDecisionTrace({ missionId, iteration, state, signals, candidateAction, selectedAction, reason, budgetBefore, budgetRequested, budgetGranted, result, nextDecision }) {
	if (!missionId) return null;
	const list = traces.get(missionId) ?? [];
	if (list.length >= MAX_PER_MISSION) {
		list.shift(); // bound per-mission growth
	}
	const trace = {
		decision_id: `dec_${randomUUID().slice(0, 12)}`,
		mission_id: String(missionId).slice(0, 64),
		iteration: clampNonNegativeInt(iteration),
		ts: Date.now(),
		state: sanitize(state) ?? 'unknown',
		signals_used: Object.keys(signals ?? {}).slice(0, 20).map(k => String(k).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)),
		candidate_action: sanitize(candidateAction, 60) ?? 'CONTINUE',
		selected_action: sanitize(selectedAction, 60) ?? 'CONTINUE',
		reason: sanitize(reason) ?? '',
		budget_before: clampNonNegativeInt(budgetBefore),
		budget_requested: clampNonNegativeInt(budgetRequested),
		budget_granted: clampNonNegativeInt(budgetGranted),
		result: sanitize(result, 60) ?? 'recorded',
		next_decision: sanitize(nextDecision, 60) ?? 'loop'
	};
	list.push(trace);
	traces.set(missionId, list);

	// Bound the mission count: evict the OLDEST mission's trace set.
	while (traces.size > MAX_MISSIONS) {
		const oldest = traces.keys().next().value;
		traces.delete(oldest);
	}

	persistSoon();
	return trace;
}

/** Read accessor: mission trace list (newest decision last). */
export function getDecisionTraces(missionId) {
	return traces.get(missionId) ? [...traces.get(missionId)] : [];
}

/** All traces (for the benchmark differ + report). */
export function allDecisionTraces() {
	const out = {};
	for (const [missionId, decisions] of traces) out[missionId] = [...decisions];
	return out;
}

/** Test-only reset. */
export function __resetDecisionTraces() {
	traces.clear();
	dirty = false;
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

loadTraces();
registerStoreFlush('decision-traces', persistNow);
