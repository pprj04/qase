/** QASE V1 Overview — project-scoped dashboard using certified read APIs only. */
import { $, state, api, escapeHtml, hostOf, relativeTime } from './shared.js';
import { navigate } from './router.js';
import { openBugDetail } from './bugs.js';

const SESSION_LIMIT = 20;
const FINDING_LIMIT = 8;
const ACTIVE_OUTCOMES = new Set(['queued', 'running', 'awaiting_input']);
const OPEN_FINDING_STATUSES = new Set(['open', 'in_testing']);
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

let initialized = false;
let overview = emptyOverview();

function emptyOverview() {
	return {
		metrics: { state: 'loading', data: null },
		runs: { state: 'loading', data: null },
		findings: { state: 'loading', data: null },
		health: { state: 'loading', data: null }
	};
}

function page() { return $('page-overview'); }
function currentProjectName() { return state.projects.find(project => project.id === state.projectId)?.name ?? 'Current project'; }
function projectQuery(projectId) { return projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''; }

export function canonicalRunStatus(session = {}) {
	if (session.status === 'awaiting_input') return 'awaiting_input';
	const status = String(session.executionOutcome ?? session.outcome?.outcome ?? session.status ?? 'pending').toLowerCase();
	if (status === 'done') return 'completed';
	if (status === 'error') return 'failed';
	if (status === 'aborted') return 'cancelled';
	if (status === 'idle' || status === 'pending') return 'pending';
	return status;
}

export function statusLabel(status) {
	return ({
		queued: 'Queued', running: 'Running', awaiting_input: 'Awaiting Input', completed: 'Completed',
		partial: 'Partial', blocked: 'Blocked', failed: 'Failed', cancelled: 'Cancelled',
		interrupted: 'Interrupted', pending: 'Not started'
	})[status] ?? 'Not reported';
}

function findingStatusLabel(status) {
	return ({ open: 'Open', in_testing: 'In testing', resolved: 'Resolved', closed: 'Closed' })[status] ?? 'Not reported';
}

export function isOpenCanonicalFinding(finding = {}) {
	return !finding.isDuplicate && !finding.duplicateOf && OPEN_FINDING_STATUSES.has(String(finding.status ?? 'open').toLowerCase());
}

export function sevenDaySummary(runs, now = Date.now()) {
	const items = Array.isArray(runs?.items) ? runs.items : [];
	const count = items.filter(run => {
		const timestamp = Number(run.updatedAt ?? run.createdAt);
		return Number.isFinite(timestamp) && timestamp >= now - (7 * 24 * 60 * 60 * 1000) && timestamp <= now;
	}).length;
	return { count, complete: !runs?.hasMore && Number(runs?.total ?? items.length) <= items.length };
}

export function overviewProjectGate(snapshot, current = state) {
	return snapshot.projectId === current.projectId && snapshot.projectVersion === current.projectVersion;
}

function summaryEnvelope(payload) {
	if (!payload || !Array.isArray(payload.items) || !Number.isFinite(payload.total)) throw new Error('Overview data was not a valid paginated response.');
	return payload;
}

function findingEnvelope(payload) {
	const page = summaryEnvelope(payload);
	if (!Number.isFinite(payload.canonicalTotal)) throw new Error('Overview findings did not include canonical totals.');
	return page;
}

function validRegressionMetric(data) {
	const regression = data?.regression;
	if (!regression || !Number.isFinite(Number(regression.completedRuns)) || Number(regression.completedRuns) < 0) return false;
	return Number(regression.completedRuns) === 0 || Number.isFinite(Number(regression.overallPassRate));
}

