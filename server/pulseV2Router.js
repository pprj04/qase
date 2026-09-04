/**
 * Pulse v2 read router — implements every operation declared in
 * server/openapiDocument.js under /api/v2.
 *
 * Contract (Pulse guide):
 *   - collections answer { data, total, page, page_size } (envelope ALWAYS on v2;
 *     defaults page=1, page_size=100, hard max 500);
 *   - all timestamps ISO 8601 UTC; numbers stay numbers;
 *   - foreign ids joined with human-readable names;
 *   - from/to date filters (from inclusive, to exclusive); invalid → 400;
 *   - Bearer-token auth inherited from the passed middleware (health is public).
 *
 * Legacy /api/* routes are untouched — this is a parallel read surface.
 */

import { Router } from 'express';
// P0-F4 — ownership scoping for the v2 read surface (same model as index.js).
import { canAccessResource, isUserScoped } from './ownership.js';
import { parsePulsePaging, parseDateRange, applyDateRange, deepIsoTimestamps, deepSnakeKeys } from './pulseHelpers.js';
import {
	nameResolver, projectProject, projectMission, projectSessionSummary, projectSessionDetail,
	projectFinding, projectTestCase, projectWorkflow, projectSuite, projectSchedule,
	projectRegressionRun, projectRegressionRunDetail, projectFixValidationRun,
	projectKnowledgePattern, projectTrendPoint, projectDashboardMetrics,
} from './pulseProjection.js';
import { listProjects, getProject } from './projects.js';
import { listMissions, getMission } from './missions.js';
import { listSessions, getSession, liveFor } from './store.js';
import { listFindings, getFinding, getFindingStats, getAllFindings } from './findings.js';
import { listTestCases, getTestCase, listTags } from './testCases.js';
import { listWorkflows, getWorkflow } from './workflows.js';
import { listSuites } from './suites.js';
import { listSchedules, getSchedule } from './scheduler.js';
import {
	listRegressionRuns, getRegressionRun, getTrend,
} from './regressionStore.js';
import { listValidations, getRunsForFinding, getFixValidationMetrics } from './fixValidation.js';
import {
	getAllPatterns, getPatternProvenance, getKnowledgeStats,
} from './knowledge.js';
import { getDashboardMetrics } from './metrics.js';
import { getUxMetrics } from './uxAssessment.js';
import { getTestCaseIdsWithBaselines as hasBaselines } from './baselines.js';
import { groupFindings } from './findingIntelligence.js';
import { getApiUsage, initApiUsageTracker, apiUsageCounter } from './apiUsage.js';
import {
	CATEGORIES, SEVERITIES, PRIORITIES, LIFECYCLE, REVIEW_STATUSES,
	REPRODUCIBILITIES, ROOT_CAUSES, RISKS, LIFECYCLE_TRANSITIONS,
} from './findingIntelligence.js';


/** P0-F4 — ownership-scoped 404 for the v2 surface. */
function denyResource(req, res, kind, record) {
	if (!record || !canAccessResource(req, record)) {
		res.status(404).json({ error: { code: `${kind.toLowerCase()}_not_found`, message: `${kind} not found.` } });
		return true;
	}
	return false;
}

