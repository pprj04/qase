'use strict';

/**
 * Phase 16/17/18 API router — additive routes only.
 *
 * Reconstructed from the test-suite contract (tests/phase16-api.test.js,
 * phase17-api.test.js, phase18-api.test.js) after server/index.js was
 * destroyed by disk corruption. All route handlers delegate to the surviving
 * store/engine modules; nothing here reimplements engine logic.
 *
 * Auth: every mutating route + all /api/v1 routes sit behind the same
 * `requireApiToken` middleware used by the rest of the app.
 */

import { Router } from 'express';

import {
	CATEGORIES, SEVERITIES, SEVERITIES as SEV, PRIORITIES, LIFECYCLE,
	REVIEW_STATUSES, REPRODUCIBILITIES, ROOT_CAUSES, RISKS,
	normalizeCategory, compareForDuplicates, detectDuplicates, groupFindings,
	redactEvidenceItem, LIFECYCLE_TRANSITIONS,
} from './findingIntelligence.js';
import { getBugIntelMetrics } from './findingEnrichment.js';
import {
	exportFindingsBulkMarkdown, exportFindingsBulkGitHub, exportFindingsBulkJira, exportFindingsBulkLinear,
} from './bugExporters.js';
import {
	getFinding, updateFinding, setReviewStatus, markDuplicate, listFindings,
	getAllFindings, transitionFindingStatus,
} from './findings.js';
import { getFindingEvidence } from './evidenceGraph.js';
import { getMission } from './missions.js';
import {
	getAssessmentForMission, applyIssueReview, getUxMetrics, runUxAssessment,
} from './uxAssessment.js';
import { listMissions } from './missions.js';
import { governorStats, queuePositionOf } from './missionGovernor.js';
import { buildRecommendations } from './recommendationEngine.js';
import {
	loadValidations, getRun, getRunsForFinding, findByIdempotencyKey,
	listValidations, createRun, transitionRun, getFixValidationMetrics,
	setFindingResolver, applyReview,
} from './fixValidation.js';
import { executeValidation } from './validationExecutorCore.js';
import {
	VALIDATION_REVIEW_STATES, canTransitionReview,
} from './fixStatusEngine.js';
// P0-F4 — ownership scoping for the phase-router surface (same model as
// index.js; open/master/admin see everything, users see own + legacy).
import { canAccessResource, isUserScoped } from './ownership.js';

const VALID_REVIEW_STATES = ['unreviewed', 'confirmed', 'false_positive', 'duplicate', 'wont_fix', 'reopened'];
	const VALID_UX_REVIEW_STATES = ['UNREVIEWED', 'AUTO_VERIFIED', 'REVIEW_REQUIRED', 'REJECTED'];

/** P0-F4 — send 404 (never a leak) and return false when access is denied. */
function denyFinding(req, res, finding) {
	if (!finding) {
		res.status(404).json({ error: 'Finding not found' });
		return true;
	}
	if (!canAccessResource(req, finding)) {
		res.status(404).json({ error: 'Finding not found' });
		return true;
	}
	return false;
}

/** P0-F4 — same guard for missions. */
function denyMission(req, res, mission) {
	if (!mission) {
		res.status(404).json({ error: 'Mission not found' });
		return true;
	}
	if (!canAccessResource(req, mission)) {
		res.status(404).json({ error: 'Mission not found' });
		return true;
	}
	return false;
}