function renderMetricCards() {
	const root = $('overview-metrics');
	if (!root) return;
	const runs = overview.runs.data;
	const findings = overview.findings.data;
	const metrics = overview.metrics.data;
	const active = runs ? runs.items.filter(run => ACTIVE_OUTCOMES.has(canonicalRunStatus(run))).length : null;
	const weekly = runs ? sevenDaySummary(runs) : null;
	const open = findings?.openCanonicalTotal ?? null;
	const critical = findings?.criticalCanonicalCount ?? null;
	const criticalValue = critical == null ? stateText(overview.findings) : `${findings.criticalComplete ? '' : '≥'}${critical}`;
	const regression = metrics?.regression;
	const passRate = regression && Number(regression.completedRuns) > 0 && Number.isFinite(regression.overallPassRate)
		? `${regression.overallPassRate}%`
		: regression ? 'No completed regressions' : null;
	const values = [
		['Active Runs', active == null ? stateText(overview.runs) : String(active), active == null ? 'From the latest runs' : `Among latest ${runs.limit} runs`],
		['Runs This Week', weekly == null ? stateText(overview.runs) : `${weekly.complete ? '' : '≥'}${weekly.count}`, weekly == null ? 'Uses server timestamps' : weekly.complete ? 'Complete current-project history' : `Latest ${runs.limit} runs only; date-range API not reported`],
		['Open Findings', open == null ? stateText(overview.findings) : String(open), 'Canonical current findings'],
		['Critical Issues', criticalValue, findings?.criticalComplete ? 'Exact canonical open critical findings' : 'At least this many in the bounded displayed pages'],
		['Pass Rate', passRate ?? stateText(overview.metrics), passRate === 'No completed regressions' ? 'No meaningful denominator' : 'Completed regressions only']
	];
	root.replaceChildren(...values.map(([label, value, detail]) => {
		const card = document.createElement('div');
		card.className = 'overview-metric';
		const term = document.createElement('dt');
		term.textContent = label;
		const definition = document.createElement('dd');
		definition.textContent = value;
		const description = document.createElement('small');
		description.textContent = detail;
		card.append(term, definition, description);
		if (label === 'Pass Rate' && overview.metrics.state === 'error') card.append(retryButton('metrics', 'metrics'));
		return card;
	}));
}

function stateText(block) {
	if (block.state === 'loading') return 'Loading…';
	return 'Unavailable';
}

function renderRuns() {
	const body = $('overview-runs-body');
	const stateNode = $('overview-runs-state');
	if (!body || !stateNode) return;
	body.replaceChildren();
	if (overview.runs.state === 'loading') {
		stateNode.textContent = 'Loading recent runs…';
		return;
	}
	if (overview.runs.state === 'error') {
		stateNode.replaceChildren(retryButton('recent runs', 'runs'));
		return;
	}
	const runs = overview.runs.data.items;
	if (runs.length === 0) {
		stateNode.replaceChildren(document.createTextNode('No runs yet. '), newRunLink('Start your first run'));
		return;
	}
	stateNode.textContent = `Latest ${runs.length}${overview.runs.data.hasMore ? ` of ${overview.runs.data.total}` : ''} runs in ${currentProjectName()}.`;
	for (const run of runs.slice(0, 8)) body.append(runRow(run));
}

function runRow(run) {
	const row = document.createElement('tr');
	const target = document.createElement('th');
	target.scope = 'row';
	const link = document.createElement('a');
	link.href = `/runs/${encodeURIComponent(run.id)}`;
	link.dataset.overviewRun = run.id;
	link.textContent = run.targetUrl ? hostOf(run.targetUrl) : (run.title || 'Untitled run');
	target.append(link);
	const status = document.createElement('td');
	status.append(statusBadge(canonicalRunStatus(run)));
	const updated = document.createElement('td');
	updated.textContent = Number.isFinite(Number(run.updatedAt ?? run.createdAt)) ? relativeTime(Number(run.updatedAt ?? run.createdAt)) : 'Not reported';
	const duration = document.createElement('td');
	duration.textContent = 'Not reported';
	const activity = document.createElement('td');
	activity.textContent = 'Not reported';
	const findings = document.createElement('td');
	findings.textContent = Number.isFinite(run.findingCount) ? String(run.findingCount) : 'Not reported';
	const report = document.createElement('td');
	report.textContent = run.reportAvailable === true ? 'Available' : run.reportAvailable === false ? 'Not available' : 'Not reported';
	row.append(target, status, updated, duration, activity, findings, report);
	return row;
}

