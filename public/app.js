import { describeSqaLifecycle, groupSqaUnresolvedResults } from './sqaPresentation.js';
import { isCredentialQuestion } from './questionPresentation.js';
import { buildFindingFixPrompt, buildAllFixPromptsMarkdown } from './fixPromptBuilder.js';
import { createFounderView } from './founderView.js';
import { createDeviceMatrixView } from './deviceMatrixView.js';
import { createTestCaseView } from './testCaseView.js';
import { createBulkRunView } from './bulkRunView.js';
import { createBugView } from './bugView.js';
import { createDeviceDrawer, chipLabel, RUNTIME_PROFILES } from './deviceDrawer.js';
import { createActiveTestEnvironmentStore } from './activeTestEnvironment.js';
import { createDevicePicker, createDeviceChipList, executionTypeText, buildDeviceCards, filterDeviceCards, resolveDeviceEnvironment, cardBadge, browsersForOS } from './devicePicker.js';
import { fallbackOptionsFor, availabilityMeta, describeQueue } from './deviceRuntimeUi.js';
import { resolveActiveRuntimeEnvironment } from './activeRuntimeEnvironment.js';
import { chromeViewModel } from './browserChrome.js';
import {
	lastRunByCase, caseStatus, platformsOf, caseEnvLines,
	filterCasesForWizard, resolveRunPairs,
	environmentsForPreset, buildBugMarkdown
} from './qaWorkflows.js';
import {
	loadBatches, recordBatch, aggregateBatch,
	createBatchTracker, activeBatchRunId
} from './bulkProgress.js';
import { formatTokens, hostOf, list, markdown, miniSummaryText, paragraph, relativeTime, section, tokenSummaryText, truncate } from './uiPrimitives.js';

/**
 * Qase dashboard.
 *
 * Three panels over one SSE stream. The server owns all state; this file
 * renders it and sends back the two things the user can contribute — an
 * instruction, and an answer to a blocking question.
 */

const $ = id => document.getElementById(id);
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const el = {
	runList: $('run-list'),
	deviceSelect: $('device-select'),
	deviceLandscape: $('device-landscape'),
	newRun: $('new-run'),
	newSqa: $('new-sqa'),
	newFounder: $('new-founder'),
	connDot: $('conn-dot'),
	connLabel: $('conn-label'),
	modelBadge: $('model-badge'),
	signOut: $('sign-out'),

	chatTitle: $('chat-title'),
	chatTarget: $('chat-target'),
	runSummary: $('run-summary'),
	tokenSummary: $('token-summary'),
	tokenText: $('token-text'),
	livePill: $('live-pill'),
	runSummaryToggle: $('run-summary-toggle'),
	runSummaryDetail: $('run-summary-detail'),
	runSummaryMini: $('run-summary-mini'),
	miniTokens: $('mini-tokens'),
	miniStatus: $('mini-status'),
	miniProgress: $('mini-progress'),
	miniFindings: $('mini-findings'),
	statusChip: $('status-chip'),
	progressSteps: $('progress-steps'),
	progressPct: $('progress-pct'),
	progressFindings: $('progress-findings'),
	progressBar: $('progress-bar'),
	currentActivity: $('current-activity'),
	currentActivityState: $('current-activity-state'),
	runTimer: $('run-timer'),
	runTimerLabel: $('run-timer-label'),
	runTimerClock: $('run-timer-clock'),
	perfPanel: $('perf-panel'),
	perfGrid: $('perf-grid'),
	perfCompare: $('perf-compare'),
	perfCompareTitle: $('perf-compare-title'),
	perfCompareList: $('perf-compare-list'),
	stopRun: $('stop-run'),
	thinkingStrip: $('thinking-strip'),
	thinkingHead: $('thinking-head'),
	thinkingLabel: $('thinking-label'),
	thinkingPeek: $('thinking-peek'),
	thinkingCaret: $('thinking-caret'),
	thinkingBody: $('thinking-body'),
	transcript: $('transcript'),
	chatEmpty: $('chat-empty'),
	questionSlot: $('question-slot'),
	composer: $('composer'),
	composerInput: $('composer-input'),
	sendBtn: $('send-btn'),

	browserUrl: $('browser-url'),
	browserTitle: $('browser-title'),
	browserDot: $('browser-dot'),
	stage: $('stage'),
	frame: $('frame'),
	stageInner: $('stage-inner'),
	stageEmpty: $('stage-empty'),
	cursor: $('cursor'),
	cursorLabel: $('cursor-label'),
	ripple: $('ripple'),
	targetBox: $('target-box'),

	activityFeed: $('activity-feed'),
	planList: $('plan-list'),
	findingsList: $('findings-list'),
	bugsList: $('bugs-list'),
	countBugs: $('count-bugs'),
	bugViewHost: $('pane-bugs'),
	reportView: $('report-view'),
	reportTab: $('tab-report'),
	activityTab: $('tab-activity'),
	sqaTab: $('tab-sqa'),
	sqaView: $('sqa-view'),
	founderTab: $('tab-founder'),
	founderView: $('founder-view'),
	countPlan: $('count-plan'),
	countFindings: $('count-findings'),
	countSqa: $('count-sqa'),
	countFounder: $('count-founder'),
	toasts: $('toasts'),
	authGate: $('auth-gate'),
	authForm: $('auth-form'),
	authEmail: $('auth-email'),
	authPassword: $('auth-password'),
	authDisplay: $('auth-display'),
	authDisplayLabel: $('auth-display-label'),
	authTitle: $('auth-title'),
	authCopy: $('auth-copy'),
	authSubmit: $('auth-submit'),
	authSwitch: $('auth-switch'),
	authError: $('auth-error')
};

const state = {
	sessionId: undefined,
	session: undefined,
	config: undefined,
	stream: undefined,
	/** Message id -> the nodes streamed text is appended to. */
	bubbles: new Map(),
	viewport: { width: 1440, height: 900 },
	cursorTimer: undefined,
	sqaCatalog: undefined,
	sqaCatalogPromise: undefined,
	founderCatalog: undefined,
	founderCatalogPromise: undefined,
	/** Live reasoning for the current turn. Never kept once the agent replies. */
	thinking: { text: '', action: '' },
	user: undefined,
	/**
	 * Test Execution Timer state. Server-authoritative: elapsed time is always
	 * computed from server timestamps (startedAt/completedAt) corrected by the
	 * latest serverNow sample, never from a frontend start event — so browser
	 * refresh, tab switches and reconnects can never reset or skew it.
	 */
	timer: {
		interval: undefined,
		/** serverNow − clientNow (ms) from the latest snapshot/event. */
		skew: 0,
		/** run id -> live duration node in the runs list. */
		runLiveTimers: new Map()
	},
	/**
	 * Single source of truth for the live view: the currently executing
	 * device/browser context, resolved by activeRuntimeEnvironment.js.
	 * Every live-view component reads this — never its own fallback chain.
	 */
	activeRuntimeEnvironment: undefined
};

/* ── Helpers ─────────────────────────────────────────────────────── */

async function apiResponse(path, options = {}) {
	const method = String(options.method ?? 'GET').toUpperCase();
	const csrf = document.cookie.match(/(?:^|; )qase_csrf=([^;]+)/)?.[1];
	const headers = { 'Content-Type': 'application/json', ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}), ...(options.headers ?? {}) };
	const response = await fetch(`/api${path}`, {
		...options,
		method,
		headers,
		credentials: 'same-origin'
	});
	if (response.status === 401 && state.user && !path.startsWith('/auth/')) { window.location.reload(); throw new Error('Your session has expired. Sign in again.'); }
	if (!response.ok) {
		const text = await response.text();
		let message;
		try {
			message = JSON.parse(text).error;
		} catch {
			message = text;
		}
		const error = new Error(message || `Request failed (${response.status})`);
		error.status = response.status;
		throw error;
	}
	return response;
}

async function api(path, options = {}) {
	const response = await apiResponse(path, options);
	return response.status === 204 ? undefined : response.json();
}

async function apiText(path, options = {}) {
	return (await apiResponse(path, options)).text();
}

function toast(message, kind = '') {
	const node = document.createElement('div');
	node.className = `toast ${kind}`;
	node.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
	node.textContent = message;
	el.toasts.append(node);
	setTimeout(() => {
		node.classList.add('is-leaving');
		node.addEventListener('animationend', () => node.remove(), { once: true });
	}, kind === 'bad' ? 6000 : 3600);
}

const fail = error => toast(error instanceof Error ? error.message : String(error), 'bad');

async function downloadReportPdf(filename) {
	const response = await apiResponse(`/sessions/${state.sessionId}/report.pdf`);
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const save = document.createElement('a');
	save.href = url;
	save.download = filename;
	document.body.append(save);
	save.click();
	save.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const founderView = createFounderView({
	getSession: () => state.session,
	getCatalog: () => state.founderCatalog,
	getSessionId: () => state.sessionId,
	elements: {
		founderView: el.founderView,
		countFounder: el.countFounder,
		reportView: el.reportView
	},
	apiText,
	downloadReportPdf,
	toast,
	fail,
	humanizeId: humanizeSqaId
});
const renderFounder = founderView.render;
const renderFounderReportTab = founderView.renderReportTab;

/* ── Bugs tab (Phase 6) ──────────────────────────────────────────── */

const bugView = createBugView({
	api,
	toast,
	openRun: (runId) => void selectSession(runId).catch(fail)
});

/** Refresh the Bugs tab from /api/bugs and repaint it (safe to fire-and-forget). */
async function refreshBugs() {
	if (!el.bugsList || !el.countBugs) return;
	await bugView.refresh();
	bugView.render(el.bugsList, el.countBugs);
	paintBugFilterValues();
}

function paintBugFilterValues() {
	const filters = bugView.filters;
	const search = $('bug-search');
	if (search) search.value = filters.search;
	const status = $('bug-filter-status');
	if (status) status.value = filters.status;
	const severity = $('bug-filter-severity');
	if (severity) severity.value = filters.severity;
}

function initBugFilters() {
	const host = el.bugViewHost;
	if (!host || host.dataset.bugFilters === 'on') return;
	host.dataset.bugFilters = 'on';
	const bar = document.createElement('div');
	bar.className = 'bug-filter-bar';
	const search = document.createElement('input');
	search.id = 'bug-search';
	search.type = 'search';
	search.placeholder = 'Search bugs…';
	search.setAttribute('aria-label', 'Search bugs');
	const status = document.createElement('select');
	status.id = 'bug-filter-status';
	status.setAttribute('aria-label', 'Filter bugs by status');
	status.append(new Option('Any status', ''));
	for (const value of ['open', 'in_progress', 'resolved', 'wont_fix', 'reopened']) {
		status.append(new Option(value.replace(/_/g, ' '), value));
	}
	const severity = document.createElement('select');
	severity.id = 'bug-filter-severity';
	severity.setAttribute('aria-label', 'Filter bugs by severity');
	severity.append(new Option('Any severity', ''));
	for (const value of ['critical', 'high', 'medium', 'low']) {
		severity.append(new Option(value, value));
	}
	const rerender = () => {
		bugView.setFilter({
			search: search.value.trim(),
			status: status.value,
			severity: severity.value
		});
		bugView.render(el.bugsList, el.countBugs);
	};
	search.oninput = rerender;
	status.onchange = rerender;
	severity.onchange = rerender;
	bar.append(search, status, severity);
	const listHost = el.bugsList;
	listHost.before(bar);
}

initBugFilters();


/* ── Runs (left panel) ───────────────────────────────────────────── */

async function refreshRuns() {
	const runs = await api('/sessions').catch(() => []);
	if (runs.length === 0) {
		el.runList.innerHTML = '<div class="feed-empty">No runs yet</div>';
		state.timer.runLiveTimers.clear();
		return;
	}
	el.runList.replaceChildren(...runs.map(renderRun));
}

// Live token commits arrive up to once a second; refreshing the whole run
// list for each is wasteful. Coalesce to at most one refetch per 5s.
let runBadgeRefreshTimer;
function scheduleRunBadgeRefresh() {
	if (runBadgeRefreshTimer) return;
	runBadgeRefreshTimer = setTimeout(() => {
		runBadgeRefreshTimer = undefined;
		void refreshRuns();
	}, 5000);
	runBadgeRefreshTimer.unref?.();
}

function renderRun(run) {
	const row = document.createElement('div');
	row.className = 'run-row';
	row.setAttribute('role', 'listitem');

	const node = document.createElement('button');
	node.className = `run${run.id === state.sessionId ? ' is-active' : ''}`;
	node.type = 'button';
	node.setAttribute('aria-current', run.id === state.sessionId ? 'true' : 'false');
	node.onclick = () => selectSession(run.id);

	const title = document.createElement('div');
	title.className = 'run-title';
	title.textContent = run.targetUrl ? hostOf(run.targetUrl) : run.title;

	const meta = document.createElement('div');
	meta.className = 'run-meta';
	const dot = document.createElement('span');
	dot.className = `dot${run.status === 'running' ? ' is-busy' : run.status === 'done' ? ' is-live' : ''}`;
	dot.setAttribute('aria-hidden', 'true');
	meta.append(dot, document.createTextNode(relativeTime(run.updatedAt)));
	// Per-run timer: live elapsed for running runs, stored duration for
	// finished ones. Each row computes independently — never a shared clock.
	if (Number.isFinite(run.startedAt)) {
		const duration = Number.isFinite(run.completedAt)
			? formatDurationShort(run.durationSeconds ?? (run.completedAt - run.startedAt) / 1000)
			: Number.isFinite(run.startedAt)
				? formatDurationShort(elapsedSecondsOf(run))
				: '';
		if (duration) {
			const timer = document.createElement('span');
			timer.className = `run-duration${run.status === 'running' ? ' run-duration--live' : ''}`;
			timer.dataset.runId = run.id;
			timer.textContent = run.status === 'running' ? `⏱ ${duration}` : `⏱ ${duration}`;
			timer.title = run.status === 'running'
				? `Elapsed time — started ${formatTimeOfDay(run.startedAt)}`
				: `Total duration — completed ${formatTimeOfDay(run.completedAt)}`;
			meta.append(timer);
			if (run.status === 'running') {
				state.timer.runLiveTimers.set(run.id, timer);
			} else {
				state.timer.runLiveTimers.delete(run.id);
			}
		}
	}
	if (run.mode === 'sqa') {
		const mode = document.createElement('span');
		mode.className = 'run-mode-badge';
		mode.textContent = 'SQA';
		mode.title = 'Software quality assurance assessment';
		meta.append(mode);
	}
	if (run.mode === 'founder') {
		const mode = document.createElement('span');
		mode.className = 'run-mode-badge run-mode-badge--founder';
		mode.textContent = 'Founder';
		mode.title = 'Founder Mode product and growth review';
		meta.append(mode);
	}
	if (run.findingCount > 0) {
		const badge = document.createElement('span');
		badge.className = 'run-badge';
		badge.textContent = `${run.findingCount}`;
		meta.append(badge);
	}
	if (run.tokenUsage && Number.isFinite(run.tokenUsage.totalTokens) && run.tokenUsage.totalTokens > 0) {
		const tokens = document.createElement('span');
		tokens.className = 'run-badge run-badge--tokens';
		tokens.textContent = `${formatTokens(run.tokenUsage.totalTokens) ?? run.tokenUsage.totalTokens} tok`;
		tokens.title = `${(run.tokenUsage.inputTokens ?? 0).toLocaleString()} prompt / ${(run.tokenUsage.outputTokens ?? 0).toLocaleString()} completion tokens`
			+ (run.tokenUsage.estimated === true ? ' (estimated)' : '');
		meta.append(tokens);
	}
	if (run.device && run.device !== 'desktop') {
		const profile = deviceState.list.find(p => p.id === run.device);
		const pill = document.createElement('span');
		pill.className = 'run-device-pill';
		pill.dataset.deviceKind = profile?.kind ?? 'mobile';
		const short = (profile?.label ?? run.device).replace(/\s*\(.*\)$/, '');
		pill.textContent = short + (run.deviceLandscape ? ' – L' : '');
		pill.title = (profile?.label ?? run.device) + (run.deviceLandscape ? ' (landscape)' : '');
		meta.append(pill);
	}
	if (run.environmentSnapshot) {
		const snap = run.environmentSnapshot;
		const pill = document.createElement('span');
		pill.className = 'run-device-pill';
		pill.dataset.deviceKind = snap.platform === 'macos' ? 'desktop' : 'mobile';
		pill.textContent = `${snap.device} · ${snap.browser} ${snap.browserVersion}`;
		pill.title = `${snap.envId} — ${snap.osVersion} · ${snap.executionProvider === 'browserstack' ? 'environment runtime' : 'local (simulated)'}`;
		meta.append(pill);
		// Phase 22: honest execution-level badge — recorded facts only.
		const level = run.runtimeFacts?.executionLevel ?? run.executionLevel;
		if (level) {
			const badge = document.createElement('span');
			badge.className = 'run-exec-level-badge';
			badge.dataset.level = level.toLowerCase();
			badge.textContent = level === 'REAL_DEVICE' ? 'REAL DEVICE' : level === 'VIRTUAL_DEVICE' ? 'VIRTUAL DEVICE' : level;
			badge.title = `Execution level recorded for this run: ${level}`
				+ (run.executionProviderActual ? ` (${run.executionProviderActual})` : '');
			meta.append(badge);
		}
	}

	// Mini progress row: step count + slim bar, only when a plan exists.
	let progress = null;
	if (run.todoTotal > 0) {
		progress = document.createElement('div');
		progress.className = 'run-progress';
		const steps = document.createElement('span');
		steps.className = 'run-progress-steps';
		steps.textContent = `${run.todoCompleted}/${run.todoTotal}`;
		const bar = document.createElement('span');
		bar.className = 'run-progress-bar';
		const fill = document.createElement('i');
		fill.style.width = `${Math.round((run.todoCompleted / run.todoTotal) * 100)}%`;
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-valuemin', '0');
		bar.setAttribute('aria-valuemax', '100');
		bar.setAttribute('aria-valuenow', String(Math.round((run.todoCompleted / run.todoTotal) * 100)));
		bar.setAttribute('aria-label', `Plan progress ${run.todoCompleted} of ${run.todoTotal} steps`);
		bar.append(fill);
		progress.append(steps, bar);
	}

	const remove = document.createElement('button');
	remove.className = 'run-del';
	remove.type = 'button';
	remove.textContent = '×';
	remove.title = 'Delete this run';
	remove.setAttribute('aria-label', `Delete run ${title.textContent}`);
	remove.onclick = async event => {
		event.stopPropagation();
		await api(`/sessions/${run.id}`, { method: 'DELETE' }).catch(fail);
		if (run.id === state.sessionId) {
			const remaining = await api('/sessions');
			await (remaining[0] ? selectSession(remaining[0].id) : startRun());
		} else {
			await refreshRuns();
		}
	};

	node.append(title, meta);
	if (progress) node.append(progress);
	row.append(node, remove);
	return row;
}

/* ── Session loading ─────────────────────────────────────────────── */

// ── Device emulation ─────────────────────────────────────────────
// We keep a single, persisted "device for the next run" preference. It flows
// into the QA quick-start, SQA modal, and Founder modal payloads, and the live
// preview picks up the current session's device from session.device so it can
// paint a phone/tablet bezel over the JPEG stream. No stream/DOM of the site
// under test is ever touched by this — the real emulation lives in
// server/deviceProfiles.js via Playwright newContext options.
const DEVICE_PREF_KEY = 'qase.device';
const deviceState = { list: [], defaultId: 'desktop' };

async function loadDevices() {
	try {
		const catalog = await api('/devices');
		deviceState.list = Array.isArray(catalog?.devices) ? catalog.devices : [];
		deviceState.defaultId = catalog?.default ?? 'desktop';
	} catch {
		deviceState.list = [{ id: 'desktop', label: 'Desktop', kind: 'desktop' }];
		deviceState.defaultId = 'desktop';
	}
	if (!el.deviceSelect) return;
	el.deviceSelect.innerHTML = '';
	for (const profile of deviceState.list) {
		const option = document.createElement('option');
		option.value = profile.id;
		option.textContent = profile.label;
		el.deviceSelect.append(option);
	}
	const saved = localStorage.getItem(DEVICE_PREF_KEY);
	el.deviceSelect.value = deviceState.list.some(p => p.id === saved) ? saved : deviceState.defaultId;
	el.deviceSelect.addEventListener('change', () => {
		localStorage.setItem(DEVICE_PREF_KEY, el.deviceSelect.value);
	});
	if (el.deviceLandscape) {
		el.deviceLandscape.checked = localStorage.getItem(DEVICE_LANDSCAPE_KEY) === '1';
		el.deviceLandscape.addEventListener('change', () => {
			localStorage.setItem(DEVICE_LANDSCAPE_KEY, el.deviceLandscape.checked ? '1' : '0');
		});
	}
}

function pendingDeviceId() {
	return (el.deviceSelect && el.deviceSelect.value) || localStorage.getItem(DEVICE_PREF_KEY) || deviceState.defaultId;
}

/* ── Cross-platform environments ──────────────────────────────── */

const ENV_PREF_KEY = 'qase.environmentId';
const envState = { list: [], loaded: false };

function envLabel(env) {
	return `${env.device} · ${env.os} ${env.osVersion} — ${env.browser} ${env.browserVersion}`;
}

/** Grouped optgroups: Platform → Device → OS version → browser + version. */
function envOptionGroups(list) {
	const groups = new Map();
	for (const env of list) {
		const platformKey = env.platformLabel;
		if (!groups.has(platformKey)) groups.set(platformKey, new Map());
		const byDevice = groups.get(platformKey);
		if (!byDevice.has(env.device)) byDevice.set(env.device, []);
		byDevice.get(env.device).push(env);
	}
	return [...groups.entries()].map(([platform, byDevice]) => ({
		platform,
		devices: [...byDevice.entries()].map(([device, envs]) => ({
			device,
			envs: envs.sort((a, b) => b.osVersion.localeCompare(a.osVersion, undefined, { numeric: true })
				|| a.browser.localeCompare(b.browser)
				|| Number(b.browserVersion) - Number(a.browserVersion))
		}))
	}));
}

async function loadEnvironments() {
	if (envState.loaded) return envState.list;
	try {
		const payload = await api('/environments?active=true&limit=1000');
		envState.list = Array.isArray(payload?.environments) ? payload.environments : [];
		envState.loaded = true;
	} catch {
		envState.list = [];
		envState.loaded = true;
	}
	return envState.list;
}

function pendingEnvironmentId() {
	return localStorage.getItem(ENV_PREF_KEY) || '';
}

/* ── TEST ON block (DX Phase 3): the ONE selection shown in every start
 * dialog. Reads the store — no per-dialog device/environment state. */
function renderTestOn(containerId) {
	const box = document.getElementById(containerId);
	if (!box) return;
	const sel = activeTestEnvStore?.get?.();
	box.textContent = '';
	if (!sel) {
		box.dataset.empty = 'true';
		const prompt = document.createElement('span');
		prompt.className = 'test-on-prompt';
		prompt.textContent = 'SELECT A DEVICE';
		box.append(prompt);
		return;
	}
	delete box.dataset.empty;
	const name = document.createElement('strong');
	name.className = 'test-on-device';
	name.textContent = sel.device;
	const line = document.createElement('span');
	line.className = 'test-on-line';
	line.textContent = [sel.os, sel.osVersion, '·', sel.browser, sel.browserVersion].filter(Boolean).join(' ');
	const meta = document.createElement('span');
	meta.className = 'test-on-meta';
	meta.textContent = `● ${executionTypeText(sel)} · ${sel.resolution ?? ''} ${sel.orientation ?? ''}`.replace(/\s+/g, ' ').trim();
	box.append(name, line, meta);
}

function renderAllTestOnBlocks() {
	renderTestOn('qa-test-on');
	renderTestOn('sqa-test-on');
	renderTestOn('founder-test-on');
	renderChooseDeviceSummary();
}

/* ── Choose Device collapsible section (exec layout #14069) ─────────
 * ONE inline picker surface above the preview. Reads/writes the SAME
 * activeTestEnvironment store as the dialog picker — no second state. */
const chooseDeviceUi = {
	root: $('choose-device'),
	head: $('cd-head'),
	body: $('cd-body'),
	summary: $('cd-summary'),
	execBadge: $('cd-exec-badge'),
	chevron: $('cd-chevron'),
	changeBtn: $('cd-change'),
	search: $('cd-search'),
	list: $('cd-list'),
	secondary: $('cd-secondary')
};
let cdSelectedDevice = null;

function renderChooseDeviceSummary() {
	if (!chooseDeviceUi.head) return;
	const sel = activeTestEnvStore?.get?.();
	if (!sel) {
		chooseDeviceUi.head.dataset.empty = 'true';
		if (chooseDeviceUi.summary) chooseDeviceUi.summary.textContent = 'No device selected — click to choose';
		if (chooseDeviceUi.execBadge) { chooseDeviceUi.execBadge.hidden = false; chooseDeviceUi.execBadge.textContent = '○ NO DEVICE'; chooseDeviceUi.execBadge.dataset.exec = 'none'; }
		return;
	}
	delete chooseDeviceUi.head.dataset.empty;
	if (chooseDeviceUi.summary) {
		chooseDeviceUi.summary.textContent = [sel.device, [sel.os, sel.osVersion].filter(Boolean).join(' '), [sel.browser, sel.browserVersion].filter(Boolean).join(' ')]
			.filter(Boolean).join(' · ');
	}
	const badgeLevel = cdBadgeText();
	if (chooseDeviceUi.execBadge) {
		chooseDeviceUi.execBadge.hidden = false;
		chooseDeviceUi.execBadge.textContent = `● ${badgeLevel.toUpperCase()}`;
		chooseDeviceUi.execBadge.dataset.exec = badgeLevel.toLowerCase().replace(/ /g, '_');
	}
}

function cdEnvironments() {
	// Reuse the dialog picker's live catalog (same data source, refreshed on open).
	return devicePicker?.state?.environments ?? [];
}

/**
 * Honest badge text for the collapsed header: derived from the SAME card
 * model + runtime board the picker cards use (cardBadge), so the header can
 * never contradict the card the user just clicked. Falls back to the store
 * selection's executionType when the device isn't in the catalog.
 */
function cdBadgeText() {
	const sel = activeTestEnvStore?.get?.();
	if (!sel?.device) return executionTypeText(sel);
	const envs = cdEnvironments();
	if (!envs.length) return executionTypeText(sel);
	const cards = buildDeviceCards(envs, cdBoardFor(envs));
	const card = cards.find((c) => c.device === sel.device);
	if (!card) return executionTypeText(sel);
	return cardBadge(card).level;
}

function cdBoardFor(envs) {
	const board = devicePicker?.state?.boardByEnvId;
	const map = new Map();
	if (!board) return map;
	for (const env of envs) {
		const entry = board.get(env.envId ?? env.id);
		if (entry) map.set(env.envId ?? env.id, entry);
	}
	return map;
}

function cdFilters() {
	const platform = chooseDeviceUi.root?.querySelector('.cd-chip.is-active[data-cd-platform]')?.dataset.cdPlatform ?? 'all';
	const type = chooseDeviceUi.root?.querySelector('.cd-chip.is-active[data-cd-type]')?.dataset.cdType ?? 'all';
	return { search: chooseDeviceUi.search?.value ?? '', platform, deviceType: type };
}

function renderCdList() {
	if (!chooseDeviceUi.list) return;
	chooseDeviceUi.list.textContent = '';
	const envs = cdEnvironments();
	if (!envs.length) {
		const p = document.createElement('p');
		p.className = 'cd-empty';
		p.textContent = devicePicker?.state?.dataState === 'error'
			? 'Could not load the device catalog — check your connection and reopen.'
			: 'Loading device catalog…';
		chooseDeviceUi.list.append(p);
		return;
	}
	const cards = filterDeviceCards(buildDeviceCards(envs, cdBoardFor(envs)), cdFilters());
	if (!cards.length) {
		const p = document.createElement('p');
		p.className = 'cd-empty';
		p.textContent = 'No devices match — clear the search or filters.';
		chooseDeviceUi.list.append(p);
		return;
	}
	let currentGroup = null;
	for (const card of cards) {
		if (card.groupLabel !== currentGroup) {
			currentGroup = card.groupLabel;
			const head = document.createElement('div');
			head.className = 'dp-group';
			head.textContent = currentGroup;
			chooseDeviceUi.list.append(head);
		}
		const el = document.createElement('div');
		const selected = cdSelectedDevice === card.device;
		el.className = `dp-card${selected ? ' is-selected' : ''}`;
		el.setAttribute('role', 'listitem');
		const badge = cardBadge(card);
		const info = document.createElement('div');
		info.className = 'dp-card-info';
		const name = document.createElement('span');
		name.className = 'dp-card-name';
		name.textContent = card.device;
		const sub = document.createElement('span');
		sub.className = 'dp-card-sub';
		sub.textContent = `${card.best.os ?? ''} ${card.best.osVersion ?? ''} · ${card.best.browser ?? ''} ${card.best.browserVersion ?? ''}`.trim();
		const badgeEl = document.createElement('span');
		badgeEl.className = 'dp-card-badge';
		badgeEl.textContent = `● ${badge.level} · ${badge.availability}`;
		info.append(name, sub, badgeEl);
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'btn btn-primary btn-sm dp-select-btn';
		btn.textContent = selected ? 'Selected ✓' : 'Select';
		btn.onclick = () => cdSelect(card);
		el.append(info, btn);
		chooseDeviceUi.list.append(el);
	}
	if (cdSelectedDevice) renderCdSecondary();
}

function renderCdSecondary() {
	if (!chooseDeviceUi.secondary) return;
	chooseDeviceUi.secondary.textContent = '';
	const envs = cdEnvironments();
	const card = buildDeviceCards(envs, cdBoardFor(envs)).find((c) => c.device === cdSelectedDevice);
	if (!card) { chooseDeviceUi.secondary.hidden = true; return; }
	chooseDeviceUi.secondary.hidden = false;
	const sel = activeTestEnvStore?.get?.();

	if (card.osVersions.length > 1) {
		const label = document.createElement('label');
		const span = document.createElement('span');
		span.textContent = 'OS version';
		const osSelect = document.createElement('select');
		osSelect.setAttribute('aria-label', 'OS version');
		for (const v of card.osVersions) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = `${card.best.os ?? ''} ${v}`.trim();
			if (sel?.osVersion === v) opt.selected = true;
			osSelect.append(opt);
		}
		osSelect.onchange = () => cdReselect(card, { osVersion: osSelect.value });
		label.append(span, osSelect);
		chooseDeviceUi.secondary.append(label);
	}

	const browsers = browsersForOS(card, sel?.osVersion ?? card.best.osVersion ?? null);
	if (browsers.length > 1) {
		const label = document.createElement('label');
		const span = document.createElement('span');
		span.textContent = 'Browser';
		const bSelect = document.createElement('select');
		bSelect.setAttribute('aria-label', 'Browser');
		for (const b of browsers) {
			const opt = document.createElement('option');
			opt.value = b.browser;
			opt.textContent = [b.browser, b.browserVersion].filter(Boolean).join(' ');
			if (sel?.browser === b.browser) opt.selected = true;
			bSelect.append(opt);
		}
		bSelect.onchange = () => cdReselect(card, { browser: bSelect.value });
		label.append(span, bSelect);
		chooseDeviceUi.secondary.append(label);
	}
}

