/**
 * Shared utilities, element refs, and global state for the Qase dashboard.
 *
 * All modules import from here — it is the dependency root.
 */

const $ = id => document.getElementById(id);

const el = {
	runList: $('run-list'),
	newRun: $('new-run'),
	connDot: $('conn-dot'),
	connLabel: $('conn-label'),
	modelBadge: $('model-badge'),

	chatTitle: $('chat-title'),
	chatTarget: $('chat-target'),
	statusChip: $('status-chip'),
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
	frame: $('frame'),
	stageInner: $('stage-inner'),
	stageEmpty: $('stage-empty'),
	cursor: $('cursor'),
	cursorLabel: $('cursor-label'),
	ripple: $('ripple'),
	targetBox: $('target-box'),

	activityFeed: $('activity-feed'),
	planList: $('plan-list'),
	reportView: $('report-view'),
	countPlan: $('count-plan'),
	testcasePane: $('testcase-pane'),
	metricsOverview: $('metrics-overview'),
	projectSelect: $('project-select'),
	newProjectBtn: $('new-project'),
	suiteTree: $('suite-tree'),
	btnNewTestcase: $('btn-new-testcase'),
	btnNewSuite: $('btn-new-suite'),
	btnRunAllTests: $('btn-run-all-tests'),
	testsSearch: $('tests-search'),
	testsFilterSeverity: $('tests-filter-severity'),
	testsFilterViewport: $('tests-filter-viewport'),
	testsStats: $('tests-stats'),
	testsTagBarWrap: $('tc-tag-bar-wrap'),
	tcEditor: $('tc-editor'),
	tcEditorTitle: $('tc-editor-title'),
	tcEditorClose: $('tc-editor-close'),
	tcEditorSave: $('tc-editor-save'),
	tcEditName: $('tc-edit-name'),
	tcEditSeverity: $('tc-edit-severity'),
	tcEditUrl: $('tc-edit-url'),
	tcEditSuite: $('tc-edit-suite'),
	tcEditTags: $('tc-edit-tags'),
	tcEditViewport: $('tc-edit-viewport'),
	tcEditViewports: $('tc-edit-viewports'),
	tcEditPrecond: $('tc-edit-precond'),
	tcStepsList: $('tc-steps-list'),
	tcAddStep: $('tc-add-step'),
	tcAssertionsList: $('tc-assertions-list'),
	tcAddAssertion: $('tc-add-assertion'),
	toasts: $('toasts'),
	navCountBugs: $('nav-count-bugs'),
	bugsBoard: $('bugs-board'),
	bugsStats: $('bugs-stats'),
	bugSearch: $('bug-search'),
	bugFilterSeverity: $('bug-filter-severity'),
	bugFilterStatus: $('bug-filter-status'),
	bugFilterCategory: $('bug-filter-category'),
	bugFilterSort: $('bug-sort'),
	bugsPagination: $('bugs-pagination'),
	bugsPageSummary: $('bugs-page-summary'),
	bugsPagePrev: $('bugs-page-prev'),
	bugsPageNext: $('bugs-page-next'),
	bugViewGrid: $('bug-view-grid'),
	bugViewList: $('bug-view-list'),
	btnNewBug: $('btn-new-bug'),
	bugDetail: $('bug-detail'),
	bugDetailTitle: $('bug-detail-title'),
	bugDetailBody: $('bug-detail-body'),
	bugDetailFoot: $('bug-detail-foot'),
	bugDetailClose: $('bug-detail-close'),
	bugEditor: $('bug-editor'),
	bugEditorClose: $('bug-editor-close'),
	bugEditorSave: $('bug-editor-save'),
	bugEditTitle: $('bug-edit-title'),
	bugEditSeverity: $('bug-edit-severity'),
	bugEditCategory: $('bug-edit-category'),
	bugEditUrl: $('bug-edit-url'),
	bugEditSteps: $('bug-edit-steps'),
	bugEditExpected: $('bug-edit-expected'),
	bugEditActual: $('bug-edit-actual'),
	bugEditEvidence: $('bug-edit-evidence'),
	missionStageStrip: $('mission-stage-strip'),
	workflowsList: $('workflows-list'),
	workflowsSearch: $('workflows-search'),
	workflowsStats: $('workflows-stats'),
	schedulesList: $('schedules-list'),
	schedulesStats: $('schedules-stats'),
	schedulesTrend: $('schedules-trend'),
	btnNewSchedule: $('btn-new-schedule'),
	cfgBrowserstackEnabled: $('cfg-browserstack-enabled'),
	cfgBrowserstackBrowsers: $('cfg-browserstack-browsers'),
	cfgBrowserstackUser: $('cfg-browserstack-user'),
	cfgBrowserstackKey: $('cfg-browserstack-key'),
	cfgBrowserstackKeyClear: $('cfg-browserstack-key-clear')
};