function renderFindings() {
	const list = $('overview-findings-list');
	const stateNode = $('overview-findings-state');
	if (!list || !stateNode) return;
	list.replaceChildren();
	if (overview.findings.state === 'loading') { stateNode.textContent = 'Loading critical findings…'; return; }
	if (overview.findings.state === 'error') { stateNode.replaceChildren(retryButton('critical findings', 'findings')); return; }
	const findings = overview.findings.data.items;
	if (findings.length === 0) { stateNode.textContent = 'No open findings.'; return; }
	stateNode.textContent = `Showing critical findings first, then high findings from the current project.`;
	for (const finding of findings) {
		const item = document.createElement('li');
		const button = document.createElement('button');
		button.type = 'button';
		button.dataset.overviewFinding = finding.id;
		button.className = 'overview-finding-link';
		const title = document.createElement('strong');
		title.textContent = finding.title || 'Untitled finding';
		const meta = document.createElement('span');
		const area = finding.url ? hostOf(finding.url) : (finding.category || 'Area not reported');
		meta.textContent = `${String(finding.severity || 'info')} · ${finding.category || 'Uncategorized'} · ${area} · ${findingStatusLabel(String(finding.status || 'open'))}${Array.isArray(finding.evidenceIds) && finding.evidenceIds.length ? ' · Evidence attached' : ''}`;
		button.append(title, meta);
		item.append(button);
		list.append(item);
	}
}

function renderHealth() {
	const root = $('overview-health-list');
	if (!root) return;
	const service = overview.health.state === 'loading' ? 'Loading…'
		: overview.health.state === 'error' ? 'Unavailable'
		: overview.health.data?.status === 'ok' ? 'Healthy' : 'Unavailable';
	const rows = [['QASE Service', service], ['AI Provider', 'Not reported'], ['Worker', 'Not reported'], ['Browser', 'Not reported'], ['Scheduler', 'Not reported']];
	root.replaceChildren(...rows.map(([label, value]) => {
		const item = document.createElement('div');
		const term = document.createElement('dt'); term.textContent = label;
		const definition = document.createElement('dd'); definition.textContent = value;
		item.append(term, definition);
		return item;
	}));
	const error = $('overview-health-error');
	if (error) {
		error.replaceChildren();
		if (overview.health.state === 'error') error.append(retryButton('service health', 'health'));
	}
}

function statusBadge(status) {
	const badge = document.createElement('span');
	badge.className = 'overview-status';
	badge.dataset.status = status;
	badge.textContent = statusLabel(status);
	return badge;
}

function retryButton(label, block) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'btn btn-ghost btn-sm';
	button.dataset.overviewRetry = block;
	button.textContent = `Retry ${label}`;
	return button;
}

function newRunLink(label) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'overview-inline-action';
	button.dataset.overviewNewRun = 'true';
	button.textContent = label;
	return button;
}

function render() {
	const root = page();
	if (!root) return;
	root.setAttribute('aria-busy', String(Object.values(overview).some(block => block.state === 'loading')));
	const project = $('overview-project-name');
	if (project) project.textContent = currentProjectName();
	renderMetricCards();
	renderRuns();
	renderFindings();
	renderHealth();
}

function relevantFindings(openPages) {
	const byId = new Map();
	for (const page of openPages) for (const finding of page.items) {
		if (isOpenCanonicalFinding(finding) && !byId.has(finding.id)) byId.set(finding.id, finding);
	}
	return [...byId.values()]
		.filter(finding => ['critical', 'high'].includes(String(finding.severity).toLowerCase()))
		.sort((a, b) => (SEVERITY_ORDER[String(a.severity).toLowerCase()] ?? 99) - (SEVERITY_ORDER[String(b.severity).toLowerCase()] ?? 99) || Number(b.ts ?? 0) - Number(a.ts ?? 0));
}