function cdSelect(card) {
	cdSelectedDevice = card.device;
	const env = resolveDeviceEnvironment(cdEnvironments(), { device: card.device })
		?? card.best ?? null;
	if (env) {
		activeTestEnvStore.setSelection(env);
		if (state.session) applySessionSnapshot(state.session);
		renderAllTestOnBlocks();
		renderCdList();
	}
}

function cdReselect(card, overrides) {
	const env = resolveDeviceEnvironment(cdEnvironments(), { device: card.device, ...overrides });
	if (env) {
		activeTestEnvStore.setSelection(env);
		if (state.session) applySessionSnapshot(state.session);
		renderAllTestOnBlocks();
		renderCdList();
	}
}

function setChooseDeviceOpen(open) {
	if (!chooseDeviceUi.root) return;
	chooseDeviceUi.root.classList.toggle('is-open', open);
	if (chooseDeviceUi.body) chooseDeviceUi.body.hidden = !open;
	if (chooseDeviceUi.head) chooseDeviceUi.head.setAttribute('aria-expanded', String(open));
	if (open) {
		cdSelectedDevice = activeTestEnvStore?.get?.()?.device ?? null;
		renderCdList();
	}
}

function cdSyncSelectedHighlight() {
	// Dialog-picker selections can change the store while the inline body is
	// open — keep the highlight/badge in sync (display only).
	const storeDevice = activeTestEnvStore?.get?.()?.device ?? null;
	if (cdSelectedDevice !== storeDevice) cdSelectedDevice = storeDevice;
	renderChooseDeviceSummary();
}

if (chooseDeviceUi.head) {
	const toggleFrom = (event) => {
		// The [Change Device] button opens THE dialog picker instead of toggling.
		if (event.target.closest?.('#cd-change')) return;
		setChooseDeviceOpen(!chooseDeviceUi.root.classList.contains('is-open'));
	};
	chooseDeviceUi.head.onclick = toggleFrom;
	// role=button div: keyboard parity with a real toggle button.
	chooseDeviceUi.head.onkeydown = (event) => {
		if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
		if (event.target.closest?.('#cd-change')) return;
		event.preventDefault();
		setChooseDeviceOpen(!chooseDeviceUi.root.classList.contains('is-open'));
	};
}
if (chooseDeviceUi.changeBtn) {
	chooseDeviceUi.changeBtn.onclick = () => {
		setChooseDeviceOpen(false);
		devicePicker?.open?.();
	};
}
if (chooseDeviceUi.search) {
	chooseDeviceUi.search.oninput = () => renderCdList();
}
for (const chip of chooseDeviceUi.root?.querySelectorAll('.cd-chip') ?? []) {
	chip.onclick = () => {
		for (const sibling of chip.parentElement.querySelectorAll('.cd-chip')) sibling.classList.remove('is-active');
		chip.classList.add('is-active');
		renderCdList();
	};
}
// Keep the inline list fresh when the dialog picker refreshes its catalog.
const cdRenderOnData = () => {
	if (!chooseDeviceUi.root?.classList.contains('is-open')) return;
	cdSyncSelectedHighlight();
	renderCdList();
};

/** Submit-time source of truth (AC14): the store's envId, read at submit. */
function selectedEnvironmentForRun() {
	const sel = activeTestEnvStore?.get?.();
	return sel?.envId || '';
}

const DEVICE_LANDSCAPE_KEY = 'qase.deviceLandscape';
function pendingLandscape() {
	if (el.deviceLandscape) return Boolean(el.deviceLandscape.checked);
	return localStorage.getItem(DEVICE_LANDSCAPE_KEY) === '1';
}

function applyStageDevice(session) {
	if (!el.stage) return;
	const id = session?.device ?? 'desktop';
	const profile = deviceState.list.find(p => p.id === id);
	const kind = profile?.kind ?? 'desktop';
	if (kind === 'desktop') {
		el.stage.removeAttribute('data-device-kind');
		el.stage.removeAttribute('data-device-label');
	} else {
		el.stage.setAttribute('data-device-kind', kind);
		el.stage.setAttribute('data-device-label', profile?.label ?? id);
	}
}


async function selectSession(id) {
	state.shownFounderReport = undefined;
	state.sessionId = id;
	state.bubbles.clear();
	localStorage.setItem('qase.session', id);

	const session = await api(`/sessions/${id}`);
	if (state.sessionId !== id) return;
	applySessionSnapshot(session);
	await connect(id);
	await refreshRuns();
	void refreshPerformance();
}

let _runEnvHook = null;
function setRunEnvHook(fn) { _runEnvHook = fn; }

// Right-panel "LIVE DEVICE VIEW" header: every value comes from the single
// activeRuntimeEnvironment view-model — never from local fallback chains.
function renderLiveDeviceViewHeader(session, are = null) {
	const ldv = document.getElementById('live-device-view-head');
	if (!ldv) return;
	const dev = ldv.querySelector('#ldv-device');
	const exec = ldv.querySelector('#ldv-exec');
	const live = ldv.querySelector('#ldv-live');
	if (!dev || !exec || !live) return;

	const view = are ?? resolveActiveRuntimeEnvironment({ session, environments: deviceState.list });
	if (!view) {
		dev.textContent = activeTestEnvStore?.get?.()?.device ?? '—';
		exec.textContent = '○ NO DEVICE';
		exec.dataset.exec = 'none';
		live.textContent = '○ IDLE';
		live.dataset.live = 'false';
		ldv.title = 'Live device view — no active environment';
		renderEnvironmentCard(null, null, null);
		return;
	}

	state.activeRuntimeEnvironment = view;
	const deviceLabel = view.device;
	const execMap = {
		real_device: view.executionTypeAttested ? 'REAL DEVICE' : 'REAL (UNVERIFIED)',
		virtual_device: 'VIRTUAL DEVICE',
		simulated: 'SIMULATED',
		none: 'NO DEVICE'
	};
	const execLabel = execMap[view.executionType] ?? view.executionType.toUpperCase();
	const statusMap = {
		queued: '○ QUEUED',
		reserving: '○ RESERVING…',
		connecting: '◌ CONNECTING…',
		connected: '● CONNECTED',
		running: '● RUNNING',
		blocked: '◆ BLOCKED',
		completed: '○ COMPLETED',
		failed: '✕ FAILED',
		device_unavailable: '✕ DEVICE UNAVAILABLE',
		released: '○ RELEASED'
	};
	const liveLabel = statusMap[view.runtimeStatus] ?? `○ ${view.runtimeStatus.toUpperCase()}`;

	exec.dataset.exec = view.executionType;
	exec.textContent = execLabel;
	live.textContent = liveLabel;
	live.dataset.live = String(['running', 'connected'].includes(view.runtimeStatus));
	dev.textContent = deviceLabel;
	ldv.title = `Live device view — ${view.device} · ${[view.os, view.osVersion].filter(Boolean).join(' ') || 'unknown OS'} · ${[view.browser, view.browserVersion].filter(Boolean).join(' ') || 'unknown browser'} · ${execLabel}`;

	renderEnvironmentCard(view, execLabel, liveLabel);
	renderBrowserChrome(view);
	applyDeviceFrame(view);
	renderUnavailableState(view, execLabel);
}

/* Environment card: readable CURRENT TEST DEVICE panel. While idle it shows
 * the selection; during a run it becomes LIVE DEVICE. When no device is
 * selected at all, the empty-state card invites choosing one (AC11). */
function renderEnvironmentCard(view, execLabel, liveLabel) {
	const card = document.getElementById('ldv-env-card');
	const emptyCard = document.getElementById('ldv-env-card-empty');
	if (!card) return;
	const hasSelection = activeTestEnvStore?.get?.();
	card.hidden = !hasSelection;
	if (emptyCard) emptyCard.hidden = Boolean(hasSelection);
	if (!hasSelection) return;
	const kicker = document.getElementById('ldv-kicker');
	if (kicker) {
		const active = view && ['running', 'connected', 'connecting', 'reserving'].includes(view.runtimeStatus);
		kicker.textContent = active
			? (view?.deviceType === 'desktop' ? 'LIVE DESKTOP' : 'LIVE DEVICE')
			: 'CURRENT TEST DEVICE';
	}
	const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
	const sel = activeTestEnvStore?.get?.();
	// Card values: the resolved view ONLY while the session is actively
	// executing; otherwise the STORE selection (a queued/idle/stale session
	// must not own the card over the user's current choice).
	const activeRun = view && ['running', 'connected', 'connecting', 'reserving'].includes(view.runtimeStatus);
	const v = activeRun ? view : null;
	set('ldv-env-device', v?.device ?? sel?.device ?? '—');
	set('ldv-env-os', [v?.os ?? sel?.os, v?.osVersion ?? sel?.osVersion].filter(Boolean).join(' ') || '—');
	set('ldv-env-browser', [v?.browser ?? sel?.browser, v?.browserVersion ?? sel?.browserVersion].filter(Boolean).join(' ') || '—');
	// Secondary fields follow the same source as the device lines: while no
	// run is actively executing, the stale session's status/runtime must not
	// contradict the card's store-driven content.
	set('ldv-card-exec', (activeRun ? execLabel : null) ?? (sel ? '○ READY' : '○ NO DEVICE'));
	set('ldv-card-status', (activeRun ? liveLabel : null) ?? '○ IDLE');
	const execBadge = document.getElementById('ldv-card-exec');
	if (execBadge) execBadge.dataset.exec = (activeRun ? view?.executionType : null) ?? sel?.executionType ?? 'none';
	const statusBadge = document.getElementById('ldv-card-status');
	if (statusBadge) {
		statusBadge.dataset.exec = (activeRun ? view?.executionType : null) ?? sel?.executionType ?? 'none';
		statusBadge.dataset.live = String(activeRun && ['running', 'connected'].includes(view.runtimeStatus));
	}
	const runtimeRow = document.getElementById('ldv-env-runtime');
	if (runtimeRow) {
		runtimeRow.hidden = !(activeRun && view.runtimeSessionId);
		const idNode = document.getElementById('ldv-runtime-id');
		if (idNode) idNode.textContent = activeRun ? view?.runtimeSessionId ?? '' : '';
	}
}

/* Browser chrome above the live screen — identity of the EXECUTING browser. */
function renderBrowserChrome(view) {
	const bar = document.getElementById('browser-chrome');
	if (!bar) return;
	if (view.source === 'none' || view.executionType === 'none') { bar.hidden = true; return; }
	const vm = chromeViewModel({ browserKey: view.browserKey, url: el.browserUrl?.textContent, title: el.browserTitle?.textContent });
	bar.hidden = false;
	const dot = document.getElementById('chrome-brand-dot');
	if (dot) dot.style.background = vm.brand.color;
	const brand = document.getElementById('chrome-brand');
	if (brand) { brand.textContent = vm.brand.name; brand.style.color = vm.brand.color; }
	const lock = document.getElementById('chrome-lock');
	if (lock) lock.textContent = vm.secure ? '🔒' : '⚠';
	const url = document.getElementById('chrome-url');
	if (url) { url.textContent = vm.url || 'about:blank'; url.title = vm.fullUrl || ''; }
}

/* Device frame category: phone / tablet / desktop on #stage. */
function applyDeviceFrame(view) {
	if (!el.stage) return;
	if (view.source === 'none') {
		el.stage.removeAttribute('data-device-kind');
		el.stage.removeAttribute('data-device-label');
		el.stage.removeAttribute('data-device-orientation');
		return;
	}
	el.stage.setAttribute('data-device-kind', view.deviceType);
	el.stage.setAttribute('data-device-label', view.device);
	el.stage.setAttribute('data-device-orientation', view.orientation);
	el.stage.setAttribute('data-browser-key', view.browserKey);
	if (view.resolution) {
		el.stage.style.setProperty('--ldv-res-w', String(view.resolution.width));
		el.stage.style.setProperty('--ldv-res-h', String(view.resolution.height));
		const ratio = view.orientation === 'landscape'
			? view.resolution.width / view.resolution.height
			: view.resolution.height / view.resolution.width;
		el.stage.style.setProperty('--ldv-aspect', String(Math.min(Math.max(ratio, 0.4), 3.2)));
	} else {
		el.stage.style.removeProperty('--ldv-aspect');
	}
}

/**
 * Execution log targeting: a pinned block at the top of the transcript that
 * names the EXACT environment under test (from the single view-model), the
 * honest execution level, the runtime id, and the final result on completion.
 */
function renderExecutionTargeting(session) {
	const host = document.getElementById('execution-target-block');
	if (!host) return;
	const view = state.activeRuntimeEnvironment;
	if (!view || view.source === 'none') { host.hidden = true; host.replaceChildren(); return; }
	host.hidden = false;
	host.replaceChildren();

	const block = document.createElement('div');
	block.className = `exec-target exec-target--${view.runtimeStatus}`;

	const head = document.createElement('div');
	head.className = 'exec-target-head';
	head.textContent = 'TARGET';
	block.append(head);

	const envLine = document.createElement('div');
	envLine.className = 'exec-target-env';
	envLine.textContent = [
		view.device,
		[view.os, view.osVersion].filter(Boolean).join(' '),
		[view.browser, view.browserVersion].filter(Boolean).join(' ')
	].filter(Boolean).join(' · ');
	block.append(envLine);

	const metaLine = document.createElement('div');
	metaLine.className = 'exec-target-meta';
	const execLabelMap = { real_device: 'REAL DEVICE', virtual_device: 'VIRTUAL DEVICE', simulated: 'SIMULATED', none: 'NO DEVICE' };
	metaLine.textContent = ['EXECUTION', execLabelMap[view.executionType] ?? view.executionType.toUpperCase(), 'RUNTIME', view.runtimeSessionId ?? '—'].join('  ');
	block.append(metaLine);

	const status = view.runtimeStatus;
	if (['running', 'connected'].includes(status)) {
		const testing = document.createElement('div');
		testing.className = 'exec-target-testing';
		testing.textContent = `TESTING — ${view.device} · ${[view.browser, view.browserVersion].filter(Boolean).join(' ')}`;
		block.append(testing);
	} else if (status === 'completed') {
		const done = document.createElement('div');
		done.className = 'exec-target-done';
		const verdict = String(session?.report?.verdict ?? session?.verdict ?? '').toUpperCase();
		done.textContent = `TEST COMPLETED — ${view.device} · ${[view.os, view.osVersion].filter(Boolean).join(' ')} · ${[view.browser, view.browserVersion].filter(Boolean).join(' ')}` + (verdict ? ` — Result: ${verdict}` : '');
		block.append(done);
	} else if (status === 'failed') {
		const failed = document.createElement('div');
		failed.className = 'exec-target-failed';
		failed.textContent = 'TEST FAILED — runtime reported an error for this environment.';
		block.append(failed);
	}

	host.append(block);
}

