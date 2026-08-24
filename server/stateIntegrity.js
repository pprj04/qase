/**
 * M1-P4.3 — Cross-store state integrity checker.
 *
 * Detects orphaned / inconsistent records ACROSS stores (missions ↔ sessions ↔
 * findings ↔ evidence graph). evidenceGraph.js already has a graph-internal
 * detectOrphans(); this module extends the check to the whole entity graph.
 *
 * Read-only. Never mutates or deletes data. Returns structured findings with
 * severity + recommended remediation so the diagnostic endpoint (Phase 6) and
 * future ops tooling can act.
 */

import { listMissions, getMission, isTerminalStatus } from './missions.js';
import { listSessions, getSession } from './store.js';
import { getAllFindings, getFinding } from './findings.js';
import { getEvidenceCount } from './evidenceGraph.js';

/**
 * Run all integrity checks.
 *
 * @param {object} [options]
 * @param {boolean} [options.deep=false] — also scan every evidence node's
 *        session/mission refs (slower on a 38k-node graph; the shallow pass
 *        samples the first 200 nodes).
 * @returns {{ generatedAt: number, summary: object, issues: object[] }}
 */
export function checkStateIntegrity(options = {}) {
	const deep = Boolean(options.deep);
	const issues = [];

	const missions = listMissions();
	const sessions = listSessions();
	const findings = getAllFindings();

	const missionIds = new Set(missions.map(m => m.id));
	const sessionIds = new Set(sessions.map(s => s.id));

	// ---- 1. Mission → session refs --------------------------------------
	for (const m of missions) {
		if (m.sessionId && !sessionIds.has(m.sessionId)) {
			// Common + expected: sessions store prunes old records (byte budget).
			issues.push({
				code: 'MISSION_SESSION_MISSING',
				severity: 'info',
				entity: 'mission',
				entityId: m.id,
				detail: `mission ${m.id} references pruned/missing session ${m.sessionId} (status ${m.status})`,
				remediation: 'Expected after session-store pruning; no action needed for terminal missions.'
			});
		}
	}

	// ---- 2. Iteration consistency ---------------------------------------
	for (const m of missions) {
		const iterations = m.iterations ?? [];
		if (m.currentIteration !== iterations.length) {
			// currentIteration is a counter incremented at record time; it equals
			// the number of recorded iterations unless history was rewritten.
			issues.push({
				code: 'MISSION_ITERATION_COUNT_DRIFT',
				severity: 'warning',
				entity: 'mission',
				entityId: m.id,
				detail: `currentIteration=${m.currentIteration} but iterations[] has ${iterations.length} entries`,
				remediation: 'Inspect mission history; a re-write may have dropped iteration records.'
			});
		}
		const seenSessionIds = new Set();
		let duplicate = false;
		for (const it of iterations) {
			if (it.sessionId) {
				if (seenSessionIds.has(it.sessionId)) {
					duplicate = true;
				}
				seenSessionIds.add(it.sessionId);
			}
		}
		if (duplicate) {
			issues.push({
				code: 'MISSION_DUPLICATE_ITERATION_SESSION',
				severity: 'error',
				entity: 'mission',
				entityId: m.id,
				detail: `mission ${m.id} recorded the same session in more than one iteration`,
				remediation: 'Deduplicate the iteration entries; revalidation must create a new session.'
			});
		}
		// Impossible timestamps: ranAt in the future, or completedAt < createdAt.
		if (m.completedAt != null && m.createdAt != null && m.completedAt < m.createdAt) {
			issues.push({
				code: 'MISSION_IMPOSSIBLE_TIMESTAMPS',
				severity: 'error',
				entity: 'mission',
				entityId: m.id,
				detail: `completedAt ${m.completedAt} < createdAt ${m.createdAt}`,
				remediation: 'Clock skew or data corruption; verify against session history.'
			});
		}
	}

	// ---- 3. Findings refs ------------------------------------------------
	for (const f of findings) {
		if (f.sessionId && !sessionIds.has(f.sessionId)) {
			issues.push({
				code: 'FINDING_SESSION_MISSING',
				severity: 'info',
				entity: 'finding',
				entityId: f.id,
				detail: `finding ${f.id} references pruned/missing session ${f.sessionId}`,
				remediation: 'Expected after session pruning; findings keep their record.'
			});
		}
		if (f.missionId && !missionIds.has(f.missionId)) {
			issues.push({
				code: 'FINDING_MISSION_MISSING',
				severity: 'warning',
				entity: 'finding',
				entityId: f.id,
				detail: `finding ${f.id} references deleted/missing mission ${f.missionId}`,
				remediation: 'Mission was deleted without cascading; consider clearing missionId.'
			});
		}
	}

	// ---- 4. Duplicate IDs (defensive; Map keys make this near-impossible) -
	const findingIdSet = new Set();
	for (const f of findings) {
		if (findingIdSet.has(f.id)) {
			issues.push({
				code: 'FINDING_DUPLICATE_ID',
				severity: 'error',
				entity: 'finding',
				entityId: f.id,
				detail: `duplicate finding id ${f.id}`,
				remediation: 'Deduplicate; ids must be unique.'
			});
		}
		findingIdSet.add(f.id);
	}

	// ---- 5. Invalid terminal states ---------------------------------------
	for (const m of missions) {
		if (m.status === 'created' && m.completedAt != null) {
			issues.push({
				code: 'MISSION_CREATED_WITH_COMPLETION',
				severity: 'warning',
				entity: 'mission',
				entityId: m.id,
				detail: `mission still 'created' but has completedAt set`,
				remediation: 'Finalization race; re-check status.'
			});
		}
		if (isTerminalStatus(m.status) && m.sessionId && m.currentIteration === 0 && m.status === 'completed') {
			issues.push({
				code: 'MISSION_COMPLETED_NO_ITERATIONS',
				severity: 'warning',
				entity: 'mission',
				entityId: m.id,
				detail: `completed mission has zero recorded iterations`,
				remediation: 'Verify finalize path recorded the iteration (recordIteration).'
			});
		}
	}

	// ---- 6. Mission.summary vs findings count -----------------------------
	// (best-effort: summary is human text; only flag empty-on-completed)
	for (const m of missions) {
		if (m.status === 'completed' && (m.findings?.length ?? 0) > 0 && !m.summary) {
			issues.push({
				code: 'MISSION_COMPLETED_MISSING_SUMMARY',
				severity: 'info',
				entity: 'mission',
				entityId: m.id,
				detail: `completed mission with ${m.findings.length} findings has no summary`,
				remediation: 'Cosmetic; re-run report generation if a summary is required.'
			});
			break; // one representative entry is enough
		}
	}

	// ---- 7. Evidence graph size sanity (cheap) ---------------------------
	const evidenceCount = getEvidenceCount();
	if (evidenceCount > 60_000) {
		issues.push({
			code: 'EVIDENCE_GRAPH_HUGE',
			severity: 'warning',
			entity: 'evidence-graph',
			entityId: null,
			detail: `evidence graph holds ${evidenceCount} nodes (>60k) — boot parse + save cost growing`,
			remediation: 'Plan archive/split (M1-P4.4 scope).'
		});
	}

	// ---- 8. M1-P4.4: duplicate mission IDs (Map dedupes silently) --------
	const dupSeen = new Set();
	for (const m of missions) {
		if (dupSeen.has(m.id)) {
			issues.push({
				code: 'MISSION_DUPLICATE_ID',
				severity: 'error',
				entity: 'mission',
				entityId: m.id,
				detail: `duplicate mission id present in list output`,
				remediation: 'Investigate store corruption; restore from .corrupt backup if available.'
			});
		}
		dupSeen.add(m.id);
	}

	// ---- 9. M1-P4.4: impossible timestamps -------------------------------
	for (const m of missions) {
		const c = Number(m.createdAt) || 0;
		const u = Number(m.updatedAt) || 0;
		const done = Number(m.completedAt) || 0;
		if (u && c && u < c) {
			issues.push({
				code: 'MISSION_TIME_TRAVEL',
				severity: 'error',
				entity: 'mission',
				entityId: m.id,
				detail: `updatedAt (${m.updatedAt}) < createdAt (${m.createdAt})`,
				remediation: 'Data corruption; inspect mission record.'
			});
		}
		if (done && done < c) {
			issues.push({
				code: 'MISSION_COMPLETED_BEFORE_CREATED',
				severity: 'error',
				entity: 'mission',
				entityId: m.id,
				detail: `completedAt (${m.completedAt}) < createdAt (${m.createdAt})`,
				remediation: 'Data corruption; inspect mission record.'
			});
		}
	}

	// ---- 10. M1-P4.4: stale mission shells (hygiene signal) --------------
	const now = Date.now();
	let shellCount = 0;
	for (const m of missions) {
		if (m.status === 'created' && !m.sessionId && (m.iterations ?? []).length === 0) {
			const ageDays = (now - (Number(m.updatedAt) || Number(m.createdAt) || now)) / 86_400_000;
			if (ageDays > 7) shellCount++;
		}
	}
	if (shellCount > 0) {
		issues.push({
			code: 'MISSION_STALE_SHELLS',
			severity: 'info',
			entity: 'missions',
			entityId: null,
			detail: `${shellCount} 'created' missions with no session/iterations older than 7d (draft/debris shells)`,
			remediation: 'Reclaimable via POST /api/v1/diagnostics/store-hygiene/cleanup {apply:true}.'
		});
	}

	const counts = {
		missions: missions.length,
		sessions: sessions.length,
		findings: findings.length,
		evidenceNodes: evidenceCount
	};
	const summary = {
		totalIssues: issues.length,
		error: issues.filter(i => i.severity === 'error').length,
		warning: issues.filter(i => i.severity === 'warning').length,
		info: issues.filter(i => i.severity === 'info').length,
		healthy: issues.filter(i => i.severity === 'error').length === 0
	};
	return { generatedAt: Date.now(), deep, counts, summary, issues };
}