export function phaseRouter(auth, publicReadGet = []) {
	const router = Router();

	// Phase 11a: cross-session bug export — B1 W3: token-gated like every
	// other read (redacted content, but no longer anonymous). Mutations were
	// always gated.
	router.get('/findings/export', auth || ((req, res, next) => next()), (req, res) => {
		const { format = 'markdown' } = req.query;
		const all = listFindings({
			projectId: req.query.projectId,
			severity: req.query.severity,
			status: req.query.status,
			category: req.query.category,
			fixStatus: req.query.fixStatus,
			q: req.query.q,
			ownerFilter: isUserScoped(req) ? f => canAccessResource(req, f) : null,
		}).filter(f => !f.isDuplicate);
		if (format === 'markdown') {
			res.type('text/markdown').send(exportFindingsBulkMarkdown(all));
			return;
		}
		if (format === 'github') return res.json(exportFindingsBulkGitHub(all));
		if (format === 'jira') return res.json(exportFindingsBulkJira(all));
		if (format === 'linear') return res.json(exportFindingsBulkLinear(all));
		res.status(400).json({ error: `Unsupported export format: ${format}` });
	});

	// Every Phase 16/17/18 route sits behind the same token gate as the
	// rest of the API (no-token-configured ⇒ open, matching HEAD behavior).
	// M1-P3: UI-facing READ routes stay public (they worked anonymously via
	// the S1 auto-cookie before it was removed): finding evidence for the
	// Bugs hub cards, mission-for-session for the run console, and finding
	// detail for the bug modal. Express runs this router.use BEFORE route
	// middleware, so the exemption is pattern-matched here.
	// B1 W3 — no public reads by default. The caller may still pass explicit
	// exemptions (kept for tests), but the shipped index.js passes none.
	const PUBLIC_READ_GET = publicReadGet ?? [];
	// NOTE: /findings/grouped must NOT be public — the :id pattern above
	// matches it, so it gets an explicit auth here by leaving the general
	// exemption list to the caller; grouped was public pre-fix ONLY via the
	// S1 cookie like everything else. If it needs to be public later, add an
	// explicit pattern.
	router.use((req, res, next) => {
		// B1 — the HMAC-signed integration surface authenticates itself via
		// requireIntegrationAuth on its own routes; the legacy bearer gate
		// must not intercept it (its Authorization header is not a Bearer).
		if (req.path.startsWith('/v1/integration/')) return next();
		// Canonical artifact reads authenticate at their own handler (session
		// or HMAC plus mission/evidence ownership). Never pre-gate with bearer.
		if (req.method === 'GET' && /^\/v1\/artifacts\/(?!stats(?:\/|$))[^/]+(?:\/content)?\/?$/i.test(req.path)) return next();
		// C1 — the /api/v2 Pulse read surface mounts its own router (with the
		// same requireApiToken) at app level; phaseRouter must not pre-gate
		// its routes — including the deliberately-public /api/v2/health.
		if (req.path.startsWith('/v2/')) return next();
		if (auth && !(req.method === 'GET' && PUBLIC_READ_GET.some(re => re.test(req.path)))) {
			return auth(req, res, next);
		}
		next();
	});

	/* ═══════════════ Phase 16 — Bug Intelligence ═══════════════ */

	router.get('/bug-intelligence/enums', (_req, res) => {
		res.json({
			categories: CATEGORIES,
			severities: SEVERITIES,
			priorities: PRIORITIES,
			lifecycle: LIFECYCLE,
			reviewStatuses: REVIEW_STATUSES,
			reproducibilities: REPRODUCIBILITIES,
			rootCauses: ROOT_CAUSES,
			risks: RISKS,
			lifecycleTransitions: LIFECYCLE_TRANSITIONS,
		});
	});

	router.get('/bug-intelligence/metrics', (_req, res) => {
		res.json(getBugIntelMetrics());
	});

	// ── Classification / severity / priority / review ──

	router.patch('/findings/:id/classification', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const { primaryCategory, secondaryCategories, confidence } = req.body ?? {};
		if (!primaryCategory || !CATEGORIES.includes(primaryCategory)) {
			return res.status(400).json({ error: `primaryCategory must be one of ${CATEGORIES.join(', ')}` });
		}
		const secondaries = Array.isArray(secondaryCategories)
			? secondaryCategories.filter(c => CATEGORIES.includes(c)).slice(0, 3)
			: [];
		const conf = typeof confidence === 'number' ? Math.min(1, Math.max(0, confidence)) : undefined;
		f.primary_category = primaryCategory;
		f.secondary_categories = secondaries;
		if (conf !== undefined) f.classification_confidence = conf;
		f.history.push({ ts: Date.now(), field: 'primary_category', from: null, to: primaryCategory, by: 'user' });
		res.json(f);
	});

	router.patch('/findings/:id/severity', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const { severity, confidence, rationale } = req.body ?? {};
		if (!severity || !SEVERITIES.includes(severity)) {
			return res.status(400).json({ error: `severity must be one of ${SEVERITIES.join(', ')}` });
		}
		f.severity = severity;
		if (typeof confidence === 'number') f.severity_confidence = Math.min(1, Math.max(0, confidence));
		if (typeof rationale === 'string') f.severity_rationale = rationale;
		f.history.push({ ts: Date.now(), field: 'severity', from: null, to: severity, by: 'user', detail: rationale });
		res.json(f);
	});

	router.patch('/findings/:id/priority', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const { priority, rationale } = req.body ?? {};
		if (!priority || !PRIORITIES.includes(priority)) {
			return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
		}
		f.priority = priority;
		if (typeof rationale === 'string') f.priority_rationale = rationale;
		f.history.push({ ts: Date.now(), field: 'priority', from: null, to: priority, by: 'user', detail: rationale });
		res.json(f);
	});

	router.patch('/findings/:id/lifecycle', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const { findingStatus } = req.body ?? {};
		if (!findingStatus || !LIFECYCLE.includes(findingStatus)) {
			return res.status(400).json({ error: `findingStatus must be one of ${LIFECYCLE.join(', ')}` });
		}
		const result = transitionFindingStatus(req.params.id, findingStatus, 'user', 'lifecycle PATCH');
		if (!result.ok) {
			return res.status(400).json({ error: result.reason || 'invalid transition', finding_status: f.finding_status ?? 'DETECTED' });
		}
		res.json(result.finding);
	});

	router.patch('/findings/:id/review', (req, res) => {
		// P0-F4 — ownership before review transition.
		if (denyFinding(req, res, getFinding(req.params.id))) return;
		const { reviewStatus, note, by } = req.body ?? {};
		if (!reviewStatus || !VALID_REVIEW_STATES.includes(reviewStatus)) {
			return res.status(400).json({ error: `reviewStatus must be one of ${VALID_REVIEW_STATES.join(', ')}` });
		}
		const result = setReviewStatus(req.params.id, reviewStatus, by || 'user', note);
		if (!result.ok) {
			if (result.reason === 'not_found') return res.status(404).json({ error: 'Finding not found' });
			return res.status(400).json({ error: result.reason });
		}
		res.json(result.finding);
	});

	// ── Duplicates / related / linkage ──

	router.get('/findings/:id/duplicates', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const others = getAllFindings().filter(x => x.id !== f.id && !x.isDuplicate && canAccessResource(req, x));
		const { candidates, duplicate_of, canonicalId } = detectDuplicates(f, others);
		res.json({ candidates, duplicate_of, canonicalId, isDuplicate: Boolean(f.isDuplicate), duplicateOf: f.duplicateOf ?? null });
	});

	router.post('/findings/:id/duplicates', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const { canonicalId } = req.body ?? {};
		const canonical = getFinding(String(canonicalId));
		if (!canonical || !canAccessResource(req, canonical) || canonical.id === f.id || canonical.isDuplicate) {
			return res.status(400).json({ error: 'Invalid canonical finding' });
		}
		const updated = markDuplicate(f.id, canonical.id, { method: 'manual', by: 'user', ts: Date.now() });
		res.json(updated);
	});

	router.get('/findings/:id/related', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const all = getAllFindings().filter(x => x.id !== f.id && !x.isDuplicate && canAccessResource(req, x));
		const related = all.map(x => {
			const cmp = compareForDuplicates(f, x);
			return { id: x.id, title: x.title, severity: x.severity, similarity: cmp?.similarity ?? 0, basis: cmp?.basis ?? [] };
		}).filter(r => r.similarity > 0.3)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, 10);
		res.json({ related });
	});

	router.get('/findings/:id/affected-workflow', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		res.json({ workflow: f.workflow_name ?? f.workflow_id ?? null, basis: f.linkage_basis ?? null });
	});

	router.get('/findings/:id/affected-feature', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		res.json({ feature: f.feature_name ?? f.feature_id ?? null, basis: f.linkage_basis ?? null });
	});

	// M1-P3 P0-5 follow-up: finding-evidence and mission-for-session are
	// UI-facing reads (Bugs hub bug cards, run console). They worked
	// anonymously only via the S1 auto-cookie; phaseRouter sits behind the
	// token gate, so these two reads are exempted here. Response bodies are
	// server-redacted. All phaseRouter MUTATIONS stay gated.
	router.get('/findings/:id/evidence', (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		const evidence = (getFindingEvidence(f.id) ?? []).filter(e => canAccessResource(req, e));
		res.json(evidence.map(e => redactEvidenceItem(e)));
	});

	router.get('/findings/grouped', (req, res) => {		const { groupBy = 'category' } = req.query;
		const valid = ['category', 'severity', 'priority', 'workflow', 'feature', 'risk'];
		if (!valid.includes(groupBy)) {
			return res.status(400).json({ error: `groupBy must be one of ${valid.join(', ')}` });
		}
		// False positives are a separate representation: reviewed-out defects are
		// excluded from grouped defect counts (Phase 16 spec — FP never counts
		// alongside confirmed defects).
		const visible = isUserScoped(req) ? getAllFindings().filter(f => canAccessResource(req, f)) : getAllFindings();
		const all = visible.filter(f => f.review_status !== 'false_positive');
		const grouped = groupFindings(all, groupBy);
		res.json({
			groupBy,
			canonicalCount: all.filter(f => !f.isDuplicate).length,
			duplicateCount: all.filter(f => f.isDuplicate).length,
			groups: grouped.groups ?? grouped,
		});
	});

	/* ═══════════════ Phase 17 — UX / Quality (read side) ═══════════════ */

	// UI helpers: session → mission resolution + aggregate panel payload.
	router.get('/missions/:id/mission-for-session', (req, res) => {
		const sessionId = req.params.id;
		const all = listMissions({}).filter(m => canAccessResource(req, m));
		const mission = [...all].reverse().find(m => m.sessionId === sessionId);
		res.json({ missionId: mission?.id ?? null });
	});

	router.get('/missions/:id/ux-quality', (req, res) => {
		const mission = getMission(req.params.id);
		if (denyMission(req, res, mission)) return; // P0-F4
		const a = getAssessmentForMission(mission.id);
		if (!a) return res.status(404).json({ error: 'No UX assessment yet' });
		res.json({
			missionId: a.missionId,
			quality: a.quality,
			overall: a.quality.overall,
			dimensions: a.quality.dimensions,
			confidence: a.quality.overall?.confidence ?? null,
			evidenceCoverage: a.quality.overall?.evidenceCoverage ?? null,
			ux: { issues: a.ux.issues, unverifiedAreas: a.ux.unverifiedAreas },
			issues: a.ux.issues,
			unverifiedAreas: a.ux.unverifiedAreas,
			recommendations: a.recommendations ?? [],
			recordedAt: a.createdAt,
		});
	});

	// POST trigger: run the (async) UX assessment for a mission.
	router.post('/v1/missions/:id/ux-assess', async (req, res) => {
		const mission = getMission(req.params.id);
		if (denyMission(req, res, mission)) return; // P0-F4
		res.status(202).json({
			missionId: mission.id,
			status: 'accepted',
			pollUrl: `/api/v1/missions/${mission.id}/quality`,
		});
		// Fire-and-forget: runUxAssessment persists its own record.
		try {
			const { getSession } = await import('./store.js');
			const session = mission.sessionId ? getSession(mission.sessionId) : null;
			await runUxAssessment(session, mission, {});
		} catch (err) {
			console.error('[phase-router] ux-assess failed:', err?.message || err);
		}
	});

	const missionAssessment = (req, res) => {
		const mission = getMission(req.params.id);
		if (denyMission(req, res, mission)) return; // P0-F4
		const a = getAssessmentForMission(mission.id);
		if (!a) return res.status(404).json({ error: 'No UX assessment for this mission yet' });
		return { mission, a };
	};

	router.get('/v1/missions/:id/quality', (req, res) => {
		const got = missionAssessment(req, res);
		if (!got || res.headersSent) return;
		const { a } = got;
		res.json({
			missionId: a.missionId,
			overall: a.quality.overall,
			dimensions: a.quality.dimensions.map(d => ({
				id: d.id, name: d.name, dimension: d.dimension ?? d.name, score: d.score,
				confidence: d.confidence, evidenceCoverage: d.evidenceCoverage,
				basis: d.basis, signals: d.signals,
			})),
			recordedAt: a.createdAt,
		});
	});

	router.get('/v1/missions/:id/ux', (req, res) => {
		const got = missionAssessment(req, res);
		if (!got || res.headersSent) return;
		const { a } = got;
		res.json({
			missionId: a.missionId,
			sweepMeta: a.sweepMeta,
			issues: a.ux.issues,
			unverifiedAreas: a.ux.unverifiedAreas,
			recordedAt: a.createdAt,
		});
	});

	router.get('/v1/missions/:id/feature-gaps', (req, res) => {
		const got = missionAssessment(req, res);
		if (!got || res.headersSent) return;
		const { a } = got;
		res.json({
			missionId: a.missionId,
			features: a.featureGaps?.features ?? [],
			explorationSufficiency: a.featureGaps?.explorationSufficiency ?? null,
			recordedAt: a.createdAt,
		});
	});

	router.get('/v1/missions/:id/recommendations', (req, res) => {
		const got = missionAssessment(req, res);
		if (!got || res.headersSent) return;
		const { a } = got;
		res.json({
			missionId: a.missionId,
			recommendations: a.recommendations ?? [],
			recordedAt: a.createdAt,
		});
	});

	router.patch('/v1/missions/:id/ux/issues/:issueId/review', (req, res) => {
		const mission = getMission(req.params.id);
		if (denyMission(req, res, mission)) return; // P0-F4
		const { reviewState, reason, by } = req.body ?? {};
		if (!reviewState || !VALID_UX_REVIEW_STATES.includes(reviewState)) {
			return res.status(400).json({ error: `reviewState must be one of ${VALID_UX_REVIEW_STATES.join(', ')}` });
		}
		const result = applyIssueReview(mission.id, req.params.issueId, { reviewState, reason, by: by || 'user' });
		if (!result || result.error === 'assessment_not_found' || result.error === 'issue_not_found') {
			return res.status(404).json({ error: 'Issue not found' });
		}
		if (result.error) return res.status(409).json({ error: result.detail || result.error });
		res.json({ issue: result.issue });
	});

	router.get('/v1/metrics/ux', (_req, res) => {
		res.json(getUxMetrics());
	});

	// Phase 16 enrichment revalidate (re-runs enrichment, tracks attempts).
	// A revalidate request is an explicit re-test: the caller is asking Qase to
	// reproduce again, so this counts as a real reproduction observation.
	router.post('/findings/:id/revalidate', async (req, res) => {
		const f = getFinding(req.params.id);
		if (denyFinding(req, res, f)) return; // P0-F4 — ownership-scoped 404
		try {
			const { reenrichFindingWithObservation } = await import('./findingEnrichment.js');
			const derived = await reenrichFindingWithObservation(f.id, { hasReproObservation: true });
			res.json({ finding: getFinding(f.id), derived: derived ?? {} });
		} catch (err) {
			res.status(500).json({ error: String(err?.message || err) });
		}
	});

	/* ═══════════════ Phase 18 — Fix Validation ═══════════════ */

	router.post('/v1/findings/:id/revalidate', (req, res) => {
		const finding = getFinding(req.params.id);
		if (denyFinding(req, res, finding)) return; // P0-F4
		const idemKey = req.headers['idempotency-key'] || null;
		if (idemKey) {
			const existing = findByIdempotencyKey(idemKey);
			if (existing && existing.findingId === finding.id) {
				return res.status(200).json({ duplicate: true, validationId: existing.id, status: existing.status });
			}
		}
		const active = getRunsForFinding(finding.id).find(r => ['REQUESTED', 'QUEUED', 'RUNNING'].includes(r.status));
		if (active) {
			return res.status(409).json({ error: 'Validation already in progress', validationId: active.id });
		}
		const run = createRun({ finding, requestedBy: 'api', idempotencyKey: idemKey, trigger: 'manual' });
		transitionRun(run.id, { status: 'QUEUED' }, 'queued by api');
		executeValidation(run.id, { getFinding }).catch(err => {
			console.error(`[fix-validation] run ${run.id} crashed:`, err?.message || err);
			transitionRun(run.id, { status: 'FAILED', error: String(err?.message || err) }, 'crashed');
		});
		res.status(202).json({ validationId: run.id, status: run.status, pollUrl: `/api/v1/findings/${finding.id}/validation` });
	});

	router.post('/findings/:id/validate-fix', (req, res) => {
		req.url = `/v1/findings/${req.params.id}/revalidate`;
		router.handle(req, res);
	});

	router.get('/v1/findings/:id/validation', (req, res) => {
		const finding = getFinding(req.params.id);
		if (denyFinding(req, res, finding)) return; // P0-F4
		const runs = getRunsForFinding(finding.id); // newest-first
		if (!runs.length) return res.status(404).json({ error: 'No validation runs' });
		res.json({
			latest: runs[0],
			history: runs.slice(1),
			metrics: isUserScoped(req) ? {} : getFixValidationMetrics(),
		});
	});

	router.get('/v1/findings/:id/comparison', (req, res) => {
		const finding = getFinding(req.params.id);
		if (denyFinding(req, res, finding)) return; // P0-F4
		const runs = getRunsForFinding(finding.id);
		const completed = runs.find(r => r.status === 'COMPLETED' && r.comparison);
		if (!completed) return res.status(404).json({ error: 'No completed comparison yet' });
		const c = completed.comparison;
		res.json({
			before: Array.isArray(c.before) ? c.before : [c.before],
			after: Array.isArray(c.after) ? c.after : [c.after],
			comparison: { verdicts: c.verdicts, original: c.original, validation: c.validation },
			runId: completed.id,
		});
	});

	router.post('/v1/findings/:id/approve', (req, res) => {
		// P0-F4 — ownership before approving a validation outcome.
		if (denyFinding(req, res, getFinding(req.params.id))) return;
		const { decision, comment } = req.body ?? {};
		if (decision !== 'APPROVED') return res.status(400).json({ error: 'decision must be APPROVED' });
		const runs = getRunsForFinding(req.params.id);
		// Approve acts on the latest COMPLETED run — an in-flight run has no
		// final status to approve yet (its review state is not final).
		const latest = runs.find(r => r.status === 'COMPLETED');
		if (!latest) return res.status(404).json({ error: 'No completed validation run to approve' });
		if (!canTransitionReview(latest.reviewState ?? 'AUTO_VALIDATED', 'APPROVED')) {
			return res.status(409).json({ error: `Illegal review transition from ${latest.reviewState}` });
		}
		const applied = applyReview(latest.id, { to: 'APPROVED', by: 'user', comment });
		if (!applied || applied.error) return res.status(409).json({ error: applied?.detail || applied?.error || 'Review transition rejected' });
		const updated = applied.run;
		// Lifecycle closure: only VERIFIED_FIXED closes the finding to RESOLVED.
		if (updated.fixStatus === 'VERIFIED_FIXED') {
			transitionFindingStatus(req.params.id, 'RESOLVED', 'user', `fix-validation ${latest.id} approved`);
		}
		res.json({ reviewState: updated.reviewState, reviewTrail: updated.reviewTrail, run: updated });
	});

	router.post('/v1/findings/:id/reopen', (req, res) => {
		// P0-F4 — ownership before reopening.
		if (denyFinding(req, res, getFinding(req.params.id))) return;
		const { comment } = req.body ?? {};
		const runs = getRunsForFinding(req.params.id);
		const latest = runs.find(r => r.status === 'COMPLETED');
		if (!latest) return res.status(404).json({ error: 'No completed validation run to reopen' });
		if (!canTransitionReview(latest.reviewState ?? 'REVIEW_REQUIRED', 'REOPENED')) {
			return res.status(409).json({ error: `Illegal review transition from ${latest.reviewState}` });
		}
		const applied = applyReview(latest.id, { to: 'REOPENED', by: 'user', comment });
		if (!applied || applied.error) return res.status(409).json({ error: applied?.detail || applied?.error || 'Review transition rejected' });
		const updated = applied.run;
		// Finding returns to the active lifecycle. From RESOLVED (and most other
		// terminal states) REOPENED is a legal transition; if the current state
		// cannot reach REOPENED directly, route through VERIFYING first.
		const reopened = transitionFindingStatus(req.params.id, 'REOPENED', 'user', `fix-validation ${latest.id} reopened`);
		if (!reopened.ok && (getFinding(req.params.id)?.finding_status ?? 'DETECTED') !== 'REOPENED') {
			const via = transitionFindingStatus(req.params.id, 'VERIFYING', 'user', 'reopen routing');
			if (via.ok) transitionFindingStatus(req.params.id, 'REOPENED', 'user', `fix-validation ${latest.id} reopened`);
		}
		res.json({ reviewState: updated.reviewState, reviewTrail: updated.reviewTrail, run: updated });
	});

	router.get('/v1/fix-validations', (req, res) => {
		const limit = Math.min(100, Number(req.query.limit) || 50);
		res.json({ runs: listValidations({ limit }), metrics: getFixValidationMetrics() });
	});

	// v1 mission list (Phase 16/17 contract: { missions: [...] }).
	router.get('/v1/missions', (req, res) => {
		const limit = Math.min(100, Number(req.query.limit) || 20);
		const missions = listMissions({
			projectId: req.query.projectId,
			status: req.query.status,
			type: req.query.type,
			// P0-F4 — user-kind callers only see their own + legacy missions.
			ownerFilter: isUserScoped(req) ? m => canAccessResource(req, m) : null,
		}).slice(0, limit).map(m => ({
			id: m.id, name: m.name, status: m.status, type: m.type,
			targetUrl: m.targetUrl, sessionId: m.sessionId,
			projectId: m.projectId, createdAt: m.createdAt, updatedAt: m.updatedAt,
			iterations: (m.iterations ?? []).length,
			// M1-P4.2: execution-governor visibility
			queuedAt: m.queuedAt ?? null,
			startedAt: m.startedAt ?? null,
			completedAt: m.completedAt ?? null,
			queuePosition: m.status === 'queued' ? queuePositionOf(m.id) : null,
			failureReason: m.failureReason ?? null
		}));
		res.json({ missions, queueDepth: governorStats().queueDepth, governor: governorStats() });
	});

	// UX metrics for the dashboard.
	router.get('/metrics/dashboard/ux', (_req, res) => res.json(getUxMetrics()));

	/* ═══════════════ shared wiring ═══════════════ */

	// The store needs a finding resolver for completion-time pointer writes.
	setFindingResolver(getFinding);

	return router;
}