const state = {
	sessionId: undefined,
	session: undefined,
	config: undefined,
	// D0.5 — who the browser is authenticated as: { kind: 'master' } or
	// { kind: 'session', role: 'viewer'|'operator', label }. undefined while
	// booting. Drives role-aware UI (hide Settings/config for team roles).
	auth: undefined,
	stream: undefined,
	bubbles: new Map(),
	viewport: { width: 1440, height: 900 },
	cursorTimer: undefined,
	thinking: { text: '', action: '' },
	capturedSteps: [],
	testCases: [],
	schedules: [],
	regressionTrend: [],
	projectId: undefined,
	projects: [],
	suites: [],
	tagFilter: null,
	suiteFilter: null,
	testsSearch: '',
	testsSeverityFilter: '',
	testsViewportFilter: '',
	editingTc: null,
	editorSteps: [],
	editorAssertions: [],
	workflowState: { workflows: [], search: '', expanded: new Set() }
};

/* ── Helpers ─────────────────────────────────────────────────────── */

async function api(path, options) {
	// D2 — human users authenticate with the HttpOnly qase_session cookie
	// (sent automatically by the browser, same-origin). Machine consumers use
	// Authorization: Bearer. Nothing is kept in localStorage.
	const headers = { 'Content-Type': 'application/json', ...(options?.headers ?? {}) };
	// Spread everything EXCEPT headers — callers pass their own headers key,
	// which would otherwise clobber the token-attached headers object above
	// (observed live: "New run" 401'd for an authenticated user because the
	// built headers never reached fetch).
	const { headers: _callerHeaders, ...rest } = options ?? {};
	const response = await fetch(`/api${path}`, { ...rest, headers });
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error ?? `Request failed (${response.status})`);
	}
	return response.status === 204 ? undefined : response.json();
}

/**
 * B1 W3 — authed raw fetch for endpoints that return text/blobs (report.md,
 * fix-prompt, exports) instead of JSON. Same token attachment as api().
 */
async function apiRaw(path, options) {
	// D2 — session cookie carries auth; machine consumers pass their own
	// Authorization header via options.headers.
	const headers = { ...(options?.headers ?? {}) };
	const { headers: _callerHeaders, ...rest } = options ?? {};
	const response = await fetch(`/api${path}`, { ...rest, headers });
	if (!response.ok) throw new Error(`Request failed (${response.status})`);
	return response;
}

function toast(message, kind = '') {
	const node = document.createElement('div');
	node.className = `toast ${kind}`;
	node.textContent = message;
	el.toasts.append(node);
	setTimeout(() => {
		node.classList.add('is-leaving');
		node.addEventListener('animationend', () => node.remove(), { once: true });
	}, kind === 'bad' ? 6000 : 3600);
}

const fail = error => toast(error instanceof Error ? error.message : String(error), 'bad');

function escapeHtml(text) {
	return text.replace(/[&<>"']/g, character => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
	));
}

