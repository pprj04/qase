/**
 * Pulse OpenAPI document — single source of truth for GET /openapi.json.
 *
 * Describes the Drytis Pulse read surface: the Bearer-token GET endpoints an
 * external analytics agent may call. Writes exist in the codebase but are NOT
 * documented (the Pulse connector only ever calls GET).
 *
 * Build rules implemented here (see .drytis/specs/pulse-openapi-document.md):
 *   - every operation: unique snake_case operationId (<= 64 chars) + summary + tags
 *   - every GET declares a 200 response schema
 *   - collections: records under `data` with integer `total` beside them
 *   - page/page_size (default 100 / maximum 500) on every collection
 *   - enums for closed value sets; from/to (format: date) on time-based lists
 *   - ISO 8601 date-time timestamps; additionalProperties for free-form maps
 *   - no {"type": "null"} anywhere (3.1 nullability via anyOf/type arrays)
 *
 * operations() returns a plain array so tests can lint the document without a server.
 */

/* ── enums (mirror the server sources; asserted by unit tests) ── */

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const FINDING_STATUSES = ['open', 'in_testing', 'resolved', 'closed'];
const MISSION_STATUS = ['created', 'queued', 'running', 'completed', 'failed', 'aborted', 'cancelled', 'timeout', 'interrupted'];
const MISSION_TYPES = ['full_audit', 'security', 'ux', 'regression', 'feature_gap', 'accessibility'];
const MISSION_SOURCES = ['manual', 'ai_studio', 'ci_cd', 'api', 'integration'];
const SESSION_STATUS = ['idle', 'running', 'awaiting_input', 'done', 'error', 'interrupted'];
const FINDING_LIFECYCLE = [
	'DETECTED', 'VERIFYING', 'VERIFIED', 'CLASSIFIED', 'TRIAGED', 'REPORTED',
	'FALSE_POSITIVE', 'DUPLICATE', 'INCONCLUSIVE', 'UNREPRODUCIBLE', 'RESOLVED', 'REOPENED',
];
const REVIEW_STATUSES = ['unreviewed', 'confirmed', 'false_positive', 'duplicate', 'needs_info'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const REPRODUCIBILITIES = ['REPRODUCIBLE', 'INTERMITTENT', 'UNREPRODUCIBLE', 'UNKNOWN'];
const CATEGORIES = [
	'FUNCTIONAL', 'UI', 'UX', 'VISUAL', 'API', 'SECURITY', 'PERFORMANCE', 'ACCESSIBILITY',
	'DATA', 'AUTHENTICATION', 'AUTHORIZATION', 'NAVIGATION', 'COMPATIBILITY', 'MOBILE',
	'REGRESSION', 'FEATURE_GAP', 'INFRASTRUCTURE', 'AI_BEHAVIOR', 'COMPLIANCE', 'UNKNOWN',
];
const FIX_RUN_STATUSES = ['REQUESTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const FIX_STATUSES = ['VERIFIED_FIXED', 'STILL_BROKEN', 'PARTIALLY_FIXED', 'REGRESSED', 'UNABLE_TO_VERIFY'];
const FIX_REVIEW_STATES = ['AUTO_VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'REOPENED'];
const KNOWLEDGE_STATUS = ['active', 'inactive', 'contradicted'];
const GROUP_BY = ['category', 'severity', 'priority', 'workflow', 'feature', 'risk'];

/* ── shared schema fragments ── */

const dt = { type: 'string', format: 'date-time', description: 'ISO 8601 UTC timestamp.' };
const dtOrNull = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] };

/* Nullability (external-handoff contract cleanup): the projectors in
 * server/pulseProjection.js emit `?? null` for optional joins, scores and
 * text fields. nullable(base) declares that honestly so strict OpenAPI 3.1
 * consumers (codegen, validators) accept responses where those fields are
 * null. anyOf union per file rule — no standalone {"type": "null"}. */
const nullable = (base) => ({ anyOf: [base, { type: 'null' }] });

const id = (desc = 'Stable record id (UUID unless prefixed).') =>
	({ type: 'string', description: desc });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const pagingParams = [
	{ name: 'page', in: 'query', description: '1-based page number.', schema: { type: 'integer', minimum: 1, default: 1 } },
	{ name: 'page_size', in: 'query', description: 'Rows per page. Values above 500 are clamped to 500.', schema: { type: 'integer', minimum: 1, default: 100, maximum: 500 } },
];

const dateRangeParams = (fieldLabel) => ([
	{ name: 'from', in: 'query', description: `${fieldLabel} >= this date (inclusive). Format YYYY-MM-DD.`, schema: { type: 'string', format: 'date' } },
	{ name: 'to', in: 'query', description: `${fieldLabel} < this date (exclusive). Format YYYY-MM-DD.`, schema: { type: 'string', format: 'date' } },
]);

const projectIdParam = { name: 'project_id', in: 'query', description: 'Only this project.', schema: { type: 'string' } };
const sessionIdParam = { name: 'session_id', in: 'query', description: 'Only this session.', schema: { type: 'string' } };
const missionIdQueryParam = { name: 'mission_id', in: 'query', description: 'Only records from this mission.', schema: { type: 'string' } };

const intCounterMap = { type: 'object', additionalProperties: { type: 'integer' }, description: 'Key -> count.' };

function pulseList(itemRef) {
	return {
		type: 'object',
		required: ['data', 'total'],
		properties: {
			data: { type: 'array', items: typeof itemRef === 'string' ? { $ref: itemRef } : itemRef },
			total: { type: 'integer', description: 'Total matching rows, ignoring paging.' },
			page: { type: 'integer', description: 'Current 1-based page.' },
			page_size: { type: 'integer', description: 'Rows per page (max 500).' },
		},
	};
}

function pathId(name, desc = 'Record id.') {
	return { name, in: 'path', required: true, schema: { type: 'string' }, description: desc };
}

function query(name, description, schema) {
	return { name, in: 'query', description, schema };
}

const errorSchema = {
	type: 'object',
	properties: { error: { type: 'string' } },
};

/* ── record schemas ── */

const Project = {
	type: 'object',
	required: ['id', 'name'],
	properties: {
		id: id(),
		name: { type: 'string', description: 'Human-readable project name.' },
		base_url: nullable({ type: 'string', description: 'Primary target base URL for this project.' }),
		workspace_id: nullable({ type: 'string', description: 'Owning workspace id, when workspaces are in use.' }),
		created_at: nullable(dt),
		updated_at: nullable(dt),
	},
};

const Mission = {
	type: 'object',
	required: ['id', 'name', 'status', 'type', 'created_at'],
	properties: {
		id: id(),
		name: { type: 'string', description: 'Human-readable mission name.' },
		status: { type: 'string', enum: MISSION_STATUS, description: 'Lifecycle status.' },
		type: { type: 'string', enum: MISSION_TYPES, description: 'What kind of audit this mission runs.' },
		source: nullable({ type: 'string', enum: MISSION_SOURCES, description: 'How the mission was created.' }),
		project_id: nullable({ type: 'string', description: 'Owning project id.' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined; absent when the project was deleted).' }),
		target_url: nullable({ type: 'string', description: 'Site under test.' }),
		session_id: nullable({ type: 'string', description: 'Current/last execution session id, when linked.' }),
		quality_score: nullable({ type: 'integer', minimum: 0, maximum: 100, description: 'Overall quality score set on completion.' }),
		verdict: nullable({ type: 'string', enum: ['pass', 'pass_with_issues', 'fail'], description: 'Final verdict, once completed.' }),
		release_ready: nullable({ type: 'boolean', description: 'Release-readiness flag set on completion.' }),
		iteration_count: { type: 'integer', description: 'Validation-loop iterations recorded.' },
		failure_reason: nullable({ type: 'string' }),
		correlation_id: nullable({ type: 'string', description: 'Cross-cutting correlation id carried through the mission.' }),
		created_at: dt,
		updated_at: dt,
		started_at: dtOrNull,
		completed_at: dtOrNull,
	},
};

const Session = {
	type: 'object',
	required: ['id', 'title', 'status', 'created_at'],
	properties: {
		id: id(),
		title: { type: 'string', description: 'Human-readable session title.' },
		status: { type: 'string', enum: SESSION_STATUS, description: 'Session lifecycle status.' },
		project_id: nullable({ type: 'string', description: 'Owning project id, when set.' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		target_url: nullable({ type: 'string', description: 'Site under test.' }),
		mission_id: nullable({ type: 'string', description: 'Mission this session executes, when linked.' }),
		mission_name: nullable({ type: 'string', description: 'Linked mission name (joined).' }),
		finding_count: { type: 'integer' },
		message_count: { type: 'integer' },
		created_at: dt,
		updated_at: dt,
	},
};

const Finding = {
	type: 'object',
	required: ['id', 'title', 'severity', 'created_at'],
	properties: {
		id: id('Stable finding id (sfnd_… or UUID).'),
		title: { type: 'string' },
		severity: { type: 'string', enum: SEVERITIES, description: 'Agent-assigned severity.' },
		status: { type: 'string', enum: FINDING_STATUSES, description: 'Legacy workflow status.' },
		finding_status: { type: 'string', enum: FINDING_LIFECYCLE, description: 'Lifecycle status (Phase 16).' },
		review_status: { type: 'string', enum: REVIEW_STATUSES, description: 'Human review state.' },
		priority: { type: 'string', enum: [...PRIORITIES, 'UNTRIAGED'], description: 'Triage priority (UNTRIAGED when unset).' },
			primary_category: nullable({ type: 'string', enum: CATEGORIES, description: 'Normalized bug category.' }),
			secondary_categories: { type: 'array', items: { type: 'string', enum: CATEGORIES }, maxItems: 3 },
			reproducibility: nullable({ type: 'string', enum: [...REPRODUCIBILITIES, 'confirmed', 'unconfirmed', 'intermittent'] }),
			confidence: nullable({ type: 'number', minimum: 0, maximum: 1, description: 'Deterministic evidence-based confidence score.' }),
			url: nullable({ type: 'string', description: 'Where the bug was observed.' }),
			expected: nullable({ type: 'string' }),
			actual: nullable({ type: 'string' }),
			observed: nullable({ type: 'string' }),
			impact: nullable({ type: 'string' }),
			recommendation: nullable({ type: 'string' }),
			project_id: nullable({ type: 'string' }),
			project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
			session_id: nullable({ type: 'string' }),
			session_title: nullable({ type: 'string', description: 'Linked session title (joined).' }),
			mission_id: nullable({ type: 'string' }),
			mission_name: nullable({ type: 'string', description: 'Linked mission name (joined).' }),
			is_duplicate: { type: 'boolean' },
			duplicate_of: nullable({ type: 'string', description: 'Canonical finding id when this record is a duplicate.' }),
		test_case_ids: { type: 'array', items: { type: 'string' } },
		tags: { type: 'array', items: { type: 'string' } },
		created_at: dt,
		updated_at: dt,
	},
};

const TestCase = {
	type: 'object',
	required: ['id', 'name', 'created_at'],
	properties: {
		id: id(),
		name: { type: 'string' },
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		workflow_id: nullable({ type: 'string', description: 'Workflow the case was generated from.' }),
		suite_id: nullable({ type: 'string', description: 'Suite the case belongs to.' }),
		target_url: nullable({ type: 'string' }),
		severity: { type: 'string', enum: SEVERITIES },
		step_count: { type: 'integer', description: 'Number of recorded steps.' },
		assertion_count: { type: 'integer', description: 'Number of recorded assertions.' },
		tags: { type: 'array', items: { type: 'string' } },
		has_baselines: { type: 'boolean', description: 'Whether visual baselines exist for this case.' },
		created_at: dt,
		updated_at: dt,
		last_run: dtOrNull,
	},
};

const Workflow = {
	type: 'object',
	required: ['id', 'name', 'created_at'],
	properties: {
		id: id(),
		name: { type: 'string' },
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		target_url: nullable({ type: 'string' }),
		step_count: { type: 'integer' },
		tags: { type: 'array', items: { type: 'string' } },
		created_at: dt,
		updated_at: dt,
	},
};

const Suite = {
	type: 'object',
	required: ['id', 'name', 'created_at'],
	properties: {
		id: id(),
		name: { type: 'string' },
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		parent_id: nullable({ type: 'string', description: 'Parent suite id for tree structures.' }),
		description: nullable({ type: 'string' }),
		created_at: dt,
		updated_at: dt,
	},
};

const Schedule = {
	type: 'object',
	required: ['id', 'name', 'cron_expr', 'created_at'],
	properties: {
		id: id(),
		name: { type: 'string' },
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		target_url: nullable({ type: 'string' }),
		cron_expr: { type: 'string', description: 'Five-field cron expression (UTC).' },
		enabled: { type: 'boolean' },
		test_case_count: { type: 'integer', description: 'Number of test cases in the schedule.' },
		last_run: nullable({
			type: 'object',
			properties: {
				ts: dt,
				result: { type: 'string' },
				summary: { type: 'string' },
			},
		}),
		next_run: dtOrNull,
		created_at: dt,
		updated_at: dt,
	},
};

const RegressionRun = {
	type: 'object',
	required: ['id', 'ts', 'total', 'passed'],
	properties: {
		id: id(),
		schedule_id: nullable({ type: 'string' }),
		schedule_name: nullable({ type: 'string', description: 'Owning schedule name (joined).' }),
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		target_url: nullable({ type: 'string' }),
		trigger: nullable({ type: 'string' }),
		total: { type: 'integer', description: 'Test cases executed.' },
		passed: { type: 'integer' },
		failed: { type: 'integer' },
		errored: { type: 'integer' },
		flaky: { type: 'integer' },
		pass_rate: { type: 'integer', minimum: 0, maximum: 100, description: 'passed/total as a percentage (0-100).' },
		duration_ms: { type: 'integer', description: 'Wall-clock duration in milliseconds.' },
		ts: dt,
	},
};

const FixValidationRun = {
	type: 'object',
	required: ['id', 'finding_id', 'status', 'created_at'],
	properties: {
		id: id('Fix-validation run id (fxv_…).'),
		finding_id: nullable({ type: 'string', description: 'Finding under validation.' }),
		finding_title: nullable({ type: 'string', description: 'Snapshot title of the finding under validation.' }),
		mission_id: nullable({ type: 'string' }),
		project_id: nullable({ type: 'string' }),
		project_name: nullable({ type: 'string', description: 'Owning project name (joined).' }),
		status: { type: 'string', enum: FIX_RUN_STATUSES, description: 'Run lifecycle.' },
		fix_status: nullable({ type: 'string', enum: FIX_STATUSES, description: 'Deterministic fix outcome once completed.' }),
		review_state: { type: 'string', enum: FIX_REVIEW_STATES, description: 'Human review state of the run.' },
		validation_confidence: nullable({ type: 'number', minimum: 0, maximum: 1 }),
		partial_fix: nullable({ type: 'object', description: 'Partial-fix snapshot (snake_cased), when the fix was partially effective.' }),
		trigger: nullable({ type: 'string' }),
		requested_by: nullable({ type: 'string' }),
		created_at: dt,
		updated_at: dt,
		completed_at: dtOrNull,
	},
};

const KnowledgePattern = {
	type: 'object',
	required: ['id', 'pattern', 'confidence'],
	properties: {
		id: id(),
		pattern: nullable({ type: 'string', description: 'The learned assertion/pattern text.' }),
		category: nullable({ type: 'string' }),
		status: { type: 'string', enum: KNOWLEDGE_STATUS },
		confidence: nullable({ type: 'number', minimum: 0, maximum: 1, description: 'Current confidence after decay/validation.' }),
		occurrences: { type: 'integer' },
		created_at: dtOrNull,
		last_seen: dtOrNull,
	},
};

const TrendPoint = {
	type: 'object',
	required: ['ts', 'total', 'passed', 'failed'],
	properties: {
		ts: dt,
		total: { type: 'integer' },
		passed: { type: 'integer' },
		failed: { type: 'integer' },
		errored: { type: 'integer' },
		flaky: { type: 'integer' },
		pass_rate: { type: 'integer', minimum: 0, maximum: 100 },
	},
};

/* ── operations (the single inventory of documented GETs) ── */

export function operations() {
	return [
		{
			path: '/api/v2/health', method: 'GET',
			operationId: 'health', summary: 'Liveness check.', tags: ['Meta'],
			public: true,
			parameters: [],
			response: {
				type: 'object', required: ['status'],
				properties: {
					status: { type: 'string', enum: ['ok'] },
					uptime: { type: 'integer', description: 'Server uptime in seconds.' },
					project: { type: 'string' },
				},
			},
		},
		{
			path: '/api/v2/projects', method: 'GET',
			operationId: 'list_projects',
			summary: 'All projects (single-tenant instance; a small bounded collection).',
			tags: ['Projects'],
			parameters: [],
			response: { type: 'array', items: ref('Project') },
		},
		{
			path: '/api/v2/missions', method: 'GET',
			operationId: 'list_missions',
			summary: 'Missions, filterable by status, type, source, project and date range.',
			tags: ['Missions'],
			parameters: [
				projectIdParam,
				query('status', 'Only this status.', { type: 'string', enum: MISSION_STATUS }),
				query('type', 'Only this mission type.', { type: 'string', enum: MISSION_TYPES }),
				query('source', 'Creation origin.', { type: 'string', enum: MISSION_SOURCES }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/Mission'),
		},
		{
			path: '/api/v2/missions/{id}', method: 'GET',
			operationId: 'get_mission',
			summary: 'One full mission record by id.',
			tags: ['Missions'],
			parameters: [pathId('id')],
			response: ref('Mission'),
		},
		{
			path: '/api/v2/mission-summaries', method: 'GET',
			operationId: 'list_mission_summaries',
			summary: 'Mission summaries plus queue depth and execution-governor stats.',
			tags: ['Missions'],
			parameters: [
				projectIdParam,
				query('status', 'Only this status.', { type: 'string', enum: MISSION_STATUS }),
				query('type', 'Only this mission type.', { type: 'string', enum: MISSION_TYPES }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/Mission'),
			withExtras: { queue_depth: 'integer', governor: 'object' },
		},
		{
			path: '/api/v2/mission-status/{id}', method: 'GET',
			operationId: 'get_mission_status',
			summary: 'Lightweight mission status and quality snapshot (lazy-finalizing).',
			tags: ['Missions'],
			parameters: [pathId('id')],
			response: ref('Mission'),
		},
		{
			path: '/api/v2/sessions', method: 'GET',
			operationId: 'list_sessions',
			summary: 'Test sessions, filterable by project and date range.',
			tags: ['Sessions'],
			parameters: [projectIdParam, ...dateRangeParams('created_at'), ...pagingParams],
			response: pulseList('#/components/schemas/Session'),
		},
		{
			path: '/api/v2/sessions/{id}', method: 'GET',
			operationId: 'get_session',
			summary: 'One session summary by id (counts; heavy arrays only with full=1).',
			tags: ['Sessions'],
			parameters: [
				pathId('id'),
				query('summary', 'summary=1 strips heavy arrays from the payload.', { type: 'string', enum: ['1'] }),
			],
			response: ref('Session'),
		},
		{
			path: '/api/v2/findings', method: 'GET',
			operationId: 'list_findings',
			summary: 'Findings (bugs), filterable by severity, status, lifecycle, review state, project, mission, session, text and date range.',
			tags: ['Findings'],
			parameters: [
				projectIdParam,
				query('severity', 'Only this severity.', { type: 'string', enum: SEVERITIES }),
				query('status', 'Legacy workflow status.', { type: 'string', enum: FINDING_STATUSES }),
				query('finding_status', 'Lifecycle status (Phase 16).', { type: 'string', enum: FINDING_LIFECYCLE }),
				query('review_status', 'Human review state.', { type: 'string', enum: REVIEW_STATUSES }),
				query('priority', 'Triage priority.', { type: 'string', enum: [...PRIORITIES, 'UNTRIAGED'] }),
				query('primary_category', 'Normalized category.', { type: 'string', enum: CATEGORIES }),
				query('reproducibility', 'Reproduction reliability.', { type: 'string', enum: REPRODUCIBILITIES }),
				missionIdQueryParam,
				sessionIdParam,
				query('q', 'Substring match on title/category/url/expected/actual.', { type: 'string' }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/Finding'),
		},
		{
			path: '/api/v2/findings/{id}', method: 'GET',
			operationId: 'get_finding',
			summary: 'One finding by id.',
			tags: ['Findings'],
			parameters: [pathId('id')],
			response: ref('Finding'),
		},
		{
			path: '/api/v2/findings/stats', method: 'GET',
			operationId: 'get_finding_stats',
			summary: 'Finding counts by status, severity, lifecycle, review state and priority, plus duplicate count.',
			tags: ['Findings'],
			parameters: [projectIdParam],
			response: {
				type: 'object', required: ['total'],
				properties: {
					total: { type: 'integer' },
					by_status: intCounterMap,
					by_severity: intCounterMap,
					by_finding_status: intCounterMap,
					by_review_status: intCounterMap,
					by_priority: intCounterMap,
					duplicates: { type: 'integer' },
				},
			},
		},
		{
			path: '/api/v2/findings/grouped', method: 'GET',
			operationId: 'get_findings_grouped',
			summary: 'Findings grouped by one dimension (category, severity, priority, workflow, feature or risk).',
			tags: ['Findings'],
			parameters: [
				projectIdParam,
				query('group_by', 'Dimension to group by (required).', { type: 'string', enum: GROUP_BY }),
			],
			response: {
				type: 'object',
				properties: {
					group_by: { type: 'string', enum: GROUP_BY },
					canonical_count: { type: 'integer' },
					duplicate_count: { type: 'integer' },
					groups: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								key: { type: 'string' },
								count: { type: 'integer' },
								severity_breakdown: intCounterMap,
							},
						},
					},
				},
			},
		},
		{
			path: '/api/v2/test-cases', method: 'GET',
			operationId: 'list_test_cases',
			summary: 'Test cases, filterable by project, workflow, suite, tag and date range.',
			tags: ['TestCases'],
			parameters: [
				projectIdParam,
				query('workflow_id', 'Only cases from this workflow.', { type: 'string' }),
				query('suite_id', 'Only cases in this suite.', { type: 'string' }),
				query('tag', 'Only cases with this tag.', { type: 'string' }),
				query('target_url', 'Only cases for this target URL.', { type: 'string' }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/TestCase'),
		},
		{
			path: '/api/v2/test-cases/{id}', method: 'GET',
			operationId: 'get_test_case',
			summary: 'One test case by id.',
			tags: ['TestCases'],
			parameters: [pathId('id')],
			response: ref('TestCase'),
		},
		{
			path: '/api/v2/test-cases/tags', method: 'GET',
			operationId: 'list_test_case_tags',
			summary: 'Distinct test case tags, alphabetical.',
			tags: ['TestCases'],
			parameters: [projectIdParam, ...pagingParams],
			response: pulseList({ type: 'string' }),
		},
		{
			path: '/api/v2/workflows', method: 'GET',
			operationId: 'list_workflows',
			summary: 'Saved browser workflows, filterable by project, target URL and date range.',
			tags: ['Workflows'],
			parameters: [
				projectIdParam,
				query('target_url', 'Only workflows for this target URL.', { type: 'string' }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/Workflow'),
		},
		{
			path: '/api/v2/workflows/{id}', method: 'GET',
			operationId: 'get_workflow',
			summary: 'One workflow (with its steps) by id.',
			tags: ['Workflows'],
			parameters: [pathId('id')],
			response: ref('Workflow'),
		},
		{
			path: '/api/v2/suites', method: 'GET',
			operationId: 'list_suites',
			summary: 'Test suites (small bounded tree; typically fewer than 50 rows).',
			tags: ['Suites'],
			parameters: [projectIdParam, ...dateRangeParams('created_at'), ...pagingParams],
			response: pulseList('#/components/schemas/Suite'),
		},
		{
			path: '/api/v2/schedules', method: 'GET',
			operationId: 'list_schedules',
			summary: 'Regression schedules with next/last run metadata (bounded collection).',
			tags: ['Schedules'],
			parameters: [projectIdParam, ...dateRangeParams('created_at'), ...pagingParams],
			response: pulseList('#/components/schemas/Schedule'),
		},
		{
			path: '/api/v2/schedules/{id}/runs', method: 'GET',
			operationId: 'list_schedule_runs',
			summary: 'Regression runs of one schedule, newest first.',
			tags: ['Schedules'],
			parameters: [pathId('id', 'Schedule id.'), ...dateRangeParams('ts'), ...pagingParams],
			response: pulseList('#/components/schemas/RegressionRun'),
		},
		{
			path: '/api/v2/regression/runs', method: 'GET',
			operationId: 'list_regression_runs',
			summary: 'Regression runs, filterable by project, schedule, target URL and date range.',
			tags: ['Regression'],
			parameters: [
				projectIdParam,
				query('schedule_id', 'Only runs of this schedule.', { type: 'string' }),
				query('target_url', 'Only runs against this target URL.', { type: 'string' }),
				...dateRangeParams('ts'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/RegressionRun'),
		},
		{
			path: '/api/v2/regression/runs/{id}', method: 'GET',
			operationId: 'get_regression_run',
			summary: 'One regression run by id (per-test results included).',
			tags: ['Regression'],
			parameters: [pathId('id')],
			response: ref('RegressionRun'),
		},
		{
			path: '/api/v2/regression/trend', method: 'GET',
			operationId: 'get_regression_trend',
			summary: 'Chronological pass-rate trend over recent regression runs.',
			tags: ['Regression'],
			parameters: [
				projectIdParam,
				query('schedule_id', 'Trend for one schedule.', { type: 'string' }),
				query('target_url', 'Trend for one target URL.', { type: 'string' }),
				query('limit', 'Number of recent runs (default 20).', { type: 'integer', default: 20, maximum: 500 }),
			],
			response: { type: 'array', items: ref('TrendPoint') },
		},
		{
			path: '/api/v2/fix-validations', method: 'GET',
			operationId: 'list_fix_validations',
			summary: 'Fix-validation runs with aggregate metrics.',
			tags: ['FixValidation'],
			parameters: [
				query('fix_status', 'Only this fix outcome.', { type: 'string', enum: FIX_STATUSES }),
				...dateRangeParams('created_at'),
				...pagingParams,
			],
			response: pulseList('#/components/schemas/FixValidationRun'),
		},
		{
			path: '/api/v2/findings/{id}/validation', method: 'GET',
			operationId: 'get_finding_validation',
			summary: 'Fix-validation history for one finding.',
			tags: ['FixValidation'],
			parameters: [pathId('id', 'Finding id.')],
			response: {
				type: 'object',
				properties: {
					latest: ref('FixValidationRun'),
					history: { type: 'array', items: ref('FixValidationRun') },
					metrics: { type: 'object', additionalProperties: true, description: 'Aggregate fix-validation metrics.' },
				},
			},
		},
		{
			path: '/api/v2/knowledge', method: 'GET',
			operationId: 'list_knowledge_patterns',
			summary: 'Learned knowledge patterns with aggregate stats.',
			tags: ['Knowledge'],
			parameters: [...dateRangeParams('last_seen'), ...pagingParams],
			response: pulseList('#/components/schemas/KnowledgePattern'),
		},
		{
			path: '/api/v2/knowledge/{id}', method: 'GET',
			operationId: 'get_knowledge_pattern',
			summary: 'One knowledge pattern with full provenance.',
			tags: ['Knowledge'],
			parameters: [pathId('id')],
			response: {
				type: 'object', additionalProperties: true,
				description: 'Pattern record with sourceMissions, validations and contradictions provenance.',
			},
		},
		{
			path: '/api/v2/metrics/dashboard', method: 'GET',
			operationId: 'get_dashboard_metrics',
			summary: 'Cross-entity dashboard metrics: sessions, findings, test cases, regression, fix-validations, UX.',
			tags: ['Metrics'],
			parameters: [projectIdParam],
			response: {
				type: 'object', additionalProperties: true,
				description: 'Nested metric blocks (sessions, findings, testCases, regression, fixValidations, uxAssessments).',
			},
		},
		{
			path: '/api/v2/metrics/ux', method: 'GET',
			operationId: 'get_ux_metrics',
			summary: 'UX assessment counters (runs, sweep failures, latency totals).',
			tags: ['Metrics'],
			parameters: [],
			response: {
				type: 'object',
				properties: {
					assessments_run: { type: 'integer' },
					sweep_failures: { type: 'integer' },
					sweep_duration_ms_total: { type: 'integer', description: 'Total sweep duration in milliseconds.' },
					assessment_latency_ms_total: { type: 'integer', description: 'Total assessment latency in milliseconds.' },
					last_duration_ms: { type: 'integer', nullable: true, description: 'Last assessment duration in milliseconds.' },
				},
			},
		},
		{
			path: '/api/v2/usage/summary', method: 'GET',
			operationId: 'get_usage_summary',
			summary: 'Time-bucketed QA activity (missions, findings, fix-validations, regression runs) with source/status mixes. Derived from persisted records; empty buckets are zeros.',
			tags: ['Usage'],
			parameters: [
				projectIdParam,
				...dateRangeParams('records'),
				query('bucket', 'Bucket granularity. Default day.', {
					type: 'string', enum: ['day', 'hour'], default: 'day',
				}),
			],
			response: {
				type: 'object',
				required: ['window', 'totals', 'buckets'],
				properties: {
					window: {
						type: 'object',
						properties: {
							from: dt,
							to: dt,
							bucket: { type: 'string', enum: ['day', 'hour'] },
						},
					},
					totals: {
						type: 'object',
						description: 'Record counts inside the window.',
						properties: {
							missions_created: { type: 'integer' },
							missions_completed: { type: 'integer' },
							findings_reported: { type: 'integer' },
							fix_validations: { type: 'integer' },
							regression_runs: { type: 'integer' },
						},
					},
					mission_source_mix: {
						type: 'object', additionalProperties: { type: 'integer' },
						description: 'Missions by creation origin (api, integration, …).',
					},
					mission_status_mix: {
						type: 'object', additionalProperties: { type: 'integer' },
						description: 'Missions by terminal/interim status.',
					},
					buckets: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								bucket: { type: 'string', description: 'Day (YYYY-MM-DD) or hour (YYYY-MM-DDTHH:00:00Z) key, UTC.' },
								missions_created: { type: 'integer' },
								missions_completed: { type: 'integer' },
								findings_reported: { type: 'integer' },
								fix_validations: { type: 'integer' },
								regression_runs: { type: 'integer' },
							},
						},
					},
				},
			},
		},
		{
			path: '/api/v2/metrics/api-usage', method: 'GET',
			operationId: 'get_api_usage',
			summary: 'Request traffic on this API itself: authenticated /api/v2 calls per day, by endpoint template. Counts begin at telemetry deployment (see `since`); there is no historical backfill.',
			tags: ['Usage'],
			parameters: [...pagingParams],
			response: {
				type: 'object',
				required: ['data', 'total', 'page', 'page_size', 'since'],
				properties: {
					data: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								day: { type: 'string', description: 'UTC day key (YYYY-MM-DD).' },
								total: { type: 'integer' },
								endpoints: {
									type: 'object', additionalProperties: { type: 'integer' },
									description: 'Request counts keyed by path template (e.g. /missions).',
								},
							},
						},
					},
					total: { type: 'integer' },
					page: { type: 'integer' },
					page_size: { type: 'integer' },
					since: { type: 'string', nullable: true, description: 'ISO timestamp when counting began; data before this does not exist.' },
				},
			},
		},
		{
			path: '/api/v2/bug-taxonomy', method: 'GET',
			operationId: 'get_bug_taxonomy',
			summary: 'All closed value sets: categories, severities, priorities, lifecycle, review states, root causes, risks.',
			tags: ['Meta'],
			parameters: [],
			response: {
				type: 'object',
				properties: {
					categories: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
					severities: { type: 'array', items: { type: 'string', enum: SEVERITIES } },
					priorities: { type: 'array', items: { type: 'string', enum: PRIORITIES } },
					lifecycle: { type: 'array', items: { type: 'string', enum: FINDING_LIFECYCLE } },
					review_statuses: { type: 'array', items: { type: 'string', enum: REVIEW_STATUSES } },
					reproducibilities: { type: 'array', items: { type: 'string', enum: REPRODUCIBILITIES } },
					root_causes: { type: 'array', items: { type: 'string' } },
					risks: { type: 'array', items: { type: 'string' } },
					lifecycle_transitions: {
						type: 'object',
						additionalProperties: { type: 'array', items: { type: 'string' } },
						description: 'Legal lifecycle status transitions.',
					},
				},
			},
		},
	];
}

/* ── document assembly ── */

export function buildOpenApiDocument({ serverUrl = '' } = {}) {
	const paths = {};
	for (const op of operations()) {
		paths[op.path] ??= {};
		paths[op.path][op.method.toLowerCase()] = {
			operationId: op.operationId,
			summary: op.summary,
			tags: op.tags,
			parameters: op.parameters,
			security: op.public ? [] : [{ bearerAuth: [] }],
			responses: {
				200: {
					description: 'OK',
					content: { 'application/json': { schema: op.response } },
				},
				...(op.public ? {} : {
					400: { description: 'Bad request (e.g. invalid date filter).', content: { 'application/json': { schema: errorSchema } } },
					401: { description: 'Missing or invalid Bearer token.', content: { 'application/json': { schema: errorSchema } } },
					404: { description: 'Record not found.', content: { 'application/json': { schema: errorSchema } } },
				}),
			},
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'Qase Read API (for Pulse)',
			version: '1.0.0',
			description: [
				'Read surface of Qase — the autonomous QA agent — for external analytics agents (Drytis Pulse).',
				'',
				'Every operation here is GET; nothing in this document mutates state.',
				'',
				'Collections answer `{ data, total, page, page_size }` when `page`/`page_size` are sent;',
				'without them the legacy array shape is returned. Timestamps are ISO 8601 UTC.',
				'Foreign ids carry human-readable names beside them (project_name, mission_name, session_title).',
				'',
				'Excluded from this document by design:',
				'- /api/sessions/{id}/events — SSE stream, never terminates (would hang the agent).',
				'- /api/artifacts/{runId}/{filename} — binary file, not JSON.',
				'- export endpoints (/api/findings/export, /api/test-cases/export, mission reports) — file attachments.',
				'- /api/v1/integration/* — per-request HMAC signing; a pull connector cannot sign.',
				'- All POST/PUT/PATCH/DELETE operations — the connector only ever calls GET.',
			].join('\n'),
		},
		servers: [{ url: serverUrl || 'http://localhost:5173' }],
		paths,
		tags: [
			{ name: 'Meta', description: 'Instance metadata and taxonomies.' },
			{ name: 'Projects', description: 'Projects (top-level containers).' },
			{ name: 'Missions', description: 'Autonomous audit missions and their execution state.' },
			{ name: 'Sessions', description: 'Individual agent test sessions.' },
			{ name: 'Findings', description: 'Bugs and issues detected by missions.' },
			{ name: 'TestCases', description: 'Generated and regression test cases.' },
			{ name: 'Workflows', description: 'Saved browser workflows.' },
			{ name: 'Suites', description: 'Test suite tree.' },
			{ name: 'Schedules', description: 'Cron regression schedules and their runs.' },
			{ name: 'Regression', description: 'Scheduled regression runs and trends.' },
			{ name: 'Usage', description: 'Activity/usage aggregates and QASE API request telemetry.' },
			{ name: 'FixValidation', description: 'Fix-validation runs and outcomes.' },
			{ name: 'Knowledge', description: 'Learned patterns with confidence decay.' },
			{ name: 'Metrics', description: 'Dashboard and UX metrics.' },
		],
		security: [{ bearerAuth: [] }],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: 'Long-lived API token (QASE_API_TOKEN). Read-only in practice: nothing documented here mutates state.',
				},
			},
			schemas: {
				Project, Mission, Session, Finding, TestCase, Workflow, Suite, Schedule,
				RegressionRun, FixValidationRun, KnowledgePattern, TrendPoint,
			},
		},
	};
}