/* Unavailable state: honest error panel, never a fake preview. */
function renderUnavailableState(view, execLabel) {	const panel = document.getElementById('ldv-unavailable');
	if (!panel) return;
	if (view.runtimeStatus !== 'device_unavailable') { panel.hidden = true; return; }
	panel.hidden = false;
	const env = document.getElementById('ldv-unavailable-env');
	if (env) env.textContent = [view.device, [view.os, view.osVersion].filter(Boolean).join(' '), [view.browser, view.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
	const reason = document.getElementById('ldv-unavailable-reason');
	if (reason) reason.textContent = 'Reason: Runtime unavailable for this device/browser combination.';
	const retry = document.getElementById('ldv-retry');
	if (retry) retry.onclick = () => { panel.hidden = true; if (state.sessionId) void startRun(); };
	const change = document.getElementById('ldv-change-env');
	if (change) change.onclick = () => { panel.hidden = true; devicePicker?.open?.(); };
}

function applySessionSnapshot(session) {
	const changedSession = state.session?.id !== session.id;
	state.bubbles.clear();
	state.session = session;
	// Refresh the clock-skew sample on every snapshot (load, resync, refresh).
	noteServerNow(session.serverNow);
	applyStageDevice(session);

	renderHeader();
	// The collapse preference is UI state — reapply it on every run switch so
	// navigating between runs never unexpectedly expands/collapses the panel.
	setRunSummaryCollapsed(state.runSummaryCollapsed);
	renderTranscript();
	renderExecutionTargeting(session);
	resetThinking();
	renderQuestion();
	renderActivities();
	renderTodos();
	renderFindings();
	renderReport();
	syncSqaDetailMode(changedSession);
	renderSqa();
	renderFounder();
	showCompletedFounderReport();
	updateRunTimer();
	if (_runEnvHook) _runEnvHook(session);
	// Recompute the single source of truth BEFORE anything renders from it.
	state.activeRuntimeEnvironment = resolveActiveRuntimeEnvironment({
		session,
		environments: deviceState.list
	});
	renderLiveDeviceViewHeader(session, state.activeRuntimeEnvironment);
	renderExecutionTargeting(session);

	if (session.frame) {
		applyFrame(session.frame);
	} else if (
		// Completion persistence (AC8): a run that finished with frames keeps
		// its final captured view + environment until a NEW run starts. Only a
		// genuinely frameless run shows the empty state.
		['done', 'error', 'interrupted', 'cancelled'].includes(String(session.status)) &&
		el.frame.getAttribute('src') &&
		state.sessionId === session.id
	) {
		// Keep the last frame on screen — badge already reads COMPLETED/FAILED.
	} else {
		el.frame.removeAttribute('src');
		el.stageInner.hidden = true;
		el.stageEmpty.hidden = false;
		el.browserUrl.textContent = session.targetUrl ?? 'about:blank';
		el.browserTitle.textContent = '';
	}

}

async function startRun() { openQaStart(); }

async function createQaRun({ targetUrl, device, deviceLandscape, environmentId }) {
	const session = await api('/sessions', { method: 'POST', body: JSON.stringify({
		device, deviceLandscape, ...(environmentId ? { environmentId } : {})
	}) });
	await selectSession(session.id);
	if (targetUrl) {
		await api(`/sessions/${session.id}/message`, { method: 'POST', body: JSON.stringify({ text: targetUrl }) }).catch(fail);
	}
	el.composerInput.focus();
	return session;
}

/** Compact token count: 820, 15.3k, 2.01M, 3.4B. Re-exported for callers importing from app.js. */
export { formatTokens };

/* ── One-click environment runs with honest fallbacks (Phase 23) ─── */
const runtimeBoardCache = { devices: [], at: 0 };
const RUNTIME_BOARD_TTL = 5000;

async function fetchRuntimeBoard(force = false) {
	if (!force && Date.now() - runtimeBoardCache.at < RUNTIME_BOARD_TTL) return runtimeBoardCache.devices;
	const payload = await api('/device-runtime/devices').catch(() => null);
	runtimeBoardCache.devices = payload?.devices ?? [];
	runtimeBoardCache.at = Date.now();
	return runtimeBoardCache.devices;
}

/**
 * Start a run on an environment. The UI never pre-creates a device session
 * for the direct path — the run engine (agent runTurn → deviceRuntime
 * .selectForRun) creates, labels and releases the session itself, linked to
 * the run. The UI's job is honest routing:
 *   - requested level attainable + device free → start the run directly;
 *   - otherwise → explicit fallback dialog (queue / virtualized / simulated),
 *     never a silent downgrade.
 */
async function startEnvironmentRun(env, { targetUrl = '' } = {}) {
	const devices = await fetchRuntimeBoard(true);
	const boardEntry = devices.find((d) => d.envId === env.envId) ?? null;
	const requestedLevel = boardEntry?.maximumLevel === 'REAL_DEVICE' ? 'REAL_DEVICE' : 'SIMULATED';
	const resolution = fallbackOptionsFor(boardEntry, requestedLevel);
	if (resolution.available) {
		// Guard against double-clicks: reuse an existing idle run on this
		// environment instead of piling up duplicates.
		const existing = await api('/sessions?limit=20').catch(() => []);
		const recent = (Array.isArray(existing) ? existing : [])
			.find((run) => run.environmentId === env.envId && run.status === 'idle');
		if (recent) {
			await selectSession(recent.id);
			toast(`${env.device} run is already waiting — send a URL to start testing.`);
			return;
		}
		await createQaRun({ targetUrl, environmentId: env.envId });
		toast(targetUrl
			? `Testing on ${env.device}…`
			: `${env.device} is ready — send a URL to start testing.`);
		return;
	}
	openExecFallback(env, boardEntry, requestedLevel, targetUrl);
}

/* Fallback dialog: REAL DEVICE UNAVAILABLE + honest reason; the user must
 * explicitly pick a fallback (queue / virtual / simulated) — never a silent
 * downgrade. Retry re-checks availability; "Choose another device" opens the
 * Device & Environment Matrix. */
let fallbackCtx = null;
function openExecFallback(env, boardEntry, requestedLevel, targetUrl) {
	const dialog = $('exec-fallback');
	if (!dialog) { fail(new Error('No runtime provider available for this environment.')); return; }
	fallbackCtx = { env, targetUrl, requestedLevel };
	const resolution = fallbackOptionsFor(boardEntry, requestedLevel);
	// Busy devices get a dedicated DEVICE BUSY modal — never an auto-switch.
	if (resolution.busy) {
		openDeviceBusyModal(env, resolution, requestedLevel);
		return;
	}
	$('exec-fallback-reason').textContent = `${resolution.reason} Choose how to proceed — every result is labeled with the execution type actually used.`;
	const list = $('exec-fallback-options');
	list.innerHTML = '';
	for (const option of resolution.options) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'exec-fallback-option';
		btn.innerHTML = `<strong></strong><small></small>`;
		btn.querySelector('strong').textContent = option.label;
		btn.querySelector('small').textContent = option.description;
		btn.onclick = () => { void applyFallback(option); };
		list.append(btn);
	}
	const retry = $('exec-fallback-retry');
	if (retry) {
		retry.onclick = async () => {
			retry.disabled = true;
			retry.textContent = 'Checking…';
			const devices = await fetchRuntimeBoard(true).catch(() => []);
			const fresh = devices.find((d) => d.envId === env.envId) ?? null;
			retry.disabled = false;
			retry.textContent = 'Retry';
			const again = fallbackOptionsFor(fresh, requestedLevel);
			if (again.available) {
				dialog.close();
				fallbackCtx = null;
				await startEnvironmentRun(env, { targetUrl });
			} else {
				$('exec-fallback-reason').textContent = `${again.reason} Choose how to proceed — every result is labeled with the execution type actually used.`;
			}
		};
	}
	const change = $('exec-fallback-change');
	if (change) {
		change.onclick = () => {
			dialog.close();
			fallbackCtx = null;
			deviceMatrix?.open();
		};
	}
	dialog.showModal();
}

/* DEVICE BUSY modal: shows the current runtime session and offers Queue /
 * Choose another device. Never moves the test automatically. */
function openDeviceBusyModal(env, resolution, requestedLevel) {
	const dialog = $('device-busy');
	if (!dialog) { openExecFallbackPlain(env, resolution, requestedLevel); return; }
	$('device-busy-detail').textContent = `${env.device ?? env.envId} — current session: ${resolution.busySessionId ?? 'unknown'}. New runs wait in queue.`;
	const list = $('device-busy-options');
	list.innerHTML = '';
	for (const option of resolution.options) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'exec-fallback-option';
		btn.innerHTML = `<strong></strong><small></small>`;
		btn.querySelector('strong').textContent = option.label;
		btn.querySelector('small').textContent = option.description;
		btn.onclick = () => { dialog.close(); void applyFallback(option); };
		list.append(btn);
	}
	const change = document.createElement('button');
	change.type = 'button';
	change.className = 'exec-fallback-option';
	change.innerHTML = `<strong>Choose another device</strong><small>Open the Device &amp; Environment Matrix and pick a free device.</small>`;
	change.onclick = () => { dialog.close(); deviceMatrix?.open(); };
	list.append(change);
	dialog.showModal();
}

/* Rare path: no busy dialog element — reuse the generic fallback dialog. */
function openExecFallbackPlain(env, resolution, requestedLevel) {
	$('exec-fallback-reason').textContent = `${resolution.reason} Choose how to proceed — every result is labeled with the execution type actually used.`;
	$('exec-fallback').showModal();
}

async function applyFallback(option) {
	$('exec-fallback')?.close();
	const ctx = fallbackCtx;
	fallbackCtx = null;
	if (!ctx) return;
	const { env, targetUrl } = ctx;
	if (option.action === 'queue') {
		// Explicit user choice to wait: reserve a queued slot now; when the
		// device frees up, the queued session auto-starts and we launch the
		// run against it (the engine creates its own labeled session).
		const result = await api('/device-runtime/sessions', { method: 'POST', body: JSON.stringify({
			environmentId: env.envId, requestedLevel: option.level, allowQueue: true
		}) }).catch(fail);
		if (result?.session) {
			trackQueuePanel(result.session, { env, targetUrl });
			toast('Queued — the run starts automatically when the device frees up.');
		}
		return;
	}
	// Explicit downgrade chosen by the user — recorded on the environment so
	// the run reports the level it actually runs at (env service validates).
	await api(`/environments/${encodeURIComponent(env.envId)}`, {
		method: 'PATCH',
		body: JSON.stringify({ executionLevelRequested: option.level })
	}).catch(() => { /* runTurn falls back to honest default labeling */ });
	await createQaRun({ targetUrl, environmentId: env.envId });
	toast(`Running ${option.label.toLowerCase()} — results will be labeled accordingly.`);
}

/* Queue panel: live position while a device session is queued. */
const queuePanelState = { sessionId: null, timer: null, launched: false };
function trackQueuePanel(session, runCtx = null) {
	if (!session?.sessionId) return;
	queuePanelState.sessionId = session.sessionId;
	queuePanelState.launchCtx = runCtx;
	queuePanelState.launched = false;
	const panel = $('run-queue-panel');
	if (!panel) return;
	panel.hidden = false;
	$('run-summary').hidden = false;
	$('run-queue-detail').textContent = session.environment?.device ? `on ${session.environment.device}` : session.envId ?? '';
	pollQueuePanel();
	clearInterval(queuePanelState.timer);
	queuePanelState.timer = setInterval(pollQueuePanel, 4000);
}

async function pollQueuePanel() {
	if (!queuePanelState.sessionId) return hideQueuePanel();
	const session = await api(`/device-runtime/sessions/${encodeURIComponent(queuePanelState.sessionId)}`).catch(() => null);
	if (!session || ['done', 'failed', 'cancelled'].includes(session.status)) return hideQueuePanel();
	const label = $('run-queue-label');
	if (label) label.textContent = describeQueue(session) ?? 'Queued for device';
	// Promoted from queued → running: the device is ours now — launch the run.
	if (session.status === 'running' && !queuePanelState.launched) {
		queuePanelState.launched = true;
		const ctx = queuePanelState.launchCtx;
		hideQueuePanel();
		if (ctx?.env) {
			await createQaRun({ targetUrl: ctx.targetUrl ?? '', environmentId: ctx.env.envId });
			toast(`Device free — testing on ${ctx.env.device}.`);
		}
	}
}

function hideQueuePanel() {
	clearInterval(queuePanelState.timer);
	queuePanelState.timer = null;
	queuePanelState.sessionId = null;
	$('run-queue-panel').hidden = true;
}

$('run-queue-cancel')?.addEventListener('click', async () => {
	if (!queuePanelState.sessionId) return hideQueuePanel();
	const result = await api(`/device-runtime/sessions/${encodeURIComponent(queuePanelState.sessionId)}/cancel`, { method: 'POST' }).catch(fail);
	hideQueuePanel();
	toast(result?.cancelled ? 'Queued session cancelled.' : 'Cancel not possible — the run already started.');
});



/** A run with no counted usage yet: show a pending state, never a fake 0. */
function usageIsPending(session) {
	const usage = session.tokenUsage;
	const hasUsage = usage && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0;
	return !hasUsage && session.status === 'running';
}

/**
 * Collapsed/expanded state for the run-summary section. UI preference, not run
 * state: survives run navigation and the RUNNING→DONE transition, stored in the
 * same localStorage the other UI prefs (device, session) already use.
 */
const RUN_SUMMARY_COLLAPSED_KEY = 'qase.runSummaryCollapsed';
state.runSummaryCollapsed = localStorage.getItem(RUN_SUMMARY_COLLAPSED_KEY) === '1';

function setRunSummaryCollapsed(collapsed) {
	state.runSummaryCollapsed = collapsed;
	localStorage.setItem(RUN_SUMMARY_COLLAPSED_KEY, collapsed ? '1' : '0');
	el.runSummary.classList.toggle('is-collapsed', collapsed);
	el.runSummaryMini.hidden = !collapsed;
	el.runSummaryToggle.setAttribute('aria-expanded', String(!collapsed));
	el.runSummaryToggle.textContent = collapsed ? '⌄' : '⌃';
	el.runSummaryToggle.title = collapsed ? 'Expand run summary' : 'Collapse run summary';
}

/**
 * Compact mirror of the run summary for the collapsed state. Reads the exact
 * same session state the expanded card reads (no extra fetching, no
 * recalculation) so live updates keep flowing while minimized.
 */
function renderMiniSummary() {
	const session = state.session;
	const usage = session?.tokenUsage;
	const mini = miniSummaryText({
		usage,
		status: session?.status,
		progress: runProgress(),
		findings: session?.findings?.length ?? 0,
	});
	el.miniTokens.textContent = mini.tokens;
	el.miniStatus.textContent = mini.status;
	el.miniStatus.dataset.status = session?.status ?? '';
	el.miniProgress.textContent = mini.progress;
	el.miniFindings.textContent = mini.findings;
}

function renderHeader() {
	const session = state.session;
	const usage = session.tokenUsage;
	const context = session.contextUsage;
	// Token row: dedicated region below the header.
	const hasRun = Boolean(session.targetUrl || session.title);
	el.runSummary.hidden = !hasRun;
	if (usageIsPending(session)) {
		// Live run, first model call still in flight. "Pending" is honest;
		// "0 in · 0 out" would suggest calls were counted and came back empty.
		el.tokenText.classList.add('is-pending');
		el.tokenText.textContent = '-- in · -- out';
		el.tokenText.title = 'Token usage pending — waiting for the first model call to complete.';
	} else {
		const text = tokenSummaryText(usage)
			?? (context && Number.isFinite(context.percentage) && context.percentage > 0
				? `${Math.round(context.percentage)}% ctx` : undefined);
		el.tokenText.classList.remove('is-pending');
		el.tokenText.textContent = text ?? '';
		if (usage && text) {
			const percentage = context && Number.isFinite(context.percentage) && context.percentage > 0
				? Math.round(context.percentage) : undefined;
			el.tokenText.title = `${(usage.inputTokens ?? 0).toLocaleString()} prompt / ${(usage.outputTokens ?? 0).toLocaleString()} completion tokens`
				+ (usage.estimated === true ? ' (estimated)' : '')
				+ (percentage !== undefined ? ` · context ${percentage}% of window` : '');
		} else if (text) {
			el.tokenText.title = `model context window ${text.replace(' ctx', '')} used`;
		} else {
			el.tokenText.title = '';
		}
	}
	// LIVE pill: only while the run is actively working.
	el.livePill.hidden = session.status !== 'running';
	renderMiniSummary();
	renderProgressCard();
	if (session.mode === 'founder') {
		const target = session.founder?.scope?.target ?? session.founder?.report?.target ?? {};
		const context = session.founder?.scope?.productContext ?? {};
		el.chatTitle.textContent = target.name ?? session.title ?? 'Founder review';
		el.chatTarget.textContent = [context.stage, context.businessModel, target.environment].filter(Boolean).join(' · ')
			|| 'Evidence-informed product and go-to-market review';
		setStatus(session.status);
		return;
	}
	if (session.mode === 'sqa') {
		const target = session.sqa?.scope?.target ?? session.sqa?.assessment?.target ?? {};
		el.chatTitle.textContent = target.name ?? session.title ?? 'SQA assessment';
		el.chatTarget.textContent = [target.release, target.environment].filter(Boolean).join(' · ')
			|| 'Standards-informed software quality assessment';
		setStatus(session.status);
		return;
	}
	el.chatTitle.textContent = session.targetUrl ? hostOf(session.targetUrl) : session.title;
	el.chatTarget.textContent = session.targetUrl ?? 'Send a URL to begin';
	setStatus(session.status);
}

/**
 * Step counts for the progress card. Same computation renderTodos() feeds the
 * right-hand Plan tab, kept here once so the two can never disagree.
 */
function runProgress() {
	const todos = state.session?.todos ?? [];
	const total = todos.length;
	const done = todos.filter(todo => todo.status === 'completed').length;
	const percent = total > 0 ? Math.round((done / total) * 100) : undefined;
	return { total, done, percent };
}

/**
 * The RUNNING/DONE card: status + step count + percent + findings on the top
 * row, the progress bar on its own row, and the current activity below it —
 * all normal flow, no absolute positioning.
 */
function renderProgressCard() {
	const session = state.session;
	const { total, done, percent } = runProgress();
	el.progressSteps.textContent = total > 0 ? `${done}/${total}` : '';
	el.progressPct.textContent = percent !== undefined ? `${percent}%` : '';
	if (percent !== undefined) {
		el.progressBar.setAttribute('aria-valuenow', String(percent));
		el.progressBar.firstElementChild.style.width = `${percent}%`;
	} else {
		el.progressBar.setAttribute('aria-valuenow', '0');
		el.progressBar.firstElementChild.style.width = '0%';
	}
	const findings = session?.findings ?? [];
	el.progressFindings.textContent = findings.length > 0 ? `Findings ${findings.length}` : '';
	renderMiniSummary();
	renderCurrentActivity();
}

function renderCurrentActivity() {
	const session = state.session;
	if (session?.status === 'running') {
		const { text, action } = state.thinking;
		const label = action || (text ? tailOf(text) : '');
		el.currentActivityState.textContent = label ? `◌ ${label}` : '◌ Working…';
		el.currentActivity.hidden = false;
	} else if (session?.status === 'done') {
		el.currentActivityState.textContent = '✓ Run completed';
		el.currentActivity.hidden = false;
	} else {
		el.currentActivityState.textContent = '';
		el.currentActivity.hidden = true;
	}
}

function setStatus(status) {
	el.statusChip.dataset.status = status;
	el.statusChip.textContent = status === 'awaiting_input'
		? 'waiting for you'
		: status === 'done' ? 'done ✓' : status;
	renderMiniSummary();
	const running = status === 'running';
	el.stopRun.hidden = !running;
	el.sendBtn.disabled = running;
	el.livePill.hidden = !running;
	el.browserDot.className = `dot${running ? ' is-busy' : state.session?.targetUrl ? ' is-live' : ''}`;
	if (state.session) {
		state.session.status = status;
	}
	// A question raised while the tab is in the background should be noticeable.
	document.title = status === 'awaiting_input'
		? 'Qase — waiting for you'
		: 'Qase — autonomous QA agent';
	updateRunTimer();
	updateThinkingStrip();
}

/* ── Test Execution Timer ────────────────────────────────────────── */

function formatClock(totalSeconds) {
	if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00:00';
	const seconds = Math.floor(totalSeconds);
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	return [h, m, s].map(part => String(part).padStart(2, '0')).join(':');
}