function markdown(text) {
	const blocks = [];
	let html = escapeHtml(text)
		.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
			blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
			return `\uE000${blocks.length - 1}\uE000`;
		})
		.replace(/`([^`\n]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
		.replace(/^#{1,6}\s+(.+)$/gm, '<h3>$1</h3>');

	html = html
		.replace(/(?:^[-*]\s+.+(?:\n|$))+/gm, match =>
			`<ul>${match.trim().split('\n').map(line => `<li>${line.replace(/^[-*]\s+/, '')}</li>`).join('')}</ul>`)
		.replace(/(?:^\d+[.)]\s+.+(?:\n|$))+/gm, match =>
			`<ol>${match.trim().split('\n').map(line => `<li>${line.replace(/^\d+[.)]\s+/, '')}</li>`).join('')}</ol>`);

	html = html
		.split(/\n{2,}/)
		.map(chunk => (/^\s*(<(ul|ol|pre|h3)|\uE000)/.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, '<br>')}</p>`))
		.join('')
		.replace(/<p>\s*<\/p>/g, '')
		.replace(/\uE000(\d+)\uE000/g, (_match, index) => blocks[Number(index)]);

	return html;
}

function hostOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function relativeTime(ts) {
	const seconds = Math.round((Date.now() - ts) / 1000);
	if (seconds >= -60 && seconds < 60) return 'just now';
	// Future timestamps (e.g. a schedule's nextRunAt) read as "in …", not "just now".
	if (seconds < 0) {
		const ahead = Math.abs(seconds);
		if (ahead < 3600) return `in ${Math.round(ahead / 60)}m`;
		if (ahead < 86_400) return `in ${Math.round(ahead / 3600)}h`;
		return new Date(ts).toLocaleDateString();
	}
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
	return new Date(ts).toLocaleDateString();
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/* ── Theme toggle ────────────────────────────────────────────────── */
function initThemeToggle() {
	const btn = $('theme-toggle');
	if (!btn) return;

	// Sync icon with current theme.
	const sync = () => {
		const isLight = document.documentElement.getAttribute('data-theme') === 'light';
		btn.textContent = isLight ? '☀️' : '🌙';
	};
	sync();

	btn.addEventListener('click', () => {
		const isLight = document.documentElement.getAttribute('data-theme') === 'light';
		const next = isLight ? 'dark' : 'light';
		if (next === 'dark') {
			document.documentElement.removeAttribute('data-theme');
		} else {
			document.documentElement.setAttribute('data-theme', 'light');
		}
		localStorage.setItem('qase.theme', next === 'dark' ? '' : 'light');
		sync();
	});
}

const STEP_ICONS = {
	navigate: '🧭', click: '👆', fill: '✏️', check: '☑️',
	select: '▾', type: '⌨️', key: '🔑', scroll: '📜',
	hover: '🖱️', screenshot: '📸', diagnostics: '🔍', snapshot: '👁️'
};

const CRON_PRESETS = [
	{ label: 'Daily 9am',     value: '0 9 * * *' },
	{ label: 'Mon + Thu 9am', value: '0 9 * * 1,4' },
	{ label: 'Every 6 hours', value: '0 */6 * * *' },
	{ label: 'Mon 9am',       value: '0 9 * * 1' },
	{ label: 'Weekdays 9am',  value: '0 9 * * 1-5' }
];

/* ── BUILD 1: shared page loading / error / retry states ─────────── */

/**
 * Show the first-load skeleton in a page's list container.
 * `container` is the element that will hold the rendered content.
 */
function showPageLoading(container) {
	if (!container) return;
	container.replaceChildren();
	const bar = document.createElement('div');
	bar.className = 'page-loading';
	bar.setAttribute('aria-busy', 'true');
	bar.innerHTML = '<div class="page-loading-bar"></div><div class="page-loading-bar is-short"></div><div class="page-loading-bar is-faint"></div>';
	container.append(bar);
}

/**
 * Show an inline error banner with a Retry button. `retry` is re-invoked on
 * click. Any previous banner/loading state in the container is replaced.
 */
function showPageError(container, retry, message) {
	if (!container) return;
	container.replaceChildren();
	const box = document.createElement('div');
	box.className = 'page-error';
	box.setAttribute('role', 'alert');
	const msg = document.createElement('p');
	msg.textContent = message || 'Could not load this page.';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'btn btn-sm';
	btn.textContent = 'Retry';
	btn.addEventListener('click', () => { void retry(); });
	box.append(msg, btn);
	container.append(box);
}

/** Clear loading/error state from a container before rendering content. */
function clearPageState(container) {
	if (!container) return;
	const loading = container.querySelector(':scope > .page-loading');
	if (loading) loading.remove();
	const error = container.querySelector(':scope > .page-error');
	if (error) error.remove();
}

export { $, el, state, api, apiRaw, toast, fail, escapeHtml, markdown, hostOf, relativeTime, truncate, STEP_ICONS, CRON_PRESETS, initThemeToggle, showPageLoading, showPageError, clearPageState };
