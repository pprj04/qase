/**
 * Phase 16 — Finding enrichment orchestrator.
 *
 * Runs AFTER a session/mission completes (async post-processing, never in the
 * execution critical path). Gathers typed evidence for each finding from the
 * evidence graph, runs the deterministic intelligence engine, merges results
 * into the global store, and performs global-store duplicate detection.
 *
 * Failure here never blocks missions, finalize, or reporting.
 */

import {
	enrichFinding, detectDuplicates, redactEvidenceItem, redactString,
} from './findingIntelligence.js';
import {
	getFinding, listFindings, getAllFindings, applyIntelligence, markDuplicate,
} from './findings.js';
import { getFindingEvidence } from './evidenceGraph.js';
import { listWorkflows } from './workflows.js';
import { getSession } from './store.js';

/* ── Phase 16 telemetry (in-memory counters, exposed via /api/bug-intelligence/metrics) ── */
export const bugIntelMetrics = {
	findings_detected: 0,
	findings_enriched: 0,
	findings_verified: 0,
	findings_false_positive: 0,
	findings_duplicate: 0,
	verification_rate: null,
	false_positive_rate: null,
	classification_accuracy: null, // set by benchmark comparison when ground truth present
	severity_accuracy: null,
	enrichment_runs: 0,
	enrichment_failures: 0,
	classification_latency_ms: { count: 0, total: 0, max: 0 },
	duplicate_detection_latency_ms: { count: 0, total: 0, max: 0 },
	enrichment_latency_ms: { count: 0, total: 0, max: 0 },
};

function observeLatency(bucket, ms) {
	bucket.count++;
	bucket.total += ms;
	if (ms > bucket.max) bucket.max = ms;
}

export function getBugIntelMetrics() {
	const enrichedTotal = bugIntelMetrics.findings_detected || 1;
	return {
		...bugIntelMetrics,
		verification_rate: bugIntelMetrics.findings_verified / enrichedTotal,
		false_positive_rate: bugIntelMetrics.findings_false_positive / enrichedTotal,
		duplicate_rate: bugIntelMetrics.findings_duplicate / enrichedTotal,
		classification_latency_ms: {
			count: bugIntelMetrics.classification_latency_ms.count,
			avg: bugIntelMetrics.classification_latency_ms.count
				? +(bugIntelMetrics.classification_latency_ms.total / bugIntelMetrics.classification_latency_ms.count).toFixed(1)
				: 0,
			max: bugIntelMetrics.classification_latency_ms.max,
		},
		duplicate_detection_latency_ms: {
			count: bugIntelMetrics.duplicate_detection_latency_ms.count,
			avg: bugIntelMetrics.duplicate_detection_latency_ms.count
				? +(bugIntelMetrics.duplicate_detection_latency_ms.total / bugIntelMetrics.duplicate_detection_latency_ms.count).toFixed(1)
				: 0,
			max: bugIntelMetrics.duplicate_detection_latency_ms.max,
		},
		enrichment_latency_ms: {
			count: bugIntelMetrics.enrichment_latency_ms.count,
			avg: bugIntelMetrics.enrichment_latency_ms.count
				? +(bugIntelMetrics.enrichment_latency_ms.total / bugIntelMetrics.enrichment_latency_ms.count).toFixed(1)
				: 0,
			max: bugIntelMetrics.enrichment_latency_ms.max,
		},
	};
}

/**
 * Enrich all findings of one session (post-finalize). Async, best-effort.
 * @param {string} sessionId
 * @param {object} opts { missionId } — recorded on findings for provenance.
 */
