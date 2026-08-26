/**
 * Pulse v2 projection — renders stored records into the shapes declared by
 * server/openapiDocument.js (snake_case, ISO 8601 UTC timestamps, joined names).
 *
 * Everything here is a PURE function over store records — no I/O, no mutation.
 * Name joins take an injected `names` resolver object so route wiring controls
 * which stores are consulted (avoids import cycles at module load).
 */

import { deepIsoTimestamps, deepSnakeKeys } from './pulseHelpers.js';

const ms = (v) => (typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null);
/** Omit-if-absent timestamp spread — never emits null (guide rule 5). */
const ts = (key, v) => (typeof v === 'number' && Number.isFinite(v) ? { [key]: new Date(v).toISOString() } : {});
const count = (v) => (Array.isArray(v) ? v.length : 0);

/** snake_case a camelCase identifier (createdAt → created_at). */
function snake(key) {
	return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function snakeProps(obj, pick) {
	const out = {};
	for (const [k, v] of Object.entries(obj ?? {})) {
		if (pick && !pick.has(k)) continue;
		out[snake(k)] = v;
	}
	return out;
}

/** Deterministic id -> name maps used for foreign-name joins. */
export function nameResolver({ getProject, getMission, getSession, getSchedule }) {
	const cache = new Map();
	const name = (kind, id) => {
		if (!id) return null;
		const key = `${kind}:${id}`;
		if (cache.has(key)) return cache.get(key);
		let value = null;
		if (kind === 'project') value = getProject?.(id)?.name ?? null;
		else if (kind === 'mission') value = getMission?.(id)?.name ?? null;
		else if (kind === 'session') value = getSession?.(id)?.title ?? null;
		else if (kind === 'schedule') value = getSchedule?.(id)?.name ?? null;
		cache.set(key, value);
		return value;
	};
	return {
		projectName: (id) => name('project', id),
		missionName: (id) => name('mission', id),
		sessionTitle: (id) => name('session', id),
		scheduleName: (id) => name('schedule', id),
	};
}

/* ── entity projectors ─────────────────────────────────────────── */

export function projectProject(p) {
	return {
		id: p.id,
		name: p.name,
		base_url: p.baseUrl ?? null,
		workspace_id: p.workspaceId ?? null,
		created_at: ms(p.createdAt),
		updated_at: ms(p.updatedAt),
	};
}

export function projectMission(m, names) {
	return {
		id: m.id,
		name: m.name,
		status: m.status,
		type: m.type,
		source: m.source ?? null,
		project_id: m.projectId ?? null,
		project_name: names?.projectName?.(m.projectId) ?? null,
		target_url: m.targetUrl ?? null,
		session_id: m.sessionId ?? null,
		quality_score: m.qualityScore ?? null,
		verdict: m.verdict ?? null,
		release_ready: m.releaseReady ?? null,
		iteration_count: count(m.iterations),
		failure_reason: m.failureReason ?? null,
		correlation_id: m.correlationId ?? null,
		created_at: ms(m.createdAt),
		updated_at: ms(m.updatedAt),
		...ts('started_at', m.startedAt),
		...ts('completed_at', m.completedAt),
	};
}

export function projectSessionSummary(s, names) {
	return {
		id: s.id,
		title: s.title,
		status: s.status ?? null,
		project_id: s.projectId ?? null,
		project_name: names?.projectName?.(s.projectId) ?? null,
		target_url: s.targetUrl ?? null,
		mission_id: s.missionId ?? null,
		mission_name: s.missionId ? (names?.missionName?.(s.missionId) ?? null) : null,
		finding_count: s.findingCount ?? 0,
		message_count: s.messageCount ?? 0,
		created_at: ms(s.createdAt),
		updated_at: ms(s.updatedAt),
	};
}

export function projectSessionDetail(s, names, live) {
	return {
		id: s.id,
		title: s.title,
		status: s.status ?? null,
		project_id: s.projectId ?? null,
		project_name: names?.projectName?.(s.projectId) ?? null,
		target_url: s.targetUrl ?? null,
		mission_id: s.missionId ?? null,
		mission_name: names?.missionName?.(s.missionId) ?? null,
		finding_count: count(s.findings),
		message_count: count(s.messages),
		step_count: count(s.capturedSteps),
		device: s.device ?? null,
		device_request: s.deviceRequest ?? null,
		viewports_explored: s.viewportsExplored ?? [],
		secret_names: s.secretNames ?? [],
		running: Boolean(live?.running),
		created_at: ms(s.createdAt),
		updated_at: ms(s.updatedAt),
	};
}

export function projectFinding(f, names) {
	return {
		id: f.id,
		title: f.title,
		severity: f.severity ?? 'medium',
		status: f.status ?? 'open',
		finding_status: f.finding_status ?? 'DETECTED',
		review_status: f.review_status ?? 'unreviewed',
		priority: f.priority ?? 'UNTRIAGED',
		primary_category: f.primary_category ?? null,
		secondary_categories: f.secondary_categories ?? [],
		reproducibility: f.reproducibility ?? null,
		confidence: f.confidence ?? null,
		url: f.url ?? null,
		expected: f.expected ?? null,
		actual: f.actual ?? null,
		observed: f.observed ?? null,
		impact: f.impact ?? null,
		recommendation: f.recommendation ?? null,
		project_id: f.projectId ?? null,
		project_name: names?.projectName?.(f.projectId) ?? null,
		session_id: f.sessionId ?? null,
		session_title: names?.sessionTitle?.(f.sessionId) ?? null,
		mission_id: f.missionId ?? null,
		mission_name: names?.missionName?.(f.missionId) ?? null,
		is_duplicate: f.isDuplicate ?? false,
		duplicate_of: f.duplicateOf ?? null,
		test_case_ids: f.testCaseIds ?? [],
		tags: f.tags ?? [],
		...(f.ts != null ? { created_at: ms(f.ts), updated_at: ms(f.updatedAt ?? f.ts) } : {}),
	};
}

export function projectTestCase(tc, names, extras = {}) {
	return {
		id: tc.id,
		name: tc.name,
		project_id: tc.projectId ?? null,
		project_name: names?.projectName?.(tc.projectId) ?? null,
		workflow_id: tc.workflowId ?? null,
		suite_id: tc.suiteId ?? null,
		target_url: tc.targetUrl ?? null,
		severity: tc.severity ?? 'medium',
		step_count: count(tc.steps),
		assertion_count: count(tc.assertions),
		tags: tc.tags ?? [],
		has_baselines: extras.hasBaselines ?? false,
		created_at: ms(tc.createdAt),
		updated_at: ms(tc.updatedAt),
		...ts('last_run', tc.lastRun),
	};
}

export function projectWorkflow(wf, names, { withSteps = false } = {}) {
	const out = {
		id: wf.id,
		name: wf.name,
		project_id: wf.projectId ?? null,
		project_name: names?.projectName?.(wf.projectId) ?? null,
		target_url: wf.targetUrl ?? null,
		step_count: count(wf.steps),
		tags: wf.tags ?? [],
		created_at: ms(wf.createdAt),
		updated_at: ms(wf.updatedAt),
	};
	if (withSteps) out.steps = wf.steps ?? [];
	return out;
}

export function projectSuite(s, names) {
	return {
		id: s.id,
		name: s.name,
		project_id: s.projectId ?? null,
		project_name: names?.projectName?.(s.projectId) ?? null,
		parent_id: s.parentId ?? null,
		created_at: ms(s.createdAt),
		updated_at: ms(s.updatedAt),
	};
}

export function projectSchedule(sc, names) {
	return {
		id: sc.id,
		name: sc.name,
		project_id: sc.projectId ?? null,
		project_name: names?.projectName?.(sc.projectId) ?? null,
		target_url: sc.targetUrl ?? null,
		cron_expr: sc.cronExpr,
		enabled: sc.enabled !== false,
		test_case_count: count(sc.testCaseIds),
		last_run: sc.lastRun
			? { ts: ms(sc.lastRun.ts), result: sc.lastRun.result ?? null, summary: sc.lastRun.summary ?? null }
			: null,
		...ts('next_run', sc.nextRun),
		created_at: ms(sc.createdAt),
		updated_at: ms(sc.updatedAt),
	};
}

export function projectRegressionRun(r, names) {
	return {
		id: r.id,
		schedule_id: r.scheduleId ?? null,
		schedule_name: names?.scheduleName?.(r.scheduleId) ?? null,
		project_id: r.projectId ?? null,
		project_name: names?.projectName?.(r.projectId) ?? null,
		target_url: r.targetUrl ?? null,
		trigger: r.trigger ?? 'manual',
		total: r.total ?? 0,
		passed: r.passed ?? 0,
		failed: r.failed ?? 0,
		errored: r.errored ?? 0,
		flaky: r.flaky ?? 0,
		pass_rate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0,
		duration_ms: r.durationMs ?? 0,
		ts: ms(r.ts),
	};
}

export function projectRegressionRunDetail(r, names) {
	const base = projectRegressionRun(r, names);
	return {
		...base,
		results: (r.results ?? []).map(x => ({
			test_case_id: x.testCaseId ?? null,
			test_case_name: x.testCaseName ?? null,
			result: x.result ?? null,
			duration_ms: x.durationMs ?? null,
			step_count: x.stepCount ?? 0,
			assertion_count: x.assertionCount ?? 0,
			error: x.error ?? null,
			viewport: x.viewport ?? null,
		})),
	};
}

export function projectFixValidationRun(run, names) {
	const original = run.originalFinding ?? {};
	return {
		id: run.id,
		finding_id: run.findingId ?? null,
		finding_title: original.title ?? null,
		mission_id: run.missionId ?? null,
		project_id: run.projectId ?? null,
		project_name: names?.projectName?.(run.projectId) ?? null,
		status: run.status,
		fix_status: run.fixStatus ?? null,
		review_state: run.reviewState ?? 'REVIEW_REQUIRED',
		validation_confidence: run.validationConfidence ?? null,
		partial_fix: run.partialFix ? deepSnakeKeys(run.partialFix) : null,
		trigger: run.trigger ?? null,
		requested_by: run.requestedBy ?? null,
		created_at: ms(run.createdAt),
		updated_at: ms(run.updatedAt),
		...ts('completed_at', run.completedAt),
	};
}

export function projectKnowledgePattern(p) {
	return {
		id: p.id,
		pattern: p.pattern ?? null,
		category: p.category ?? null,
		type: p.type ?? null,
		status: p.status ?? 'active',
		confidence: typeof p.confidence === 'number' ? Math.round(p.confidence * 100) / 100 : null,
		occurrences: p.occurrences ?? 0,
		validation_count: count(p.validations),
		contradiction_count: count(p.contradictions),
		source_mission_count: count(p.sourceMissions),
		...(p.createdAt != null ? { created_at: ms(p.createdAt) } : {}),
		...(p.lastSeen != null ? { last_seen: ms(p.lastSeen) } : {}),
	};
}

export function projectTrendPoint(point) {
	return {
		ts: ms(point.ts),
		total: point.total ?? 0,
		passed: point.passed ?? 0,
		failed: point.failed ?? 0,
		errored: point.errored ?? 0,
		flaky: point.flaky ?? 0,
		pass_rate: point.passRate ?? (point.total > 0 ? Math.round((point.passed / point.total) * 100) : 0),
	};
}

/** Dashboard metrics: keep the nested block structure, ISO-render every ts. */
export function projectDashboardMetrics(m) {
	return deepIsoTimestamps(m);
}

export { snake, snakeProps };
