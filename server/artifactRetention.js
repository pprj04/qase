/**
 * R6-T3 — Evidence & artifact retention: bounded, link-aware, deterministic.
 *
 * DESIGN (extends existing conventions; NO second evidence system):
 *   - artifactStore.js keeps owning the registry + bytes. This module only
 *     computes eligibility and executes ordered deletion THROUGH artifactStore's
 *     mutation surface (deleteArtifactById), never by hand-rolling fs paths.
 *   - storeHygiene.js keeps owning the dry-run/apply convention (GET report /
 *     POST {apply:true} safety interlock). This module plugs an artifacts-retention
 *     block into that same surface.
 *   - config.js owns settings + validation (clamp pattern, updateConfig allowlist).
 *
 * ELIGIBILITY (an artifact is deletable only when ALL hold):
 *   1. outside retention window: capturedAt older than artifactMaxAgeDays; OR
 *      store over ceiling: beyond artifactMaxCount oldest-first (deterministic
 *      order: capturedAt ASC, then artifactId ASC as tie-break).
 *   2. NOT protected: no live reference anywhere —
 *        a. evidence-graph node metadata.artifact.id (R6-T2 ref),
 *        b. an evidence-graph node belonging to a LIVE session (session still
 *           in sessions.json),
 *        c. missionId still live in missions.json (non-terminal OR any state —
 *           the mission record itself is the reference),
 *        d. referenced by name/path in replay-runs.json / baselines.json /
 *           test-cases.json / workflows.json (legacy filename forms),
 *        e. sessionId still live in sessions.json.
 *   3. status === 'persisted' (write_failed rows are metadata, not bytes).
 *
 * SAFE ORDERING (crash-safe at every step):
 *   evaluate (pure) → delete bytes file → delete registry row → persist
 *   registry atomically → report. A crash after file-delete leaves a registry
 *   row whose getArtifact() truthfully returns null (missing bytes) — R6-T2
 *   semantics; the next cycle re-reports it as eligible and reclaims the row.
 *   Idempotent: re-running produces the same final state, 0 further deletions.
 *
 * INVALID CONFIG never means "delete everything": NaN/negative/absurd values
 * fall back to documented defaults (config.js clamp convention), and the
 * analysis report always echoes the EFFECTIVE policy it used.
 */

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import './artifactStore.js';
import {
	listArtifactRows, deleteArtifactById, artifactStoreStats, getArtifactSaveHealth
} from './artifactStore.js';

/** Documented defaults — conservative for the current local deployment
 * (single workspace, screenshot-heavy sessions, evidence graph 52k nodes).
 * artMaxCount 20k ≈ months of screenshots at current capture rates;
 * artMaxAgeDays 180 keeps two quarters of history. */
export const RETENTION_DEFAULTS = {
	artifactMaxCount: 20_000,
	artifactMaxAgeDays: 180,
	// Evidence-node retention is INTENTIONALLY NOT wired to deletion here:
	// pruneUnlinked (zero-degree only) remains the only evidence-node prune.
	// See LIMITATIONS in the R6 spec.
	evidenceNodeMax: 60_000
};

/** Validate + clamp a retention policy. Returns the EFFECTIVE policy.
 * Invalid values fall back to defaults — never to 0/Infinity semantics. */
export function normalizeRetentionPolicy(raw = {}) {
	const policy = { ...RETENTION_DEFAULTS };
	const count = Number(raw?.artifactMaxCount);
	if (Number.isFinite(count)) policy.artifactMaxCount = Math.max(100, Math.min(500_000, Math.floor(count)));
	const age = Number(raw?.artifactMaxAgeDays);
	if (Number.isFinite(age)) policy.artifactMaxAgeDays = Math.max(1, Math.min(3650, Math.floor(age)));
	return policy;
}

function dataDir() {
	return process.env.QASE_DATA_DIR ?? join(process.cwd(), '.qase');
}

function loadJsonSafe(rel) {
	try {
		const p = join(dataDir(), rel);
		if (!existsSync(p)) return null;
		return JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return null;
	}
}

/** Live-resource snapshot: sessions, missions, findings (id + ids of stores). */
function loadLiveResources() {
	const sessions = loadJsonSafe('sessions.json');
	const sessionIds = new Set(Array.isArray(sessions) ? sessions.map(s => s?.id).filter(Boolean) : []);
	const missions = loadJsonSafe('missions.json');
	const missionIds = new Set(Array.isArray(missions) ? missions.map(m => m?.id).filter(Boolean) : []);
	const findings = loadJsonSafe('findings.json');
	const findingArr = Array.isArray(findings) ? findings : (findings?.findings ?? []);
	const findingIds = new Set(findingArr.map(f => f?.id).filter(Boolean));
	return { sessionIds, missionIds, findingIds };
}

/** Every artifact reference that exists in the evidence graph:
 *  metadata.artifact.id (R6-T2 form) + any node whose sessionId is live
 *  (its screenshot artifacts are that session's evidence chain). */
function collectGraphArtifactRefs({ sessionIds }) {
	const refs = new Set();
	const graph = loadJsonSafe('evidence-graph.json');
	const evidence = Array.isArray(graph?.evidence) ? graph.evidence : [];
	for (const node of evidence) {
		const artId = node?.metadata?.artifact?.id;
		if (typeof artId === 'string' && artId) refs.add(artId);
		// b: a live session's step_outcome nodes reference that session's shots
		if (sessionIds.has(node?.sessionId) && node?.metadata?.artifact) {
			refs.add(node.metadata.artifact.id);
		}
	}
	return refs;
}

/** Legacy filename references: "<sessionId>/shot-…jpeg" or
 *  "artifacts/<sessionId>/…" appearing anywhere in durable stores. */
