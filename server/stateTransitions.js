/**
 * M1-P4.3 — Centralized mission status transition validation.
 *
 * Single source of truth for the LEGAL mission-status matrix, derived from the
 * actual call-sites audited in docs/M1-P4.3-STATE-MODEL.md §1. Every writer
 * that sets mission.status flows through updateMission()/finalizeMission()
 * (missions.js) which call this module — including the execution governor's
 * pump/sweep/reaper paths, the manual stop route, pipeline finalization, lazy
 * finalize on GET, and the revalidate route.
 *
 * Design constraints (see STATE-MODEL §7):
 *  - Preserve existing behavior for all legal transitions (no route changes).
 *  - Illegal transitions become a logged NO-OP for in-process writers (drop
 *    only the status field, keep other fields) so a racing writer cannot
 *    resurrect a terminal mission or fabricate completion.
 *  - PATCH /api/missions/:id surfaces illegal transitions as 409 (route change
 *    in index.js; the store stays tolerant).
 *  - One sanctioned resurrection: completed → running on the REVALIDATE path
 *    (a new iteration re-opens the mission with a new session).
 *  - finalizeMission() keeps its own terminal idempotency guard (unchanged).
 *
 * Storage is a single-process in-memory Map + debounced atomicWrite — the
 * validator runs synchronously inside the same tick as the mutation, so there
 * is no TOCTOU window between validation and write within one process.
 */

/* Legal transitions, verified against index.js/missions.js/missionGovernor.js */
const LEGAL_TRANSITIONS = Object.freeze({
	created: ['queued', 'running', 'failed', 'cancelled', 'interrupted'],
	queued: ['running', 'cancelled', 'failed', 'interrupted'],
	running: ['completed', 'failed', 'aborted', 'timeout', 'interrupted'],
	// Revalidate path: a completed mission may be re-opened for a new iteration.
	completed: ['running'],
	// Terminal → terminal stays ILLEGAL (no flip-flopping aborted ↔ failed).
	failed: [],
	aborted: [],
	cancelled: [],
	timeout: [],
	// Boot reaper: running→interrupted at boot; interrupted→queued on requeue;
	// interrupted re-finalized by lazy finalize on first GET.
	interrupted: ['queued', 'completed', 'failed', 'aborted']
});

/** True when `from → to` is a legal mission-status transition. */
export function isLegalMissionTransition(from, to) {
	if (from === to) return true; // no-op re-assert (idempotent)
	const allowed = LEGAL_TRANSITIONS[from];
	return Boolean(allowed && allowed.includes(to));
}

/**
 * Attempt a transition for an in-process writer.
 * Returns { ok, status } — status is the resulting mission status (unchanged
 * if illegal). Never throws.
 */
export function attemptMissionTransition(from, proposed, { actor = 'system', reason = null } = {}) {
	if (proposed == null) return { ok: true, status: from };
	if (from === proposed) return { ok: true, status: from };
	if (isLegalMissionTransition(from, proposed)) {
		return { ok: true, status: proposed };
	}
	console.warn(
		`[state] illegal mission transition ignored: ${from} → ${proposed}` +
		` (actor=${actor}${reason ? ` reason=${String(reason).slice(0, 120)}` : ''})`
	);
	return { ok: false, status: from };
}

export const MISSION_TRANSITION_MATRIX = LEGAL_TRANSITIONS;