export async function enrichSessionFindings(sessionId, opts = {}) {
	const runStart = Date.now();
	bugIntelMetrics.enrichment_runs++;
	let workflows = [];
	try { workflows = listWorkflows(); } catch { /* workflows store optional */ }

	const sessionFindings = listFindings({ sessionId });
	const results = { enriched: 0, verified: 0, duplicates: 0, failures: 0 };

	for (const f of sessionFindings) {
		try {
			const t0 = Date.now();
			const evidence = (getFindingEvidence(f.id) ?? []).map(redactEvidenceItem);
			const observationCount = evidence.length >= 2 ? 2 : evidence.length;

			const tClass = Date.now();
			// hasReproObservation: the agent actually re-tested the target during
			// this mission (session has captured steps) — distinguishes real
			// reproduction failures from bookkeeping-only attempts.
			const hasReproObservation = (getSession?.(sessionId)?.capturedSteps?.length ?? 0) > 0 || evidence.length > 0;
			const derived = enrichFinding(f, {
				evidence,
				workflows,
				features: [],
				observationCount,
				hasReproObservation,
			});
			observeLatency(bugIntelMetrics.classification_latency_ms, Date.now() - tClass);

			if (opts.missionId && !f.missionId) derived.missionId = opts.missionId;
			applyIntelligence(f.id, derived);

			bugIntelMetrics.findings_detected++;
			bugIntelMetrics.findings_enriched++;
			results.enriched++;
			if (derived.finding_status === 'VERIFIED') { bugIntelMetrics.findings_verified++; results.verified++; }
			if (f.review_status === 'false_positive') bugIntelMetrics.findings_false_positive++;

			// Global-store duplicate detection (async, after enrichment so signatures exist).
			const tDup = Date.now();
			const others = getAllFindings().filter(o => o.id !== f.id && !o.isDuplicate);
			const dup = detectDuplicates({ ...f, primary_category: derived.primary_category, errorSignatureKnown: true }, others);
			observeLatency(bugIntelMetrics.duplicate_detection_latency_ms, Date.now() - tDup);

			if (dup.duplicate_of) {
				markDuplicate(f.id, dup.duplicate_of, {
					evidenceCount: (derived.evidence_refs ?? []).length,
				});
				bugIntelMetrics.findings_duplicate++;
				results.duplicates++;
			} else if (derived.duplicate_candidates === undefined) {
				applyIntelligence(f.id, { duplicate_candidates: dup.candidates });
			}
		} catch (error) {
			bugIntelMetrics.enrichment_failures++;
			results.failures++;
			console.error(`[phase16] Enrichment failed for ${f.id}:`, error.message);
		}
	}
	observeLatency(bugIntelMetrics.enrichment_latency_ms, Date.now() - runStart);
	return results;
}

/**
 * Re-enrich a single finding on demand (e.g. after review or new evidence).
 */
export async function reenrichFinding(findingId, opts = {}) {
	const f = getFinding(findingId);
	if (!f) return null;
	let workflows = [];
	try { workflows = listWorkflows(); } catch { /* optional */ }
	const evidence = (getFindingEvidence(f.id) ?? []).map(redactEvidenceItem);
	// An explicit revalidate request is itself a reproduction attempt: the
	// operator asked Qase to re-test, so the attempt must be counted even when
	// the stored finding predates the numeric attempt fields (legacy shapes).
	const inputs = { ...f };
	if (opts.hasReproObservation) {
		// An explicit revalidate request is itself a reproduction attempt: the
		// operator asked Qase to re-test, so attempts must grow on every call —
		// including the first one on a legacy finding that carries no numeric
		// attempt fields yet ('confirmed' reproducibility).
		const prevAttempts = Number.isFinite(inputs.reproduction_attempts) && inputs.reproduction_attempts > 0
			? inputs.reproduction_attempts : 0;
		const prevSuccesses = Number.isFinite(inputs.successful_reproductions) && inputs.successful_reproductions > 0
			? inputs.successful_reproductions : 0;
		const wasConfirmed = inputs.reproducibility === 'confirmed' || inputs.reproducibility === 'REPRODUCIBLE';
		inputs.reproduction_attempts = prevAttempts + 1;
		inputs.successful_reproductions = wasConfirmed ? prevSuccesses + 1 : prevSuccesses;
	}
	const derived = enrichFinding(inputs, {
		evidence,
		workflows,
		features: [],
		observationCount: evidence.length >= 2 ? 2 : evidence.length,
		hasReproObservation: opts.hasReproObservation ?? false,
	});
	// Preserve human verdicts over derived lifecycle.
	if (f.review_status && f.review_status !== 'unreviewed') derived.review_status = f.review_status;
	applyIntelligence(f.id, derived);
	return derived;
}

/**
 * Re-enrich after an explicit reproduction attempt (API revalidate). An
 * operator-requested re-test is a real reproduction observation: attempts
 * must be counted even when the stored finding carries no numeric attempt
 * fields yet (legacy 'confirmed' reproducibility).
 */
export async function reenrichFindingWithObservation(findingId, opts = {}) {
	return reenrichFinding(findingId, { ...opts, hasReproObservation: true });
}