export function pulseV2Router(requireApiToken, usageCounter = null) {
	const router = Router();
	// C1 G1 — /health must be public: the OpenAPI document declares it
	// `public: true` (and legacy /api/health is public), but router.use
	// auth-gated EVERY v2 route including it. Anonymous liveness probes
	// must get 200. Registered BEFORE the auth middleware.
	router.get('/health', (_req, res) => {
		res.json({ status: 'ok', uptime: Math.round(process.uptime()), project: process.env.QASE_PROJECT_NAME ?? 'Qase' });
	});
	router.use(requireApiToken);
	// C1 G3 — count authenticated v2 requests (path templates only). Mounted
	// after auth so 401-rejected traffic is not "usage".
	if (usageCounter) router.use(usageCounter);

	const names = nameResolver({
		getProject,
		getMission,
		getSession,
		getSchedule,
	});

	const pageDefaults = { page: 1, pageSize: 100 };

	/** Wrap a projected list in the Pulse envelope with date-range pre-filter applied. */
	function envelope(list, query, { rangeField, extras = {} } = {}) {
		const range = parseDateRange(query);
		if (range?.error) return { error: range.error };
		const filtered = rangeField ? applyDateRange(list, range, rangeField) : list;
		const paging = parsePulsePaging(query) ?? pageDefaults;
		const total = filtered.length;
		const offset = (paging.page - 1) * paging.pageSize;
		return {
			body: {
				data: filtered.slice(offset, offset + paging.pageSize),
				total,
				page: paging.page,
				page_size: paging.pageSize,
				...extras,
			},
		};
	}

	function sendList(res, query, list, opts) {
		const result = envelope(list, query, opts);
		if (result.error) return res.status(400).json({ error: result.error });
		return res.json(result.body);
	}

	const notFound = (res, what) => res.status(404).json({ error: `${what} not found` });

	/* ── Meta ── */

	/* /health moved above router.use(requireApiToken) — see C1 G1 note. */

	router.get('/bug-taxonomy', (_req, res) => {
		res.json({
			categories: CATEGORIES,
			severities: SEVERITIES,
			priorities: PRIORITIES,
			lifecycle: LIFECYCLE,
			review_statuses: REVIEW_STATUSES,
			reproducibilities: REPRODUCIBILITIES,
			root_causes: ROOT_CAUSES,
			risks: RISKS,
			lifecycle_transitions: LIFECYCLE_TRANSITIONS,
		});
	});

	/* ── Projects ── */

	router.get('/projects', (_req, res) => {
		// Bounded, small collection (single-tenant) — documented as a bare array.
		res.json(listProjects().map(projectProject));
	});

	/* ── Missions ── */

	router.get('/missions', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listMissions({
			projectId: req.query.project_id,
			status: req.query.status,
			type: req.query.type,
			source: req.query.source,
			// P0-F4 — user-kind callers see own + legacy only.
			ownerFilter: isUserScoped(req) ? m => canAccessResource(req, m) : null,
		}), range, 'createdAt');
		sendList(res, req.query, raw.map(m => projectMission(m, names)), {});
	});

	router.get('/missions/:id', (req, res) => {
		const mission = getMission(req.params.id);
		if (denyResource(req, res, 'Mission', mission)) return; // P0-F4
		res.json(projectMission(mission, names));
	});

	router.get('/mission-summaries', (req, res) => {
		const list = listMissions({
			projectId: req.query.project_id,
			status: req.query.status,
			type: req.query.type,
			// P0-F4 — user-kind callers see own + legacy only.
			ownerFilter: isUserScoped(req) ? m => canAccessResource(req, m) : null,
		});
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const filtered = applyDateRange(list, range, 'createdAt');
		const paging = parsePulsePaging(req.query) ?? pageDefaults;
		const projected = filtered.map(m => projectMission(m, names));
		res.json({
			data: projected.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize),
			total: projected.length,
			page: paging.page,
			page_size: paging.pageSize,
		});
	});

	router.get('/mission-status/:id', (req, res) => {
		const mission = getMission(req.params.id);
		if (denyResource(req, res, 'Mission', mission)) return; // P0-F4
		res.json(projectMission(mission, names));
	});

	/* ── Sessions ── */

	router.get('/sessions', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listSessions({
			projectId: req.query.project_id,
			// P0-F4 — user-kind callers see own + legacy only.
			ownerFilter: isUserScoped(req) ? s => canAccessResource(req, s) : null,
		}), range, 'createdAt');
		sendList(res, req.query, raw.map(s => projectSessionSummary(s, names)), {});
	});

	router.get('/sessions/:id', (req, res) => {
		const session = getSession(req.params.id);
		if (denyResource(req, res, 'Session', session)) return; // P0-F4
		const record = liveFor(session.id);
		res.json(projectSessionDetail(session, names, record));
	});

	/* ── Findings ── */

	router.get('/findings', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listFindings({
			projectId: req.query.project_id,
			severity: req.query.severity,
			status: req.query.status,
			category: req.query.primary_category,
			assignee: req.query.assignee,
			sessionId: req.query.session_id,
			primaryCategory: req.query.primary_category,
			priority: req.query.priority,
			findingStatus: req.query.finding_status,
			reviewStatus: req.query.review_status,
			reproducibility: req.query.reproducibility,
			missionId: req.query.mission_id,
			q: req.query.q,
			// P0-F4 — user-kind callers see own + legacy only.
			ownerFilter: isUserScoped(req) ? f => canAccessResource(req, f) : null,
		}), range, 'ts');
		sendList(res, req.query, raw.map(f => projectFinding(f, names)), {});
	});

	router.get('/findings/stats', (req, res) => {
		const raw = getFindingStats({ projectId: req.query.project_id });
		res.json(deepSnakeCounters(raw));
	});

	router.get('/findings/grouped', (req, res) => {
		const groupBy = req.query.group_by ?? req.query.groupBy ?? 'category';
		const valid = ['category', 'severity', 'priority', 'workflow', 'feature', 'risk'];
		if (!valid.includes(groupBy)) {
			return res.status(400).json({ error: `group_by must be one of ${valid.join(', ')}` });
		}
		const visible = isUserScoped(req) ? getAllFindings().filter(f => canAccessResource(req, f)) : getAllFindings();
		const all = visible.filter(f => f.review_status !== 'false_positive');
		const grouped = groupFindings(all, groupBy);
		const groups = Object.values(grouped.groups ?? {}).map(g => ({
			key: g.key,
			count: g.total,
			severity_breakdown: g.bySeverity ?? {},
		}));
		res.json({
			group_by: groupBy,
			canonical_count: all.filter(f => !f.isDuplicate).length,
			duplicate_count: all.filter(f => f.isDuplicate).length,
			groups,
		});
	});

	router.get('/findings/:id', (req, res) => {
		const finding = getFinding(req.params.id);
		if (denyResource(req, res, 'Finding', finding)) return; // P0-F4
		res.json(projectFinding(finding, names));
	});

	/* ── Test cases ── */

	router.get('/test-cases', (req, res) => {
		const cases = listTestCases({
			projectId: req.query.project_id,
			targetUrl: req.query.target_url,
			workflowId: req.query.workflow_id,
			suiteId: req.query.suite_id,
			tag: req.query.tag,
		});
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const baselineIds = hasBaselines();
		const raw = applyDateRange(cases, range, 'createdAt');
		sendList(res, req.query, raw.map(tc => projectTestCase(tc, names, {
			hasBaselines: baselineIds.has(tc.id),
		})), {});
	});

	router.get('/test-cases/tags', (req, res) => {
		const tags = listTags({ projectId: req.query.project_id });
		sendList(res, req.query, tags, {});
	});

	router.get('/test-cases/:id', (req, res) => {
		const tc = getTestCase(req.params.id);
		if (!tc) return notFound(res, 'Test case');
		res.json(projectTestCase(tc, names, { hasBaselines: hasBaselines([tc.id]).has?.(tc.id) ?? false }));
	});

	/* ── Workflows ── */

	router.get('/workflows', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listWorkflows({
			projectId: req.query.project_id,
			targetUrl: req.query.target_url,
		}), range, 'createdAt');
		sendList(res, req.query, raw.map(wf => projectWorkflow(wf, names)), {});
	});

	router.get('/workflows/:id', (req, res) => {
		const wf = getWorkflow(req.params.id);
		if (!wf) return notFound(res, 'Workflow');
		res.json(projectWorkflow(wf, names, { withSteps: true }));
	});

	/* ── Suites & Schedules ── */

	router.get('/suites', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listSuites({ projectId: req.query.project_id }), range, 'createdAt');
		sendList(res, req.query, raw.map(s => projectSuite(s, names)), {});
	});

	router.get('/schedules', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listSchedules({ projectId: req.query.project_id }), range, 'createdAt');
		sendList(res, req.query, raw.map(s => projectSchedule(s, names)), {});
	});

	router.get('/schedules/:id/runs', (req, res) => {
		const schedule = getSchedule(req.params.id);
		if (!schedule) return notFound(res, 'Schedule');
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listRegressionRuns({ scheduleId: req.params.id }), range, 'ts');
		sendList(res, req.query, raw.map(r => projectRegressionRun(r, names)), {});
	});

	/* ── Regression ── */

	router.get('/regression/runs', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(listRegressionRuns({
			projectId: req.query.project_id,
			scheduleId: req.query.schedule_id,
			targetUrl: req.query.target_url,
		}), range, 'ts');
		sendList(res, req.query, raw.map(r => projectRegressionRun(r, names)), {});
	});

	router.get('/regression/runs/:id', (req, res) => {
		const run = getRegressionRun(req.params.id);
		if (!run) return notFound(res, 'Regression run');
		res.json(projectRegressionRunDetail(run, names));
	});

	router.get('/regression/trend', (req, res) => {
		const limitRaw = Number(req.query.limit);
		const limit = Number.isFinite(limitRaw) && limitRaw > 0
			? Math.min(limitRaw, 500)
			: 20;
		const trend = getTrend({
			projectId: req.query.project_id,
			scheduleId: req.query.schedule_id,
			targetUrl: req.query.target_url,
			limit,
		}).map(projectTrendPoint);
		res.json(trend);
	});

	/* ── Fix validations ── */

	router.get('/fix-validations', (req, res) => {
		const paging = parsePulsePaging(req.query) ?? pageDefaults;
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const filtered = applyDateRange(listValidations({ fixStatus: req.query.fix_status, limit: 10000 }), range, 'createdAt')
			.map(run => projectFixValidationRun(run, names));
		const total = filtered.length;
		const offset = (paging.page - 1) * paging.pageSize;
		res.json({
			data: filtered.slice(offset, offset + paging.pageSize),
			total,
			page: paging.page,
			page_size: paging.pageSize,
			metrics: deepSnakeKeys(getFixValidationMetrics()),
		});
	});

	router.get('/findings/:id/validation', (req, res) => {
		const runs = getRunsForFinding(req.params.id)
			.map(run => projectFixValidationRun(run, names));
		if (runs.length === 0) return notFound(res, 'Validation runs');
		const [latest, ...history] = runs;
		res.json({ latest, history, metrics: deepSnakeKeys(getFixValidationMetrics()) });
	});

	/* ── Knowledge ── */

	router.get('/knowledge', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const raw = applyDateRange(getAllPatterns(), range, 'lastSeen');
		sendList(res, req.query, raw.map(projectKnowledgePattern), { extras: { stats: deepSnakeKeys(getKnowledgeStats()) } });
	});

	router.get('/knowledge/:id', (req, res) => {
		const provenance = getPatternProvenance(req.params.id);
		if (!provenance) return notFound(res, 'Knowledge pattern');
		res.json(deepIsoTimestamps(deepSnakeKeys(provenance)));
	});

	/* ── Metrics ── */

	router.get('/metrics/dashboard', (req, res) => {
		res.json(deepSnakeKeys(projectDashboardMetrics(getDashboardMetrics({ projectId: req.query.project_id }))));
	});

	router.get('/metrics/ux', (_req, res) => {
		const raw = getUxMetrics();
		res.json({
			assessments_run: raw.assessmentsRun ?? 0,
			sweep_failures: raw.sweepFailures ?? 0,
			sweep_duration_ms_total: raw.sweepDurationMsTotal ?? 0,
			assessment_latency_ms_total: raw.assessmentLatencyMsTotal ?? 0,
			last_duration_ms: raw.lastDurationMs ?? null,
		});
	});

	/* ── C1 G2 — time-bucketed usage/activity summary ── */

	router.get('/usage/summary', (req, res) => {
		const range = parseDateRange(req.query);
		if (range?.error) return res.status(400).json({ error: range.error });
		const bucket = String(req.query.bucket ?? 'day');
		if (!['day', 'hour'].includes(bucket)) {
			return res.status(400).json({ error: 'bucket must be "day" or "hour"' });
		}
		const window = (range?.fromMs != null || range?.toMs != null)
			? { fromMs: range.fromMs, toMs: range.toMs }
			: defaultWindow();
		res.json(buildUsageSummary({
			projectId: req.query.project_id,
			fromMs: window.fromMs,
			toMs: window.toMs,
			bucket,
		}));
	});

	/* ── C1 G3 — QASE API request-traffic telemetry ── */

	router.get('/metrics/api-usage', (req, res) => {
		const usage = getApiUsage();
		const paging = parsePulsePaging(req.query) ?? pageDefaults;
		const rows = usage.rows.map(r => ({ day: r.day, total: r.total, endpoints: r.endpoints }));
		const offset = (paging.page - 1) * paging.pageSize;
		res.json({
			data: rows.slice(offset, offset + paging.pageSize),
			total: rows.length,
			page: paging.page,
			page_size: paging.pageSize,
			since: usage.since,
		});
	});

	return router;
}

