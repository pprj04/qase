/**
 * R6-T4 — Never-started mission-shell lifecycle.
 *
 * A "shell" is a mission left in `created` that never reached execution.
 * Operator decision (2026-09-06): shells older than a configurable TTL
 * (default 24h) transition `created → cancelled` with cancellationReason
 * `never_started_ttl_expired`. The record is PRESERVED (never deleted) —
 * the historical "2,833 created-never-started shells" complaint is a
 * visibility/lifecycle problem, not a data-retention one.
 *
 * Truthfulness rules (R6 spec §G5):
 *  - `status === 'created'` alone does NOT prove never-started. Execution
 *    markers are checked individually: startedAt, sessionId, iterations[],
 *    currentIteration, findings[], and any evidence node referencing the
 *    mission. ANY marker ⇒ the mission executed ⇒ PROTECTED, reported as
 *    an anomaly, never auto-cancelled (stale/malformed state with execution
 *    evidence is exactly the case a human must look at).
 *  - Only `created` missions are eligible. queued/running/awaiting_input/
 *    paused/terminal missions are never touched.
 *  - The ONLY mutation is updateMission() — the existing transition choke
 *    point. If a concurrent writer moved the mission to queued/running
 *    between analysis and apply, the `running|queued → cancelled`
 *    transition is ILLEGAL in stateTransitions.js and the choke point
 *    drops it; the shell then lands in `failed[]` and the report says so.
 *    No parallel state machine exists here.
 *  - Eligible shells have no execution resources by definition (no session,
 *    browser, or workspace was ever created for them). The cleanup pass is
 *    defensive-report-only: if a resource somehow exists it is REPORTED as
 *    an anomaly, never silently claimed as disposed.
 *
 * No automatic destructive startup sweep: expiry runs only through the
 * explicit master-gated diagnostics endpoint (consistent with the rest of
 * the lifecycle architecture, where every destructive action is opt-in).
 */

import { listMissions, getMission, updateMission } from './missions.js';
import { getSession } from './store.js';
import { getMissionIdsWithEvidence } from './evidenceGraph.js';

export const SHELL_TTL_DEFAULT_HOURS = 24;
export const SHELL_CANCEL_REASON = 'never_started_ttl_expired';

/** Clamp/validate a TTL in hours: [1, 8760]. Missing/invalid → 24h
 *  default, never 0 (cancel-everything) and never an accidental infinite
 *  TTL. Note Number(null) === 0 — null must default, not clamp to 1h. */
export function normalizeShellTtlHours(raw) {
	if (raw === null || raw === undefined) return SHELL_TTL_DEFAULT_HOURS;
	const n = Number(raw);
	if (!Number.isFinite(n)) return SHELL_TTL_DEFAULT_HOURS;
	return Math.max(1, Math.min(8760, Math.floor(n)));
}

/** Per-marker view of the evidence that a mission actually executed.
 *  `evidenceNodes` comes from the precomputed set (single graph pass). */
function executionMarkers(mission, missionIdsWithEvidence) {
	return {
		startedAt: Boolean(mission.startedAt),
		sessionId: Boolean(mission.sessionId),
		iterations: (mission.iterations ?? []).length > 0,
		currentIteration: Number(mission.currentIteration) > 0,
		findings: (mission.findings ?? []).length > 0,
		evidenceNodes: missionIdsWithEvidence.has(mission.id)
	};
}

/**
 * Read-only analysis. ZERO mutations. Reports:
 *  total missions, per-status counts, total created, fresh created (inside
 *  TTL), stale created (past TTL), eligible stale shells (never-started),
 *  protected anomalies (stale created WITH execution markers), projected
 *  cancellations.
 */
