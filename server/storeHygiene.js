/**
 * M1-P4.4 Phase 3 — store hygiene: dry-run reporting + guarded cleanup.
 *
 * Principles (from the persistence contract §7):
 *   - DRY-RUN FIRST. `analyzeStoreHygiene()` never mutates anything.
 *   - Deletion only via `applyStoreHygiene()` with an explicit options object.
 *   - Findings, evidence required by validation/audit, historical findings
 *     referenced by reports — NEVER pruned.
 *   - Active/recent mission data stays (non-terminal missions are untouchable;
 *     recent terminal missions preserved by MIN_KEEP floors).
 *   - Deterministic, logged, safe to repeat (idempotent).
 *
 * What IS eligible, per store:
 *   missions        — count cap (default 400): first terminal test/demo debris
 *                     (name/objective matching P42|p4|gate|smoke patterns,
 *                     older than 30d), then oldest terminal missions; always
 *                     keeps the most recent MIN_KEEP (200) terminal missions.
 *   replay-runs     — count cap (default 400), oldest-first. Artifacts of
 *                     removed runs become orphan candidates (Phase 4 decides).
 *   ux-assessments  — count cap (default 400), oldest-first.
 *   evidence-graph  — evidence-node cap (default 60,000): prunes ONLY
 *                     zero-degree (unlinked) evidence oldest-first, then
 *                     unlinked observations. Linked evidence NEVER pruned.
 *   sessions        — existing 12MB/50-count budget (store.js pruneOldSessions),
 *                     surfaced here only as informational.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// R6-T4 fix — honor QASE_DATA_DIR (the documented isolation contract from
// config.js/findings.js/missions.js). The module-load constant broke child
// servers run with a temp data dir: hygiene analyzed the REAL .qase even
// though every other store read the temp one.
const QASE_DIR = process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');

const HYGIENE_DEFAULTS = {
	missionMax: 400,
	missionMinKeep: 200,
	replayRunMax: 400,
	uxAssessmentMax: 400,
	evidenceNodeMax: 60_000,
	debrisPattern: /p42|p4[.\-_]?4|gate|smoke/i,
	staleShellOlderThanDays: 7,
	debrisOlderThanDays: 30
};

const TERMINAL = new Set(['completed', 'failed', 'aborted', 'cancelled', 'timeout']);

function daysOld(ts) {
	if (!ts) return Infinity;
	const t = typeof ts === 'string' ? Date.parse(ts) : ts;
	if (!Number.isFinite(t)) return Infinity;
	return (Date.now() - t) / 86_400_000;
}

function loadJson(file, fallback) {
	try {
		if (!existsSync(file)) return fallback;
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function fileBytes(p) {
	try { return statSync(p).size; } catch { return 0; }
}

/**
 * Read-only analysis of every retention-managed store.
 * @returns {object} structured report: per-store current size, cap, eligible
 *   records, projected bytes reclaimed (approx — JSON size deltas are
 *   estimated per-record by serialized length).
 */