async function loadFindings(projectId, isCurrent) {
	try {
		const suffix = projectQuery(projectId);
		const [open, testing] = await Promise.all([
			api(`/findings?limit=${FINDING_LIMIT}&status=open${suffix}`).then(findingEnvelope),
			api(`/findings?limit=${FINDING_LIMIT}&status=in_testing${suffix}`).then(findingEnvelope)
		]);
		if (!isCurrent()) return;
		const candidates = relevantFindings([open, testing]);
		overview.findings = {
			state: 'ready',
			data: {
				items: candidates.slice(0, FINDING_LIMIT),
				openCanonicalTotal: open.canonicalTotal + testing.canonicalTotal,
				criticalCanonicalCount: candidates.filter(finding => String(finding.severity).toLowerCase() === 'critical').length,
				criticalComplete: !open.hasMore && !testing.hasMore
			}
		};
	} catch {
		if (!isCurrent()) return;
		overview.findings = { state: 'error', data: null };
	}
	render();
}

export function markOverviewStale() {
	overview = emptyOverview();
	if (page() && !page().hidden) render();
}

function overviewSnapshot() {
	const snapshot = { projectId: state.projectId, projectVersion: state.projectVersion };
	return { snapshot, isCurrent: () => overviewProjectGate(snapshot) };
}

function loadMetrics(snapshot, isCurrent) {
	const suffix = snapshot.projectId ? `?projectId=${encodeURIComponent(snapshot.projectId)}` : '';
	void api(`/metrics/dashboard${suffix}`).then(data => {
		if (!isCurrent()) return;
		overview.metrics = validRegressionMetric(data) ? { state: 'ready', data } : { state: 'error', data: null };
		render();
	}).catch(() => {
		if (!isCurrent()) return;
		overview.metrics = { state: 'error', data: null };
		render();
	});
}

function loadRuns(snapshot, isCurrent) {
	void api(`/sessions?limit=${SESSION_LIMIT}${snapshot.projectId ? `&projectId=${encodeURIComponent(snapshot.projectId)}` : ''}`).then(data => {
		if (!isCurrent()) return;
		overview.runs = { state: 'ready', data: summaryEnvelope(data) };
		render();
	}).catch(() => {
		if (!isCurrent()) return;
		overview.runs = { state: 'error', data: null };
		render();
	});
}

function loadHealth(snapshot, isCurrent) {
	void api('/health').then(data => {
		if (!isCurrent()) return;
		overview.health = { state: 'ready', data };
		render();
	}).catch(() => {
		if (!isCurrent()) return;
		overview.health = { state: 'error', data: null };
		render();
	});
}

function retryOverviewBlock(block) {
	if (!['metrics', 'runs', 'findings', 'health'].includes(block)) return;
	const { snapshot, isCurrent } = overviewSnapshot();
	overview[block] = { state: 'loading', data: null };
	render();
	if (block === 'metrics') loadMetrics(snapshot, isCurrent);
	else if (block === 'runs') loadRuns(snapshot, isCurrent);
	else if (block === 'findings') void loadFindings(snapshot.projectId, isCurrent);
	else loadHealth(snapshot, isCurrent);
}

export async function loadOverview() {
	const { snapshot, isCurrent } = overviewSnapshot();
	markOverviewStale();
	render();
	void loadFindings(snapshot.projectId, isCurrent);
	loadMetrics(snapshot, isCurrent);
	loadRuns(snapshot, isCurrent);
	loadHealth(snapshot, isCurrent);
}

export function initOverview() {
	if (initialized) return;
	initialized = true;
	page()?.addEventListener('click', event => {
		const retry = event.target.closest('[data-overview-retry]');
		if (retry) { retryOverviewBlock(retry.dataset.overviewRetry); return; }
		const newRun = event.target.closest('[data-overview-new-run]');
		if (newRun) {
			if (newRun.disabled) return;
			newRun.disabled = true;
			window.dispatchEvent(new CustomEvent('qase:start-run', { detail: { done: () => { newRun.disabled = false; } } }));
			return;
		}
		const run = event.target.closest('[data-overview-run]');
		if (run) {
			event.preventDefault();
			navigate('runs');
			window.dispatchEvent(new CustomEvent('qase:select-run', { detail: { id: run.dataset.overviewRun } }));
			return;
		}
		const finding = event.target.closest('[data-overview-finding]');
		if (finding) { navigate('findings'); void openBugDetail(finding.dataset.overviewFinding); }
	});
}