export function analyzeMissionShells({ ttlHours = SHELL_TTL_DEFAULT_HOURS } = {}) {
	const ttl = normalizeShellTtlHours(ttlHours);
	const now = Date.now();
	const cutoff = now - ttl * 3_600_000;

	const missions = listMissions();
	const missionIdsWithEvidence = getMissionIdsWithEvidence();

	const byStatus = {};
	for (const m of missions) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;

	const created = missions.filter(m => m.status === 'created');
	const freshCreated = [];
	const staleCreated = [];
	const eligible = [];
	const anomalies = [];

	for (const m of created) {
		// Age anchor: updatedAt (last touch) ?? createdAt. A mission created
		// 3 days ago and edited 1h ago is FRESH — recent intent.
		const anchor = Number(m.updatedAt ?? m.createdAt ?? 0) || 0;
		const ageHours = (now - anchor) / 3_600_000;
		if (anchor === 0 || anchor >= cutoff) {
			freshCreated.push(m.id);
			continue;
		}
		staleCreated.push(m.id);
		const markers = executionMarkers(m, missionIdsWithEvidence);
		if (Object.values(markers).some(Boolean)) {
			// Stale `created` + execution markers = malformed state. Protect
			// and report; a human decides.
			anomalies.push({
				id: m.id,
				ageHours: Math.round(ageHours * 10) / 10,
				targetUrl: m.targetUrl ?? null,
				markers
			});
		} else {
			eligible.push({
				id: m.id,
				ageHours: Math.round(ageHours * 10) / 10,
				targetUrl: m.targetUrl ?? null
			});
		}
	}

	return {
		generatedAt: new Date(now).toISOString(),
		ttlHours: ttl,
		total: missions.length,
		byStatus,
		created: created.length,
		freshCreated: freshCreated.length,
		staleCreated: staleCreated.length,
		eligible: eligible.length,
		eligibleIds: eligible.map(e => e.id),
		eligibleDetail: eligible,
		protectedAnomalies: anomalies.length,
		anomalyIds: anomalies.map(e => e.id),
		anomalyDetail: anomalies,
		projectedCancellations: eligible.length
	};
}

/**
 * Apply the shell TTL: cancel every currently-eligible shell through the
 * updateMission choke point. Idempotent (re-running finds nothing — the
 * shells are already `cancelled`). Failure semantics: every mission that
 * could not be cancelled lands in `failed` with a reason; the mission
 * record is left exactly as the choke point decided (never force-written).
 */
export function applyMissionShellTtl({ ttlHours = SHELL_TTL_DEFAULT_HOURS } = {}) {
	const analysis = analyzeMissionShells({ ttlHours });
	const cancelled = [];
	const alreadyTerminal = [];
	const failed = [];

	for (const id of analysis.eligibleIds) {
		const current = getMission(id);
		if (!current) continue; // vanished between analysis and apply (deleted)
		// Re-check the exact precondition immediately before the write —
		// closes the same-process window where another writer moved the
		// mission off `created` after the analysis pass.
		if (current.status !== 'created') {
			alreadyTerminal.push({ id, status: current.status });
			continue;
		}
		const patched = updateMission(current.id, {
			status: 'cancelled',
			cancelledAt: Date.now(),
			cancellationReason: SHELL_CANCEL_REASON,
			__actor: 'mission-shell-ttl'
		});
		if (patched?.status === 'cancelled') {
			cancelled.push(id);
		} else {
			// Choke point refused (e.g. raced to running/queued). Truthful.
			failed.push({
				id,
				reason: 'transition-not-applied',
				status: patched?.status ?? current.status
			});
		}
	}

	return {
		appliedAt: new Date().toISOString(),
		analysis,
		cancelledIds: cancelled,
		cancelled: cancelled.length,
		alreadyTerminalIds: alreadyTerminal,
		failed,
		resourceCleanup: inspectShellResources(cancelled)
	};
}

/**
 * Eligible shells have no session/browser/workspace by definition (no
 * sessionId marker, no session record was ever created). Defensive sweep:
 * if a resource reference somehow exists on a freshly-cancelled shell it is
 * REPORTED as an anomaly — never silently claimed disposed, and never
 * force-deleted here (sessions own their lifecycle in store.js).
 */
function inspectShellResources(cancelledIds) {
	const anomalies = [];
	for (const id of cancelledIds) {
		const m = getMission(id);
		if (m?.sessionId) {
			const session = getSession(m.sessionId);
			anomalies.push({
				missionId: id,
				sessionId: m.sessionId,
				sessionRecordPresent: Boolean(session)
			});
		}
	}
	return {
		disposed: [],
		anomalies,
		note: 'eligible shells hold no execution resources by definition; anomalies are reported, never silently claimed'
	};
}