export function analyzeStoreHygiene(options = {}) {
	const cfg = { ...HYGIENE_DEFAULTS, ...options };
	const report = { generatedAt: new Date().toISOString(), config: cfg, stores: {} };

	/* missions */
	const missions = loadJson(join(QASE_DIR, 'missions.json'), []);
	const terminal = missions.filter(m => TERMINAL.has(m.status));
	const nonTerminal = missions.length - terminal.length;
	// Stale shells: `created` missions that never got a session or a single
	// iteration — leftovers of deleted runs / never-started drafts.
	// R6-T4 — shells are NO LONGER deletion-eligible here. The mission-shell
	// TTL (server/missionShells.js, default 24h) transitions them
	// created→cancelled with the record PRESERVED; the count stays in this
	// report as a visibility signal only.
	const staleShells = missions.filter(m =>
		m.status === 'created' && !m.sessionId && (m.iterations ?? []).length === 0
		&& daysOld(m.updatedAt ?? m.createdAt) > cfg.staleShellOlderThanDays);
	const debris = terminal.filter(m =>
		cfg.debrisPattern.test(`${m.name ?? ''} ${m.objective ?? ''} ${m.source ?? ''}`)
		&& daysOld(m.updatedAt ?? m.completedAt ?? m.createdAt) > cfg.debrisOlderThanDays);
	const keptRecent = [...terminal]
		.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0).toString().localeCompare((a.updatedAt ?? a.createdAt ?? 0).toString()))
		.slice(0, cfg.missionMinKeep).map(m => m.id);
	const excess = Math.max(0, terminal.length - cfg.missionMax);
	const oldest = terminal
		.filter(m => !keptRecent.includes(m.id) && !debris.includes(m))
		.sort((a, b) => String(a.updatedAt ?? a.createdAt ?? 0).localeCompare(String(b.updatedAt ?? b.createdAt ?? 0)))
		.slice(0, Math.max(0, excess - debris.length) + Math.max(0, debris.length - 0));
	const missionEligible = [...new Set([
		...debris.map(m => m.id),
		...oldest.map(m => m.id)
	])]; // R6-T4: shells are EXCLUDED from deletion (cancel+preserve instead); `oldest` is floor-limited
	const missionBytes = missions.reduce((n, m) => n + JSON.stringify(m).length, 0);
	const eligibleSet = new Set(missionEligible);
	const eligibleMissionBytes = missions
		.filter(m => eligibleSet.has(m.id))
		.reduce((n, m) => n + JSON.stringify(m).length, 0);
	report.stores.missions = {
		count: missions.length, terminal: terminal.length, nonTerminal,
		staleShells: staleShells.length,
		cap: cfg.missionMax, minKeep: cfg.missionMinKeep,
		eligibleCount: missionEligible.length,
		eligibleIds: missionEligible,
		estimatedBytesReclaimable: eligibleMissionBytes,
		fileBytes: fileBytes(join(QASE_DIR, 'missions.json'))
	};

	/* replay runs */
	const replay = loadJson(join(QASE_DIR, 'replay-runs.json'), []);
	const replayExcess = Math.max(0, replay.length - cfg.replayRunMax);
	const replayEligible = [...replay]
		.sort((a, b) => String(a.startedAt ?? a.createdAt ?? 0).localeCompare(String(b.startedAt ?? a.createdAt ?? 0)))
		.slice(0, replayExcess);
	report.stores['replay-runs'] = {
		count: replay.length, cap: cfg.replayRunMax,
		eligibleCount: replayEligible.length,
		eligibleIds: replayEligible.map(r => r.id),
		estimatedBytesReclaimable: replayEligible.reduce((n, r) => n + JSON.stringify(r).length, 0),
		fileBytes: fileBytes(join(QASE_DIR, 'replay-runs.json'))
	};

	/* ux assessments */
	const ux = loadJson(join(QASE_DIR, 'ux-assessments.json'), []);
	const uxExcess = Math.max(0, ux.length - cfg.uxAssessmentMax);
	const uxEligible = [...ux]
		.sort((a, b) => String(a.createdAt ?? 0).localeCompare(String(b.createdAt ?? 0)))
		.slice(0, uxExcess);
	report.stores['ux-assessments'] = {
		count: ux.length, cap: cfg.uxAssessmentMax,
		eligibleCount: uxEligible.length,
		eligibleIds: uxEligible.map(a => a.id),
		estimatedBytesReclaimable: uxEligible.reduce((n, a) => n + JSON.stringify(a).length, 0),
		fileBytes: fileBytes(join(QASE_DIR, 'ux-assessments.json'))
	};

	/* evidence graph — zero-degree nodes only */
	const graphRaw = loadJson(join(QASE_DIR, 'evidence-graph.json'), { evidence: [], observations: [], edges: [] });
	const evidence = Array.isArray(graphRaw.evidence) ? graphRaw.evidence : [];
	const observations = Array.isArray(graphRaw.observations) ? graphRaw.observations : [];
	const edges = Array.isArray(graphRaw.edges) ? graphRaw.edges : [];
	const linked = new Set();
	for (const e of edges) {
		if (e?.from) linked.add(e.from);
		if (e?.to) linked.add(e.to);
	}
	const evidenceExcess = Math.max(0, evidence.length - cfg.evidenceNodeMax);
	const zeroDeg = evidence.filter(n => !linked.has(n.id))
		.sort((a, b) => String(a.createdAt ?? 0).localeCompare(String(b.createdAt ?? 0)));
	const evidenceEligible = zeroDeg.slice(0, evidenceExcess);
	const obsExcess = Math.max(0, observations.length - cfg.evidenceNodeMax);
	const obsEligible = observations.filter(o => !linked.has(o.id))
		.sort((a, b) => String(a.createdAt ?? 0).localeCompare(String(b.createdAt ?? 0)))
		.slice(0, obsExcess);
	report.stores['evidence-graph'] = {
		evidenceCount: evidence.length, observationCount: observations.length,
		edgeCount: edges.length, linkedNodes: linked.size,
		evidenceCap: cfg.evidenceNodeMax,
		eligibleEvidence: evidenceEligible.length,
		eligibleObservations: obsEligible.length,
		estimatedBytesReclaimable:
			evidenceEligible.reduce((n, x) => n + JSON.stringify(x).length, 0) +
			obsEligible.reduce((n, x) => n + JSON.stringify(x).length, 0),
		fileBytes: fileBytes(join(QASE_DIR, 'evidence-graph.json'))
	};

	/* sessions — informational only (store.js owns this budget) */
	const sessions = loadJson(join(QASE_DIR, 'sessions.json'), []);
	report.stores.sessions = {
		count: sessions.length,
		fileBytes: fileBytes(join(QASE_DIR, 'sessions.json')),
		note: 'managed by store.js pruneOldSessions (12MB / 50-count budget); informational'
	};

	return report;
}