function collectFilenameRefs() {
	const refs = new Set();
	for (const file of ['replay-runs.json', 'baselines.json', 'test-cases.json', 'workflows.json', 'findings.json', 'missions.json', 'sessions.json']) {
		const data = loadJsonSafe(file);
		if (!data) continue;
		const text = JSON.stringify(data);
		for (const m of text.matchAll(/(?:artifacts\/)([A-Za-z0-9_.\-]+)/g)) refs.add(m[1]);
	}
	return refs; // session-dir level references
}

/**
 * Pure analysis — NO mutations. Safe to call any time.
 * @param {{policy?: object}} options
 * @returns retention report: counts, bytes, oldest/newest, eligible +
 *   protected (with reasons), projected deletions + reclaimed bytes, and the
 *   EFFECTIVE policy (post-clamp) so an operator never mistakes the applied
 *   policy for the requested one.
 */
export function analyzeArtifactRetention(options = {}) {
	const policy = normalizeRetentionPolicy(options?.policy);
	const rows = listArtifactRows()
		.filter(r => r.status !== 'write_failed');
	const live = loadLiveResources();
	const graphRefs = collectGraphArtifactRefs(live);
	const filenameRefs = collectFilenameRefs();

	const now = Date.now();
	const eligible = [];       // outside window or over ceiling → deletion candidates
	const protectedRows = [];  // referenced/protected → never deletable
	const inPolicy = [];       // R6-T3 accounting truth: unreferenced but WITHIN
	                           // the window+ceiling — retained, reported, so
	                           // total == protected + inPolicy + eligible at all times
	let totalBytes = 0;
	let oldestAt = null;
	let newestAt = null;

	for (const row of rows) {
		const bytes = Number.isFinite(row.bytes) ? row.bytes : 0;
		totalBytes += bytes;
		const at = Number.isFinite(row.capturedAt) ? row.capturedAt : null;
		if (at !== null) {
			if (oldestAt === null || at < oldestAt) oldestAt = at;
			if (newestAt === null || at > newestAt) newestAt = at;
		}
		// Protection reasons (first match wins; order = strongest claim first).
		const reasons = [];
		if (graphRefs.has(row.id)) reasons.push('evidence-node-ref');
		if (row.missionId && live.missionIds.has(row.missionId)) reasons.push('live-mission');
		if (row.sessionId && live.sessionIds.has(row.sessionId)) reasons.push('live-session');
		if (row.sessionId && filenameRefs.has(row.sessionId)) reasons.push('store-filename-ref');
		if (reasons.length > 0) {
			protectedRows.push({ id: row.id, sessionId: row.sessionId, capturedAt: at, bytes, reasons });
			continue;
		}
		// Unprotected: age-out is immediate; otherwise it lands in-policy
		// until the count-ceiling pass selects it below.
		const ageDays = at === null ? Infinity : (now - at) / 86_400_000;
		const entry = { id: row.id, sessionId: row.sessionId, capturedAt: at, bytes, ageDays: at === null ? null : Math.round(ageDays) };
		if (policy.artifactMaxAgeDays > 0 && ageDays > policy.artifactMaxAgeDays) {
			eligible.push({ ...entry, reason: 'age' });
		} else {
			inPolicy.push({ ...entry, reason: 'in-policy' });
		}
	}

	// Age-eligible first (oldest first), then count-ceiling fillers drawn from
	// the in-policy pool (oldest-first). Unreferenced rows never leave the
	// report: they are either candidates, protected, or inPolicy.
	const byOldest = (a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0) || String(a.id).localeCompare(String(b.id));
	const ageEligible = eligible.filter(e => e.reason === 'age').sort(byOldest);
	const inPolicySorted = inPolicy.sort(byOldest);
	const countExcess = Math.max(0, rows.length - policy.artifactMaxCount);
	const countEligible = inPolicySorted.slice(0, countExcess);
	const candidates = [...ageEligible, ...countEligible];
	const retainedInPolicy = inPolicySorted.slice(countExcess);

	return {
		generatedAt: new Date().toISOString(),
		effectivePolicy: policy,
		stats: {
			...artifactStoreStats(),
			oldestCapturedAt: oldestAt,
			newestCapturedAt: newestAt,
			saveHealth: getArtifactSaveHealth()
		},
		total: rows.length,
		protectedCount: protectedRows.length,
		eligibleCount: candidates.length,
		inPolicyCount: retainedInPolicy.length,
		projectedDeletions: candidates.length,
		projectedReclaimedBytes: candidates.reduce((n, c) => n + c.bytes, 0),
		candidates,
		protected: protectedRows,
		retainedInPolicy
	};
}

/**
 * Execute the retention policy. Ordered, crash-safe, idempotent:
 * evaluate (fresh analysis) → per candidate: delete bytes → delete registry
 * row (atomic persist inside artifactStore) → tally. Failures are reported
 * per-artifact, never swallowed, never claimed as success.
 */
export function applyArtifactRetention(options = {}) {
	const analysis = analyzeArtifactRetention(options);
	const deleted = [];
	const failed = [];
	let reclaimedBytes = 0;
	for (const c of analysis.candidates) {
		const result = deleteArtifactById(c.id);
		if (result?.deleted === true) {
			deleted.push(c.id);
			reclaimedBytes += c.bytes;
		} else {
			failed.push({ id: c.id, error: result?.error ?? 'delete returned false' });
		}
	}
	return {
		appliedAt: new Date().toISOString(),
		effectivePolicy: analysis.effectivePolicy,
		deletedCount: deleted.length,
		reclaimedBytes,
		failed,
		protectedCount: analysis.protectedCount,
		statsAfter: artifactStoreStats()
	};
}