/** Human short form, e.g. "12m 18s" — used in run lists. */
function formatDurationShort(totalSeconds) {
	if (!Number.isFinite(totalSeconds)) return '';
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatTimeOfDay(epochMs) {
	if (!Number.isFinite(epochMs)) return '';
	return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

/** Record a server clock sample so elapsed math corrects local clock skew. */
function noteServerNow(serverNow) {
	if (Number.isFinite(serverNow) && serverNow > 0) {
		state.timer.skew = serverNow - Date.now();
	}
}

function serverNowNow() {
	return Date.now() + state.timer.skew;
}

/** Live elapsed seconds for a session-like object with server timing fields. */
function elapsedSecondsOf(session, now = serverNowNow()) {
	if (!Number.isFinite(session?.startedAt)) return undefined;
	const end = Number.isFinite(session.completedAt) ? session.completedAt : now;
	return Math.max(0, Math.floor((end - session.startedAt) / 1000));
}

const TIMER_LABELS = {
	running: 'Elapsed',
	awaiting_input: 'Elapsed (paused for input)',
	done: 'Total Duration',
	error: 'Duration Until Failure',
	interrupted: 'Duration Until Failure',
	idle: 'Duration'
};

/**
 * Render the header timer for the current session and keep it ticking.
 * Stamps come only from the server (snapshot fields or SSE status timing);
 * the interval merely re-renders elapsed time between updates.
 */
function updateRunTimer() {
	const session = state.session;
	if (!session || !Number.isFinite(session.startedAt)) {
		el.runTimer.hidden = true;
		return;
	}
	el.runTimer.hidden = false;
	const terminal = ['done', 'error', 'interrupted'].includes(session.status)
		|| Number.isFinite(session.completedAt);
	const label = TIMER_LABELS[session.status] ?? 'Elapsed';
	el.runTimerLabel.textContent = session.cancelledAt ? 'Duration (cancelled)' : label;
	el.runTimerLabel.dataset.state = session.status;
	if (session.status === 'done') {
		el.runTimer.dataset.state = 'completed';
		el.runTimerLabel.textContent = '✓ Test Completed';
	} else if (session.status === 'error' || session.status === 'interrupted') {
		el.runTimer.dataset.state = 'failed';
		el.runTimerLabel.textContent = '⚠ Test Execution Failed';
	} else if (session.cancelledAt) {
		el.runTimer.dataset.state = 'cancelled';
		el.runTimerLabel.textContent = 'Test Cancelled';
	} else if (session.status === 'awaiting_input') {
		el.runTimer.dataset.state = 'paused';
		el.runTimerLabel.textContent = '⏸ Paused (awaiting input)';
	} else if (session.status === 'running') {
		el.runTimer.dataset.state = 'running';
		el.runTimerLabel.textContent = '● Testing';
	}
	const seconds = elapsedSecondsOf(session);
	el.runTimerClock.textContent = formatClock(seconds);
	if (terminal || session.status === 'awaiting_input') {
		// Terminal or paused-on-question states don't need a second hand;
		// show the completed stamp too.
		el.runTimer.title = Number.isFinite(session.completedAt)
			? `Test Completed: ${formatTimeOfDay(session.completedAt)}`
			: Number.isFinite(session.startedAt)
				? `Test Started: ${formatTimeOfDay(session.startedAt)}`
				: '';
	} else {
		el.runTimer.title = `Test Started: ${formatTimeOfDay(session.startedAt)}`;
	}
}

function startTimerInterval() {
	if (state.timer.interval !== undefined) return;
	state.timer.interval = setInterval(() => {
		const session = state.session;
		if (!session || el.runTimer.hidden) return;
		// Re-render only while a live run can advance the clock.
		if (session.status === 'running' && !Number.isFinite(session.completedAt)) {
			el.runTimerClock.textContent = formatClock(elapsedSecondsOf(session));
		}
		// Keep the runs list's live per-row elapsed times ticking too.
		if (state.runLiveTimers?.size) {
			for (const [runId, node] of state.runLiveTimers) {
				const run = runId === session?.id ? session : undefined;
				if (run && run.status === 'running') {
					node.textContent = `⏱ ${formatDurationShort(elapsedSecondsOf(run))}`;
				}
			}
		}
	}, 1000);
}

/* ── Performance analytics & run-time comparison ─────────────────── */

function perfRow(label, value) {
	const dt = document.createElement('dt');
	dt.textContent = label;
	const dd = document.createElement('dd');
	dd.textContent = value ?? '—';
	return [dt, dd];
}

/**
 * Render the Performance panel from the analytics API. Shows real aggregates
 * only; when there are no completed runs the panel stays hidden.
 */
async function refreshPerformance() {
	const aggregate = await api('/analytics/durations').catch(() => undefined);
	if (!aggregate || !aggregate.runCount) {
		el.perfPanel.hidden = true;
		return;
	}
	el.perfPanel.hidden = false;
	el.perfGrid.replaceChildren(
		...perfRow('Completed runs', String(aggregate.runCount)),
		...perfRow('Average execution', formatDurationShort(aggregate.avgDurationSeconds)),
		...perfRow('Median execution', formatDurationShort(aggregate.medianDurationSeconds)),
		...perfRow('Fastest run', formatDurationShort(aggregate.minDurationSeconds)),
		...perfRow('Slowest run', formatDurationShort(aggregate.maxDurationSeconds)),
		...perfRow('Avg / test item', aggregate.avgSecondsPerItem !== undefined
			? `${aggregate.avgSecondsPerItem.toFixed(1)}s`
			: undefined)
	);
	// Same-target comparison for the currently selected run's target.
	const session = state.session;
	if (!session?.targetUrl || typeof session.targetUrl !== 'string') {
		el.perfCompare.hidden = true;
		return;
	}
	const history = await api(`/analytics/targets/durations?targetUrl=${encodeURIComponent(session.targetUrl)}`)
		.catch(() => []);
	if (!Array.isArray(history) || history.length < 2) {
		el.perfCompare.hidden = true;
		return;
	}
	el.perfCompare.hidden = false;
	el.perfCompareTitle.textContent = `${hostOf(session.targetUrl)} — run comparison`;
	const items = history.map((entry, index) => {
		const li = document.createElement('li');
		const trend = index === 0 ? '' : (
			entry.durationSeconds < history[index - 1].durationSeconds ? ' ▼ faster'
				: entry.durationSeconds > history[index - 1].durationSeconds ? ' ▲ slower'
					: ' → stable');
		li.textContent = `Run #${index + 1} · ${formatDurationShort(entry.durationSeconds)}${trend}`;
		if (entry.id === session.id) li.classList.add('is-current');
		return li;
	});
	el.perfCompareList.replaceChildren(...items);
}

/* ── Transcript ──────────────────────────────────────────────────── */

function renderTranscript() {
	// Keep the execution-target host alive across renders — only messages
	// are replaced. (replaceChildren would destroy the pinned block.)
	const targetHost = document.getElementById('execution-target-block');
	const children = targetHost ? [targetHost] : [];
	el.transcript.replaceChildren(...children);
	const messages = state.session.messages ?? [];
	if (messages.length === 0) {
		el.transcript.append(el.chatEmpty);
		el.chatEmpty.hidden = false;
		return;
	}
	el.chatEmpty.hidden = true;
	// Reasoning is live-only; anything stored by an earlier version is dropped.
	for (const message of messages.filter(entry => entry.role !== 'thinking')) {
		el.transcript.append(renderMessage(message));
	}
	requestAnimationFrame(() => {
		el.transcript.scrollTop = el.transcript.scrollHeight;
	});
}

function renderMessage(message) {
	const node = document.createElement('div');
	node.className = `msg ${message.role}${message.kind ? ` ${message.kind}` : ''}`;
	node.dataset.id = message.id;

	const role = document.createElement('div');
	role.className = 'msg-role';
	role.textContent = message.role === 'agent' ? 'Qase' : message.role === 'user' ? 'You' : 'System';

	const body = document.createElement('div');
	body.className = message.role === 'agent' ? 'msg-body md' : 'msg-body';
	if (message.role === 'agent') {
		body.innerHTML = markdown(message.text);
	} else {
		body.textContent = message.text;
	}

	node.append(role, body);
	state.bubbles.set(message.id, { node, body, text: message.text });
	return node;
}

/* ── Thinking strip ──────────────────────────────────────────────── */

/**
 * Shows what the agent is doing right now, directly above the composer, and
 * gets out of the way as soon as it has something to say. Reasoning text is
 * shown when the provider streams any; otherwise the current action stands in,
 * so the strip is never a spinner with nothing behind it.
 */
function updateThinkingStrip() {
	const running = state.session?.status === 'running';
	const { text, action } = state.thinking;

	if (!running) {
		el.thinkingStrip.hidden = true;
		el.thinkingStrip.classList.remove('is-open', 'has-detail');
		el.thinkingHead.setAttribute('aria-expanded', 'false');
		return;
	}

	el.thinkingStrip.hidden = false;
	el.thinkingLabel.textContent = text ? 'Thinking' : 'Working';
	el.thinkingPeek.textContent = text ? tailOf(text) : action;

	// Only reasoning is worth expanding; a one-line action is already complete.
	const hasDetail = Boolean(text);
	el.thinkingStrip.classList.toggle('has-detail', hasDetail);
	el.thinkingCaret.hidden = !hasDetail;
	if (hasDetail) {
		el.thinkingBody.textContent = text;
		if (el.thinkingStrip.classList.contains('is-open')) {
			el.thinkingBody.scrollTop = el.thinkingBody.scrollHeight;
		}
	} else {
		el.thinkingStrip.classList.remove('is-open');
	}
	el.thinkingHead.setAttribute('aria-expanded', String(el.thinkingStrip.classList.contains('is-open')));
}

/** Clears the live reasoning — called when the agent speaks or the turn ends. */
function resetThinking() {
	state.thinking = { text: '', action: '' };
	updateThinkingStrip();
}

/** The last readable fragment of a thought, for the collapsed one-line peek. */
function tailOf(text) {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length > 110 ? `…${clean.slice(-110)}` : clean;
}

/**
 * Routes a streamed chunk. Reasoning feeds the strip above the composer;
 * anything the agent actually says goes into its bubble and retires the strip.
 */
function appendDelta(id, content, role) {
	if (role === 'thinking') {
		state.thinking.text += content;
		updateThinkingStrip();
		renderCurrentActivity();
		return;
	}

	let bubble = state.bubbles.get(id);
	if (!bubble) {
		// The delta arrived before the message event; build the shell now.
		el.chatEmpty.hidden = true;
		el.transcript.append(renderMessage({ id, role: 'agent', text: '' }));
		bubble = state.bubbles.get(id);
	}

	bubble.text += content;
	bubble.body.innerHTML = markdown(bubble.text);
	resetThinking();
	scrollTranscript();
}

function scrollTranscript() {
	const nearBottom = el.transcript.scrollHeight - el.transcript.scrollTop - el.transcript.clientHeight < 160;
	if (nearBottom) {
		el.transcript.scrollTop = el.transcript.scrollHeight;
	}
}

/* ── Blocking question ───────────────────────────────────────────── */

function renderQuestion() {
	const question = state.session?.pendingQuestion;
	el.questionSlot.replaceChildren();
	if (!question) {
		return;
	}

	const card = document.createElement('div');
	card.className = 'question';

	const tag = document.createElement('span');
	tag.className = 'question-tag';
	const credentialLike = isCredentialQuestion(question);
	tag.textContent = credentialLike ? 'Credentials needed' : 'Decision needed';

	const text = document.createElement('div');
	text.className = 'question-text';
	text.textContent = question.question;

	card.append(tag, text);

	if (question.summary) {
		const summary = document.createElement('div');
		summary.className = 'question-summary';
		summary.textContent = question.summary;
		card.append(summary);
	}

	card.append(credentialLike ? credentialForm() : optionForm(question));
	el.questionSlot.append(card);
	card.querySelector('input')?.focus();
}

function optionForm(question) {
	const wrap = document.createDocumentFragment();

	if (question.options.length > 0) {
		const options = document.createElement('div');
		options.className = 'question-options';
		for (const option of question.options) {
			const button = document.createElement('button');
			button.className = 'opt';
			button.type = 'button';
			button.textContent = option.label;
			if (option.description) {
				const small = document.createElement('small');
				small.textContent = option.description;
				button.append(small);
			}
			button.onclick = () => sendAnswer(option.label);
			options.append(button);
		}
		wrap.append(options);
	}

	if (question.allowCustom) {
		const form = document.createElement('form');
		form.className = 'cred-row';
			const input = document.createElement('input');
			input.placeholder = question.placeholder ?? 'Type your own answer';
			input.setAttribute('aria-label', question.placeholder ?? 'Type your own answer');
		const submit = document.createElement('button');
		submit.className = 'btn btn-primary btn-sm';
		submit.textContent = question.customLabel ?? 'Reply';
		form.append(input, submit);
		form.onsubmit = event => {
			event.preventDefault();
			if (input.value.trim()) {
				sendAnswer(input.value.trim());
			}
		};
		wrap.append(form);
	}

	return wrap;
}

/**
 * Credentials go straight to the vault, not into the answer text. The model is
 * told the placeholder names; the values never enter its context.
 */
function credentialForm() {
	const form = document.createElement('form');
	form.className = 'cred-form';

	const row = document.createElement('div');
	row.className = 'cred-row';
	const username = document.createElement('input');
	username.placeholder = 'Username or email';
	username.setAttribute('aria-label', 'Username or email');
	username.autocomplete = 'off';
	const password = document.createElement('input');
	password.type = 'password';
	password.placeholder = 'Password';
	password.setAttribute('aria-label', 'Password');
	password.autocomplete = 'off';
	row.append(username, password);

	const extra = document.createElement('input');
	extra.placeholder = 'One-time code or extra field (optional)';
	extra.setAttribute('aria-label', 'One-time code or extra field');
	extra.autocomplete = 'off';

	const note = document.createElement('div');
	note.className = 'cred-note';
	note.innerHTML = 'Encrypted locally for this run and deleted when the run ends — never sent to the model. ' +
		'The agent fills the form with <code>{{QA_USERNAME}}</code> and <code>{{QA_PASSWORD}}</code>; the real values are swapped in at the keyboard.';

	const actions = document.createElement('div');
	actions.className = 'cred-actions';
	const skip = document.createElement('button');
	skip.type = 'button';
	skip.className = 'btn btn-ghost btn-sm';
	skip.textContent = 'Skip login';
	skip.onclick = () => sendAnswer('Continue with a public-only review. No credentials are available. Treat authenticated surfaces as not observed, do not attempt login, and do not ask for credentials again during this review.');
	const submit = document.createElement('button');
	submit.type = 'submit';
	submit.className = 'btn btn-primary btn-sm';
	submit.textContent = 'Store and continue';
	actions.append(skip, submit);

	form.append(row, extra, note, actions);
	form.onsubmit = async event => {
		event.preventDefault();
		const fields = {};
		if (username.value) fields.QA_USERNAME = username.value;
		if (password.value) fields.QA_PASSWORD = password.value;
		if (extra.value) fields.QA_OTP = extra.value;
		if (Object.keys(fields).length === 0) {
			toast('Enter a username or password first.', 'bad');
			return;
		}
		el.questionSlot.replaceChildren();
		state.session.pendingQuestion = undefined;
		try {
			await api(`/sessions/${state.sessionId}/credentials`, { method: 'POST', body: JSON.stringify({ fields }) });
			toast('Credentials stored locally. The model only sees placeholders.', 'good');
		} catch (error) {
			fail(error);
		}
	};

	return form;
}

async function sendAnswer(answer) {
	el.questionSlot.replaceChildren();
	state.session.pendingQuestion = undefined;
	await api(`/sessions/${state.sessionId}/answer`, {
		method: 'POST',
		body: JSON.stringify({ answer })
	}).catch(fail);
}

/* ── Live browser view ───────────────────────────────────────────── */

/** Keeps the screenshot and its cursor overlay on the exact same aspect box. */
function fitStageFrame() {
	const { width, height } = state.viewport;
	if (!width || !height || !el.stage.clientWidth || !el.stage.clientHeight) return;

	const styles = getComputedStyle(el.stage);
	const availableWidth = el.stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
	const availableHeight = el.stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
	const ratio = width / height;
	let frameWidth = availableWidth;
	let frameHeight = frameWidth / ratio;
	if (frameHeight > availableHeight) {
		frameHeight = availableHeight;
		frameWidth = frameHeight * ratio;
	}

	el.stageInner.style.width = `${Math.max(1, frameWidth)}px`;
	el.stageInner.style.height = `${Math.max(1, frameHeight)}px`;
}

function applyFrame(frame) {
	el.frame.src = `data:${frame.mimeType};base64,${frame.base64}`;
	el.stageEmpty.hidden = true;
	el.stageInner.hidden = false;
	if (frame.viewport) {
		state.viewport = frame.viewport;
	}
	if (frame.url) {
		el.browserUrl.textContent = frame.url;
	}
	el.browserTitle.textContent = truncate(frame.title ?? '', 40);
	requestAnimationFrame(fitStageFrame);
}

/**
 * Places the cursor over the frame. Coordinates arrive in the page's viewport
 * space, so they are scaled to however large the image is actually drawn.
 */
function applyCursor(cursor) {
	if (cursor.viewport) {
		state.viewport = cursor.viewport;
	}
	const rect = el.frame.getBoundingClientRect();
	if (!rect.width || cursor.x === undefined) {
		return;
	}
	const scale = rect.width / state.viewport.width;

	el.cursor.style.left = `${cursor.x * scale}px`;
	el.cursor.style.top = `${cursor.y * scale}px`;
	el.cursor.classList.add('is-visible');
	el.cursorLabel.textContent = cursor.label ? truncate(String(cursor.label), 34) : '';

	if (cursor.box) {
		el.targetBox.style.left = `${cursor.box.x * scale}px`;
		el.targetBox.style.top = `${cursor.box.y * scale}px`;
		el.targetBox.style.width = `${cursor.box.width * scale}px`;
		el.targetBox.style.height = `${cursor.box.height * scale}px`;
		el.targetBox.classList.add('is-visible');
	} else {
		el.targetBox.classList.remove('is-visible');
	}

	// A completed pointer action flashes, then everything fades out.
	if (cursor.verb.endsWith(':done')) {
		el.ripple.classList.remove('is-firing');
		void el.ripple.offsetWidth;
		el.ripple.classList.add('is-firing');
		clearTimeout(state.cursorTimer);
		state.cursorTimer = setTimeout(() => {
			el.cursor.classList.remove('is-visible');
			el.targetBox.classList.remove('is-visible');
		}, 1500);
	}
}

/* ── Activity, plan, findings, report ────────────────────────────── */

function renderActivities() {
	const activities = state.session.activities ?? [];
	el.activityFeed.replaceChildren();
	if (activities.length === 0) {
		el.activityFeed.innerHTML = '<div class="feed-empty">No activity yet — start a QA run to see the agent execution log.</div>';
		return;
	}
	for (const activity of activities) {
		el.activityFeed.append(renderActivity(activity));
	}
	scrollFeed(el.activityFeed);
}

function renderActivity(activity) {
	const node = document.createElement('div');
	node.className = `act ${activity.status}`;
	node.setAttribute('role', 'listitem');
	node.dataset.id = activity.id;

	const icon = document.createElement('span');
	icon.className = 'act-icon';
	icon.setAttribute('aria-hidden', 'true');
	icon.textContent = activity.status === 'running' ? '◉' : activity.status === 'failed' ? '✕' : '●';

	const main = document.createElement('div');
	main.className = 'act-main';
	const label = document.createElement('div');
	label.className = 'act-label';
	label.textContent = activity.label;
	main.append(label);

	const detail = activity.error ?? activity.summary ?? activity.detail;
	if (detail) {
		const line = document.createElement('div');
		line.className = 'act-detail';
		line.textContent = detail;
		line.title = detail;
		main.append(line);
	}

	const time = document.createElement('span');
	time.className = 'act-time';
	time.textContent = new Date(activity.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

	node.append(icon, main, time);
	return node;
}

/* Auto-scroll toggle (UI Fix Phase 1): latest activity stays visible unless
 * the user turned auto-scroll off for the session. */
const autoScrollState = { activity: true };
function feedAutoScrolls(feed) {
	return autoScrollState.activity;
}

function scrollFeed(feed) {
	if (!feedAutoScrolls(feed)) return;
	const pane = feed.parentElement;
	requestAnimationFrame(() => {
		pane.scrollTop = pane.scrollHeight;
	});
}

function upsertActivity(activity) {
	const existing = el.activityFeed.querySelector(`[data-id="${activity.id}"]`);
	const node = renderActivity(activity);
	if (existing) {
		existing.replaceWith(node);
		return;
	}
	if (el.activityFeed.querySelector('.feed-empty')) {
		el.activityFeed.replaceChildren();
	}
	el.activityFeed.append(node);
	scrollFeed(el.activityFeed);
}

function renderTodos() {
	const todos = state.session.todos ?? [];
	const done = todos.filter(todo => todo.status === 'completed').length;
	el.countPlan.textContent = todos.length > 0 ? `${done}/${todos.length}` : '';
	el.planList.replaceChildren();
	if (todos.length === 0) {
		el.planList.innerHTML = '<div class="feed-empty">No test plan generated yet — the agent writes one at the start of each run.</div>';
		return;
	}
	for (const todo of todos) {
		const node = document.createElement('div');
		node.className = `todo ${todo.status}`;
		node.setAttribute('role', 'listitem');
		const mark = document.createElement('span');
		mark.className = 'todo-mark';
		mark.textContent = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○';
		/* Status chip (UI Fix Phase 1): text label, not color-only — maps the
		 * raw todo status onto the run vocabulary. */
		const chip = document.createElement('span');
		chip.className = `todo-chip todo-chip-${todo.status ?? 'pending'}`;
		chip.textContent = { completed: 'Passed', in_progress: 'Running', failed: 'Failed', blocked: 'Blocked' }[todo.status ?? 'pending'] ?? 'Queued';
		const text = document.createElement('span');
		text.className = 'todo-text';
		text.textContent = todo.text;
		node.append(mark, chip, text);
		el.planList.append(node);
	}
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
let findingDisclosureSerial = 0;

function renderFindings() {
	const findings = state.session.findings ?? [];
	findingDisclosureSerial = 0;
	el.countFindings.textContent = findings.length > 0 ? `${findings.length}` : '';
	el.countFindings.classList.toggle('is-alert', findings.some(finding => finding.severity === 'critical'));

	el.findingsList.replaceChildren();
	if (findings.length === 0) {
		el.findingsList.innerHTML = '<div class="feed-empty">No findings yet — they appear here as the agent tests your target.</div>';
		return;
	}
	const sorted = [...findings].sort(
		(a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
	);
	for (const finding of sorted) {
		el.findingsList.append(renderFinding(finding));
	}
}

function renderFinding(finding) {
	const node = document.createElement('article');
	node.className = 'finding';
	node.dataset.sev = finding.severity;
	node.setAttribute('role', 'listitem');

	const head = document.createElement('button');
	head.className = 'finding-head';
	head.type = 'button';
	head.setAttribute('aria-expanded', 'false');
	const disclosureId = `finding-body-${++findingDisclosureSerial}`;
	head.setAttribute('aria-controls', disclosureId);
	const title = document.createElement('span');
	title.className = 'finding-title';
	title.textContent = finding.title;
	const sev = document.createElement('span');
	sev.className = 'sev';
	sev.textContent = finding.severity;
	const chevron = document.createElement('span');
	chevron.className = 'finding-chevron';
	chevron.setAttribute('aria-hidden', 'true');
	chevron.textContent = '›';
	head.append(title, sev, chevron);
	head.onclick = () => {
		const open = node.classList.toggle('is-open');
		head.setAttribute('aria-expanded', String(open));
	};

	const body = document.createElement('div');
	body.className = 'finding-body';
	body.id = disclosureId;

	const meta = document.createElement('div');
	meta.className = 'finding-meta';
	meta.textContent = [finding.category, finding.url].filter(Boolean).join(' · ');
	body.append(meta);

	if (finding.steps?.length) {
		const steps = document.createElement('ol');
		for (const step of finding.steps) {
			const item = document.createElement('li');
			item.textContent = step;
			steps.append(item);
		}
		body.append(steps);
	}

	const list = document.createElement('dl');
	for (const [term, value] of [['Expected', finding.expected], ['Actual', finding.actual]]) {
		const dt = document.createElement('dt');
		dt.textContent = term;
		const dd = document.createElement('dd');
		dd.textContent = value;
		list.append(dt, dd);
	}
	body.append(list);

	if (finding.evidence) {
		const pre = document.createElement('pre');
		pre.textContent = finding.evidence;
		body.append(pre);
	}

	const fixPrompt = buildFindingFixPrompt(finding, {
		targetUrl: state.session?.targetUrl,
		mode: state.session?.mode
	});
	const fixWrap = document.createElement('section');
	fixWrap.className = 'finding-fix-prompt';
	const fixHead = document.createElement('div');
	fixHead.className = 'finding-fix-prompt-head';
	const fixTitle = document.createElement('h4');
	fixTitle.textContent = 'Fix prompt';
	const fixHint = document.createElement('span');
	fixHint.className = 'finding-fix-prompt-hint';
	fixHint.textContent = 'Paste into your coding agent (Cursor / Claude Code / Copilot / Codex).';
	fixHead.append(fixTitle, fixHint);
	const fixText = document.createElement('pre');
	fixText.className = 'finding-fix-prompt-body';
	fixText.textContent = fixPrompt;
	fixWrap.append(fixHead, fixText);
	body.append(fixWrap);

	const actions = document.createElement('div');
	actions.className = 'finding-actions';
	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy as ticket';
	copy.onclick = async () => {
		try { await navigator.clipboard.writeText(findingAsTicket(finding)); toast('Finding copied to the clipboard.', 'good'); }
		catch { toast('Clipboard is blocked in this browser.', 'bad'); }
	};
	const copyPrompt = document.createElement('button');
	copyPrompt.className = 'btn btn-primary btn-sm finding-fix';
	copyPrompt.type = 'button';
	copyPrompt.textContent = 'Copy fix prompt';
	copyPrompt.title = 'Copies the diagnose-and-fix prompt above for one coding agent.';
	copyPrompt.onclick = async () => {
		try { await navigator.clipboard.writeText(fixPrompt); toast('Fix prompt copied.', 'good'); }
		catch { toast('Clipboard is blocked in this browser.', 'bad'); }
	};
	actions.append(copy, copyPrompt);
	body.append(actions);

	node.append(head, body);
	return node;
}

function findingAsTicket(finding) {
	return [
		`[${finding.severity.toUpperCase()}] ${finding.title}`,
		'',
		finding.url && `URL: ${finding.url}`,
		finding.category && `Area: ${finding.category}`,
		'',
		finding.steps?.length && `Steps to reproduce:\n${finding.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
		'',
		`Expected: ${finding.expected}`,
		`Actual: ${finding.actual}`,
		finding.evidence && `\nEvidence:\n${finding.evidence}`
	].filter(Boolean).join('\n');
}

const VERDICTS = {
	pass: { mark: '✓', label: 'Pass', tone: 'ok' },
	pass_with_issues: { mark: '!', label: 'Pass with issues', tone: 'warn' },
	fail: { mark: '✕', label: 'Fail', tone: 'bad' },
	blocked: { mark: '—', label: 'Blocked', tone: 'dim' }
};

/**
 * Evidence provenance (Phase 4): every artifact the run captured already
 * carries device/OS/browser/orientation/execution-level/runtime metadata in
 * its sidecar (server/artifactStore.js). Render that metadata alongside the
 * evidence so it is immediately clear which environment produced it.
 */
async function renderEvidenceSection(sessionId) {
	try {
		const payload = await api(`/sessions/${sessionId}/artifacts`);
		const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
		if (!artifacts.length || state.sessionId !== sessionId) return;
		const host = document.createElement('div');
		host.className = 'evidence-section';
		host.dataset.forSession = sessionId;
		const title = document.createElement('h3');
		title.textContent = `Evidence (${artifacts.length})`;
		host.append(title);
		for (const [index, artifact] of artifacts.entries()) {
			const card = document.createElement('div');
			card.className = 'evidence-card';
			const head = document.createElement('div');
			head.className = 'evidence-head';
			head.textContent = `Evidence #${index + 1} — ${artifact.kind ?? artifact.type ?? 'artifact'}`;
			card.append(head);
			const meta = artifact.meta ?? artifact;
			const provParts = [
				meta.evidenceHeader,
				meta.orientation ? String(meta.orientation).toUpperCase() : null,
				meta.capturedAt ? new Date(meta.capturedAt).toLocaleString() : null
			].filter(Boolean);
			const prov = document.createElement('div');
			prov.className = 'evidence-prov';
			prov.textContent = provParts.join(' · ') || 'No environment metadata recorded';
			card.append(prov);
			host.append(card);
		}
		// The report tab may have re-rendered while artifacts loaded.
		if (state.sessionId !== sessionId) return;
		el.reportView.append(host);
	} catch {
		// Artifacts endpoint unavailable — evidence section is additive; skip.
	}
}

function renderReport() {
	el.reportView.replaceChildren();
	if (state.session?.mode === 'sqa') {
		renderSqaReportTab();
		return;
	}
	if (state.session?.mode === 'founder') {
		renderFounderReportTab();
		return;
	}

	const report = state.session.report;
	if (!report) {
		el.reportView.innerHTML = '<div class="feed-empty">No report available — it is published when a run finishes.</div>';
		return;
	}

	/* Export report (UI Fix Phase 1): JSON download of the finished report —
	 * presented once, inside the Report tab workspace. */
	const exportBar = document.createElement('div');
	exportBar.className = 'report-export-bar';
	const exportBtn = document.createElement('button');
	exportBtn.type = 'button';
	exportBtn.className = 'btn btn-ghost btn-sm';
	exportBtn.textContent = 'Export report';
	exportBtn.onclick = () => {
		const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qase-report-${state.sessionId ?? 'run'}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};
	exportBar.append(exportBtn);
	el.reportView.append(exportBar);

	const verdict = VERDICTS[report.verdict] ?? { mark: '•', label: report.verdict, tone: 'dim' };
	const banner = document.createElement('div');
	banner.className = 'verdict';
	const mark = document.createElement('span');
	mark.className = `verdict-mark is-${verdict.tone}`;
	mark.textContent = verdict.mark;
	const text = document.createElement('div');
	const label = document.createElement('div');
	label.className = 'verdict-label';
	label.textContent = verdict.label;
	const sub = document.createElement('div');
	sub.className = 'verdict-sub';
	sub.textContent = `${report.findings} finding${report.findings === 1 ? '' : 's'} · ${new Date(report.ts).toLocaleString()}`;
	text.append(label, sub);
	banner.append(mark, text);
	el.reportView.append(banner);

	const stats = document.createElement('div');
	stats.className = 'sev-grid';
	for (const severity of SEVERITY_ORDER) {
		const count = report.bySeverity?.[severity] ?? 0;
		const stat = document.createElement('div');
		stat.className = `sev-stat${count === 0 ? ' is-zero' : ''}`;
		const value = document.createElement('b');
		value.textContent = count;
		const name = document.createElement('span');
		name.textContent = severity;
		stat.append(value, name);
		stats.append(stat);
	}
	el.reportView.append(stats);

	el.reportView.append(section('Summary', paragraph(report.summary)));
	if (report.covered?.length) el.reportView.append(section('Covered', list(report.covered)));
	if (report.notCovered?.length) el.reportView.append(section('Not covered', list(report.notCovered)));
	if (report.recommendations?.length) el.reportView.append(section('Recommendations', list(report.recommendations)));
	void renderEvidenceSection(state.sessionId);

	const actions = document.createElement('div');
	actions.className = 'report-actions';
	const download = document.createElement('button');
	download.className = 'btn btn-ghost btn-sm';
	download.type = 'button';
	download.textContent = 'Download .md';
	download.onclick = async () => {
		try {
			const markdownText = await apiText(`/sessions/${state.sessionId}/report.md`);
			const url = URL.createObjectURL(new Blob([markdownText], { type: 'text/markdown;charset=utf-8' }));
			const save = document.createElement('a');
			save.href = url;
			save.download = 'qase-report.md';
			document.body.append(save);
			save.click();
			save.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (error) {
			fail(error);
		}
	};
	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy report';
	copy.onclick = async () => {
		try {
			const markdownText = await apiText(`/sessions/${state.sessionId}/report.md`);
			await navigator.clipboard.writeText(markdownText);
			toast('Report copied to the clipboard.', 'good');
		} catch (error) {
			fail(error);
		}
	};
	const pdf = document.createElement('button');
	pdf.className = 'btn btn-primary btn-sm';
	pdf.type = 'button';
	pdf.textContent = 'Download PDF';
	pdf.onclick = async () => { try { await downloadReportPdf('qase-qa-report.pdf'); } catch (error) { fail(error); } };

	const findings = Array.isArray(state.session?.findings) ? state.session.findings : [];
	const copyFixes = document.createElement('button');
	copyFixes.className = 'btn btn-ghost btn-sm';
	copyFixes.type = 'button';
	copyFixes.textContent = 'Copy all fix prompts';
	copyFixes.disabled = findings.length === 0;
	copyFixes.title = findings.length === 0
		? 'No findings to generate fix prompts for.'
		: 'Copies one long markdown block containing a fix prompt for every finding.';
	copyFixes.onclick = async () => {
		const markdown = buildAllFixPromptsMarkdown(state.session);
		if (!markdown) { toast('No findings to build fix prompts from.', 'bad'); return; }
		try { await navigator.clipboard.writeText(markdown); toast('All fix prompts copied.', 'good'); }
		catch { toast('Clipboard is blocked in this browser.', 'bad'); }
	};
	const downloadFixes = document.createElement('button');
	downloadFixes.className = 'btn btn-ghost btn-sm';
	downloadFixes.type = 'button';
	downloadFixes.textContent = 'Download fix prompts (.md)';
	downloadFixes.disabled = findings.length === 0;
	downloadFixes.onclick = () => {
		const markdown = buildAllFixPromptsMarkdown(state.session);
		if (!markdown) { toast('No findings to build fix prompts from.', 'bad'); return; }
		const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
		const save = document.createElement('a');
		save.href = url;
		save.download = 'qase-fix-prompts.md';
		document.body.append(save);
		save.click();
		save.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	// The re-run control only applies to runs launched from a saved environment
	// snapshot; runs without one keep the standard download/copy actions only.
	const snapshot = state.session?.environmentSnapshot;
	if (snapshot) {
		const rerun = document.createElement('button');
		rerun.className = 'btn btn-ghost btn-sm';
		rerun.type = 'button';
		rerun.textContent = 'Re-run with same environment';
		rerun.title = `Starts a fresh run against ${snapshot.device ?? snapshot.deviceLabel} · ${snapshot.osVersion} · ${snapshot.browser} ${snapshot.browserVersion}`;
		rerun.onclick = async () => {
			const target = state.session?.targetUrl;
			if (!target) { toast('This run has no target URL to reproduce.', 'bad'); return; }
			try {
				await createQaRun({ targetUrl: target, environmentId: snapshot.envId });
				toast(`New run started on ${snapshot.envId}.`, 'good');
			} catch (error) {
				toast(error?.message ?? 'Could not start the re-run.', 'bad');
			}
		};
		actions.append(rerun);
	}

	actions.append(download, copy, copyFixes, downloadFixes, pdf);

	// Agent generation on demand: derive test cases from this completed run.
	// Idempotent — a second click never duplicates the same cases.
	if (state.sessionId && state.session.report) {
		const generate = document.createElement('button');
		generate.className = 'btn btn-ghost btn-sm';
		generate.type = 'button';
		generate.textContent = 'Generate test cases';
		generate.title = 'Ask the agent to turn this run into reusable test cases';
		generate.onclick = async () => {
			generate.disabled = true;
			generate.textContent = 'Generating…';
			try {
				const result = await api('/test-cases/generate', {
					method: 'POST',
					body: JSON.stringify({ runId: state.sessionId })
				});
				const count = Number(result?.count ?? 0);
				if (count > 0) {
					toast(`${count} test case${count === 1 ? '' : 's'} generated from this run.`, 'good');
					testCaseView?.refresh?.();
				} else if (result?.skipped === 'already-generated') {
					toast('Test cases were already generated from this run.', 'good');
				} else if (result?.skipped === 'from-test-case') {
					toast('This run came from a test case, so nothing new was generated.', 'good');
				} else if (result?.skipped === 'disabled') {
					toast('Agent generation is disabled on this deployment.', 'bad');
				} else {
					toast('Nothing to generate from this run.', 'good');
				}
			} catch (error) {
				fail(error);
			} finally {
				generate.disabled = false;
				generate.textContent = 'Generate test cases';
			}
		};
		actions.append(generate);
	}

	el.reportView.append(actions);
}

function renderSqaReportTab() {
	const sqa = state.session?.sqa ?? {};
	const assessment = sqa.assessment;
	const lifecycle = describeSqaLifecycle(sqa, state.session?.status, state.session?.activities?.length ?? 0);
	if (!lifecycle.finalized || !assessment) {
		const pending = document.createElement('div');
		pending.className = 'feed-empty';
		pending.textContent = lifecycle.detail || 'The SQA report is available after the assessment is finalized.';
		el.reportView.append(pending);
		return;
	}

	const notice = document.createElement('aside');
	notice.className = 'sqa-notice';
	const noticeTitle = document.createElement('strong');
	noticeTitle.textContent = 'SQA assessment report';
	const noticeText = document.createElement('p');
	noticeText.textContent = assessment.disclaimer
		?? 'This scoped engineering assessment is not legal advice, regulatory approval, accreditation, an audit opinion, or certification.';
	notice.append(noticeTitle, noticeText);

	el.reportView.append(notice, renderSqaVerdict(assessment, lifecycle), renderSqaScope(sqa.scope ?? {}, assessment));
	if (assessment.technicalSummary) el.reportView.append(renderSqaTechnicalSummary(assessment.technicalSummary));
	el.reportView.append(
		renderSqaCoverage(assessment),
		renderSqaUnresolved(assessment),
		renderSqaControls(assessment.results ?? []),
		renderSqaSources(assessment.frameworkCoverage ?? []),
		renderSqaReportActions()
	);
}

/* ── Event stream ────────────────────────────────────────────────── */

/* ── Software quality assurance ─────────────────────────────────────────── */

const SQA_RESULT_META = Object.freeze({
	pass: { label: 'Pass', mark: '✓' },
	fail: { label: 'Fail', mark: '×' },
	blocked: { label: 'Blocked', mark: '!' },
	not_assessed: { label: 'Not assessed', mark: '—' },
	not_applicable: { label: 'Not applicable', mark: '—' }
});

function humanizeSqaId(value) {
	return String(value ?? '')
		.replaceAll('_', ' ')
		.replace(/\b\w/g, character => character.toUpperCase());
}

function sqaValues(value) {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') return Object.values(value);
	return [];
}

function showCompletedFounderReport() {
	const session = state.session;
	if (session?.mode !== 'founder' || session.status !== 'done'
		|| !session.founder?.report || !session.founder.finalizedAt) return;
	const reportKey = `${session.id}:${session.founder.finalizedAt}`;
	if (state.shownFounderReport === reportKey) return;
	state.shownFounderReport = reportKey;
	activateDetailTab(el.reportTab);
}

function syncSqaDetailMode(selectDefault = false) {
	const isSqa = state.session?.mode === 'sqa';
	const isFounder = state.session?.mode === 'founder';
	const enteringFounder = isFounder && (el.founderTab.hidden || selectDefault);
	el.sqaTab.hidden = !isSqa;
	el.founderTab.hidden = !isFounder;
	if (isSqa && !el.sqaTab.classList.contains('is-active')) {
		activateDetailTab(el.sqaTab);
	} else if (enteringFounder) {
		activateDetailTab(el.founderTab);
	} else if ((!isSqa && el.sqaTab.classList.contains('is-active'))
		|| (!isFounder && el.founderTab.classList.contains('is-active'))) {
		activateDetailTab(el.activityTab);
	}
	syncFeatureDock();
}

function syncFeatureDock() {
	const activeMode = state.session?.mode === 'sqa' || state.session?.mode === 'founder'
		? state.session.mode
		: 'qa';
	for (const action of document.querySelectorAll('.feature-action')) {
		const active = action.dataset.feature === activeMode;
		action.classList.toggle('is-active', active);
		if (active) action.setAttribute('aria-current', 'page');
		else action.removeAttribute('aria-current');
	}
}

function renderSqa() {
	el.sqaView.replaceChildren();
	if (state.session?.mode !== 'sqa') {
		el.countSqa.textContent = '';
		return;
	}

	const sqa = state.session.sqa ?? {};
	const scope = sqa.scope ?? {};
	const assessment = sqa.assessment;
	const lifecycle = describeSqaLifecycle(sqa, state.session.status, state.session.activities?.length ?? 0);
	el.countSqa.textContent = lifecycle.badge;

	const notice = document.createElement('aside');
	notice.className = 'sqa-notice';
	const noticeTitle = document.createElement('strong');
	noticeTitle.textContent = 'Assessment boundary';
	const noticeText = document.createElement('p');
	noticeText.textContent = assessment?.disclaimer ?? scope.disclaimer
		?? 'This scoped engineering assessment is not legal advice, regulatory approval, accreditation, an audit opinion, or certification.';
	notice.append(noticeTitle, noticeText);
	el.sqaView.append(notice);

	el.sqaView.append(renderSqaVerdict(assessment, lifecycle));
	el.sqaView.append(renderSqaScope(scope, assessment));
	if (lifecycle.finalized && assessment) el.sqaView.append(renderSqaReportActions());

	if (!lifecycle.finalized && lifecycle.phase === 'ready') {
		const pending = document.createElement('div');
		pending.className = 'sqa-pending';
		const label = document.createElement('strong');
		label.textContent = 'Ready to begin';
		const text = document.createElement('p');
		text.textContent = 'Paste the target URL in the command line below and press Send. A final pass, fail, or blocked verdict appears only after the agent completes the assessment.';
		pending.append(label, text);
		el.sqaView.append(pending);
		return;
	}
	if (!assessment) return;

	if (assessment.technicalSummary) el.sqaView.append(renderSqaTechnicalSummary(assessment.technicalSummary));
	el.sqaView.append(renderSqaCoverage(assessment));
	el.sqaView.append(renderSqaUnresolved(assessment));
	el.sqaView.append(renderSqaControls(assessment.results ?? []));
	el.sqaView.append(renderSqaSources(assessment.frameworkCoverage ?? []));
}

function renderSqaReportActions() {
	const actions = document.createElement('div');
	actions.className = 'report-actions sqa-report-actions';
	actions.setAttribute('aria-label', 'SQA assessment report actions');

	const download = document.createElement('button');
	download.className = 'btn btn-ghost btn-sm';
	download.type = 'button';
	download.textContent = 'Download .md';
	download.onclick = async () => {
		try {
			const markdownText = await apiText(`/sessions/${state.sessionId}/report.md`);
			const url = URL.createObjectURL(new Blob([markdownText], { type: 'text/markdown;charset=utf-8' }));
			const save = document.createElement('a');
			save.href = url;
			save.download = 'qase-sqa-assessment.md';
			document.body.append(save);
			save.click();
			save.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (error) {
			fail(error);
		}
	};

	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy report';
	copy.onclick = async () => {
		try {
			const markdownText = await apiText(`/sessions/${state.sessionId}/report.md`);
			await navigator.clipboard.writeText(markdownText);
			toast('SQA assessment copied to the clipboard.', 'good');
		} catch (error) {
			fail(error);
		}
	};

	const pdf = document.createElement('button');
	pdf.className = 'btn btn-primary btn-sm';
	pdf.type = 'button';
	pdf.textContent = 'Download PDF';
	pdf.onclick = async () => {
		try { await downloadReportPdf('qase-sqa-assessment.pdf'); }
		catch (error) { fail(error); }
	};
	actions.append(download, copy, pdf);
	return actions;
}

function renderSqaVerdict(assessment, lifecycle) {
	const node = document.createElement('section');
	node.className = 'sqa-verdict';
	node.dataset.status = lifecycle.status;

	const mark = document.createElement('span');
	mark.className = 'sqa-verdict-mark';
	mark.setAttribute('aria-hidden', 'true');
	mark.textContent = lifecycle.mark;

	const body = document.createElement('div');
	const eyebrow = document.createElement('span');
	eyebrow.className = 'sqa-eyebrow';
	eyebrow.textContent = lifecycle.eyebrow;
	const title = document.createElement('strong');
	title.textContent = lifecycle.label;
	const detail = document.createElement('p');
	if (lifecycle.finalized && assessment) {
		if (lifecycle.evidenceIncomplete) {
			detail.textContent = `Deterministic verdict: Blocked. No control failures were recorded; ${lifecycle.evidenceGapCount} reviewer or mixed-evidence control${lifecycle.evidenceGapCount === 1 ? '' : 's'} remain incomplete.`;
		} else {
			const gates = assessment.gates ?? [];
			const passed = gates.filter(gate => gate.status === 'pass').length;
			const risk = assessment.risk?.level ? ` Residual risk: ${humanizeSqaId(assessment.risk.level)}.` : '';
			detail.textContent = `${passed}/${gates.length} decision gates passed.${risk}`;
		}
	} else if (lifecycle.phase === 'ready') {
		detail.textContent = 'The scope is saved. Testing has not started and no final verdict exists yet.';
	} else if (lifecycle.phase === 'waiting') {
		detail.textContent = 'Answer the agent\'s question to continue collecting assessment evidence.';
	} else {
		detail.textContent = 'Evidence collection is underway. Current control results remain provisional.';
	}
	body.append(eyebrow, title, detail);

	const id = document.createElement('code');
	id.className = 'sqa-assessment-id';
	id.textContent = lifecycle.finalized ? (assessment?.assessmentId ?? 'result-unavailable') : 'draft-assessment';
	node.append(mark, body, id);
	return node;
}

function renderSqaTechnicalSummary(summary) {
	const applicable = Number(summary?.applicableControls) || 0;
	const verdict = summary?.verdict ?? 'not_applicable';
	const meta = SQA_RESULT_META[verdict] ?? { label: humanizeSqaId(verdict), mark: '•' };
	const node = sqaSection(
		'Automated web checks',
		applicable ? `${applicable} controlled-browser check${applicable === 1 ? '' : 's'} evaluated separately from reviewer evidence.` : 'No automated web checks applied to this scope.'
	);
	node.classList.add('sqa-technical');

	const summaryRow = document.createElement('div');
	summaryRow.className = 'sqa-technical-summary';
	summaryRow.dataset.status = verdict;
	const status = document.createElement('span');
	status.className = 'sqa-status';
	status.textContent = meta.label;
	const copy = document.createElement('p');
	copy.textContent = verdict === 'pass'
		? 'All applicable browser checks completed successfully.'
		: verdict === 'fail'
			? 'At least one automated browser check produced an evidence-backed failure.'
			: verdict === 'blocked'
				? 'At least one automated browser check could not complete or lacks technical evidence.'
				: 'This assessment scope contains no automated web controls.';
	summaryRow.append(status, copy);
	node.append(summaryRow);

	const counts = document.createElement('dl');
	counts.className = 'sqa-technical-counts';
	for (const [label, key] of [['Passed', 'pass'], ['Failed', 'fail'], ['Blocked', 'blocked'], ['Not run', 'not_assessed']]) {
		const item = document.createElement('div');
		const value = document.createElement('dd');
		value.textContent = String(Number(summary?.[key]) || 0);
		const term = document.createElement('dt');
		term.textContent = label;
		item.append(value, term);
		counts.append(item);
	}
	node.append(counts);
	return node;
}

function renderSqaScope(scope, assessment) {
	const target = assessment?.target ?? scope.target ?? {};
	const profiles = assessment?.profiles ?? scope.profiles ?? [];
	const attributes = assessment?.attributes ?? scope.attributes ?? [];
	const node = sqaSection('Assessment scope', 'Target, release, and declared applicability inputs.');
	const grid = document.createElement('dl');
	grid.className = 'sqa-scope-grid';
	appendSqaDefinition(grid, 'Target', target.name ?? state.session.title ?? 'Not provided');
	appendSqaDefinition(grid, 'Release', target.release ?? 'Not provided');
	appendSqaDefinition(grid, 'Environment', target.environment ?? 'Not provided');
	appendSqaDefinition(grid, 'Catalog', assessment?.catalogVersion ?? scope.catalogVersion ?? 'Current server catalog');
	appendSqaDefinition(grid, 'Profiles', profiles.length ? profiles.map(humanizeSqaId).join(', ') : 'Universal core');
	appendSqaDefinition(grid, 'Attributes', attributes.length ? attributes.map(humanizeSqaId).join(', ') : 'None declared');
	node.append(grid);

	const notesText = assessment?.scopeNotes ?? scope.scopeNotes;
	if (notesText) {
		const notes = document.createElement('p');
		notes.className = 'sqa-scope-notes';
		notes.textContent = notesText;
		node.append(notes);
	}
	return node;
}

function appendSqaDefinition(listNode, term, value) {
	const dt = document.createElement('dt');
	dt.textContent = term;
	const dd = document.createElement('dd');
	dd.textContent = String(value);
	listNode.append(dt, dd);
}

function renderSqaCoverage(assessment) {
	const node = sqaSection('Coverage and decision gates', 'Conclusive results require pass or fail; blocked and not assessed remain unresolved.');
	const metrics = document.createElement('div');
	metrics.className = 'sqa-metric-grid';
	for (const [label, value] of [
		['Observed controls', assessment.coverage?.observed],
		['Conclusive controls', assessment.coverage?.conclusive],
		['Mandatory passed', assessment.coverage?.mandatoryPassed],
		['Evidence satisfied', assessment.coverage?.evidence]
	]) {
		metrics.append(renderSqaMetric(label, value));
	}
	node.append(metrics);

	const gates = document.createElement('div');
	gates.className = 'sqa-gates';
	for (const gate of assessment.gates ?? []) {
		const row = document.createElement('div');
		row.className = 'sqa-gate';
		row.dataset.status = gate.status;
		const status = document.createElement('span');
		status.className = 'sqa-status';
		status.textContent = SQA_RESULT_META[gate.status]?.label ?? humanizeSqaId(gate.status);
		const content = document.createElement('div');
		const title = document.createElement('strong');
		title.textContent = gate.title;
		const detail = document.createElement('p');
		detail.textContent = gate.detail ?? '';
		content.append(title, detail);
		row.append(status, content);
		gates.append(row);
	}
	node.append(gates);
	return node;
}

function renderSqaMetric(label, value) {
	const numeric = Number(value);
	const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
	const card = document.createElement('div');
	card.className = 'sqa-metric';
	const head = document.createElement('div');
	const name = document.createElement('span');
	name.textContent = label;
	const amount = document.createElement('strong');
	amount.textContent = Number.isFinite(numeric) ? `${numeric}%` : '—';
	head.append(name, amount);
	const track = document.createElement('span');
	track.className = 'sqa-meter';
	const fill = document.createElement('i');
	fill.style.width = `${percent}%`;
	track.append(fill);
	card.append(head, track);
	return card;
}

function renderSqaUnresolved(assessment) {
	const unresolved = (assessment.results ?? []).filter(result => result.status !== 'pass');
	const groups = groupSqaUnresolvedResults(assessment.results);
	const evidenceGaps = groups.reviewer.length + groups.mixed.length;
	const node = sqaSection('Failures and evidence gaps', `${groups.failures.length} failed · ${evidenceGaps} reviewer/mixed evidence gaps · ${groups.automated.length} automated incomplete`);

	if (unresolved.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'sqa-section-empty';
		empty.textContent = 'No unresolved controls in this assessment.';
		node.append(empty);
		return node;
	}

	const list = document.createElement('div');
	list.className = 'sqa-unresolved-groups';
	for (const group of [
		{ title: 'Confirmed failures', description: 'Evidence-backed control failures that affect the product verdict.', results: groups.failures, kind: 'failures' },
		{ title: 'Reviewer evidence required', description: 'Documents, approvals, records, or independent review must be supplied by an authorized reviewer.', results: groups.reviewer, kind: 'reviewer' },
		{ title: 'Mixed evidence incomplete', description: 'This control combines browser-observable checks with external reviewer artifacts.', results: groups.mixed, kind: 'mixed' },
		{ title: 'Automated check blocked / not run', description: 'The controlled browser check did not complete or lacks agent-capable technical evidence.', results: groups.automated, kind: 'automated' }
	]) {
		if (!group.results.length) continue;
		const section = document.createElement('section');
		section.className = 'sqa-unresolved-group';
		section.dataset.kind = group.kind;
		const heading = document.createElement('h4');
		heading.textContent = `${group.title} (${group.results.length})`;
		const description = document.createElement('p');
		description.className = 'sqa-unresolved-group-description';
		description.textContent = group.description;
		const rows = document.createElement('div');
		rows.className = 'sqa-unresolved-list';
		for (const result of group.results) rows.append(renderSqaUnresolvedRow(result));
		section.append(heading, description, rows);
		list.append(section);
	}
	node.append(list);
	return node;
}

function renderSqaUnresolvedRow(result) {
	const row = document.createElement('div');
	row.className = 'sqa-unresolved';
	row.dataset.status = result.status;
	const status = document.createElement('span');
	status.className = 'sqa-status';
	status.textContent = SQA_RESULT_META[result.status]?.label ?? humanizeSqaId(result.status);
	const body = document.createElement('div');
	const title = document.createElement('strong');
	title.textContent = `${result.controlId} · ${result.title}`;
	const reason = document.createElement('p');
	const missing = result.evidenceCoverage?.missing ?? [];
	reason.textContent = result.decisionNotes?.[0] ?? result.rationale
		?? (missing.length ? `Missing evidence: ${missing.join(', ')}.` : 'A conclusive evidence-backed result is not available.');
	body.append(title, reason);
	row.append(status, body);
	return row;
}

function renderSqaControls(results) {
	const node = sqaSection('Control results', `${results.length} applicable control${results.length === 1 ? '' : 's'}`);
	const list = document.createElement('div');
	list.className = 'sqa-control-list';
	for (const result of results) list.append(renderSqaControl(result));
	if (!results.length) {
		const empty = document.createElement('p');
		empty.className = 'sqa-section-empty';
		empty.textContent = 'No control results were returned.';
		list.append(empty);
	}
	node.append(list);
	return node;
}

function renderSqaControl(result) {
	const item = document.createElement('details');
	item.className = 'sqa-control';
	item.dataset.status = result.status;
	const summary = document.createElement('summary');
	const id = document.createElement('code');
	id.textContent = result.controlId;
	const title = document.createElement('span');
	title.textContent = result.title;
	const status = document.createElement('span');
	status.className = 'sqa-status';
	status.textContent = SQA_RESULT_META[result.status]?.label ?? humanizeSqaId(result.status);
	summary.append(id, title, status);

	const body = document.createElement('div');
	body.className = 'sqa-control-body';
	const meta = document.createElement('p');
	meta.className = 'sqa-control-meta';
	meta.textContent = `${humanizeSqaId(result.domain)} · ${humanizeSqaId(result.severity)} severity · ${humanizeSqaId(result.automationLevel)}${result.mandatory ? ' · Mandatory' : ''}`;
	body.append(meta);
	if (result.rationale) body.append(sqaLabeledText('Rationale', result.rationale));
	for (const note of result.decisionNotes ?? []) body.append(sqaLabeledText('Decision note', note));

	const evidenceTitle = document.createElement('h4');
	evidenceTitle.textContent = `Evidence (${result.evidenceCoverage?.satisfied ?? 0}/${result.evidenceCoverage?.required ?? 0} requirements)`;
	body.append(evidenceTitle);
	const evidence = result.evidence ?? [];
	if (!evidence.length) {
		const none = document.createElement('p');
		none.className = 'sqa-section-empty';
		none.textContent = 'No evidence artifact was attached.';
		body.append(none);
	} else {
		const evidenceList = document.createElement('ul');
		evidenceList.className = 'sqa-evidence-list';
		for (const artifact of evidence) {
			const entry = document.createElement('li');
			const type = document.createElement('strong');
			type.textContent = humanizeSqaId(artifact.type);
			const reference = safeSqaLink(artifact.reference, artifact.reference);
			entry.append(type, reference);
			if (artifact.summary) {
				const description = document.createElement('span');
				description.textContent = artifact.summary;
				entry.append(description);
			}
			evidenceList.append(entry);
		}
		body.append(evidenceList);
	}

	const requirements = result.evidenceCoverage?.requirements ?? [];
	if (requirements.length) {
		const requirementsList = document.createElement('ul');
		requirementsList.className = 'sqa-requirement-list';
		for (const requirement of requirements) {
			const entry = document.createElement('li');
			entry.dataset.satisfied = String(Boolean(requirement.satisfied));
			entry.textContent = `${requirement.satisfied ? '✓' : '○'} ${requirement.description}`;
			requirementsList.append(entry);
		}
		body.append(requirementsList);
	}

	if (result.sources?.length) {
		const sources = document.createElement('div');
		sources.className = 'sqa-source-tags';
		for (const source of result.sources) {
			const tag = document.createElement('code');
			tag.textContent = source;
			sources.append(tag);
		}
		body.append(sources);
	}
	item.append(summary, body);
	return item;
}

function renderSqaSources(frameworks) {
	const node = sqaSection('Source coverage', 'Control crosswalk coverage; source publications remain authoritative.');
	const grid = document.createElement('div');
	grid.className = 'sqa-source-grid';
	for (const framework of frameworks) {
		const card = document.createElement('article');
		card.className = 'sqa-source-card';
		card.dataset.status = framework.status;
		const title = safeSqaLink(framework.title ?? framework.sourceId, framework.url);
		title.classList.add('sqa-source-title');
		const meta = document.createElement('p');
		meta.textContent = `${framework.controls ?? 0} mapped controls · ${framework.coverage ?? 0}% conclusive`;
		const status = document.createElement('span');
		status.className = 'sqa-status';
		status.textContent = SQA_RESULT_META[framework.status]?.label ?? humanizeSqaId(framework.status);
		card.append(title, meta, status);
		grid.append(card);
	}
	if (!frameworks.length) {
		const empty = document.createElement('p');
		empty.className = 'sqa-section-empty';
		empty.textContent = 'No source crosswalk was returned.';
		grid.append(empty);
	}
	node.append(grid);
	return node;
}

function sqaSection(titleText, subtitleText) {
	const node = document.createElement('section');
	node.className = 'sqa-section';
	const head = document.createElement('header');
	const title = document.createElement('h3');
	title.textContent = titleText;
	const subtitle = document.createElement('p');
	subtitle.textContent = subtitleText;
	head.append(title, subtitle);
	node.append(head);
	return node;
}

function sqaLabeledText(labelText, text) {
	const node = document.createElement('p');
	const label = document.createElement('strong');
	label.textContent = `${labelText}: `;
	node.append(label, document.createTextNode(text));
	return node;
}

function safeSqaLink(label, href) {
	let safeUrl;
	try {
		const candidate = new URL(String(href ?? ''));
		if (['http:', 'https:'].includes(candidate.protocol)) safeUrl = candidate.href;
	} catch {
		// Render untrusted references as text rather than active links.
	}
	const node = document.createElement(safeUrl ? 'a' : 'span');
	node.textContent = String(label ?? href ?? 'Reference');
	if (safeUrl) {
		node.href = safeUrl;
		node.target = '_blank';
		node.rel = 'noreferrer noopener';
	}
	return node;
}

function connect(id) {
	state.stream?.close();
	const stream = new EventSource(`/api/sessions/${id}/events`);
	state.stream = stream;
	let finishReady;
	const ready = new Promise(resolve => { finishReady = resolve; });
	// An unavailable stream must not lock the workspace; EventSource will keep
	// reconnecting. Healthy launchers wait for subscription before starting work.
	const timer = setTimeout(finishReady, 5000);
	const connected = () => { clearTimeout(timer); finishReady(); };
	let eventRevision = 0;
	let resyncTimer;
	const resync = async () => {
		if (state.stream !== stream || state.sessionId !== id) return;
		const revision = eventRevision;
		try {
			const snapshot = await api(`/sessions/${id}`);
			if (state.stream !== stream || state.sessionId !== id) return;
			// Never overwrite events that arrived while the snapshot was in flight.
			// Retry after a quiet interval; EventSource keeps applying live updates.
			if (revision !== eventRevision) {
				resyncTimer = setTimeout(resync, 250);
				return;
			}
			applySessionSnapshot(snapshot);
		} catch {
			if (state.stream === stream) resyncTimer = setTimeout(resync, 1000);
		} finally {
			connected();
		}
	};

	stream.onopen = () => {
		if (state.stream !== stream) return;
		el.connDot.className = 'dot is-live';
		el.connLabel.textContent = 'connected';
		clearTimeout(resyncTimer);
		void resync();
	};
	stream.onerror = () => {
		connected();
		clearTimeout(resyncTimer);
		if (state.stream !== stream) return;
		el.connDot.className = 'dot';
		el.connLabel.textContent = 'reconnecting…';
	};
	stream.onmessage = event => {
		if (state.stream !== stream) return;
		const data = JSON.parse(event.data);
		if (data.sessionId === state.sessionId) {
			eventRevision += 1;
			handleEvent(data);
		}
	};
	return ready;
}

function handleEvent(event) {
	const session = state.session;
	switch (event.type) {
		case 'frame':
			applyFrame(event.frame);
			break;

		case 'cursor':
			applyCursor(event.cursor);
			break;

		case 'message':
			// Thinking is live state, not transcript: it never becomes a bubble.
			if (event.message.role === 'thinking') {
				break;
			}
			session.messages.push(event.message);
			el.chatEmpty.hidden = true;
			el.transcript.append(renderMessage(event.message));
			if (event.message.role === 'agent') {
				resetThinking();
			}
			scrollTranscript();
			break;

		case 'message_delta':
			appendDelta(event.id, event.content, event.role);
			break;

		case 'message_done':
			if (event.message) {
				const index = session.messages.findIndex(message => message.id === event.message.id);
				if (index < 0) session.messages.push(event.message);
				else session.messages[index] = event.message;
				renderTranscript();
			}
			break;

		case 'activity': {
			const index = session.activities.findIndex(item => item.id === event.activity.id);
			if (index === -1) {
				session.activities.push(event.activity);
			} else {
				session.activities[index] = event.activity;
			}
			upsertActivity(event.activity);
			// The action doubles as the strip's caption when no reasoning streams.
			if (event.activity.status === 'running') {
				state.thinking.action = [event.activity.label, event.activity.detail]
					.filter(Boolean).join(' — ');
				updateThinkingStrip();
				renderCurrentActivity();
			}
			if (session.mode === 'founder') renderFounder();
			break;
		}

		case 'todos':
			session.todos = event.todos;
			renderTodos();
			renderProgressCard();
			break;

		case 'context':
			session.contextUsage = event.context;
			renderHeader();
			break;

		case 'usage':
			session.tokenUsage = event.usage;
			renderHeader();
			// Keep the sidebar's token badge in step without a full refetch;
			// throttled so a fast series of commits stays cheap.
			scheduleRunBadgeRefresh();
			break;

		case 'finding':
			session.findings.push(event.finding);
			renderFindings();
			renderProgressCard();
			if (event.finding.severity === 'critical' || event.finding.severity === 'high') {
				toast(`${event.finding.severity.toUpperCase()}: ${event.finding.title}`, 'bad');
			}
			break;

		case 'report':
			session.report = event.report;
			renderReport();
			toast('Report published.', 'good');
			break;

		case 'sqa':
			session.mode = 'sqa';
			session.sqa ??= { scope: {} };
			session.sqa.assessment = event.assessment;
			if (event.final) session.sqa.finalizedAt = new Date(event.ts ?? Date.now()).toISOString();
			else delete session.sqa.finalizedAt;
			syncSqaDetailMode();
			renderHeader();
			renderSqa();
			renderReport();
			void refreshRuns();
			if (event.final) toast('SQA assessment published.', 'good');
			break;

		case 'founder.created':
			session.mode = 'founder';
			session.founder ??= { scope: {} };
			if (event.schemaVersion) session.founder.schemaVersion = event.schemaVersion;
			if (event.categories) session.founder.scope.categories = event.categories;
			syncSqaDetailMode();
			renderHeader();
			renderFounder();
			renderReport();
			void refreshRuns();
			break;

		case 'founder.target_bound':
			session.mode = 'founder';
			session.targetUrl = event.targetUrl;
			session.title = event.title;
			session.founder ??= { scope: { target: {} }, observations: [] };
			session.founder.scope ??= { target: {} };
			session.founder.scope.target ??= {};
			session.founder.scope.target.url = event.authorizedTargetUrl ?? event.targetUrl;
			syncSqaDetailMode();
			renderHeader();
			renderFounder();
			void refreshRuns();
			break;

		case 'founder.observation': {
			session.mode = 'founder';
			session.founder ??= { scope: {}, observations: [] };
			session.founder.observations ??= [];
			const index = session.founder.observations.findIndex(item => item.id === event.observation?.id);
			if (event.observation && index === -1) session.founder.observations.push(event.observation);
			else if (event.observation) session.founder.observations[index] = event.observation;
			syncSqaDetailMode();
			renderHeader();
			renderFounder();
			break;
		}

		case 'founder.finalized':
			session.mode = 'founder';
			session.founder ??= { scope: {}, observations: [] };
			session.founder.report = event.report;
			session.founder.finalizedAt = event.report?.generatedAt ?? new Date(event.ts ?? Date.now()).toISOString();
			syncSqaDetailMode();
			renderHeader();
			renderFounder();
			renderReport();
			showCompletedFounderReport();
			void refreshRuns();
			toast('Founder brief published.', 'good');
			break;

		case 'question':
			session.pendingQuestion = event.question;
			renderQuestion();
			break;

		case 'status':
			setStatus(event.status);
			renderCurrentActivity();
			// Server-authoritative timing arrives with every status event.
			if (event.timing) {
				noteServerNow(event.timing.serverNow);
				Object.assign(session, {
					startedAt: event.timing.startedAt,
					completedAt: event.timing.completedAt,
					cancelledAt: event.timing.cancelledAt,
					failureReason: event.timing.failureReason
				});
			}
			updateRunTimer();
			if (session.mode === 'sqa') {
				renderSqa();
				renderReport();
			}
			if (session.mode === 'founder') {
				renderFounder();
				renderReport();
				showCompletedFounderReport();
			}
		if (event.status !== 'running') {
			void refreshRuns();
			void refreshPerformance();
		}
			if (event.detail && event.status === 'error') {
				toast(event.detail, 'bad');
			}
			// Status changes move the runtime through the lifecycle — refresh the
			// single source of truth so every live-view element follows.
			if (session) {
				state.activeRuntimeEnvironment = resolveActiveRuntimeEnvironment({ session, environments: deviceState.list });
				renderLiveDeviceViewHeader(session, state.activeRuntimeEnvironment);
			}
			break;

		case 'browser':
			if (event.browser?.url) {
				el.browserUrl.textContent = event.browser.url;
			}
			break;

		case 'session':
			if (event.targetUrl) {
				session.targetUrl = event.targetUrl;
				session.title = event.title;
				if (session.mode === 'founder' && session.founder?.scope?.target) {
					session.founder.scope.target.url = event.targetUrl;
				}
				renderHeader();
				if (session.mode === 'founder') renderFounder();
				void refreshRuns();
			}
			break;

		default:
			break;
	}
}

/* ── QA start dialog ─────────────────────────────────────────────── */

const qaUi = {
	dialog: $('qa-start'),
	form: $('qa-form'),
	close: $('qa-close'),
	cancel: $('qa-cancel'),
	submit: $('qa-submit'),
	targetUrl: $('qa-target-url'),
	testOn: $('qa-test-on'),
	testOnChange: document.querySelector('#qa-start [data-test-on-change]'),
	deviceLandscape: $('qa-device-landscape'),
	error: $('qa-form-error')
};

function setQaFormError(message = '') {
	if (!qaUi.error) return;
	qaUi.error.className = `test-result${message ? ' bad' : ''}`;
	qaUi.error.textContent = message;
}

function openQaStart() {
	if (!qaUi.dialog) return;
	setQaFormError();
	qaUi.form.reset();
	renderTestOn('qa-test-on');
	qaUi._testCaseId = undefined;
	qaUi._testCaseSnapshot = undefined;
	if (qaUi.deviceLandscape) qaUi.deviceLandscape.checked = pendingLandscape();
	qaUi.submit.dataset.busy = 'false';
	qaUi.submit.disabled = false;
	qaUi.submit.textContent = 'Start QA run';
	if (qaUi.testOnChange) qaUi.testOnChange.onclick = () => devicePicker?.open?.();
	if (!qaUi.dialog.open) qaUi.dialog.showModal();
	setTimeout(() => qaUi.targetUrl?.focus(), 0);
}

function closeQaStart() {
	if (qaUi.dialog?.open) qaUi.dialog.close();
}

if (qaUi.dialog) {
	qaUi.close.onclick = closeQaStart;
	qaUi.cancel.onclick = closeQaStart;

	qaUi.form.onsubmit = async event => {
		event.preventDefault();
		setQaFormError();
		if (!qaUi.form.reportValidity()) return;
		let targetUrl;
		try {
			const parsed = new URL(qaUi.targetUrl.value.trim());
			if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError();
			targetUrl = parsed.toString();
		} catch {
			setQaFormError('Enter a valid http(s) URL.');
			qaUi.targetUrl.focus();
			return;
		}
		// AC14: the run uses exactly the environment shown in the TEST ON block,
		// read from the store at submit time.
		const device = activeTestEnvStore?.get?.()?.device || pendingDeviceId();
		const deviceLandscape = (qaUi.deviceLandscape?.checked) === true;
		const environmentId = selectedEnvironmentForRun();
		const testCaseId = qaUi._testCaseId || undefined;
		qaUi.submit.dataset.busy = 'true';
		qaUi.submit.disabled = true;
		qaUi.submit.textContent = 'Starting run…';
		try {
			await createQaRunWithCase({ targetUrl, device, deviceLandscape, environmentId, testCaseId });
			closeQaStart();
		} catch (error) {
			setQaFormError(error instanceof Error ? error.message : String(error));
		} finally {
			qaUi.submit.dataset.busy = 'false';
			qaUi.submit.disabled = false;
			qaUi.submit.textContent = 'Start QA run';
		}
	};
}

/* ── Settings ────────────────────────────────────────────────────── */

const sqaUi = {
	dialog: $('sqa-start'),
	form: $('sqa-form'),
	close: $('sqa-close'),
	cancel: $('sqa-cancel'),
	submit: $('sqa-submit'),
	catalogState: $('sqa-catalog-state'),
	catalogVersion: $('sqa-catalog-version'),
	disclaimer: $('sqa-catalog-disclaimer'),
	deviceSelect: null, // legacy select removed (DX Phase 3)
	deviceLandscape: $('sqa-device-landscape'),
	testOnChange: document.querySelector('#sqa-start [data-test-on-change]'),
	profilesFieldset: $('sqa-profiles-fieldset'),
	attributesFieldset: $('sqa-attributes-fieldset'),
	profileOptions: $('sqa-profile-options'),
	attributeOptions: $('sqa-attribute-options'),
	targetName: $('sqa-target-name'),
	targetUrl: $('sqa-target-url'),
	targetRelease: $('sqa-target-release'),
	targetEnvironment: $('sqa-target-environment'),
	scopeNotes: $('sqa-scope-notes'),
	authorization: $('sqa-authorization'),
	error: $('sqa-form-error')
};

function setSqaFormError(message = '') {
	sqaUi.error.className = `test-result${message ? ' bad' : ''}`;
	sqaUi.error.textContent = message;
}

async function loadSqaCatalog() {
	if (state.sqaCatalog) return state.sqaCatalog;
	if (!state.sqaCatalogPromise) {
		state.sqaCatalogPromise = api('/sqa/catalog')
			.then(catalog => {
				if (!catalog || typeof catalog !== 'object' || !catalog.catalogVersion) {
					throw new Error('The SQA catalog response is invalid.');
				}
				state.sqaCatalog = catalog;
				return catalog;
			})
			.finally(() => {
				state.sqaCatalogPromise = undefined;
			});
	}
	return state.sqaCatalogPromise;
}

function paintSqaCatalog(catalog) {
	const profiles = sqaValues(catalog.profiles);
	const attributes = sqaValues(catalog.attributes);
	const sources = sqaValues(catalog.sources);
	const controls = sqaValues(catalog.controls);
	sqaUi.disclaimer.textContent = catalog.disclaimer
		?? 'This is a scoped engineering assessment and does not represent regulatory approval, an audit opinion, or certification.';
	sqaUi.catalogVersion.textContent = `catalog ${catalog.catalogVersion} · ${controls.length} controls · ${sources.length} sources`;

	sqaUi.profileOptions.replaceChildren(...profiles.map(profile => {
		const id = typeof profile === 'string' ? profile : profile.id;
		const title = typeof profile === 'string' ? humanizeSqaId(profile) : (profile.title ?? humanizeSqaId(id));
		const description = typeof profile === 'string' ? '' : (profile.description ?? '');
		const isCore = id === 'core';
		const count = controls.filter(control => control.applicability?.profiles?.includes(id)).length;
		return sqaCatalogOption({
			name: 'sqa-profile', value: id, title, description,
			meta: `${count} mapped control${count === 1 ? '' : 's'}${isCore ? ' · required' : ''}`,
			checked: isCore, disabled: isCore
		});
	}));

	sqaUi.attributeOptions.replaceChildren(...attributes.map(attribute => {
		const id = typeof attribute === 'string' ? attribute : attribute.id;
		const title = typeof attribute === 'string' ? humanizeSqaId(attribute) : (attribute.title ?? humanizeSqaId(id));
		return sqaCatalogOption({ name: 'sqa-attribute', value: id, title });
	}));
	sqaUi.profilesFieldset.disabled = false;
	sqaUi.attributesFieldset.disabled = false;
	sqaUi.catalogState.hidden = true;
	syncSqaSubmitState();
}

function sqaCatalogOption({ name, value, title, description = '', meta = '', checked = false, disabled = false }) {
	const label = document.createElement('label');
	label.className = `sqa-option${disabled ? ' is-required' : ''}`;
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.name = name;
	input.value = value;
	input.checked = checked;
	input.defaultChecked = checked;
	input.disabled = disabled;

	const copy = document.createElement('span');
	const heading = document.createElement('strong');
	heading.textContent = title;
	copy.append(heading);
	if (description) {
		const text = document.createElement('small');
		text.textContent = description;
		copy.append(text);
	}
	if (meta) {
		const metadata = document.createElement('em');
		metadata.textContent = meta;
		copy.append(metadata);
	}
	label.append(input, copy);
	return label;
}

function syncSqaSubmitState() {
	sqaUi.submit.disabled = !state.sqaCatalog || !sqaUi.authorization.checked || sqaUi.submit.dataset.busy === 'true';
}

async function openSqaStart() {
	setSqaFormError();
	sqaUi.form.reset();
	renderTestOn('sqa-test-on');
	if (sqaUi.testOnChange) sqaUi.testOnChange.onclick = () => devicePicker?.open?.();
	if (sqaUi.deviceLandscape) sqaUi.deviceLandscape.checked = pendingLandscape();
	sqaUi.profilesFieldset.disabled = true;
	sqaUi.attributesFieldset.disabled = true;
	sqaUi.catalogState.hidden = false;
	sqaUi.catalogState.textContent = 'Loading assessment catalog…';
	sqaUi.submit.dataset.busy = 'false';
	syncSqaSubmitState();
	if (!sqaUi.dialog.open) sqaUi.dialog.showModal();

	try {
		paintSqaCatalog(await loadSqaCatalog());
	} catch (error) {
		sqaUi.catalogState.hidden = false;
		sqaUi.catalogState.textContent = 'The assessment catalog could not be loaded.';
		setSqaFormError(error instanceof Error ? error.message : String(error));
	}
}

function closeSqaStart() {
	if (sqaUi.dialog.open) sqaUi.dialog.close();
}

sqaUi.close.onclick = closeSqaStart;
sqaUi.cancel.onclick = closeSqaStart;
sqaUi.authorization.onchange = syncSqaSubmitState;

sqaUi.form.onsubmit = async event => {
	event.preventDefault();
	setSqaFormError();
	if (!sqaUi.form.reportValidity()) return;
	const target = {
		name: sqaUi.targetName.value.trim(),
		release: sqaUi.targetRelease.value.trim(),
		environment: sqaUi.targetEnvironment.value.trim()
	};
	let targetUrl;
	try {
		targetUrl = new URL(sqaUi.targetUrl.value.trim());
		if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new TypeError();
		targetUrl = targetUrl.href;
	} catch {
		setSqaFormError('Enter a complete HTTP or HTTPS target URL.');
		sqaUi.targetUrl.focus();
		return;
	}
	const emptyTarget = Object.entries(target).find(([, value]) => !value);
	if (emptyTarget) {
		setSqaFormError('Product, release, and environment must contain visible text.');
		sqaUi.targetName.focus();
		return;
	}
	if (!sqaUi.authorization.checked) {
		setSqaFormError('Confirm testing authorization and the non-destructive boundary first.');
		sqaUi.authorization.focus();
		return;
	}

	const profiles = [...sqaUi.profileOptions.querySelectorAll('input:checked')].map(input => input.value);
	if (!profiles.includes('core')) profiles.unshift('core');
	const attributes = [...sqaUi.attributeOptions.querySelectorAll('input:checked')].map(input => input.value);
	sqaUi.submit.dataset.busy = 'true';
	sqaUi.submit.textContent = 'Creating assessment…';
	syncSqaSubmitState();
	try {
		const result = await api('/sqa/sessions', {
			method: 'POST',
			body: JSON.stringify({
				profiles,
				attributes,
				target,
				scopeNotes: sqaUi.scopeNotes.value.trim(),
				authorizationConfirmed: true,
				device: activeTestEnvStore?.get?.()?.device || pendingDeviceId(),
				deviceLandscape: (sqaUi.deviceLandscape?.checked) === true,
				environmentId: selectedEnvironmentForRun() || undefined
			})
		});
		const session = result?.session ?? result;
		if (!session?.id) throw new Error('The server did not return the new assessment session.');
		closeSqaStart();
		await selectSession(session.id);
		const startError = await api(`/sessions/${session.id}/message`, {
			method: 'POST',
			body: JSON.stringify({ text: targetUrl })
		}).then(() => undefined, error => error);
		if (startError) {
			fail(new Error(`The assessment scope was created, but the test could not start: ${startError.message}`));
			el.composerInput.value = targetUrl;
			el.composerInput.focus();
		}
	} catch (error) {
		setSqaFormError(error instanceof Error ? error.message : String(error));
	} finally {
		sqaUi.submit.dataset.busy = 'false';
		sqaUi.submit.textContent = 'Start assessment';
		syncSqaSubmitState();
	}
};

const founderUi = {
	dialog: $('founder-start'),
	form: $('founder-form'),
	close: $('founder-close'),
	cancel: $('founder-cancel'),
	submit: $('founder-submit'),
	catalogMeta: $('founder-catalog-meta'),
	deviceSelect: null, // legacy select removed (DX Phase 3)
	deviceLandscape: $('founder-device-landscape'),
	testOnChange: document.querySelector('#founder-start [data-test-on-change]'),
	targetName: $('founder-target-name'),
	targetUrl: $('founder-target-url'),
	targetRelease: $('founder-target-release'),
	targetEnvironment: $('founder-target-environment'),
	stage: $('founder-stage'),
	businessModel: $('founder-business-model'),
	targetCustomer: $('founder-target-customer'),
	primaryGoal: $('founder-primary-goal'),
	constraints: $('founder-constraints'),
	competitors: $('founder-competitors'),
	authorization: $('founder-authorization'),
	error: $('founder-form-error')
};

function setFounderFormError(message = '') {
	founderUi.error.className = `test-result${message ? ' bad' : ''}`;
	founderUi.error.textContent = message;
}

async function loadFounderCatalog() {
	if (state.founderCatalog) return state.founderCatalog;
	if (!state.founderCatalogPromise) {
		state.founderCatalogPromise = api('/founder/catalog')
			.then(catalog => {
				if (!catalog || typeof catalog !== 'object' || !catalog.schemaVersion || !Array.isArray(catalog.categories)) {
					throw new Error('The Founder review catalog response is invalid.');
				}
				state.founderCatalog = catalog;
				return catalog;
			})
			.finally(() => {
				state.founderCatalogPromise = undefined;
			});
	}
	return state.founderCatalogPromise;
}

function paintFounderCatalog(catalog) {
	founderUi.catalogMeta.textContent = `${catalog.schemaVersion} · ${catalog.categories.length} review lenses · browser evidence required`;
	syncFounderSubmitState();
	if (state.session?.mode === 'founder') renderFounder();
}

function syncFounderSubmitState() {
	founderUi.submit.disabled = !state.founderCatalog
		|| !founderUi.authorization.checked
		|| founderUi.submit.dataset.busy === 'true';
}

async function openFounderStart() {
	setFounderFormError();
	founderUi.form.reset();
	renderTestOn('founder-test-on');
	if (founderUi.testOnChange) founderUi.testOnChange.onclick = () => devicePicker?.open?.();
	if (founderUi.deviceLandscape) founderUi.deviceLandscape.checked = pendingLandscape();
	founderUi.submit.dataset.busy = 'false';
	founderUi.catalogMeta.textContent = 'Loading review catalog…';
	syncFounderSubmitState();
	if (!founderUi.dialog.open) founderUi.dialog.showModal();
	try {
		paintFounderCatalog(await loadFounderCatalog());
	} catch (error) {
		founderUi.catalogMeta.textContent = 'Review catalog unavailable.';
		setFounderFormError(error instanceof Error ? error.message : String(error));
	}
}

function closeFounderStart() {
	if (founderUi.dialog.open) founderUi.dialog.close();
}

function founderOptional(value) {
	const text = String(value ?? '').trim();
	return text || undefined;
}

function readFounderCompetitors() {
	const lines = founderUi.competitors.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
	if (lines.length > 20) throw new TypeError('Enter no more than 20 competitors.');
	if (lines.some(value => value.length > 500)) throw new TypeError('Each competitor must be 500 characters or fewer.');
	const seen = new Set();
	const unique = [];
	for (const value of lines) {
		const key = value.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(value);
	}
	return unique;
}

founderUi.close.onclick = closeFounderStart;
founderUi.cancel.onclick = closeFounderStart;
founderUi.authorization.onchange = syncFounderSubmitState;

founderUi.form.onsubmit = async event => {
	event.preventDefault();
	setFounderFormError();
	if (!founderUi.form.reportValidity()) return;
	let targetUrl;
	try {
		targetUrl = new URL(founderUi.targetUrl.value.trim());
		if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new TypeError();
		targetUrl = targetUrl.href;
	} catch {
		setFounderFormError('Enter a complete HTTP or HTTPS target URL.');
		founderUi.targetUrl.focus();
		return;
	}
	if (!founderUi.targetName.value.trim()) {
		setFounderFormError('Enter the product or project name.');
		founderUi.targetName.focus();
		return;
	}
	if (!founderUi.authorization.checked) {
		setFounderFormError('Confirm review authorization and the non-destructive boundary first.');
		founderUi.authorization.focus();
		return;
	}

	let competitors;
	try {
		competitors = readFounderCompetitors();
	} catch (error) {
		setFounderFormError(error instanceof Error ? error.message : String(error));
		founderUi.competitors.focus();
		return;
	}
	const target = {
		name: founderUi.targetName.value.trim(),
		url: targetUrl,
		...(founderOptional(founderUi.targetRelease.value) ? { release: founderUi.targetRelease.value.trim() } : {}),
		...(founderOptional(founderUi.targetEnvironment.value) ? { environment: founderUi.targetEnvironment.value.trim() } : {})
	};
	const productContext = {
		...(founderOptional(founderUi.stage.value) ? { stage: founderUi.stage.value.trim() } : {}),
		...(founderOptional(founderUi.businessModel.value) ? { businessModel: founderUi.businessModel.value.trim() } : {}),
		...(founderOptional(founderUi.targetCustomer.value) ? { targetCustomer: founderUi.targetCustomer.value.trim() } : {}),
		...(founderOptional(founderUi.primaryGoal.value) ? { primaryGoal: founderUi.primaryGoal.value.trim() } : {}),
		...(founderOptional(founderUi.constraints.value) ? { constraints: founderUi.constraints.value.trim() } : {}),
		...(competitors.length ? { competitors } : {})
	};

	founderUi.submit.dataset.busy = 'true';
	founderUi.submit.textContent = 'Creating review…';
	founderUi.form.setAttribute('aria-busy', 'true');
	syncFounderSubmitState();
	try {
		const result = await api('/founder/sessions', {
			method: 'POST',
			body: JSON.stringify({
				authorizationConfirmed: true,
				target,
				device: activeTestEnvStore?.get?.()?.device || pendingDeviceId(),
				deviceLandscape: (founderUi.deviceLandscape?.checked) === true,
				environmentId: selectedEnvironmentForRun() || undefined,
				...(Object.keys(productContext).length ? { productContext } : {})
			})
		});
		const session = result?.session ?? result;
		if (!session?.id) throw new Error('The server did not return the new Founder review session.');
		closeFounderStart();
		await selectSession(session.id);
		const startError = await api(`/sessions/${session.id}/message`, {
			method: 'POST',
			body: JSON.stringify({ text: `Review ${targetUrl}` })
		}).then(() => undefined, error => error);
		if (startError) {
			fail(new Error(`The review scope was created, but evidence collection could not start: ${startError.message}`));
			el.composerInput.value = `Review ${targetUrl}`;
			el.composerInput.focus();
		}
	} catch (error) {
		setFounderFormError(error instanceof Error ? error.message : String(error));
	} finally {
		founderUi.submit.dataset.busy = 'false';
		founderUi.submit.textContent = 'Start founder review';
		founderUi.form.removeAttribute('aria-busy');
		syncFounderSubmitState();
	}
};

const cfg = {
	dialog: $('settings'),
	provider: $('cfg-provider'),
	providerNote: $('cfg-provider-note'),
	key: $('cfg-key'),
	keyField: $('cfg-key-field'),
	keyNote: $('cfg-key-note'),
	baseUrlField: $('cfg-baseurl-field'),
	baseUrl: $('cfg-baseurl'),
	model: $('cfg-model'),
	modelCustom: $('cfg-model-custom'),
	reasoning: $('cfg-reasoning'),
	maxTurns: $('cfg-maxturns'),
	headless: $('cfg-headless'),
	test: $('cfg-test'),
	testBtn: $('cfg-test-btn'),
	saveBtn: $('cfg-save')
};

/** Providers whose endpoint the user supplies themselves. */
const BASE_URL_REQUIRED = new Set(['custom', 'azureOpenAI']);
const BASE_URL_OPTIONAL = new Set(['openai', 'openrouter', 'nvidia', 'grok']);
const CUSTOM_MODEL_VALUE = '__qase_custom_model__';
const DEFAULT_CUSTOM_MODEL = 'z-ai/glm-5.2';

function selectedModelId() {
	return (cfg.model.value === CUSTOM_MODEL_VALUE ? cfg.modelCustom.value : cfg.model.value).trim();
}

function syncCustomModelField() {
	const custom = cfg.model.value === CUSTOM_MODEL_VALUE;
	cfg.modelCustom.hidden = !custom;
	cfg.modelCustom.required = custom;
	if (custom) cfg.modelCustom.focus();
}

function fillModelOptions(models = [], selected = '') {
	const uniqueModels = [...new Set(models.filter(model => typeof model === 'string' && model.trim()).map(model => model.trim()))];
	const selectedIsListed = uniqueModels.includes(selected);
	const options = uniqueModels.map(id => {
		const option = document.createElement('option');
		option.value = id;
		option.textContent = id;
		return option;
	});
	const customOption = document.createElement('option');
	customOption.value = CUSTOM_MODEL_VALUE;
	customOption.textContent = 'Custom model ID…';
	options.push(customOption);
	cfg.model.replaceChildren(...options);
	if (selected && !selectedIsListed) {
		cfg.model.value = CUSTOM_MODEL_VALUE;
		cfg.modelCustom.value = selected;
	} else {
		// When no model is explicitly configured, prefer the server default
		// (z-ai/glm-5.2 for the managed custom gateway) over the first listed.
		const preferred = selectedIsListed ? selected
			: (uniqueModels.includes(DEFAULT_CUSTOM_MODEL) ? DEFAULT_CUSTOM_MODEL : (uniqueModels[0] ?? CUSTOM_MODEL_VALUE));
		cfg.model.value = preferred;
		if (preferred !== CUSTOM_MODEL_VALUE) cfg.modelCustom.value = '';
	}
	syncCustomModelField();
}

function paintConfig(config) {
	state.config = config;
	el.modelBadge.textContent = config.ready ? config.model : (config.problem ?? 'not configured');
	el.modelBadge.style.color = config.ready ? '' : 'var(--danger)';
	el.modelBadge.title = config.ready
		? `${config.provider}${config.baseUrl ? ` · ${config.baseUrl}` : ''}`
		: 'Open settings to finish configuring';
}

function fillSettings(config) {
	cfg.provider.replaceChildren(...config.providers.map(name => {
		const option = document.createElement('option');
		option.value = name;
		option.textContent = name === 'custom' ? 'custom (OpenAI-compatible endpoint)' : name;
		return option;
	}));
	cfg.provider.value = config.provider;
	cfg.baseUrl.value = config.baseUrl ?? '';
	fillModelOptions([], config.model ?? '');
	cfg.reasoning.value = config.reasoning ?? 'medium';
	cfg.maxTurns.value = config.maxTurns ?? 120;
	cfg.headless.checked = config.headless !== false;

	// The stored key is never sent to the browser; leaving the box empty keeps it.
	cfg.key.value = '';
	cfg.key.placeholder = config.hasApiKey ? `${config.apiKeyHint} — leave blank to keep` : 'sk-…';
	cfg.keyNote.textContent = config.hasApiKey
		? (config.apiKeyFromEnv ? 'Currently coming from .env. Saving one here overrides it.' : 'Stored on this machine, in .qase/config.json.')
		: 'Stored on this machine, in .qase/config.json. Sent only to your endpoint.';

	cfg.test.className = 'test-result';
	cfg.test.textContent = '';
	syncProviderFields();
}

function syncProviderFields() {
	const provider = cfg.provider.value;
	const required = BASE_URL_REQUIRED.has(provider);
	cfg.baseUrlField.hidden = !required && !BASE_URL_OPTIONAL.has(provider);
	// The custom gateway is provisioned by the server (key comes from env) —
	// no API key entry needed unless the user wants to override with their own.
	const managedKey = provider === 'custom';
	cfg.keyField.hidden = managedKey;
	cfg.keyNote.hidden = managedKey;
	cfg.providerNote.textContent = required
		? (managedKey
			? 'OpenAI-compatible endpoint managed by this server — key and base URL are preconfigured.'
			: 'Any OpenAI-compatible API: key, base URL, model name.')
		: BASE_URL_OPTIONAL.has(provider)
			? 'Base URL is optional — leave it blank to use the provider default.'
			: 'This provider uses its own endpoint.';
}

function readSettings() {
	const patch = {
		provider: cfg.provider.value,
		baseUrl: cfg.baseUrl.value.trim(),
		model: selectedModelId(),
		reasoning: cfg.reasoning.value,
		maxTurns: Number(cfg.maxTurns.value),
		headless: cfg.headless.checked
	};
	if (cfg.key.value.trim()) {
		patch.apiKey = cfg.key.value.trim();
	}
	return patch;
}

cfg.provider.onchange = syncProviderFields;
cfg.model.onchange = syncCustomModelField;

async function probeModelEndpoint({ announce = true } = {}) {
	if (announce) {
		cfg.test.className = 'test-result busy';
		cfg.test.textContent = 'Probing the endpoint…';
	}
	const requestedModel = selectedModelId();
	const result = await api('/config/test', {
		method: 'POST',
		body: JSON.stringify(readSettings())
	}).catch(error => ({ ok: false, error: error.message }));

	if (!result.ok) {
		if (announce) {
			cfg.test.className = 'test-result bad';
			cfg.test.textContent = result.error;
		}
		return result;
	}
	fillModelOptions(result.models ?? [], requestedModel);
	cfg.test.className = 'test-result ok';
	cfg.test.textContent = result.matched === false
		? `${result.message} But "${requestedModel}" is not in the list — choose another model or keep it as a custom ID.`
		: result.message;
	return result;
}

async function openSettings() {
	const config = await api('/config');
	fillSettings(config);
	cfg.dialog.showModal();
	if (config.ready) void probeModelEndpoint({ announce: false });
}

let authRegisterMode = false;
let workspaceBooted = false;

function renderAuthMode() {
	if (!el.authGate) return;
	const register = authRegisterMode;
	if (el.authTitle) el.authTitle.textContent = register ? 'Create your workspace' : 'Sign in to your workspace';
	if (el.authCopy) el.authCopy.textContent = register
		? 'Your runs, profile, and saved memory are isolated to this account.'
		: 'Your runs, profile, and saved memory stay isolated to your account.';
	if (el.authDisplay) { el.authDisplay.hidden = !register; el.authDisplay.required = register; }
	if (el.authDisplayLabel) el.authDisplayLabel.hidden = !register;
	if (el.authPassword) { el.authPassword.autocomplete = register ? 'new-password' : 'current-password'; el.authPassword.minLength = register ? 12 : 1; }
	if (el.authSubmit) el.authSubmit.textContent = register ? 'Create account' : 'Sign in';
	if (el.authSwitch) el.authSwitch.textContent = register ? 'I already have an account' : 'Create an account';
}

function showAuthGate() {
	if (!el.authGate) return;
	el.authGate.hidden = false;
	document.querySelector('.app').inert = true;
	document.querySelector('.app').setAttribute('aria-hidden', 'true');
	renderAuthMode();
	el.authEmail?.focus();
}

function hideAuthGate() {
	if (el.authGate) el.authGate.hidden = true;
	for (const node of document.querySelectorAll('.app, .skip-link, #settings, #environments, #toasts')) { node.inert = false; node.removeAttribute('aria-hidden'); }
}

el.authSwitch?.addEventListener('click', () => {
	authRegisterMode = !authRegisterMode;
	if (el.authError) el.authError.hidden = true;
	renderAuthMode();
	el.authPassword?.focus();
});

el.authForm?.addEventListener('submit', async event => {
	event.preventDefault();
	if (!el.authEmail || !el.authPassword || !el.authSubmit) return;
	if (el.authError) el.authError.hidden = true;
	el.authSubmit.disabled = true;
	el.authSwitch.disabled = true;
	el.authForm.setAttribute('aria-busy', 'true');
	try {
		state.user = await api(authRegisterMode ? '/auth/register' : '/auth/login', {
			method: 'POST',
			body: JSON.stringify({
				email: el.authEmail.value.trim(),
				password: el.authPassword.value,
				displayName: el.authDisplay?.value.trim()
			})
		});
		el.authPassword.value = '';
		hideAuthGate();
		await bootWorkspace();
	} catch (error) {
		if (el.authError) {
			el.authError.textContent = error instanceof Error ? error.message : String(error);
			el.authError.hidden = false;
		}
	} finally {
		el.authSubmit.disabled = false;
		el.authSwitch.disabled = false;
		el.authForm.removeAttribute('aria-busy');
	}
});

$('open-settings').onclick = openSettings;

const openDeviceMatrixButton = $('open-device-matrix');

/* ── Device & Environment Matrix (Phase 3) ────────────────────── */
const deviceMatrix = $('device-matrix') ? createDeviceMatrixView({
	api,
	toast,
	fail,
	onRunEnvironment: (env) => startEnvironmentRun(env),
	onOpenRun: (runId) => selectSession(runId),
	elements: {
		dialog: $('device-matrix'),
		navButton: $('open-device-matrix'),
		tabs: [...document.querySelectorAll('#device-matrix [data-dm-tab]')],
		browseList: $('dm-browse-list'),
		browseSearch: $('dm-browse-search'),
		browseCategory: $('dm-browse-category'),
		builderDevices: $('dm-builder-devices'),
		builderOs: $('dm-builder-os'),
		builderBrowsers: $('dm-builder-browsers'),
		builderPreview: $('dm-builder-preview'),
		builderCreate: $('dm-builder-create'),
		envTbody: $('dm-env-tbody'),
		envSummary: $('dm-env-summary'),
		envFilterPlatform: $('dm-env-platform'),
		envFilterBrowser: $('dm-env-browser'),
		envFilterActive: $('dm-env-active'),
		envFilterSearch: $('dm-env-search'),
		envPrev: $('dm-env-prev'),
		envNext: $('dm-env-next'),
		envEditor: $('dm-env-editor'),
		catalogForms: $('dm-catalog-forms'),
		coverageMetrics: $('dm-coverage-metrics'),
		coverageHead: $('dm-coverage-head'),
		coverageTbody: $('dm-coverage-tbody'),
		coverageDetail: $('dm-coverage-detail'),
		facetSummary: $('dm-facet-summary')
	}
}) : null;

/* ── Test cases (Phase 4) ───────────────────────────────────────── */
function startRunForTestCase(testCase) {
	openQaStart();
	// DX Phase 3: assigned-env prefill goes through the ONE picker's data, not
	// a disabled select. If the current selection isn't assigned to the case,
	// switch to the first assigned environment (still one source of truth).
	const assigned = testCase.environmentIds ?? [];
	if (assigned.length) {
		const current = activeTestEnvStore?.get?.();
		if (!current || !assigned.includes(current.envId)) {
			const env = (devicePicker?.state?.environments ?? []).find((e) => assigned.includes(e.envId));
			if (env) {
				activeTestEnvStore.setSelection(env);
				if (devicePicker) devicePicker.state.selectedDevice = env.device;
				renderAllTestOnBlocks();
				deviceDrawer?.paintChip?.();
			}
		}
	}
	qaUi._testCaseId = testCase.caseNumber;
	qaUi._testCaseSnapshot = testCase;
	el.composerInput.placeholder = `Run ${testCase.caseNumber} — ${testCase.title}`;
}

function createQaRunWithCase({ targetUrl, device, deviceLandscape, environmentId, testCaseId }) {
	if (!testCaseId) return createQaRun({ targetUrl, device, deviceLandscape, environmentId });
	return api('/sessions', { method: 'POST', body: JSON.stringify({
		device, deviceLandscape, ...(environmentId ? { environmentId } : {}), testCaseId
	}) }).then(async (session) => {
		await selectSession(session.id);
		if (targetUrl) {
			await api(`/sessions/${session.id}/message`, { method: 'POST', body: JSON.stringify({ text: targetUrl }) }).catch(fail);
		}
		return session;
	});
}

const quickRunState = { testCase: null };

const workflow = {
	lastRunByCase,
	caseStatus,
	platformsOf,
	caseEnvLines,
	oneClickRun(testCase) {
		const assigned = testCase.environmentIds ?? [];
		if (!assigned.length) {
			// Zero assigned environments → current device emulation with a note.
			openRunTarget(testCase);
			return;
		}
		if (assigned.length === 1) {
			// One-click: no configuration steps.
			void launchPairs([{ testCase, envId: assigned[0] }], `${testCase.caseNumber}: `);
			return;
		}
		openRunTarget(testCase);
	}
};

const testCaseView = $('test-cases') ? createTestCaseView({
	api, toast, fail,
	onStartRun: startRunForTestCase,
	onOpenRun: (runId) => { void selectSession(runId).catch(fail); },
	workflow,
	elements: {
		dialog: $('test-cases'),
		navButton: $('open-test-cases'),
		list: $('tc-tbody'),
		search: $('tc-search'),
		source: $('tc-source'),
		form: $('tc-form'),
		formTitle: $('tc-title'),
		formDescription: $('tc-description'),
		formExpected: $('tc-expected'),
		formSteps: $('tc-steps'),
		formTags: $('tc-tags'),
		deviceChips: $('tc-device-chips'),
		addDeviceBtn: $('tc-add-device'),
		submitBtn: $('tc-submit'),
		formCancel: $('tc-cancel'),
		closeButton: $('tc-close'),
		editorSummary: $('tc-summary')
	}
}) : null;

const bulkRunView = $('bulk-run') ? createBulkRunView({
	api, toast, fail,
	onLaunch: (pairs, label) => launchPairs(pairs, label),
	elements: {
		dialog: $('bulk-run'),
		navButton: $('open-bulk-run'),
		close: $('bulk-close'),
		what: $('bulk-what'),
		casesField: $('bulk-cases-field'),
		casesSelect: $('bulk-cases'),
		where: $('bulk-where'),
		deviceChips: $('bulk-device-chips'),
		addDeviceBtn: $('bulk-add-device'),
		preview: $('bulk-preview'),
		launchBtn: $('bulk-launch'),
		result: $('bulk-result'),
		steps: [...document.querySelectorAll('#bulk-run [data-bulk-step]')]
	}
}) : null;
if (bulkRunView) {
	bulkRunView.setWizardFilter((mode) => filterCasesForWizard(bulkRunView.state.cases, mode, bulkRunView.state.lastRuns));
	bulkRunView.setLastRunIndex(lastRunByCase);
}

/* ── Phase 11: run-target dialog + quick actions + presets ────────── */

const runTarget = $('run-target') ? {
	dialog: $('run-target'),
	close: $('rt-close'),
	cancel: $('rt-cancel'),
	runBtn: $('rt-run'),
	envsField: $('rt-envs-field'),
	error: $('rt-error'),
	sub: $('run-target-sub')
} : null;

/** Run-target dialog chip list (DX Phase 4) — same picker, add-mode. */
const runTargetDevices = $('run-target') ? createDeviceChipList({
	container: $('rt-device-chips'),
	addBtn: $('rt-add-device'),
	environmentsById: (id) => (testCaseView?.state.environmentsById ?? new Map()).get(id),
	onChange: () => {}
}) : null;


async function defaultEnvironmentId() {
	return localStorage.getItem('qase.environmentId') || '';
}

async function launchPairs(pairs, sourceLabel = '') {
	let created = 0;
	const failures = [];
	const sessionIds = [];
	const testCaseTitles = {};
	for (const { testCase, envId } of pairs) {
		try {
			const session = await createQaRunWithCase({ testCaseId: testCase.caseNumber, environmentId: envId });
			created += 1;
			if (session?.id) {
				sessionIds.push(session.id);
				testCaseTitles[session.id] = `${testCase.caseNumber} ${testCase.title ?? ''}`.trim();
			}
		} catch (error) {
			failures.push(`${testCase.caseNumber} @ ${envId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (batchTracker && sessionIds.length) {
		batchTracker.track(recordBatch({ label: sourceLabel.trim() || 'Bulk run', sessionIds, testCaseTitles }));
	}
	toast(
		created && !failures.length
			? `${sourceLabel}${created} run${created === 1 ? '' : 's'} launched.`
			: failures.length ? `${created} launched, ${failures.length} failed.` : 'Nothing launched.',
		failures.length ? 'bad' : ''
	);
	return { created, failures };
}

function openRunTarget(testCase) {
	if (!runTarget) return;
	quickRunState.testCase = testCase;
	runTarget.error.hidden = true;
	runTarget.error.textContent = '';
	const assigned = testCase.environmentIds ?? [];
	if (runTarget.sub) {
		runTarget.sub.textContent = assigned.length
			? `${assigned.length} device${assigned.length === 1 ? '' : 's'} assigned to this test.`
			: 'This test has no assigned devices — it will run on the current device emulation.';
	}
	runTargetDevices?.set(assigned);
	runTarget.envsField.hidden = true;
	for (const radio of runTarget.dialog.querySelectorAll('input[name="rt-choice"]')) radio.checked = radio.value === 'current';
	runTarget.dialog.querySelectorAll('input[name="rt-choice"]').forEach((radio) => {
		radio.onchange = () => { if (runTarget.envsField) runTarget.envsField.hidden = radio.value !== 'choose' || !radio.checked; };
	});
	if (!runTarget.dialog.open) runTarget.dialog.showModal();
}

async function submitRunTarget() {
	if (!runTarget || !quickRunState.testCase) return;
	const choice = runTarget.dialog.querySelector('input[name="rt-choice"]:checked')?.value ?? 'current';
	const testCase = quickRunState.testCase;
	const pairs = resolveRunPairs([testCase], choice, {
		defaultEnvId: await defaultEnvironmentId(),
		chosenEnvIds: runTargetDevices?.ids ?? []
	});
	runTarget.error.hidden = true;
	if (!pairs.length) {
		if (choice === 'current' && !(await defaultEnvironmentId())) {
			runTarget.error.hidden = false;
			runTarget.error.textContent = 'No current device chosen — open the device panel and pick one, or choose "All selected devices".';
			return;
		}
		runTarget.error.hidden = false;
		runTarget.error.textContent = 'Pick at least one device to run on.';
		return;
	}
	runTarget.dialog.close();
	await launchPairs(pairs, `${testCase.caseNumber}: `);
}

async function loadSessionsForFilters() {
	try {
		const sessions = await api('/sessions?limit=100');
		return Array.isArray(sessions) ? sessions : [];
	} catch {
		return [];
	}
}

async function runAllTests() {
	if (!bulkRunView) return;
	const sessions = await loadSessionsForFilters();
	bulkRunView.state.lastRuns = lastRunByCase(sessions);
	bulkRunView.state.cases = (await api('/test-cases').then((p) => p.testCases ?? []).catch(() => []));
	const pairs = resolveRunPairs(bulkRunView.state.cases, 'all');
	if (!pairs.length) {
		toast('No test cases with assigned environments yet — create one first.');
		return;
	}
	await launchPairs(pairs, 'Run all: ');
}

async function runFailedTests() {
	const sessions = await loadSessionsForFilters();
	const lastRuns = lastRunByCase(sessions);
	const cases = (await api('/test-cases').then((p) => p.testCases ?? []).catch(() => []));
	const failed = filterCasesForWizard(cases, 'failed', lastRuns);
	if (!failed.length) {
		toast('No failed runs to re-run — nice and green.');
		return;
	}
	await launchPairs(resolveRunPairs(failed, 'all'), 'Re-run failed: ');
}

async function createBugReport() {
	const sessions = await loadSessionsForFilters();
	// Findings live on the full session object (list payload carries only
	// findingCount) — load the freshest runs that have findings.
	const candidates = sessions
		.filter((s) => s.mode !== 'sqa' && s.mode !== 'founder' && Number(s.findingCount ?? 0) > 0)
		.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	if (!candidates.length) {
		toast('No findings recorded yet — nothing to report.');
		return;
	}
	// Prefer a run whose full detail (findings + snapshot) loads.
	let session = null;
	for (const candidate of candidates.slice(0, 3)) {
		const full = await api(`/sessions/${encodeURIComponent(candidate.id)}`).catch(() => null);
		if (full && Array.isArray(full.findings) && full.findings.length) { session = full; break; }
		if (!session) session = candidate;
	}
	if (!session) { toast('No findings recorded yet — nothing to report.'); return; }
	// Create the BUG-XXXX record — the server auto-associates the environment
	// snapshot + execution level from the linked run.
	let bug = null;
	try {
		bug = await api('/bugs', { method: 'POST', body: JSON.stringify({
			title: `${session.findings?.[0]?.title ?? 'QA finding'} — ${session.title ?? 'run'}`.slice(0, 300),
			description: buildBugMarkdown(session, null),
			severity: 'high',
			category: session.findings?.[0]?.category ?? 'general',
			expected: session.findings?.[0]?.expected ?? null,
			actual: session.findings?.[0]?.actual ?? null,
			environmentId: session.environmentId ?? null,
			environmentSnapshot: session.environmentSnapshot ?? undefined,
			executionLevel: session.executionLevel ?? session.runtimeFacts?.executionLevel ?? null,
			linkedRunId: session.id,
			linkedTestCaseId: session.testCaseId ?? null
		}) });
	} catch (error) {
		fail(error);
	}
	if (bug?.bugNumber) {
		toast(`Bug ${bug.bugNumber} created${bug.environmentSnapshot?.device ? ` · ${bug.environmentSnapshot.device}` : ''}.`);
		void refreshBugs();
		return;
	}
	// Record creation unavailable — fall back to the markdown export.
	const env = session.environmentSnapshot
		?? (session.environmentId ? (await api(`/environments/${encodeURIComponent(session.environmentId)}`).catch(() => null)) : null);
	const markdown = buildBugMarkdown(session, env);
	try {
		await navigator.clipboard.writeText(markdown);
		toast('Bug report copied to the clipboard.');
	} catch {
		toast('Bug report generated (clipboard blocked) — downloading instead.');
	}
	const blob = new Blob([markdown], { type: 'text/markdown' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `bug-${session.id?.slice(0, 8) ?? 'report'}.md`;
	link.click();
	URL.revokeObjectURL(url);
}

const quickActions = $('quick-actions') ? {
	strip: $('quick-actions'),
	runAll: $('qa-run-all'),
	runFailed: $('qa-run-failed'),
	createCase: $('qa-create-case'),
	chooseDevices: $('qa-choose-devices'),
	viewResults: $('qa-view-results'),
	createBug: $('qa-create-bug'),
	preset: $('qa-preset')
} : null;

if (quickActions) {
	if (quickActions.runAll) quickActions.runAll.addEventListener('click', () => void runAllTests());
	if (quickActions.runFailed) quickActions.runFailed.addEventListener('click', () => void runFailedTests());
	if (quickActions.createCase) quickActions.createCase.addEventListener('click', () => testCaseView?.open?.());
	if (quickActions.chooseDevices) quickActions.chooseDevices.addEventListener('click', () => devicePicker?.open?.());
	quickActions.viewResults?.addEventListener('click', () => {
		// Results live in the run history (left panel): refresh it and move
		// focus there. No separate results dialog exists by design.
		void refreshRuns();
		document.getElementById('run-list')?.focus?.();
		toast('Run history refreshed — pick a run to see its results.');
	});
	quickActions.createBug?.addEventListener('click', () => void createBugReport());
	quickActions.preset?.addEventListener('change', async () => {
		const presetId = quickActions.preset.value;
		if (!presetId || !bulkRunView) return;
		const environments = (await api('/environments?active=true&limit=1000').then((p) => p.environments ?? []).catch(() => []));
		if (bulkRunView.runPreset(presetId, { environmentsFor: (id) => environmentsForPreset(id, environments) })) {
			toast(`${quickActions.preset.selectedOptions[0]?.textContent ?? 'Preset'} ready — review the summary and run.`);
		}
		quickActions.preset.value = '';
	});
}

if (runTarget) {
	runTarget.close?.addEventListener('click', () => runTarget.dialog.close());
	runTarget.cancel?.addEventListener('click', () => runTarget.dialog.close());
	runTarget.runBtn?.addEventListener('click', () => void submitRunTarget());
}

/* ── Phase 12: run-screen environment block + bulk progress ───────── */

const batchTracker = $('bulk-progress') ? createBatchTracker({
	api,
	elements: {
		block: $('bulk-progress'),
		label: $('bulk-progress-label'),
		pct: $('bulk-progress-pct'),
		bar: $('bulk-progress-bar'),
		counts: $('bulk-progress-counts'),
		list: $('bulk-progress-list')
	},
	// Phase 4: the live preview follows the ACTIVE batch run. When the
	// executing run changes (RUN 1 finishes → RUN 2 starts), the whole live
	// view — device frame, browser chrome, environment card, runtime id —
	// switches to that run's environment automatically. One preview per
	// execution; environments are never blended.
	onTick: (batch, sessionsById) => {
		const activeId = activeBatchRunId(batch, sessionsById);
		if (!activeId || activeId === state.sessionId) return;
		void selectSession(activeId);
	}
}) : null;

// Environment block inside #run-summary-detail: test-case title, current
// environment, batch size — driven from the selected session's snapshot.
setRunEnvHook(renderRunEnvBlock);

// Restore a persisted batch after reload so mid-batch progress reappears.
if (batchTracker) {
	const restored = loadBatches().at(-1);
	if (restored?.sessionIds?.length) batchTracker.track(restored);
}

function renderRunEnvBlock(session) {
	const block = $('run-env-block');
	if (!block) return;
	const testcaseLine = $('run-env-testcase');
	const currentLine = $('run-env-current');
	const countLine = $('run-env-count');
	const snap = session?.environmentSnapshot;
	const hasEnv = Boolean(snap || session?.environmentId);
	block.hidden = !hasEnv && !session?.testCaseId;
	if (testcaseLine) {
		const title = session?.testCaseSnapshot?.title ?? session?.testCaseId;
		testcaseLine.textContent = title ? `Test case: ${title}` : '';
		testcaseLine.hidden = !title;
	}
	if (currentLine) {
		const deviceText = snap
			? [snap.device, [snap.os, snap.osVersion].filter(Boolean).join(' '), [snap.browser, snap.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
			: session?.environmentId ?? '';
		// Phase D2: execution type + live runtime state, always visible.
		const execType = session?.runtimeFacts?.executionLevel
			?? (snap?.executionProvider === 'local' ? 'SIMULATED' : 'VIRTUAL_DEVICE');
		const state = session?.status === 'running'
			? '● RUNNING'
			: session?.status === 'done' ? '● COMPLETED' : '● CONNECTED';
		currentLine.textContent = deviceText ? `TARGET DEVICE: ${deviceText} — ${execType} ${state}` : '';
		currentLine.hidden = !currentLine.textContent;
	}
	if (countLine) {
		const batch = batchTracker?.current;
		countLine.textContent = batch && batch.sessionIds.length > 1
			? `${batch.sessionIds.length} environments in this batch`
			: hasEnv ? '1 environment' : '';
		countLine.hidden = !countLine.textContent;
	}
}

// Paint on every snapshot and restore any persisted batch on load.
// Re-render the env block on every snapshot without redefining the hoisted
// function: a small post-hook invoked from applySessionSnapshot itself.

/* ── ONE Device Picker + activeTestEnvironment store (DX Phase 1) ── */
const activeTestEnvStore = createActiveTestEnvironmentStore();
/* UI Fix Phase 3: the feature-dock device chip (deviceDrawer.js, non-module
 * script scope boundary) reads the store through this accessor — one source
 * of truth for the selection. */
globalThis.__qaseActiveSelection = () => activeTestEnvStore.get();
const devicePicker = $('device-picker') ? createDevicePicker({
	elements: {
		dialog: $('device-picker'),
		search: $('dp-search'),
		tabs: [...document.querySelectorAll('#device-picker [data-dp-tab]')],
		types: [...document.querySelectorAll('#device-picker [data-dp-type]')],
		cards: $('dp-cards'),
		summary: $('dp-summary'),
		closeBtn: $('dp-close')
	},
	store: activeTestEnvStore,
	runtimeProfiles: RUNTIME_PROFILES,
	onSelect: (selection, env) => {
		if (deviceDrawer) deviceDrawer.state.defaultEnvId = env?.envId ?? null;
		deviceDrawer?.paintChip?.();
		if (state.session) applySessionSnapshot(state.session);
		renderAllTestOnBlocks(); // start dialogs read the same selection (DX Phase 3)
		cdSyncSelectedHighlight(); // inline Choose Device stays in sync (exec layout #14069)
	},
	onClose: () => void refreshDevicePickerData(),
	onOpen: () => void refreshDevicePickerData()
}) : null;

async function refreshDevicePickerData() {
	if (!devicePicker) return;
	devicePicker.setData({ environments: [], boardByEnvId: new Map(), dataState: 'loading' });
	cdRenderOnData();
	const environments = await api('/environments?active=true&limit=1000').then((p) => p.environments ?? []).catch(() => null);
	if (!Array.isArray(environments)) {
		// Catalog fetch failed: surface an honest error state, not empty data.
		devicePicker.setData({ environments: [], boardByEnvId: new Map(), dataState: 'error' });
		cdRenderOnData();
		return;
	}
	let boardByEnvId = new Map();
	try {
		const board = await api('/device-runtime/devices').catch(() => null);
		for (const device of board?.devices ?? []) {
			for (const e of device.environments ?? []) {
				if (e?.envId) boardByEnvId.set(e.envId, { status: device.status, maximumLevel: device.maximumLevel ?? null });
			}
		}
	} catch { /* board unavailable — badges fall back to neutral */ }
	devicePicker.setData({ environments, boardByEnvId, dataState: 'ready' });
	cdRenderOnData();
}

// Hydrate the persisted selection once environments are known; data is
// refreshed again every time the picker opens (onClose).
void (async () => {
	if (!devicePicker) return;
	const environments = await api('/environments?active=true&limit=1000').then((p) => p.environments ?? []).catch(() => null);
	if (!Array.isArray(environments)) {
		// Boot fetch failed: keep the picker in its honest error state instead
		// of an empty catalog (which would read as "nothing configured").
		devicePicker.setData({ environments: [], boardByEnvId: new Map(), dataState: 'error' });
		return;
	}
	devicePicker.setData({ environments, boardByEnvId: new Map() });
	const persisted = activeTestEnvStore.persistedEnvId();
	if (persisted) {
		const env = environments.find((e) => e.envId === persisted);
		if (env) devicePicker.hydrate(env);
		else activeTestEnvStore.clear();
	}
	renderAllTestOnBlocks();
})();

/* ── Device Matrix drawer (Phase 10) ─────────────────────────────── */
const deviceDrawer = $('device-drawer') ? createDeviceDrawer({
	api, toast, fail,
	onRunEnvironment: (env) => startEnvironmentRun(env),
	onApplied: (created) => {
		if (created?.length && testCaseView) testCaseView.refresh?.();
	},
	onOpenPicker: () => devicePicker?.open?.(),
	elements: {
		drawer: $('device-drawer'),
		chip: $('device-chip'),
		chipChange: $('device-chip-change'),
		chipLabel: $('device-chip-env'),
		search: $('dd-search'),
		tabs: [...document.querySelectorAll('#device-drawer [data-dd-tab]')],
		sections: $('dd-sections'),
		detail: $('dd-detail'),
		detailBody: $('dd-detail-body'),
		selectionSummary: $('dd-selection-summary'),
		applyBtn: $('dd-apply'),
		clearSelection: $('dd-clear-selection'),
		savedList: $('dd-saved-list'),
		savedRefresh: $('dd-saved-refresh'),
		closeBtn: $('dd-close'),
		advancedToggle: $('dd-advanced-toggle'),
		advancedBody: $('dd-advanced-body')
	}
}) : null;

// Wire the live-view environment card actions: Change and Device details.
// DX Phase 2: Change opens THE picker (single selection surface); details
// opens the Device Management catalog.
(function wireEnvironmentCardActions() {
	const change = document.getElementById('ldv-change-device');
	if (change) change.onclick = () => devicePicker?.open?.();
	const choose = document.getElementById('ldv-choose-device');
	if (choose) choose.onclick = () => devicePicker?.open?.();
	const details = document.getElementById('ldv-device-details');
	if (details) details.onclick = () => document.getElementById('open-device-matrix')?.click();
})();

// Paint the collapsed chip once environments are loaded (and refresh the
// saved list so Run/Set-default actions target real envIds).
// DX Phase 2: NO silent default device — if nothing was persisted, the chip
// stays empty and the empty-state card invites the user to choose one.
void (async () => {
	if (!deviceDrawer) return;
	await deviceDrawer.refreshEnvironments();
	deviceDrawer.state.defaultEnvId = localStorage.getItem('qase.environmentId') ?? null;
	deviceDrawer.paintChip();
})();

cfg.testBtn.onclick = async () => {
	await probeModelEndpoint();
};

cfg.saveBtn.onclick = async () => {
	try {
		const config = await api('/config', { method: 'PUT', body: JSON.stringify(readSettings()) });
		paintConfig(config);
		if (config.problem) {
			cfg.test.className = 'test-result bad';
			cfg.test.textContent = config.problem;
			return;
		}
		cfg.dialog.close();
		toast(config.runsKeepingOldSettings > 0
			? `Saved. ${config.runsKeepingOldSettings} run(s) already going keep the old settings.`
			: 'Settings saved.', 'good');
	} catch (error) {
		cfg.test.className = 'test-result bad';
		cfg.test.textContent = error instanceof Error ? error.message : String(error);
	}
};

/* ── Wiring ──────────────────────────────────────────────────────── */

el.composer.onsubmit = async event => {
	event.preventDefault();
	const text = el.composerInput.value.trim();
	if (!text || !state.sessionId) {
		return;
	}
	if (!state.config?.ready) {
		toast('Set up the model endpoint first.', 'bad');
		void openSettings();
		return;
	}
	el.composerInput.value = '';
	el.composerInput.style.height = 'auto';
	el.composerInput.style.overflowY = 'hidden';
	el.questionSlot.replaceChildren();
	await api(`/sessions/${state.sessionId}/message`, {
		method: 'POST',
		body: JSON.stringify({ text })
	}).catch(fail);
};

el.composerInput.addEventListener('input', () => {
	el.composerInput.style.height = 'auto';
	el.composerInput.style.height = `${Math.min(el.composerInput.scrollHeight, 170)}px`;
	el.composerInput.style.overflowY = el.composerInput.scrollHeight > 170 ? 'auto' : 'hidden';
});

// Collapse/expand the run summary. Pure UI: values already in state keep
// flowing to the mini row — nothing is refetched or recalculated.
el.runSummaryToggle?.addEventListener('click', () => {
	setRunSummaryCollapsed(!state.runSummaryCollapsed);
	renderMiniSummary();
});

el.composerInput.addEventListener('keydown', event => {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		el.composer.requestSubmit();
	}
});

window.addEventListener('resize', fitStageFrame, { passive: true });

el.newRun.onclick = openQaStart;
el.newSqa.onclick = openSqaStart;
el.newFounder.onclick = openFounderStart;
el.stopRun.onclick = () => api(`/sessions/${state.sessionId}/stop`, { method: 'POST' }).catch(fail);
el.signOut?.addEventListener('click', async () => {
  el.signOut.disabled = true;
  try {
    await api('/auth/logout', { method: 'POST' });
    state.stream?.close();
    localStorage.removeItem('qase.session');
    window.location.reload();
  } catch (error) { fail(error); el.signOut.disabled = false; }
});

el.thinkingHead.onclick = () => {
	if (el.thinkingStrip.classList.contains('has-detail')) {
		el.thinkingStrip.classList.toggle('is-open');
		updateThinkingStrip();
	}
};

document.addEventListener('keydown', event => {
	if (!el.authGate.hidden) return;
	if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
		event.preventDefault();
		void startRun();
	}
	if ((event.metaKey || event.ctrlKey) && event.key === ',') {
		event.preventDefault();
		void openSettings();
	}
	/* Escape closes the topmost open dialog (UI Fix Phase 4). Native <dialog>
	 * cancels on Escape already; this is a safety net for dialogs whose close
	 * is JS-driven (form method=dialog submit interception etc.). */
	if (event.key === 'Escape') {
		const top = [...document.querySelectorAll('dialog[open]')].pop();
		if (top && !top.matches(':modal')) top.close();
	}
});

const detailTabs = [...document.querySelectorAll('#tabs .tab')];

/* Auto-scroll ON/OFF button (UI Fix Phase 1). */
{
	const toggle = document.getElementById('activity-autoscroll');
	if (toggle) {
		toggle.onclick = () => {
			autoScrollState.activity = !autoScrollState.activity;
			toggle.setAttribute('aria-pressed', String(autoScrollState.activity));
			toggle.textContent = autoScrollState.activity ? 'Auto-scroll ON' : 'Auto-scroll OFF';
			if (autoScrollState.activity && el.activityFeed) scrollFeed(el.activityFeed);
		};
	}
}

function activateDetailTab(tab, moveFocus = false) {
	for (const other of detailTabs) {
		const active = other === tab;
		other.classList.toggle('is-active', active);
		other.setAttribute('aria-selected', String(active));
		other.tabIndex = active ? 0 : -1;
	}
	for (const pane of document.querySelectorAll('.tab-pane')) {
		pane.classList.toggle('is-active', pane.dataset.pane === tab.dataset.tab);
	}
	if (moveFocus) tab.focus();
}

for (const tab of detailTabs) {
	tab.onclick = () => activateDetailTab(tab);
	tab.onkeydown = event => {
		const availableTabs = detailTabs.filter(candidate => !candidate.hidden);
		const index = availableTabs.indexOf(tab);
		let next = index;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % availableTabs.length;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + availableTabs.length) % availableTabs.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = availableTabs.length - 1;
		else return;
		event.preventDefault();
		activateDetailTab(availableTabs[next], true);
	};
}

/* ── Boot ────────────────────────────────────────────────────────── */

async function bootWorkspace() {
	if (workspaceBooted) return;
	workspaceBooted = true;
	hideAuthGate();
	await window.qaseEntryReady;

	const config = await api('/config').catch(() => undefined);
	if (config) {
		paintConfig(config);
	}

	await loadDevices();
	void loadEnvironments();

	const runs = await api('/sessions').catch(() => []);
	const launchParameters = new URLSearchParams(window.location.search);
	const requestedRunId = launchParameters.get('run');
	if (requestedRunId && RUN_ID_PATTERN.test(requestedRunId)) {
		try {
			await selectSession(requestedRunId.toLowerCase());
			launchParameters.delete('run');
			const query = launchParameters.toString();
			window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
			el.composerInput.focus();
			return;
		} catch {
			// A stale or cross-project launch handle cannot select a run. Fall back
			// to the user's own latest visible run without leaking whether it exists.
			launchParameters.delete('run');
			const query = launchParameters.toString();
			window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
		}
	}
	const remembered = localStorage.getItem('qase.session');
	const target = runs.find(run => run.id === remembered) ?? runs[0];

	if (target) {
		await selectSession(target.id);
	} else {
		// No runs yet: don't ambush a brand-new workspace with a blocking modal.
		// Point at the composer; the QA dialog is one click (New run) away.
		toast('Welcome! Paste a URL below or press “QA” to start your first run.');
	}
	void refreshBugs();
	el.composerInput.focus();
}

(async function boot() {
	await window.qaseEntryReady;
	// Test Execution Timer: one shared second-hand for every live timer view.
	startTimerInterval();
	try {
		state.user = await api('/auth/me');
	} catch (error) {
		if (error?.status === 401) {
			showAuthGate();
			return;
		}
		// Older embedded hosts can omit the first-party auth adapter. Keep the
		// dashboard usable there while production instances always expose it.
		if (error?.status !== 404) {
			showAuthGate();
			return;
		}
	}
	await bootWorkspace();
})();

$('auth-show-password').onchange = event => { el.authPassword.type = event.target.checked ? 'text' : 'password'; };
const profileDialog = $('profile-dialog');
$('profile-close').onclick = () => profileDialog.close();
profileDialog.addEventListener('close', () => { $('password-form').reset(); });
async function refreshMemory() {
  const entries = await api('/memory');
  $('profile-memory').replaceChildren();
  if (!entries.length) $('profile-memory').textContent = 'No saved memory yet.';
  for (const entry of entries) {
    const item = document.createElement('li');
    item.textContent = entry.key + ': ' + entry.value + ' ';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost'; remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete memory ' + entry.key);
    remove.onclick = () => accountAction(remove, async () => { await api('/memory/' + entry.id, { method:'DELETE' }); await refreshMemory(); });
    item.append(remove); $('profile-memory').append(item);
  }
}
async function accountAction(button, work) {
  button.disabled = true; $('profile-message').textContent = '';
  try { await work(); } catch(error) { $('profile-message').textContent = error.message; }
  finally { button.disabled = false; }
}
$('open-profile').onclick = () => accountAction($('open-profile'), async () => {
  const user = await api('/profile');
  $('profile-name').value = user.displayName; $('profile-timezone').value = user.profile.timezone; $('profile-email').textContent = user.email;
  profileDialog.showModal(); await refreshMemory();
});
$('profile-form').onsubmit = event => { event.preventDefault(); accountAction(event.submitter, async () => {
  state.user = await api('/profile', { method:'PUT', body:JSON.stringify({displayName:$('profile-name').value,profile:{timezone:$('profile-timezone').value}}) });
  $('profile-message').textContent = 'Profile saved.';
}); };
$('password-form').onsubmit = event => { event.preventDefault(); accountAction(event.submitter, async () => {
  await api('/auth/password', { method:'POST', body:JSON.stringify({currentPassword:$('current-password').value,password:$('new-password').value}) });
  state.stream?.close(); window.location.reload();
}); };
$('memory-form').onsubmit = event => { event.preventDefault(); accountAction(event.submitter, async () => {
  await api('/memory', { method:'PUT', body:JSON.stringify({key:$('memory-key').value,value:$('memory-value').value}) });
  $('memory-form').reset(); await refreshMemory(); $('profile-message').textContent = 'Memory saved.';
}); };

/* Wire the picker host into the chip lists (DX Phase 4). Runs at the very end
 * of module evaluation, after devicePicker and runTargetDevices exist — the
 * earlier placement hit a temporal-dead-zone ReferenceError. */
if (devicePicker) {
	testCaseView?.deviceList?.setPickerHost?.(devicePicker);
	bulkRunView?.deviceList?.setPickerHost?.(devicePicker);
	runTargetDevices?.setPickerHost?.(devicePicker);
}