/* ── small helpers local to this file ── */

/** C1 G2 — default summary window: last 7 days when no from/to given. */
function defaultWindow() {
	const toMs = Date.now();
	const fromMs = toMs - 7 * 24 * 3600 * 1000;
	return { fromMs, toMs };
}

/**
 * C1 G2 — derive a time-bucketed usage/activity summary from EXISTING stores.
 * No new data is invented: every count is recomputed from mission/finding/
 * fix-validation records inside [fromMs, toMs). Empty buckets are zeros.
 */
function buildUsageSummary({ projectId, fromMs, toMs, bucket }) {
	const bucketMs = bucket === 'hour' ? 3600_000 : 24 * 3600_000;

	const inRange = (ts) => {
		const t = Number(ts);
		if (!Number.isFinite(t)) return false;
		if (fromMs != null && t < fromMs) return false;
		if (toMs != null && t >= toMs) return false;
		return true;
	};
	const bucketKey = (ts) => {
		const aligned = Math.floor(Number(ts) / bucketMs) * bucketMs;
		return bucket === 'hour'
			? new Date(aligned).toISOString().slice(0, 13) + ':00:00Z'
			: new Date(aligned).toISOString().slice(0, 10);
	};

	// Pre-create the full bucket axis so empty periods show as zeros.
	// C1 review fix (Finding B) — a single-sided window (from-only or to-only)
	// previously produced an EMPTY bucket series (axis needed both bounds)
	// while totals still counted. Default the missing side instead: from-only
	// → [from, now); to-only → [oldest record, to). Totals and buckets then
	// always describe the same window.
	const buckets = [];
	const missions = listMissions({ projectId });
	const findings = listFindings({ projectId });
	const validations = listValidations({ projectId, limit: 100000 });
	const regressionRuns = listRegressionRuns({ projectId, limit: 100000 });

	let effFromMs = fromMs != null ? fromMs : null;
	if (effFromMs == null) {
		let oldest = Infinity;
		for (const m of missions) { const t = Number(m.createdAt); if (Number.isFinite(t) && t < oldest) oldest = t; }
		for (const f of findings) { const t = Number(f.ts); if (Number.isFinite(t) && t < oldest) oldest = t; }
		for (const v of validations) { const t = Number(v.createdAt); if (Number.isFinite(t) && t < oldest) oldest = t; }
		for (const r of regressionRuns) { const t = Number(r.ts); if (Number.isFinite(t) && t < oldest) oldest = t; }
		if (oldest !== Infinity) effFromMs = Math.floor(oldest / bucketMs) * bucketMs;
	}
	const effToMs = toMs != null ? toMs : Date.now();
	if (effFromMs != null) {
		for (let t = Math.floor(effFromMs / bucketMs) * bucketMs; t < effToMs; t += bucketMs) {
			buckets.push(bucket === 'hour'
				? new Date(t).toISOString().slice(0, 13) + ':00:00Z'
				: new Date(t).toISOString().slice(0, 10));
		}
	}

	const rows = new Map(buckets.map(b => [b, {
		bucket: b,
		missions_created: 0,
		missions_completed: 0,
		findings_reported: 0,
		fix_validations: 0,
		regression_runs: 0,
	}]));
	const bySource = {};
	const byStatus = {};
	let missionsInWindow = 0;

	for (const m of missions) {
		if (!inRange(m.createdAt)) continue;
		missionsInWindow += 1;
		bySource[m.source ?? 'unknown'] = (bySource[m.source ?? 'unknown'] ?? 0) + 1;
		byStatus[m.status ?? 'unknown'] = (byStatus[m.status ?? 'unknown'] ?? 0) + 1;
		const row = rows.get(bucketKey(m.createdAt));
		if (row) row.missions_created += 1;
		if (m.completedAt && inRange(m.completedAt)) {
			const cRow = rows.get(bucketKey(m.completedAt));
			if (cRow) cRow.missions_completed += 1;
		}
	}
	for (const f of findings) {
		if (!inRange(f.ts)) continue;
		const row = rows.get(bucketKey(f.ts));
		if (row) row.findings_reported += 1;
	}
	for (const v of validations) {
		if (!inRange(v.createdAt)) continue;
		const row = rows.get(bucketKey(v.createdAt));
		if (row) row.fix_validations += 1;
	}
	for (const r of regressionRuns) {
		if (!inRange(r.ts)) continue;
		const row = rows.get(bucketKey(r.ts));
		if (row) row.regression_runs += 1;
	}

	return {
		window: {
			// C1 review fix (Finding B) — echo the EFFECTIVE bounds actually
			// bucketed, so a from-only query no longer reports to:null while
			// the series now extends to now.
			from: effFromMs != null ? new Date(effFromMs).toISOString() : null,
			to: effToMs != null ? new Date(effToMs).toISOString() : null,
			bucket,
		},
		totals: {
			missions_created: missionsInWindow,
			findings_reported: findings.filter(f => inRange(f.ts)).length,
			fix_validations: validations.filter(v => inRange(v.createdAt)).length,
			regression_runs: regressionRuns.filter(r => inRange(r.ts)).length,
			missions_completed: missions.filter(m => m.completedAt && inRange(m.completedAt)).length,
		},
		mission_source_mix: bySource,
		mission_status_mix: byStatus,
		buckets: Array.from(rows.values()),
	};
}

function deepSnakeCounters(raw) {
	const out = {};
	for (const [k, v] of Object.entries(raw)) {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			out[camelToSnake(k)] = Object.fromEntries(Object.entries(v).map(([a, b]) => [a, b]));
		} else {
			out[camelToSnake(k)] = v;
		}
	}
	return out;
}

function camelToSnake(k) {
	return k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