/**
 * Execute the cleanup described by a fresh analyzeStoreHygiene() report.
 * DANGEROUS (mutates stores) — the API layer only calls this when the request
 * explicitly carries apply:true. Delegates to each store's own mutation
 * surface so debounced persistence, dirty flags and shutdown flush stay
 * consistent. Returns what was actually pruned.
 */
export function applyStoreHygiene(options = {}, deps = {}) {
	const cfg = { ...HYGIENE_DEFAULTS, ...options };
	const analysis = analyzeStoreHygiene(cfg);
	const result = {
		appliedAt: new Date().toISOString(),
		pruned: {},
		skipped: [],
		analysis
	};

	// deps must be injected by the caller (index.js passes the live modules;
	// tests pass scratch instances). Missing dep → skipped, never crash.
	const {
		deleteMission, pruneRunsByIds, pruneAssessmentsByIds, pruneUnlinked,
		cancelMissionShells
	} = deps;

	// R6-T4 — expire never-started shells FIRST, through the transition choke
	// point (created→cancelled, record preserved). Sequenced before mission
	// pruning so shells this pass cancels become terminal and are then subject
	// to the SAME count-based caps as any other terminal mission — never
	// deleted as "shells" simply for being shells (operator decision: the
	// record is preserved; ordinary retention still applies to everything).
	if (cancelMissionShells) {
		try {
			result.pruned.missionShells = cancelMissionShells();
		} catch (err) {
			result.skipped.push(`mission-shells: ${err.message}`);
		}
	}

	if (deleteMission) {
		const ids = analysis.stores.missions.eligibleIds ?? [];
		const removed = [];
		for (const id of ids) {
			try { deleteMission(id); removed.push(id); } catch (err) {
				result.skipped.push(`missions:${id}: ${err.message}`);
			}
		}
		result.pruned.missions = removed;
	} else {
		result.skipped.push('missions: no deleteMission dep');
	}

	if (pruneRunsByIds) {
		result.pruned['replay-runs'] = pruneRunsByIds(analysis.stores['replay-runs'].eligibleIds ?? []);
	} else {
		result.skipped.push('replay-runs: no pruneRunsByIds dep');
	}

	if (pruneAssessmentsByIds) {
		result.pruned['ux-assessments'] = pruneAssessmentsByIds(analysis.stores['ux-assessments'].eligibleIds ?? []);
	} else {
		result.skipped.push('ux-assessments: no pruneAssessmentsByIds dep');
	}

	if (pruneUnlinked) {
		result.pruned['evidence-graph'] = pruneUnlinked(cfg.evidenceNodeMax);
	} else {
		result.skipped.push('evidence-graph: no pruneUnlinked dep');
	}

	// sessions: intentionally NOT pruned here — store.js pruneOldSessions owns
	// that budget and already runs at boot + 30-min ticks.
	result.pruned.sessions = 'managed-by-store.js';

	console.log(
		`[store-hygiene] cleanup applied — missions:${result.pruned.missions?.length ?? 0} ` +
		`replay-runs:${result.pruned['replay-runs']?.length ?? 0} ` +
		`ux-assessments:${result.pruned['ux-assessments']?.length ?? 0} ` +
		`evidence:${result.pruned['evidence-graph']?.prunedEvidence ?? 0}+${result.pruned['evidence-graph']?.prunedObservations ?? 0}`
	);
	return result;
}
