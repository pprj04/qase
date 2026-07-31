/**
 * Qase dashboard.
 *
 * Three panels over one SSE stream. The server owns all state; this file
 * renders it and sends back the two things the user can contribute — an
 * instruction, and an answer to a blocking question.
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
	findingsList: $('findings-list'),
	reportView: $('report-view'),
	workflowPane: $('workflow-pane'),
	countPlan: $('count-plan'),
	countFindings: $('count-findings'),
	countWorkflows: $('count-workflows'),
	testcasePane: $('testcase-pane'),
	countTestcases: $('count-testcases'),
	regressionPane: $('regression-pane'),
	countRegression: $('count-regression'),
	metricsOverview: $('metrics-overview'),
	projectSelect: $('project-select'),
	newProjectBtn: $('new-project'),
	suiteTree: $('suite-tree'),
	btnNewTestcase: $('btn-new-testcase'),
	btnNewSuite: $('btn-new-suite'),
	tcEditor: $('tc-editor'),
	tcEditorTitle: $('tc-editor-title'),
	tcEditorClose: $('tc-editor-close'),
	tcEditorSave: $('tc-editor-save'),
	tcEditName: $('tc-edit-name'),
	tcEditSeverity: $('tc-edit-severity'),
	tcEditUrl: $('tc-edit-url'),
	tcEditSuite: $('tc-edit-suite'),
	tcEditTags: $('tc-edit-tags'),
	tcEditPrecond: $('tc-edit-precond'),
	tcStepsList: $('tc-steps-list'),
	tcAddStep: $('tc-add-step'),
	tcAssertionsList: $('tc-assertions-list'),
	tcAddAssertion: $('tc-add-assertion'),
	toasts: $('toasts'),
	openBugs: $('open-bugs'),
	countBugs: $('count-bugs'),
	bugsHub: $('bugs-hub'),
	bugsBoard: $('bugs-board'),
	bugsStats: $('bugs-stats'),
	bugSearch: $('bug-search'),
	bugFilterSeverity: $('bug-filter-severity'),
	bugFilterStatus: $('bug-filter-status'),
	bugFilterCategory: $('bug-filter-category'),
	btnNewBug: $('btn-new-bug'),
	closeBugs: $('close-bugs'),
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
	bugEditEvidence: $('bug-edit-evidence')
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
	/** Live reasoning for the current turn. Never kept once the agent replies. */
	thinking: { text: '', action: '' },
	/** Steps captured from the current session's browser actions. */
	capturedSteps: [],
	/** Test cases for the current session's target URL. */
	testCases: [],
	/** Saved schedules. */
	schedules: [],
	/** Regression run history for trend chart. */
	regressionTrend: [],
	/** Active project ID (undefined = all / Default). */
	projectId: undefined,
	/** All projects list. */
	projects: [],
	/** Test suites for the current project. */
	suites: [],
	/** Active tag filter (null = no filter). */
	tagFilter: null,
	/** Editing context: null = new, object = existing tc. */
	editingTc: null,
	/** Editor step/assertion working data. */
	editorSteps: [],
	editorAssertions: []
};

/* ── Helpers ─────────────────────────────────────────────────────── */

async function api(path, options) {
	const response = await fetch(`/api${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...options
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error ?? `Request failed (${response.status})`);
	}
	return response.status === 204 ? undefined : response.json();
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

/**
 * Just enough markdown for what an agent writes. Escapes first, so anything it
 * quotes from the page under test cannot become live markup.
 */
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

	// Group consecutive bullet or numbered lines into a single list.
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
	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
	return new Date(ts).toLocaleDateString();
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/* ── Runs (left panel) ───────────────────────────────────────────── */

async function refreshRuns() {
	const query = state.projectId ? `?projectId=${state.projectId}` : '';
	const runs = await api(`/sessions${query}`).catch(() => []);
	if (runs.length === 0) {
		el.runList.innerHTML = '<div class="feed-empty">No runs yet</div>';
		return;
	}
	el.runList.replaceChildren(...runs.map(renderRun));
}

function renderRun(run) {
	const node = document.createElement('button');
	node.className = `run${run.id === state.sessionId ? ' is-active' : ''}`;
	node.onclick = () => selectSession(run.id);

	const title = document.createElement('div');
	title.className = 'run-title';
	title.textContent = run.targetUrl ? hostOf(run.targetUrl) : run.title;

	const meta = document.createElement('div');
	meta.className = 'run-meta';
	const dot = document.createElement('span');
	dot.className = `dot${run.status === 'running' ? ' is-busy' : run.status === 'done' ? ' is-live' : ''}`;
	meta.append(dot, document.createTextNode(relativeTime(run.updatedAt)));
	if (run.findingCount > 0) {
		const badge = document.createElement('span');
		badge.className = 'run-badge';
		badge.textContent = `${run.findingCount}`;
		meta.append(badge);
	}

	const remove = document.createElement('button');
	remove.className = 'run-del';
	remove.textContent = '×';
	remove.title = 'Delete this run';
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

	node.append(title, meta, remove);
	return node;
}

/* ── Session loading ─────────────────────────────────────────────── */

async function selectSession(id) {
	state.sessionId = id;
	state.bubbles.clear();
	localStorage.setItem('qase.session', id);

	const session = await api(`/sessions/${id}`);
	state.session = session;

	renderHeader();
	renderTranscript();
	resetThinking();
	renderQuestion();
	renderActivities();
	renderTodos();
	renderFindings();
	renderReport();
	await loadWorkflows();
	await loadTestCases();
	await loadRegression();
	await loadMetrics();

	if (session.frame) {
		applyFrame(session.frame);
	} else {
		el.frame.removeAttribute('src');
		el.stageInner.hidden = true;
		el.stageEmpty.hidden = false;
		el.browserUrl.textContent = session.targetUrl ?? 'about:blank';
		el.browserTitle.textContent = '';
	}

	connect(id);
	await refreshRuns();
}

async function startRun() {
	const body = state.projectId ? { projectId: state.projectId } : {};
	const session = await api('/sessions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await selectSession(session.id);
	el.composerInput.focus();
}

function renderHeader() {
	const session = state.session;
	el.chatTitle.textContent = session.targetUrl ? hostOf(session.targetUrl) : session.title;
	el.chatTarget.textContent = session.targetUrl ?? 'Send a URL to begin';
	setStatus(session.status);
}

function setStatus(status) {
	el.statusChip.dataset.status = status;
	el.statusChip.textContent = status === 'awaiting_input' ? 'waiting for you' : status;
	const running = status === 'running';
	el.stopRun.hidden = !running;
	el.sendBtn.disabled = running;
	el.browserDot.className = `dot${running ? ' is-busy' : state.session?.targetUrl ? ' is-live' : ''}`;
	if (state.session) {
		state.session.status = status;
	}
	// A question raised while the tab is in the background should be noticeable.
	document.title = status === 'awaiting_input'
		? 'Qase — waiting for you'
		: 'Qase — autonomous QA agent';
	updateThinkingStrip();
}

/* ── Transcript ──────────────────────────────────────────────────── */

function renderTranscript() {
	el.transcript.replaceChildren();
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
	tag.textContent = question.credentialLike ? 'Credentials needed' : 'Decision needed';

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

	card.append(question.credentialLike ? credentialForm() : optionForm(question));
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
	username.autocomplete = 'off';
	const password = document.createElement('input');
	password.type = 'password';
	password.placeholder = 'Password';
	password.autocomplete = 'off';
	row.append(username, password);

	const extra = document.createElement('input');
	extra.placeholder = 'One-time code or extra field (optional)';
	extra.autocomplete = 'off';

	const note = document.createElement('div');
	note.className = 'cred-note';
	note.innerHTML = 'Held in this server\'s memory only — never written to disk, never sent to the model. ' +
		'The agent fills the form with <code>{{QA_USERNAME}}</code> and <code>{{QA_PASSWORD}}</code>; the real values are swapped in at the keyboard.';

	const actions = document.createElement('div');
	actions.className = 'cred-actions';
	const skip = document.createElement('button');
	skip.type = 'button';
	skip.className = 'btn btn-ghost btn-sm';
	skip.textContent = 'Skip login';
	skip.onclick = () => sendAnswer('No credentials available. Skip anything behind the login and test what is reachable while signed out.');
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
		el.activityFeed.innerHTML = '<div class="feed-empty">Nothing yet</div>';
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
	node.dataset.id = activity.id;

	const icon = document.createElement('span');
	icon.className = 'act-icon';
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

function scrollFeed(feed) {
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
		el.planList.innerHTML = '<div class="feed-empty">The agent has not written a test plan yet</div>';
		return;
	}
	for (const todo of todos) {
		const node = document.createElement('div');
		node.className = `todo ${todo.status}`;
		const mark = document.createElement('span');
		mark.className = 'todo-mark';
		mark.textContent = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○';
		const text = document.createElement('span');
		text.className = 'todo-text';
		text.textContent = todo.text;
		node.append(mark, text);
		el.planList.append(node);
	}
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function renderFindings() {
	const findings = state.session.findings ?? [];
	el.countFindings.textContent = findings.length > 0 ? `${findings.length}` : '';
	el.countFindings.classList.toggle('is-alert', findings.some(finding => finding.severity === 'critical'));

	el.findingsList.replaceChildren();
	if (findings.length === 0) {
		el.findingsList.innerHTML = '<div class="feed-empty">No findings filed yet</div>';
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

	const head = document.createElement('button');
	head.className = 'finding-head';
	head.type = 'button';
	const title = document.createElement('span');
	title.className = 'finding-title';
	title.textContent = finding.title;
	const sev = document.createElement('span');
	sev.className = 'sev';
	sev.textContent = finding.severity;
	head.append(title, sev);
	head.onclick = () => node.classList.toggle('is-open');

	const body = document.createElement('div');
	body.className = 'finding-body';

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

	const actions = document.createElement('div');
	actions.className = 'finding-actions';
	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy as ticket';
	copy.onclick = async () => {
		await navigator.clipboard.writeText(findingAsTicket(finding));
		toast('Finding copied to the clipboard.', 'good');
	};
	actions.append(copy);
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

function renderReport() {
	const report = state.session.report;
	el.reportView.replaceChildren();
	if (!report) {
		el.reportView.innerHTML = '<div class="feed-empty">The report is published when the run finishes</div>';
		return;
	}

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

	const actions = document.createElement('div');
	actions.className = 'report-actions';
	const download = document.createElement('a');
	download.className = 'btn btn-ghost btn-sm';
	download.href = `/api/sessions/${state.sessionId}/report.md`;
	download.download = 'qase-report.md';
	download.textContent = 'Download .md';
	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy report';
	copy.onclick = async () => {
		const markdownText = await fetch(`/api/sessions/${state.sessionId}/report.md`).then(response => response.text());
		await navigator.clipboard.writeText(markdownText);
		toast('Report copied to the clipboard.', 'good');
	};
	actions.append(download, copy);
	el.reportView.append(actions);
}

function section(heading, body) {
	const node = document.createElement('div');
	node.className = 'report-section';
	const title = document.createElement('h3');
	title.textContent = heading;
	node.append(title, body);
	return node;
}

function paragraph(text) {
	const node = document.createElement('p');
	node.textContent = text ?? '';
	return node;
}

/* ── Workflows ──────────────────────────────────────────────────── */

const STEP_ICONS = {
	navigate: '🧭', click: '👆', fill: '✏️', check: '☑️',
	select: '▾', type: '⌨️', key: '🔑', scroll: '📜',
	hover: '🖱️', screenshot: '📸', diagnostics: '🔍', snapshot: '👁️'
};

let savedWorkflows = [];

async function loadWorkflows() {
	const steps = state.session?.capturedSteps ?? [];
	state.capturedSteps = Array.isArray(steps) ? [...steps] : [];

	if (state.sessionId) {
		try {
			const data = await api(`/sessions/${state.sessionId}/workflow`);
			savedWorkflows = data.savedWorkflows ?? [];
		} catch {
			savedWorkflows = [];
		}
	}
	renderWorkflows();
}

function renderWorkflows() {
	el.workflowPane.replaceChildren();
	el.countWorkflows.textContent = state.capturedSteps.length || '';

	if (state.capturedSteps.length === 0 && savedWorkflows.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'workflow-empty';
		empty.innerHTML = '<p>No workflow steps yet.</p><small>Browser actions taken by the agent will appear here as a captureable timeline.</small>';
		el.workflowPane.append(empty);
		return;
	}

	/* ── Captured steps timeline ── */
	if (state.capturedSteps.length > 0) {
		const captureSection = document.createElement('div');
		captureSection.className = 'wf-section';

		const heading = document.createElement('h3');
		heading.className = 'wf-section-heading';
		heading.textContent = `Captured steps (${state.capturedSteps.length})`;

		const saveForm = document.createElement('div');
		saveForm.className = 'wf-save-form';

		const nameInput = document.createElement('input');
		nameInput.type = 'text';
		nameInput.placeholder = 'Workflow name (e.g. "Login flow")';
		nameInput.className = 'wf-name-input';

		const saveBtn = document.createElement('button');
		saveBtn.className = 'wf-save-btn';
		saveBtn.textContent = 'Save as workflow';
		saveBtn.onclick = async () => {
			const name = nameInput.value.trim();
			if (!name) {
				toast('Enter a name for the workflow.', 'bad');
				return;
			}
			try {
				saveBtn.disabled = true;
				saveBtn.textContent = 'Saving…';
				const wf = await api(`/sessions/${state.sessionId}/workflow`, {
					method: 'POST',
					body: JSON.stringify({ name })
				});
				savedWorkflows.unshift({
					id: wf.id, name: wf.name, stepCount: wf.steps.length,
					targetUrl: wf.targetUrl, tags: wf.tags,
					createdAt: wf.createdAt, updatedAt: wf.updatedAt
				});
				nameInput.value = '';
				renderSavedWorkflows();
				toast(`Workflow "${wf.name}" saved.`, 'good');
			} catch (error) {
				toast(fail(error), 'bad');
			} finally {
				saveBtn.disabled = false;
				saveBtn.textContent = 'Save as workflow';
			}
		};

		saveForm.append(nameInput, saveBtn);

		const timeline = document.createElement('div');
		timeline.className = 'wf-timeline';

		for (const step of state.capturedSteps) {
			timeline.append(renderWorkflowStep(step));
		}

		captureSection.append(heading, saveForm, timeline);
		el.workflowPane.append(captureSection);
	}

	renderSavedWorkflows();
}

function renderWorkflowStep(step) {
	const node = document.createElement('div');
	node.className = 'wf-step';

	const icon = document.createElement('span');
	icon.className = 'wf-step-icon';
	icon.textContent = STEP_ICONS[step.action] ?? '•';

	const body = document.createElement('div');
	body.className = 'wf-step-body';

	const action = document.createElement('span');
	action.className = 'wf-step-action';
	action.textContent = step.displayLabel ?? step.action;

	const detail = document.createElement('span');
	detail.className = 'wf-step-detail';
	if (step.target && step.value) {
		detail.textContent = `${step.target} = ${step.value}`;
	} else if (step.target) {
		detail.textContent = step.target;
	} else {
		detail.textContent = '';
	}

	body.append(action, detail);

	const ts = document.createElement('span');
	ts.className = 'wf-step-ts';
	if (step.ts) {
		ts.textContent = new Date(step.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	node.append(icon, body, ts);
	return node;
}

function renderSavedWorkflows() {
	const existing = el.workflowPane.querySelector('.wf-saved-section');
	if (existing) {
		existing.remove();
	}

	if (savedWorkflows.length === 0) {
		return;
	}

	const section = document.createElement('div');
	section.className = 'wf-section wf-saved-section';

	const heading = document.createElement('h3');
	heading.className = 'wf-section-heading';
	heading.textContent = `Saved workflows (${savedWorkflows.length})`;

	const list = document.createElement('div');
	list.className = 'wf-saved-list';

	for (const wf of savedWorkflows) {
		const item = document.createElement('div');
		item.className = 'wf-saved-item';

		const name = document.createElement('span');
		name.className = 'wf-saved-name';
		name.textContent = wf.name;

		const meta = document.createElement('span');
		meta.className = 'wf-saved-meta';
		const parts = [`${wf.stepCount} steps`];
		if (wf.targetUrl) {
			parts.push(hostOf(wf.targetUrl));
		}
		parts.push(relativeTime(wf.updatedAt ?? wf.createdAt));
		meta.textContent = parts.join(' · ');

		const del = document.createElement('button');
		del.className = 'wf-saved-delete';
		del.textContent = 'Delete';
		del.title = 'Delete workflow';
		del.onclick = async () => {
			try {
				await api(`/workflows/${wf.id}`, { method: 'DELETE' });
				savedWorkflows = savedWorkflows.filter(w => w.id !== wf.id);
				renderSavedWorkflows();
				toast(`Deleted "${wf.name}".`, 'good');
			} catch (error) {
				toast(fail(error), 'bad');
			}
		};

		const gen = document.createElement('button');
		gen.className = 'wf-saved-gen';
		gen.textContent = 'Gen Tests';
		gen.title = 'Generate test cases from this workflow';
		gen.onclick = async () => {
			try {
				gen.disabled = true;
				gen.textContent = 'Generating…';
				const created = await api(`/workflows/${wf.id}/generate-tests`, { method: 'POST' });
				if (Array.isArray(created)) {
					for (const tc of created) {
						state.testCases.unshift(tc);
					}
					renderTestCases();
					toast(`Generated ${created.length} test case${created.length === 1 ? '' : 's'}.`, 'good');
				}
			} catch (error) {
				toast(fail(error), 'bad');
			} finally {
				gen.disabled = false;
				gen.textContent = 'Gen Tests';
			}
		};

		item.append(name, meta, gen, del);
		list.append(item);
	}

	section.append(heading, list);
	el.workflowPane.append(section);
}

/* ── Test Cases ─────────────────────────────────────────────────── */

const SEVERITY_COLORS = {
	critical: '#ff4444', high: '#ff8c00', medium: '#0a84ff', low: '#8e8e93'
};

const ASSERTION_ICONS = {
	url_is: '🔗', url_contains: '🔗', element_visible: '👁️', element_hidden: '🚫',
	element_text: '📝', element_enabled: '⚡', no_console_errors: '🖥️',
	no_failed_requests: '🌐', status_code: '📊', custom: '❓'
};

async function loadTestCases() {
	state.testCases = [];
	const projectId = state.session?.projectId ?? state.projectId;
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const query = params.toString() ? `?${params.toString()}` : '';
	try {
		state.testCases = await api(`/test-cases${query}`);
	} catch {
		state.testCases = [];
	}

	// Load suites for the project.
	try {
		state.suites = await api(`/suites${query}`);
	} catch {
		state.suites = [];
	}

	renderSuiteTree();
	renderTestCases();
}

function renderTestCases() {
	el.testcasePane.replaceChildren();

	// Apply tag filter + suite filter.
	let visible = state.testCases;
	if (state.tagFilter) {
		visible = visible.filter(tc => (tc.tags ?? []).includes(state.tagFilter));
	}
	if (state.suiteFilter) {
		visible = visible.filter(tc => tc.suiteId === state.suiteFilter);
		const suite = state.suites.find(s => s.id === state.suiteFilter);
		if (suite) {
			const filterBar = document.createElement('div');
			filterBar.className = 'tc-suite-filter-bar';
			filterBar.innerHTML = `<span>Filtered by suite: <strong>${escapeHtml(suite.name)}</strong></span>`;
			const clearBtn = document.createElement('button');
			clearBtn.className = 'tc-tag-chip';
			clearBtn.textContent = '✕ Clear filter';
			clearBtn.onclick = () => { state.suiteFilter = null; renderTestCases(); renderSuiteTree(); };
			filterBar.append(clearBtn);
			el.testcasePane.append(filterBar);
		}
	}

	el.countTestcases.textContent = state.testCases.length || '';

	// Tag filter chips.
	const allTags = [...new Set(state.testCases.flatMap(tc => tc.tags ?? []))].sort();
	if (allTags.length > 0) {
		const tagBar = document.createElement('div');
		tagBar.className = 'tc-tag-bar';
		if (state.tagFilter) {
			const clearChip = document.createElement('button');
			clearChip.className = 'tc-tag-chip tc-tag-active';
			clearChip.textContent = `✕ ${state.tagFilter}`;
			clearChip.onclick = () => { state.tagFilter = null; renderTestCases(); };
			tagBar.append(clearChip);
		} else {
			for (const tag of allTags) {
				const chip = document.createElement('button');
				chip.className = 'tc-tag-chip';
				chip.textContent = tag;
				chip.onclick = () => { state.tagFilter = tag; renderTestCases(); };
				tagBar.append(chip);
			}
		}
		el.testcasePane.append(tagBar);
	}

	if (visible.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'tc-empty';
		if (state.tagFilter) {
			empty.innerHTML = `<p>No test cases with tag "${escapeHtml(state.tagFilter)}".</p>`;
		} else if (state.suiteFilter) {
			empty.innerHTML = '<p>No test cases in this suite.</p>';
		} else {
			empty.innerHTML = '<p>No test cases yet.</p><small>Save a workflow → Gen Tests, or click "New Test Case" to create one manually.</small>';
		}
		el.testcasePane.append(empty);
		return;
	}

	// Run All button
	const toolbar = document.createElement('div');
	toolbar.className = 'tc-toolbar';
	const runAllBtn = document.createElement('button');
	runAllBtn.className = 'tc-run-all';
	runAllBtn.textContent = 'Run All';
	runAllBtn.onclick = () => runAllTests();
	toolbar.append(runAllBtn);
	el.testcasePane.append(toolbar);

	for (const tc of visible) {
		el.testcasePane.append(renderTestCaseCard(tc));
	}
}

function renderTestCaseCard(tc) {
	const card = document.createElement('div');
	card.className = 'tc-card';
	card.dataset.id = tc.id;

	// Header
	const header = document.createElement('div');
	header.className = 'tc-header';

	const sevDot = document.createElement('span');
	sevDot.className = 'tc-sev-dot';
	sevDot.style.background = SEVERITY_COLORS[tc.severity] ?? SEVERITY_COLORS.medium;

	const name = document.createElement('span');
	name.className = 'tc-name';
	name.textContent = tc.name;

	const stepCount = document.createElement('span');
	stepCount.className = 'tc-step-count';
	stepCount.textContent = `${tc.steps?.length ?? 0} steps · ${tc.assertions?.length ?? 0} assertions`;

	const delBtn = document.createElement('button');
	delBtn.className = 'tc-delete';
	delBtn.textContent = '✕';
	delBtn.title = 'Delete test case';
	delBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			await api(`/test-cases/${tc.id}`, { method: 'DELETE' });
			state.testCases = state.testCases.filter(t => t.id !== tc.id);
			card.remove();
			el.countTestcases.textContent = state.testCases.length || '';
			toast(`Deleted "${tc.name}".`, 'good');
		} catch (error) {
			toast(fail(error), 'bad');
		}
	};

	const cloneBtn = document.createElement('button');
	cloneBtn.className = 'tc-clone';
	cloneBtn.textContent = '⧉';
	cloneBtn.title = 'Clone test case';
	cloneBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			const clone = await api(`/test-cases/${tc.id}/clone`, { method: 'POST' });
			state.testCases.unshift(clone);
			el.testcasePane.insertBefore(renderTestCaseCard(clone), card.nextSibling);
			el.countTestcases.textContent = state.testCases.length || '';
			toast(`Cloned "${tc.name}".`, 'good');
		} catch (error) {
			toast(fail(error), 'bad');
		}
	};

	const editBtn = document.createElement('button');
	editBtn.className = 'tc-edit';
	editBtn.textContent = '✎';
	editBtn.title = 'Edit test case';
	editBtn.onclick = (e) => {
		e.stopPropagation();
		openTcEditor(tc);
	};

	const runBtn = document.createElement('button');
	runBtn.className = 'tc-run';
	runBtn.textContent = 'Run';
	runBtn.title = 'Run this test case';
	runBtn.onclick = async (e) => {
		e.stopPropagation();
		await runSingleTest(tc, card, runBtn);
	};

	const approveBtn = document.createElement('button');
	approveBtn.className = 'tc-approve-baseline';
	approveBtn.textContent = '✓ Baseline';
	approveBtn.title = 'Approve visual baseline from latest run';
	approveBtn.style.display = 'none';
	approveBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			approveBtn.disabled = true;
			approveBtn.textContent = 'Approving…';
			const data = await api(`/test-cases/${tc.id}/approve-baseline`, { method: 'POST' });
			toast(`Baseline updated (${data.approved} screenshot${data.approved === 1 ? '' : 's'}).`, 'good');
			approveBtn.style.display = 'none';
		} catch (error) {
			toast(fail(error), 'bad');
		} finally {
			approveBtn.disabled = false;
			approveBtn.textContent = '✓ Baseline';
		}
	};

	header.append(sevDot, name, stepCount, runBtn, approveBtn, editBtn, cloneBtn, delBtn);

	// Check if baselines exist and show the approve button after runs
	card._checkBaselines = async () => {
		try {
			const baselines = await api(`/test-cases/${tc.id}/baselines`);
			approveBtn.style.display = baselines.length > 0 ? '' : 'none';
		} catch { /* ignore */ }
	};
	card._checkBaselines();

	// Tags + move-to-suite
	const metaRow = document.createElement('div');
	metaRow.className = 'tc-meta-row';

	if (tc.tags?.length > 0) {
		for (const tag of tc.tags) {
			const chip = document.createElement('span');
			chip.className = 'tc-tag-chip';
			chip.textContent = tag;
			chip.onclick = (e) => {
				e.stopPropagation();
				state.tagFilter = tag;
				renderTestCases();
			};
			metaRow.append(chip);
		}
	}

	// Move to suite dropdown
	if (state.suites.length > 0) {
		const moveSelect = document.createElement('select');
		moveSelect.className = 'tc-move-suite';
		moveSelect.title = 'Move to suite';
		const noneOpt = document.createElement('option');
		noneOpt.value = '';
		noneOpt.textContent = '— No suite —';
		moveSelect.append(noneOpt);
		for (const suite of state.suites) {
			const opt = document.createElement('option');
			opt.value = suite.id;
			const prefix = suite.parentId ? '↳ ' : '';
			opt.textContent = prefix + suite.name;
			if (tc.suiteId === suite.id) opt.selected = true;
			moveSelect.append(opt);
		}
		moveSelect.onchange = async (e) => {
			e.stopPropagation();
			try {
				const newSuiteId = moveSelect.value || null;
				await api(`/test-cases/${tc.id}`, {
					method: 'PUT',
					body: JSON.stringify({ ...tc, suiteId: newSuiteId })
				});
				tc.suiteId = newSuiteId;
				state.testCases = state.testCases.map(t =>
					t.id === tc.id ? { ...t, suiteId: newSuiteId } : t
				);
				renderSuiteTree();
				toast(`Moved to ${newSuiteId ? state.suites.find(s => s.id === newSuiteId)?.name : 'no suite'}.`, 'good');
			} catch (error) {
				toast(fail(error), 'bad');
			}
		};
		metaRow.append(moveSelect);
	}

	if (metaRow.children.length > 0) {
		header.append(metaRow);
	}

	// Bug badges (Phase 11: bi-directional linking)
	if (tc.findingIds?.length > 0) {
		const bugBadges = document.createElement('div');
		bugBadges.className = 'tc-bug-badges';
		for (const fid of tc.findingIds) {
			const badge = document.createElement('span');
			badge.className = 'tc-bug-badge';
			badge.textContent = '🐛';
			badge.title = `Linked bug: ${fid.slice(0, 8)}…`;
			badge.onclick = (e) => {
				e.stopPropagation();
				el.bugsHub.hidden = false;
				openBugDetail(fid);
			};
			bugBadges.append(badge);
		}
		header.append(bugBadges);
	}

	// Body (collapsible)
	const body = document.createElement('div');
	body.className = 'tc-body';

	// Preconditions
	if (tc.preconditions?.length > 0) {
		const precond = document.createElement('div');
		precond.className = 'tc-section-label';
		precond.textContent = 'Preconditions';
		const ul = document.createElement('ul');
		ul.className = 'tc-precond';
		for (const p of tc.preconditions) {
			const li = document.createElement('li');
			li.textContent = p;
			ul.append(li);
		}
		body.append(precond, ul);
	}

	// Steps
	if (tc.steps?.length > 0) {
		const stepsLabel = document.createElement('div');
		stepsLabel.className = 'tc-section-label';
		stepsLabel.textContent = 'Steps';
		body.append(stepsLabel);

		for (const [i, step] of tc.steps.entries()) {
			const row = document.createElement('div');
			row.className = 'tc-step';

			const num = document.createElement('span');
			num.className = 'tc-step-num';
			num.textContent = String(i + 1);

			const icon = document.createElement('span');
			icon.className = 'tc-step-icon';
			icon.textContent = STEP_ICONS[step.action] ?? '•';

			const text = document.createElement('span');
			text.className = 'tc-step-text';
			const parts = [step.description || step.action];
			if (step.target) parts.push(step.target);
			if (step.value) parts.push(`= ${step.value}`);
			text.textContent = parts.join(' · ');

			row.append(num, icon, text);
			body.append(row);
		}
	}

	// Assertions
	if (tc.assertions?.length > 0) {
		const assertLabel = document.createElement('div');
		assertLabel.className = 'tc-section-label';
		assertLabel.textContent = 'Assertions';
		body.append(assertLabel);

		for (const assertion of tc.assertions) {
			const row = document.createElement('div');
			row.className = 'tc-assertion';

			const icon = document.createElement('span');
			icon.className = 'tc-assertion-icon';
			icon.textContent = ASSERTION_ICONS[assertion.type] ?? '❓';

			const text = document.createElement('span');
			text.className = 'tc-assertion-text';
			text.textContent = assertion.description || `${assertion.type}: ${assertion.expected}`;

			row.append(icon, text);
			body.append(row);
		}
	}

	card.append(header, body);

	// Run result container (populated after a run)
	const resultContainer = document.createElement('div');
	resultContainer.className = 'tc-result';
	card.append(resultContainer);

	// History section (lazy-loaded on first expand)
	const historySection = document.createElement('div');
	historySection.className = 'tc-history-section';
	const historyToggle = document.createElement('button');
	historyToggle.className = 'tc-history-toggle';
	historyToggle.textContent = '▸ History';
	let historyLoaded = false;
	historyToggle.onclick = async (e) => {
		e.stopPropagation();
		const isOpen = historySection.classList.toggle('is-open');
		historyToggle.textContent = isOpen ? '▾ History' : '▸ History';
		if (isOpen && !historyLoaded) {
			historyLoaded = true;
			historyToggle.textContent = '▾ Loading…';
			try {
				const runs = await api(`/test-cases/${tc.id}/runs`);
				renderHistoryList(historySection, runs, tc.id);
				historyToggle.textContent = `▾ History (${runs.length})`;
			} catch {
				historyToggle.textContent = '▾ History (error)';
			}
		}
	};
	card.append(historyToggle, historySection);

	// Toggle expand/collapse
	let expanded = false;
	header.onclick = () => {
		expanded = !expanded;
		body.classList.toggle('is-expanded', expanded);
		header.classList.toggle('is-expanded', expanded);
	};

	card._runResult = resultContainer;
	return card;
}

/* ── Run history rendering ──────────────────────────────────────── */

function renderHistoryList(container, runs, testCaseId) {
	container.replaceChildren();

	if (!runs || runs.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'tc-history-empty';
		empty.textContent = 'No previous runs.';
		container.append(empty);
		return;
	}

	for (const run of runs) {
		const entry = document.createElement('div');
		entry.className = 'tc-history-entry';

		// Header row: timestamp, result badge, duration, flaky
		const header = document.createElement('div');
		header.className = 'tc-history-header';

		const icon = run.result === 'pass' ? '✓' : run.result === 'fail' ? '✗' : '⚠';
		header.innerHTML = `<span class="tc-history-icon tc-result-${run.result}">${icon}</span>`;
		const info = document.createElement('span');
		info.className = 'tc-history-info';
		const time = new Date(run.ts).toLocaleString();
		let infoText = `${time} · ${Math.round(run.durationMs / 1000)}s`;
		if (run.flaky) {
			infoText += ' · <span class="tc-history-flaky">⚡ flaky</span>';
		}
		if (run.attempt && run.attempt > 1) {
			infoText += ` · attempt ${run.attempt}`;
		}
		info.innerHTML = infoText;
		header.append(info);

		// Screenshot thumbnails (from artifact paths)
		if (run.screenshotPaths?.length > 0) {
			const thumbs = document.createElement('div');
			thumbs.className = 'tc-history-thumbs';
			for (const sp of run.screenshotPaths) {
				const img = document.createElement('img');
				img.className = 'tc-history-thumb';
				img.src = `/api/artifacts/${sp}`;
				img.alt = 'Screenshot evidence';
				img.loading = 'lazy';
				img.onclick = () => window.open(img.src, '_blank');
				thumbs.append(img);
			}
			entry.append(header, thumbs);
		} else {
			entry.append(header);
		}

		// Expandable details: step + assertion results
		let detailsOpen = false;
		const details = document.createElement('div');
		details.className = 'tc-history-details';

		entry.onclick = () => {
			detailsOpen = !detailsOpen;
			details.classList.toggle('is-open', detailsOpen);
			if (detailsOpen && !details.children.length) {
				renderHistoryDetails(details, run);
			}
		};
		entry.style.cursor = 'pointer';
		entry.append(details);

		container.append(entry);
	}
}

function renderHistoryDetails(container, run) {
	// Step results
	if (run.stepResults?.length > 0) {
		const label = document.createElement('div');
		label.className = 'tc-section-label';
		label.textContent = `Steps (${run.stepResults.length})`;
		container.append(label);

		for (const sr of run.stepResults) {
			const row = document.createElement('div');
			row.className = `tc-result-step ${sr.status}`;
			const sIcon = sr.status === 'pass' ? '✓' : '✗';
			let html = `<span class="tc-result-step-icon">${sIcon}</span>`;
			if (sr.stepIndex !== undefined) html += ` ${sr.stepIndex + 1}.`;
			html += ` ${escapeHtml(sr.action || '')}`;
			if (sr.error) {
				html += ` <span class="tc-result-step-error">${escapeHtml(sr.error)}</span>`;
			}
			row.innerHTML = html;
			container.append(row);
		}
	}

	// Assertion results
	if (run.assertionResults?.length > 0) {
		const label = document.createElement('div');
		label.className = 'tc-section-label';
		label.textContent = `Assertions (${run.assertionResults.length})`;
		container.append(label);

		for (const ar of run.assertionResults) {
			const row = document.createElement('div');
			row.className = `tc-result-assertion ${ar.passed ? 'pass' : 'fail'}`;
			const aIcon = ar.passed ? '✓' : '✗';
			row.innerHTML = `<span class="tc-result-step-icon">${aIcon}</span> ${escapeHtml(ar.type || '')}: ${escapeHtml(ar.description || '')}`;
			if (!ar.passed) {
				const detail = document.createElement('div');
				detail.className = 'tc-result-assertion-detail';
				detail.textContent = `expected: ${ar.expected} · got: ${ar.actual}`;
				row.append(detail);
			}
			container.append(row);
		}
	}

	// Trace download
	if (run.tracePath) {
		const trace = document.createElement('a');
		trace.className = 'tc-trace-download';
		trace.href = `/api/artifacts/${run.tracePath}`;
		trace.download = 'trace.zip';
		trace.textContent = '⬇ Download Playwright trace';
		trace.onclick = (e) => e.stopPropagation();
		container.append(trace);
	}

	if (!run.stepResults?.length && !run.assertionResults?.length && !run.tracePath) {
		const none = document.createElement('div');
		none.className = 'tc-history-empty';
		none.textContent = 'No detailed results for this run.';
		container.append(none);
	}
}

/* ── Test case execution ────────────────────────────────────────── */

async function runSingleTest(tc, card, runBtn) {
	const resultContainer = card._runResult;
	try {
		runBtn.disabled = true;
		runBtn.textContent = 'Running…';
		resultContainer.replaceChildren();
		const spinner = document.createElement('div');
		spinner.className = 'tc-running';
		spinner.textContent = 'Running test…';
		resultContainer.append(spinner);

		const credentials = state.session?.secretNames?.length
			? undefined
			: undefined;
		const data = await api(`/test-cases/${tc.id}/run`, {
			method: 'POST',
			body: JSON.stringify({ credentials })
		});

		renderRunResult(resultContainer, data.result);
		toast(
			data.result.result === 'pass' ? `✓ ${tc.name} passed` : `✗ ${tc.name} ${data.result.result}`,
			data.result.result === 'pass' ? 'good' : 'bad'
		);
	} catch (error) {
		toast(fail(error), 'bad');
		resultContainer.replaceChildren();
		const errEl = document.createElement('div');
		errEl.className = 'tc-result-error';
		errEl.textContent = `Error: ${fail(error)}`;
		resultContainer.append(errEl);
	} finally {
		runBtn.disabled = false;
		runBtn.textContent = 'Run';
	}
}

async function runAllTests() {
	if (state.testCases.length === 0) {
		toast('No test cases to run.', 'bad');
		return;
	}

	const pane = el.testcasePane;
	const runAllBtn = pane.querySelector('.tc-run-all');
	if (runAllBtn) {
		runAllBtn.disabled = true;
		runAllBtn.textContent = 'Running…';
	}

	// Show running indicator
	const indicator = document.createElement('div');
	indicator.className = 'tc-running-all';
	indicator.textContent = `Running ${state.testCases.length} test cases…`;
	pane.prepend(indicator);

	try {
		const ids = state.testCases.map(tc => tc.id);
		const summary = await api('/test-cases/run', {
			method: 'POST',
			body: JSON.stringify({
				testCaseIds: ids,
				concurrency: Number(cfg.concurrentRuns?.value) || 3,
				retries: Number(cfg.retriesCount?.value) || 0
			})
		});

		// Render results on each card
		for (const result of summary.results) {
			const card = pane.querySelector(`.tc-card[data-id="${result.testCaseId}"]`);
			if (card && card._runResult) {
				renderRunResult(card._runResult, result);
			}
		}

		let msg = `Suite: ${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored`;
		if (summary.flaky) {
			msg += `, ${summary.flaky} flaky`;
		}
		toast(msg, summary.failed + summary.errored === 0 ? 'good' : 'bad');
	} catch (error) {
		toast(fail(error), 'bad');
	} finally {
		indicator.remove();
		if (runAllBtn) {
			runAllBtn.disabled = false;
			runAllBtn.textContent = 'Run All';
		}
	}
}

function renderRunResult(container, result) {
	container.replaceChildren();

	const banner = document.createElement('div');
	banner.className = `tc-result-banner ${result.result}`;
	const icon = result.result === 'pass' ? '✓' : result.result === 'fail' ? '✗' : '⚠';
	const label = result.result === 'pass' ? 'PASSED' : result.result === 'fail' ? 'FAILED' : 'ERROR';
	let bannerHtml = `<span class="tc-result-icon">${icon}</span> ${label} · ${Math.round(result.durationMs / 1000)}s`;
	if (result.flaky) {
		bannerHtml += ` <span class="tc-flaky-badge" title="Passed on attempt ${result.attempt || 2} of ${result.attempt || 2}">⚡ FLAKY</span>`;
	}
	if (result.attempt && result.attempt > 1) {
		bannerHtml += ` <span class="tc-attempt-badge">attempt ${result.attempt}</span>`;
	}
	banner.innerHTML = bannerHtml;
	container.append(banner);

	// Error message
	if (result.error) {
		const errEl = document.createElement('div');
		errEl.className = 'tc-result-error';
		errEl.textContent = result.error;
		container.append(errEl);
	}

	// Step results
	if (result.stepResults?.length > 0) {
		const stepsLabel = document.createElement('div');
		stepsLabel.className = 'tc-section-label';
		stepsLabel.textContent = 'Steps';
		container.append(stepsLabel);

		for (const sr of result.stepResults) {
			const row = document.createElement('div');
			row.className = `tc-result-step ${sr.status}`;
			const sIcon = sr.status === 'pass' ? '✓' : '✗';
			const labelSpan = document.createElement('span');
			labelSpan.textContent = `${sr.stepIndex + 1}. ${sr.action || ''}`;
			row.innerHTML = `<span class="tc-result-step-icon">${sIcon}</span> `;
			row.append(labelSpan);
			if (sr.error) {
				const err = document.createElement('span');
				err.className = 'tc-result-step-error';
				err.textContent = sr.error;
				row.append(err);
			}
			container.append(row);
		}
	}

	// Assertion results
	if (result.assertionResults?.length > 0) {
		const assertLabel = document.createElement('div');
		assertLabel.className = 'tc-section-label';
		assertLabel.textContent = 'Assertions';
		container.append(assertLabel);

		for (const ar of result.assertionResults) {
			const row = document.createElement('div');
			row.className = `tc-result-assertion ${ar.passed ? 'pass' : 'fail'}`;
			const aIcon = ar.passed ? '✓' : '✗';
			let typeLabel = escapeHtml(ar.type || '');
			if (ar.type === 'visual_match') {
				typeLabel = '🎨 visual_match';
			}
			row.innerHTML = `<span class="tc-result-step-icon">${aIcon}</span> ${typeLabel}: ${escapeHtml(ar.description || '')}`;
			if (!ar.passed) {
				const detail = document.createElement('div');
				detail.className = 'tc-result-assertion-detail';
				detail.textContent = `expected: ${ar.expected} · got: ${ar.actual}`;
				row.append(detail);
			}
			// Visual diff viewer
			if (ar.type === 'visual_match' && ar.visual) {
				const v = ar.visual;
				if (v.isNew) {
					const badge = document.createElement('div');
					badge.className = 'tc-visual-badge new';
					badge.textContent = '✓ Baseline auto-captured';
					row.append(badge);
				} else if (v.diffPath) {
					const viewer = renderVisualDiffViewer(v);
					row.append(viewer);
				}
			}
			container.append(row);
		}
	}

	// Screenshots
	if (result.screenshots?.length > 0) {
		const ssLabel = document.createElement('div');
		ssLabel.className = 'tc-section-label';
		ssLabel.textContent = 'Evidence';
		container.append(ssLabel);

		for (const ss of result.screenshots) {
			const wrap = document.createElement('div');
			wrap.className = 'tc-screenshot';
			const cap = document.createElement('div');
			cap.className = 'tc-screenshot-label';
			cap.textContent = ss.label;
			const img = document.createElement('img');
			img.src = ss.dataUrl;
			img.alt = ss.label;
			wrap.append(cap, img);
			container.append(wrap);
		}
	}
}

/* ── Visual diff viewer ────────────────────────────────────────── */

function renderVisualDiffViewer(visual) {
	const wrap = document.createElement('div');
	wrap.className = 'tc-visual-diff';

	// Stats bar
	const stats = document.createElement('div');
	stats.className = 'tc-visual-stats';
	const pct = (visual.pctChanged * 100).toFixed(2);
	const status = visual.pctChanged <= (visual.threshold ?? 0.001) ? 'match' : 'diff';
	stats.innerHTML = `
		<span class="tc-visual-stat ${status}">
			${status === 'match' ? '✓' : '⚠'} ${pct}% changed
		</span>
		<span class="tc-visual-stat-detail">${visual.pixelDiff.toLocaleString()} / ${visual.totalPixels.toLocaleString()} pixels</span>
	`;
	wrap.append(stats);

	// Side-by-side images
	const grid = document.createElement('div');
	grid.className = 'tc-visual-grid';

	// Baseline
	const baselineBox = document.createElement('div');
	baselineBox.className = 'tc-visual-img-box';
	baselineBox.innerHTML = '<div class="tc-visual-img-label">Baseline</div>';
	const baselineImg = document.createElement('img');
	baselineImg.src = `/api/artifacts/${visual.baselinePath}`;
	baselineImg.alt = 'Baseline screenshot';
	baselineImg.loading = 'lazy';
	baselineBox.append(baselineImg);

	// Current
	const currentBox = document.createElement('div');
	currentBox.className = 'tc-visual-img-box';
	currentBox.innerHTML = '<div class="tc-visual-img-label">Actual</div>';
	const currentImg = document.createElement('img');
	currentImg.src = `/api/artifacts/${visual.currentPath}`;
	currentImg.alt = 'Current screenshot';
	currentImg.loading = 'lazy';
	currentBox.append(currentImg);

	// Diff
	const diffBox = document.createElement('div');
	diffBox.className = 'tc-visual-img-box';
	diffBox.innerHTML = '<div class="tc-visual-img-label">Diff</div>';
	const diffImg = document.createElement('img');
	diffImg.src = `/api/artifacts/${visual.diffPath}`;
	diffImg.alt = 'Visual diff';
	diffImg.loading = 'lazy';
	diffBox.append(diffImg);

	grid.append(baselineBox, currentBox, diffBox);
	wrap.append(grid);

	return wrap;
}

/* ── Test Case Editor (Phase 8) ─────────────────────────────────── */

const STEP_ACTIONS = [
	'navigate', 'click', 'fill', 'type', 'select', 'check', 'key',
	'scroll', 'hover', 'wait', 'screenshot', 'diagnostics'
];

const ASSERTION_TYPES = [
	'url_is', 'url_contains', 'element_visible', 'element_hidden',
	'element_text', 'element_enabled', 'no_console_errors',
	'no_failed_requests', 'status_code', 'visual_match', 'custom'
];

/** Populates the suite <select> inside the editor. */
function populateSuiteSelect() {
	el.tcEditSuite.replaceChildren();
	const none = document.createElement('option');
	none.value = '';
	none.textContent = '— No suite —';
	el.tcEditSuite.append(none);
	for (const suite of state.suites) {
		const opt = document.createElement('option');
		opt.value = suite.id;
		const prefix = suite.parentId ? '↳ ' : '';
		opt.textContent = prefix + suite.name;
		el.tcEditSuite.append(opt);
	}
}

/** Renders the suite tree sidebar. */
function renderSuiteTree() {
	el.suiteTree.replaceChildren();
	if (state.suites.length === 0) return;

	const rootSuites = state.suites.filter(s => !s.parentId);
	for (const suite of rootSuites) {
		el.suiteTree.append(renderSuiteNode(suite, 0));
	}
}

function renderSuiteNode(suite, depth) {
	const node = document.createElement('div');
	node.className = 'suite-node';
	node.style.marginLeft = `${depth * 16}px`;

	const row = document.createElement('div');
	row.className = 'suite-row';

	const folder = document.createElement('span');
	folder.className = 'suite-folder';
	const hasChildren = state.suites.some(s => s.parentId === suite.id);
	folder.textContent = hasChildren ? '📂' : '📁';

	const name = document.createElement('span');
	name.className = 'suite-name';
	name.textContent = suite.name;
	name.title = 'Click to filter test cases by this suite';
	name.style.cursor = 'pointer';
	name.onclick = (e) => {
		e.stopPropagation();
		// Toggle: if already filtering by this suite, clear it.
		if (state.suiteFilter === suite.id) {
			state.suiteFilter = null;
		} else {
			state.suiteFilter = suite.id;
		}
		renderTestCases();
		renderSuiteTree();
	};

	// Test case count in suite.
	const count = state.testCases.filter(tc => tc.suiteId === suite.id).length;
	const countSpan = document.createElement('span');
	countSpan.className = 'suite-count';
	countSpan.textContent = `${count}`;

	const delBtn = document.createElement('button');
	delBtn.className = 'suite-del';
	delBtn.textContent = '✕';
	delBtn.title = 'Delete suite';
	delBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			await api(`/suites/${suite.id}`, { method: 'DELETE' });
			state.suites = state.suites.filter(s => s.id !== suite.id);
			renderSuiteTree();
			toast(`Deleted suite "${suite.name}".`, 'good');
		} catch (error) {
			toast(fail(error), 'bad');
		}
	};

	row.append(folder, name, countSpan, delBtn);
	node.append(row);

	// Children (collapsible).
	const childWrap = document.createElement('div');
	childWrap.className = 'suite-children';

	// Collapsible: clicking the row toggles children.
	if (hasChildren) {
		row.classList.add('suite-collapsible');
		row.onclick = (e) => {
			// Don't toggle when clicking delete button.
			if (e.target === delBtn) return;
			const collapsed = row.classList.toggle('suite-collapsed');
			childWrap.hidden = collapsed;
			folder.textContent = collapsed ? '📁' : '📂';
		};
	}

	const children = state.suites.filter(s => s.parentId === suite.id);
	for (const child of children) {
		childWrap.append(renderSuiteNode(child, depth + 1));
	}
	node.append(childWrap);

	return node;
}

/** Opens the test case editor — `existingTc` null = new, object = edit. */
function openTcEditor(existingTc) {
	state.editingTc = existingTc ?? null;

	populateSuiteSelect();

	if (existingTc) {
		el.tcEditorTitle.textContent = 'Edit Test Case';
		el.tcEditName.value = existingTc.name ?? '';
		el.tcEditSeverity.value = existingTc.severity ?? 'medium';
		el.tcEditUrl.value = existingTc.targetUrl ?? '';
		el.tcEditSuite.value = existingTc.suiteId ?? '';
		el.tcEditTags.value = (existingTc.tags ?? []).join(', ');
		el.tcEditPrecond.value = (existingTc.preconditions ?? []).join('\n');
		state.editorSteps = (existingTc.steps ?? []).map(s => ({ ...s }));
		state.editorAssertions = (existingTc.assertions ?? []).map(a => ({ ...a }));
	} else {
		el.tcEditorTitle.textContent = 'New Test Case';
		el.tcEditName.value = '';
		el.tcEditSeverity.value = 'medium';
		el.tcEditUrl.value = state.session?.targetUrl ?? '';
		el.tcEditSuite.value = '';
		el.tcEditTags.value = '';
		el.tcEditPrecond.value = '';
		state.editorSteps = [];
		state.editorAssertions = [];
	}

	renderEditorSteps();
	renderEditorAssertions();
	el.tcEditor.showModal();
}

/** Renders the step editor rows. */
function renderEditorSteps() {
	el.tcStepsList.replaceChildren();
	for (const [i, step] of state.editorSteps.entries()) {
		const row = document.createElement('div');
		row.className = 'tc-edit-step';

		const num = document.createElement('span');
		num.className = 'tc-edit-step-num';
		num.textContent = String(i + 1);

		const actionSel = document.createElement('select');
		actionSel.className = 'tc-edit-field';
		for (const a of STEP_ACTIONS) {
			const opt = document.createElement('option');
			opt.value = a;
			opt.textContent = a;
			if (step.action === a) opt.selected = true;
			actionSel.append(opt);
		}
		actionSel.onchange = () => { step.action = actionSel.value; };

		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'tc-edit-field';
		targetInput.placeholder = 'CSS selector / URL';
		targetInput.value = step.target ?? '';
		targetInput.oninput = () => { step.target = targetInput.value; };

		const valueInput = document.createElement('input');
		valueInput.type = 'text';
		valueInput.className = 'tc-edit-field';
		valueInput.placeholder = 'Value';
		valueInput.value = step.value ?? '';
		valueInput.oninput = () => { step.value = valueInput.value; };

		const descInput = document.createElement('input');
		descInput.type = 'text';
		descInput.className = 'tc-edit-field tc-edit-desc';
		descInput.placeholder = 'Description';
		descInput.value = step.description ?? '';
		descInput.oninput = () => { step.description = descInput.value; };

		// Move up / down / delete
		const upBtn = document.createElement('button');
		upBtn.type = 'button';
		upBtn.className = 'btn btn-ghost btn-sm tc-step-move';
		upBtn.textContent = '↑';
		upBtn.title = 'Move up';
		upBtn.disabled = i === 0;
		upBtn.onclick = () => {
			if (i > 0) {
				[state.editorSteps[i - 1], state.editorSteps[i]] = [state.editorSteps[i], state.editorSteps[i - 1]];
				renderEditorSteps();
			}
		};

		const downBtn = document.createElement('button');
		downBtn.type = 'button';
		downBtn.className = 'btn btn-ghost btn-sm tc-step-move';
		downBtn.textContent = '↓';
		downBtn.title = 'Move down';
		downBtn.disabled = i === state.editorSteps.length - 1;
		downBtn.onclick = () => {
			if (i < state.editorSteps.length - 1) {
				[state.editorSteps[i + 1], state.editorSteps[i]] = [state.editorSteps[i], state.editorSteps[i + 1]];
				renderEditorSteps();
			}
		};

		const delBtn = document.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'btn btn-ghost btn-sm tc-step-del';
		delBtn.textContent = '✕';
		delBtn.title = 'Remove step';
		delBtn.onclick = () => {
			state.editorSteps.splice(i, 1);
			renderEditorSteps();
		};

		row.append(num, actionSel, targetInput, valueInput, descInput, upBtn, downBtn, delBtn);
		el.tcStepsList.append(row);
	}
}

/** Renders the assertion editor rows. */
function renderEditorAssertions() {
	el.tcAssertionsList.replaceChildren();
	for (const [i, assertion] of state.editorAssertions.entries()) {
		const row = document.createElement('div');
		row.className = 'tc-edit-assertion';

		const num = document.createElement('span');
		num.className = 'tc-edit-step-num';
		num.textContent = String(i + 1);

		const typeSel = document.createElement('select');
		typeSel.className = 'tc-edit-field';
		for (const t of ASSERTION_TYPES) {
			const opt = document.createElement('option');
			opt.value = t;
			opt.textContent = t;
			if (assertion.type === t) opt.selected = true;
			typeSel.append(opt);
		}
		typeSel.onchange = () => { assertion.type = typeSel.value; };

		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'tc-edit-field';
		targetInput.placeholder = 'Selector / URL';
		targetInput.value = assertion.target ?? '';
		targetInput.oninput = () => { assertion.target = targetInput.value; };

		const expectedInput = document.createElement('input');
		expectedInput.type = 'text';
		expectedInput.className = 'tc-edit-field';
		expectedInput.placeholder = 'Expected value';
		expectedInput.value = assertion.expected ?? '';
		expectedInput.oninput = () => { assertion.expected = expectedInput.value; };

		const descInput = document.createElement('input');
		descInput.type = 'text';
		descInput.className = 'tc-edit-field tc-edit-desc';
		descInput.placeholder = 'Description';
		descInput.value = assertion.description ?? '';
		descInput.oninput = () => { assertion.description = descInput.value; };

		const delBtn = document.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'btn btn-ghost btn-sm tc-step-del';
		delBtn.textContent = '✕';
		delBtn.title = 'Remove assertion';
		delBtn.onclick = () => {
			state.editorAssertions.splice(i, 1);
			renderEditorAssertions();
		};

		row.append(num, typeSel, targetInput, expectedInput, descInput, delBtn);
		el.tcAssertionsList.append(row);
	}
}

// Editor event wiring.
el.btnNewTestcase.onclick = () => openTcEditor(null);

el.btnNewSuite.onclick = async () => {
	const name = prompt('Suite name:', '');
	if (!name?.trim()) return;
	try {
		const projectId = state.session?.projectId ?? state.projectId;
		await api('/suites', {
			method: 'POST',
			body: JSON.stringify({ name: name.trim(), projectId })
		});
		const params = new URLSearchParams();
		if (projectId) params.set('projectId', projectId);
		state.suites = await api(`/suites${params.toString() ? `?${params}` : ''}`);
		renderSuiteTree();
		toast(`Suite "${name.trim()}" created.`, 'good');
	} catch (error) {
		toast(fail(error), 'bad');
	}
};

el.tcAddStep.onclick = () => {
	state.editorSteps.push({ action: 'click', target: '', value: '', description: '' });
	renderEditorSteps();
};

el.tcAddAssertion.onclick = () => {
	state.editorAssertions.push({ type: 'element_visible', target: '', expected: '', description: '' });
	renderEditorAssertions();
};

el.tcEditorClose.onclick = () => el.tcEditor.close();

el.tcEditorSave.onclick = async () => {
	const name = el.tcEditName.value.trim();
	if (!name) {
		toast('Test case name is required.', 'bad');
		return;
	}

	const data = {
		name,
		severity: el.tcEditSeverity.value,
		targetUrl: el.tcEditUrl.value.trim(),
		suiteId: el.tcEditSuite.value || null,
		tags: el.tcEditTags.value.split(',').map(t => t.trim()).filter(Boolean),
		preconditions: el.tcEditPrecond.value.split('\n').map(p => p.trim()).filter(Boolean),
		steps: state.editorSteps,
		assertions: state.editorAssertions
	};

	try {
		el.tcEditorSave.disabled = true;
		el.tcEditorSave.textContent = 'Saving…';

		if (state.editingTc) {
			// Update existing.
			const updated = await api(`/test-cases/${state.editingTc.id}`, {
				method: 'PUT',
				body: JSON.stringify(data)
			});
			const idx = state.testCases.findIndex(tc => tc.id === state.editingTc.id);
			if (idx !== -1) state.testCases[idx] = updated;
			toast(`Updated "${updated.name}".`, 'good');
		} else {
			// Create new.
			const tc = await api('/test-cases', {
				method: 'POST',
				body: JSON.stringify({
					...data,
					projectId: state.session?.projectId ?? state.projectId
				})
			});
			state.testCases.unshift(tc);
			toast(`Created "${tc.name}".`, 'good');
		}

		el.tcEditor.close();
		renderTestCases();
		el.countTestcases.textContent = state.testCases.length || '';
	} catch (error) {
		toast(fail(error), 'bad');
	} finally {
		el.tcEditorSave.disabled = false;
		el.tcEditorSave.textContent = 'Save';
	}
};

/* ── Regression Schedules ───────────────────────────────────────── */

const CRON_PRESETS = [
	{ label: 'Daily 9am',     value: '0 9 * * *' },
	{ label: 'Mon + Thu 9am', value: '0 9 * * 1,4' },
	{ label: 'Every 6 hours', value: '0 */6 * * *' },
	{ label: 'Mon 9am',       value: '0 9 * * 1' },
	{ label: 'Weekdays 9am',  value: '0 9 * * 1-5' }
];

async function loadRegression() {
	state.schedules = [];
	state.regressionTrend = [];
	const projectId = state.session?.projectId ?? state.projectId;
	const pq = projectId ? `?projectId=${projectId}` : '';
	try {
		state.schedules = await api(`/schedules${pq}`);
	} catch { /* empty */ }
	try {
		state.regressionTrend = await api(`/regression/trend?limit=15${projectId ? `&projectId=${projectId}` : ''}`);
	} catch { /* empty */ }
	renderRegression();
}

function renderRegression() {
	el.regressionPane.replaceChildren();
	el.countRegression.textContent = state.schedules.length || '';

	// Trend chart
	if (state.regressionTrend.length > 0) {
		el.regressionPane.append(renderTrendChart(state.regressionTrend));
	}

	// Create schedule form
	el.regressionPane.append(renderCreateScheduleForm());

	// Schedule list
	if (state.schedules.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'reg-empty';
		empty.innerHTML = '<p>No schedules yet.</p><small>Create a schedule above to auto-run test suites on a recurring basis.</small>';
		el.regressionPane.append(empty);
	} else {
		const heading = document.createElement('div');
		heading.className = 'reg-section-heading';
		heading.textContent = `Schedules (${state.schedules.length})`;
		el.regressionPane.append(heading);

		for (const sched of state.schedules) {
			el.regressionPane.append(renderScheduleCard(sched));
		}
	}
}

function renderTrendChart(trend) {
	const wrap = document.createElement('div');
	wrap.className = 'reg-trend';

	const heading = document.createElement('div');
	heading.className = 'reg-section-heading';
	heading.textContent = 'Pass rate trend';
	wrap.append(heading);

	const chart = document.createElement('div');
	chart.className = 'reg-chart';

	const maxBars = Math.min(trend.length, 15);
	const chartWidth = Math.max(maxBars * 28, 200);

	for (const point of trend) {
		const bar = document.createElement('div');
		bar.className = 'reg-chart-bar';

		const pct = point.passRate;
		const color = pct >= 80 ? '#30d158' : pct >= 50 ? '#ff9f0a' : '#ff453a';

		const fill = document.createElement('div');
		fill.className = 'reg-chart-fill';
		fill.style.height = `${Math.max(pct, 3)}%`;
		fill.style.background = color;

		const label = document.createElement('div');
		label.className = 'reg-chart-label';
		label.textContent = pct + '%';

		bar.append(fill, label);
		bar.title = `${new Date(point.ts).toLocaleString()}\n${point.passed}/${point.total} passed (${pct}%)${point.flaky ? `\n${point.flaky} flaky` : ''}`;
		chart.append(bar);
	}

	wrap.append(chart);
	return wrap;
}

function renderCreateScheduleForm() {
	const wrap = document.createElement('div');
	wrap.className = 'reg-create';

	const heading = document.createElement('div');
	heading.className = 'reg-section-heading';
	heading.textContent = 'New schedule';
	wrap.append(heading);

	const form = document.createElement('div');
	form.className = 'reg-form';

	const nameInput = document.createElement('input');
	nameInput.type = 'text';
	nameInput.placeholder = 'Schedule name';
	nameInput.className = 'reg-input';

	const cronSelect = document.createElement('select');
	cronSelect.className = 'reg-select';
	for (const preset of CRON_PRESETS) {
		const opt = document.createElement('option');
		opt.value = preset.value;
		opt.textContent = preset.label;
		cronSelect.append(opt);
	}

	const customCron = document.createElement('input');
	customCron.type = 'text';
	customCron.placeholder = 'Custom cron (e.g. 0 9 * * 1,4)';
	customCron.className = 'reg-input reg-cron-input';
	customCron.style.display = 'none';

	const customToggle = document.createElement('label');
	customToggle.className = 'reg-custom-toggle';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	const toggleLabel = document.createElement('span');
	toggleLabel.textContent = 'Custom';
	customToggle.append(checkbox, toggleLabel);
	checkbox.onchange = () => {
		customCron.style.display = checkbox.checked ? 'block' : 'none';
		cronSelect.style.display = checkbox.checked ? 'none' : 'block';
	};

	const suiteSelect = document.createElement('select');
	suiteSelect.className = 'reg-select';
	const allOpt = document.createElement('option');
	allOpt.value = '';
	allOpt.textContent = 'All test cases';
	suiteSelect.append(allOpt);
	for (const suite of state.suites) {
		const opt = document.createElement('option');
		opt.value = suite.id;
		opt.textContent = suite.name;
		suiteSelect.append(opt);
	}

	const createBtn = document.createElement('button');
	createBtn.className = 'reg-create-btn';
	createBtn.textContent = 'Create';
	createBtn.onclick = async () => {
		const cron = checkbox.checked ? customCron.value.trim() : cronSelect.value;
		if (!nameInput.value.trim()) {
			toast('Enter a schedule name.', 'bad');
			return;
		}
		try {
			createBtn.disabled = true;
			createBtn.textContent = 'Creating…';

			// Use suite-filtered test cases if a suite is selected.
			let testCaseIds = state.testCases.map(tc => tc.id);
			if (suiteSelect.value) {
				testCaseIds = state.testCases.filter(tc => tc.suiteId === suiteSelect.value).map(tc => tc.id);
			}

			await api('/schedules', {
				method: 'POST',
				body: JSON.stringify({
					name: nameInput.value.trim(),
					cronExpr: cron,
					targetUrl: state.session?.targetUrl ?? '',
					projectId: state.session?.projectId ?? state.projectId,
					testCaseIds
				})
			});

			state.schedules = await api('/schedules');
			renderRegression();
			toast('Schedule created.', 'good');
			nameInput.value = '';
		} catch (error) {
			toast(fail(error), 'bad');
		} finally {
			createBtn.disabled = false;
			createBtn.textContent = 'Create';
		}
	};

	form.append(nameInput, suiteSelect, cronSelect, customCron, customToggle, createBtn);
	wrap.append(form);
	return wrap;
}

function renderScheduleCard(sched) {
	const card = document.createElement('div');
	card.className = `reg-card ${sched.enabled ? '' : 'is-disabled'}`;

	const header = document.createElement('div');
	header.className = 'reg-card-header';

	const name = document.createElement('span');
	name.className = 'reg-card-name';
	name.textContent = sched.name;

	const toggleLabel = document.createElement('label');
	toggleLabel.className = 'reg-toggle';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = sched.enabled;
	checkbox.onchange = async () => {
		try {
			await api(`/schedules/${sched.id}`, {
				method: 'PUT',
				body: JSON.stringify({ enabled: checkbox.checked })
			});
			toast(`Schedule ${checkbox.checked ? 'enabled' : 'disabled'}.`, 'good');
		} catch (error) {
			toast(fail(error), 'bad');
			checkbox.checked = !checkbox.checked;
		}
	};
	const slider = document.createElement('span');
	slider.className = 'reg-toggle-slider';
	toggleLabel.append(checkbox, slider);

	header.append(name, toggleLabel);

	// Meta
	const meta = document.createElement('div');
	meta.className = 'reg-card-meta';
	const parts = [sched.cronExpr];
	if (sched.testCaseIds?.length) {
		parts.push(`${sched.testCaseIds.length} test${sched.testCaseIds.length === 1 ? '' : 's'}`);
	}
	if (sched.targetUrl) {
		parts.push(hostOf(sched.targetUrl));
	}
	if (sched.lastRun) {
		const r = sched.lastRun;
		parts.push(`last: ${r.result} (${relativeTime(r.ts)})`);
	}
	if (sched.nextRun) {
		parts.push(`next: ${relativeTime(sched.nextRun)}`);
	}
	meta.textContent = parts.join(' · ');

	// Actions
	const actions = document.createElement('div');
	actions.className = 'reg-card-actions';

	const runBtn = document.createElement('button');
	runBtn.className = 'reg-run-now';
	runBtn.textContent = 'Run Now';
	runBtn.onclick = async () => {
		try {
			runBtn.disabled = true;
			runBtn.textContent = 'Running…';
			const summary = await api(`/schedules/${sched.id}/run`, { method: 'POST' });
				let msg = `${sched.name}: ${summary.passed}/${summary.total} passed`;
				if (summary.flaky) {
					msg += `, ${summary.flaky} flaky`;
				}
				toast(
					msg,
					summary.failed + summary.errored === 0 ? 'good' : 'bad'
				);
			// Reload trend + schedules
			state.schedules = await api('/schedules');
			state.regressionTrend = await api('/regression/trend?limit=15');
			renderRegression();
		} catch (error) {
			toast(fail(error), 'bad');
		} finally {
			runBtn.disabled = false;
			runBtn.textContent = 'Run Now';
		}
	};

	const delBtn = document.createElement('button');
	delBtn.className = 'reg-card-delete';
	delBtn.textContent = 'Delete';
	delBtn.onclick = async () => {
		try {
			await api(`/schedules/${sched.id}`, { method: 'DELETE' });
			state.schedules = state.schedules.filter(s => s.id !== sched.id);
			card.remove();
			el.countRegression.textContent = state.schedules.length || '';
			toast(`Deleted "${sched.name}".`, 'good');
		} catch (error) {
			toast(fail(error), 'bad');
		}
	};

	actions.append(runBtn, delBtn);
	card.append(header, meta, actions);

	return card;
}

function list(items) {
	const node = document.createElement('ul');
	for (const item of items) {
		const entry = document.createElement('li');
		entry.textContent = item;
		node.append(entry);
	}
	return node;
}

/* ── Event stream ────────────────────────────────────────────────── */

function connect(id) {
	state.stream?.close();
	const stream = new EventSource(`/api/sessions/${id}/events`);
	state.stream = stream;

	stream.onopen = () => {
		el.connDot.className = 'dot is-live';
		el.connLabel.textContent = 'connected';
	};
	stream.onerror = () => {
		el.connDot.className = 'dot';
		el.connLabel.textContent = 'reconnecting…';
	};
	stream.onmessage = event => {
		const data = JSON.parse(event.data);
		if (data.sessionId === state.sessionId) {
			handleEvent(data);
		}
	};
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
			}
			break;
		}

		case 'todos':
			session.todos = event.todos;
			renderTodos();
			break;

		case 'finding':
			session.findings.push(event.finding);
			renderFindings();
			if (event.finding.severity === 'critical' || event.finding.severity === 'high') {
				toast(`${event.finding.severity.toUpperCase()}: ${event.finding.title}`, 'bad');
			}
			break;

		case 'report':
			session.report = event.report;
			renderReport();
			toast('Report published.', 'good');
			break;

		case 'workflow_step':
			state.capturedSteps.push(event.step);
			renderWorkflows();
			break;

		case 'question':
			session.pendingQuestion = event.question;
			renderQuestion();
			break;

		case 'status':
			setStatus(event.status);
			if (event.status !== 'running') {
				void refreshRuns();
			}
			if (event.detail && event.status === 'error') {
				toast(event.detail, 'bad');
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
				renderHeader();
				void refreshRuns();
			}
			break;

		default:
			break;
	}
}

/* ── Settings ────────────────────────────────────────────────────── */

const cfg = {
	dialog: $('settings'),
	provider: $('cfg-provider'),
	providerNote: $('cfg-provider-note'),
	key: $('cfg-key'),
	keyNote: $('cfg-key-note'),
	baseUrlField: $('cfg-baseurl-field'),
	baseUrl: $('cfg-baseurl'),
	model: $('cfg-model'),
	modelList: $('cfg-model-list'),
	reasoning: $('cfg-reasoning'),
	maxTurns: $('cfg-maxturns'),
	discoveryModel: $('cfg-discovery-model'),
	executionModel: $('cfg-execution-model'),
	headless: $('cfg-headless'),
	concurrentRuns: $('cfg-concurrent-runs'),
	retriesCount: $('cfg-retries-count'),
	apiToken: $('cfg-api-token'),
	apiTokenNote: $('cfg-api-token-note'),
	apiTokenClear: $('cfg-api-token-clear'),
	test: $('cfg-test'),
	testBtn: $('cfg-test-btn'),
	saveBtn: $('cfg-save')
};

/** Providers whose endpoint the user supplies themselves. */
const BASE_URL_REQUIRED = new Set(['custom', 'azureOpenAI']);
const BASE_URL_OPTIONAL = new Set(['openai', 'openrouter', 'nvidia', 'grok']);

function paintConfig(config) {
	state.config = config;
	el.modelBadge.textContent = config.ready ? config.model : (config.problem ?? 'not configured');
	el.modelBadge.style.color = config.ready ? '' : 'var(--danger)';
	const tiers = [
		config.discoveryModel ? `discovery: ${config.discoveryModel}` : '',
		config.executionModel ? `execution: ${config.executionModel}` : ''
	].filter(Boolean).join(' · ');
	el.modelBadge.title = config.ready
		? `${config.provider}${config.baseUrl ? ` · ${config.baseUrl}` : ''}${tiers ? ` · ${tiers}` : ''}`
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
	cfg.model.value = config.model ?? '';
	cfg.reasoning.value = config.reasoning ?? 'medium';
	cfg.maxTurns.value = config.maxTurns ?? 120;
	cfg.discoveryModel.value = config.discoveryModel ?? '';
	cfg.executionModel.value = config.executionModel ?? '';
	cfg.headless.checked = config.headless !== false;
	cfg.concurrentRuns.value = config.concurrentRuns ?? 3;
	cfg.retriesCount.value = config.retriesCount ?? 1;

	// API Token — never sent to browser; leaving the box empty keeps it.
	cfg.apiToken.value = '';
	cfg.apiToken.placeholder = config.hasApiToken ? `${config.apiTokenHint} — leave blank to keep` : 'Leave empty for local use';
	cfg.apiTokenNote.textContent = config.hasApiToken
		? (config.apiTokenFromEnv ? 'Currently set in .env. Saving one here overrides it.' : 'Stored in .qase/config.json. Required as Authorization: Bearer header for CI/CD triggers.')
		: 'Protects test-run/schedule-trigger endpoints. Leave empty when running locally.';

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
	cfg.providerNote.textContent = required
		? 'Any OpenAI-compatible API: key, base URL, model name.'
		: BASE_URL_OPTIONAL.has(provider)
			? 'Base URL is optional — leave it blank to use the provider default.'
			: 'This provider uses its own endpoint.';
}

function readSettings() {
	const patch = {
		provider: cfg.provider.value,
		baseUrl: cfg.baseUrl.value.trim(),
		model: cfg.model.value.trim(),
		reasoning: cfg.reasoning.value,
		maxTurns: Number(cfg.maxTurns.value),
		discoveryModel: cfg.discoveryModel.value.trim(),
		executionModel: cfg.executionModel.value.trim(),
		headless: cfg.headless.checked,
		concurrentRuns: Number(cfg.concurrentRuns.value) || 3,
		retriesCount: Number(cfg.retriesCount.value) || 0
	};
	if (cfg.key.value.trim()) {
		patch.apiKey = cfg.key.value.trim();
	}
	if (cfg.apiToken.value.trim()) {
		patch.apiToken = cfg.apiToken.value.trim();
	} else if (cfg.apiToken.dataset.cleared === '1') {
		patch.apiToken = '';
	}
	delete cfg.apiToken.dataset.cleared;
	return patch;
}

cfg.provider.onchange = syncProviderFields;

cfg.apiTokenClear.onclick = () => {
	cfg.apiToken.value = ' ';
	cfg.apiToken.dataset.cleared = '1';
	cfg.apiToken.value = '';
	cfg.apiTokenNote.textContent = 'Token will be cleared on Save.';
};

async function openSettings() {
	fillSettings(await api('/config'));
	cfg.dialog.showModal();
}

$('open-settings').onclick = openSettings;
el.modelBadge.onclick = openSettings;

cfg.testBtn.onclick = async () => {
	cfg.test.className = 'test-result busy';
	cfg.test.textContent = 'Probing the endpoint…';
	const result = await api('/config/test', {
		method: 'POST',
		body: JSON.stringify(readSettings())
	}).catch(error => ({ ok: false, error: error.message }));

	cfg.test.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
	if (!result.ok) {
		cfg.test.textContent = result.error;
		return;
	}
	cfg.modelList.replaceChildren(...(result.models ?? []).map(id => {
		const option = document.createElement('option');
		option.value = id;
		return option;
	}));
	cfg.test.textContent = result.matched === false
		? `${result.message} But "${cfg.model.value.trim()}" is not in the list — check the model name.`
		: result.message;
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
	el.questionSlot.replaceChildren();
	await api(`/sessions/${state.sessionId}/message`, {
		method: 'POST',
		body: JSON.stringify({ text })
	}).catch(fail);
};

el.composerInput.addEventListener('input', () => {
	el.composerInput.style.height = 'auto';
	el.composerInput.style.height = `${Math.min(el.composerInput.scrollHeight, 170)}px`;
});

el.composerInput.addEventListener('keydown', event => {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		el.composer.requestSubmit();
	}
});

el.newRun.onclick = startRun;
el.stopRun.onclick = () => api(`/sessions/${state.sessionId}/stop`, { method: 'POST' }).catch(fail);

el.thinkingHead.onclick = () => {
	if (el.thinkingStrip.classList.contains('has-detail')) {
		el.thinkingStrip.classList.toggle('is-open');
		updateThinkingStrip();
	}
};

document.addEventListener('keydown', event => {
	if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
		event.preventDefault();
		void startRun();
	}
	if ((event.metaKey || event.ctrlKey) && event.key === ',') {
		event.preventDefault();
		void openSettings();
	}
});

for (const tab of document.querySelectorAll('.tab')) {
	tab.onclick = () => {
		for (const other of document.querySelectorAll('.tab')) {
			other.classList.toggle('is-active', other === tab);
		}
		for (const pane of document.querySelectorAll('.tab-pane')) {
			pane.classList.toggle('is-active', pane.dataset.pane === tab.dataset.tab);
		}
	};
}

/* ── Project management ────────────────────────────────────────────── */

async function loadProjects() {
	try {
		state.projects = await api('/projects');
	} catch {
		state.projects = [];
	}
	renderProjectSelect();
}

function renderProjectSelect() {
	el.projectSelect.replaceChildren();
	for (const project of state.projects) {
		const opt = document.createElement('option');
		opt.value = project.id;
		opt.textContent = project.name;
		if (project.id === state.projectId) opt.selected = true;
		el.projectSelect.append(opt);
	}
}

async function selectProject(id) {
	state.projectId = id || undefined;
	localStorage.setItem('qase.project', id || '');
	renderProjectSelect();
	await refreshRuns();
	// If there's no session yet for this project, start a new run.
	if (state.session?.projectId !== id) {
		const runs = await api(`/sessions${id ? `?projectId=${id}` : ''}`).catch(() => []);
		if (runs.length > 0) {
			await selectSession(runs[0].id);
		} else {
			await startRun();
		}
	}
}

el.projectSelect.onchange = () => {
	selectProject(el.projectSelect.value);
};

el.newProjectBtn.onclick = async () => {
	const name = prompt('Project name:', '');
	if (!name?.trim()) return;
	try {
		const project = await api('/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim() })
		});
		state.projects.push(project);
		await selectProject(project.id);
		toast(`Project "${project.name}" created`);
	} catch (error) {
		toast(`Failed to create project: ${error.message}`);
	}
};

/* ── Metrics dashboard ─────────────────────────────────────────────── */

async function loadMetrics() {
	if (!el.metricsOverview) return;
	try {
		const projectId = state.session?.projectId ?? state.projectId;
		const query = projectId ? `?projectId=${projectId}` : '';
		const metrics = await api(`/metrics/dashboard${query}`);
		renderMetricsOverview(metrics);
	} catch {
		el.metricsOverview.replaceChildren();
	}
}

function renderMetricsOverview(metrics) {
	el.metricsOverview.replaceChildren();

	const cards = document.createElement('div');
	cards.className = 'metrics-cards';

	// Sessions card
	const sessionsCard = metricCard('Sessions', String(metrics.sessions.total),
		metrics.sessions.byStatus && Object.keys(metrics.sessions.byStatus).length > 1
			? Object.entries(metrics.sessions.byStatus).map(([s, n]) => `${s}: ${n}`).join(' · ')
			: ''
	);

	// Findings card with severity dots
	const findingsCard = metricCard('Findings', String(metrics.findings.total),
		renderSeveritySummary(metrics.findings.bySeverity)
	);

	// Test cases card
	const tcCard = metricCard('Test Cases', String(metrics.testCases.total),
		renderSeveritySummary(metrics.testCases.bySeverity)
	);

	// Regression card
	const regCard = metricCard('Regression Pass Rate',
		`${metrics.regression.overallPassRate}%`,
		`${metrics.regression.totalRuns} run${metrics.regression.totalRuns === 1 ? '' : 's'} · ${metrics.regression.totalTests} test${metrics.regression.totalTests === 1 ? '' : 's'}`
	);

	cards.append(sessionsCard, findingsCard, tcCard, regCard);
	el.metricsOverview.append(cards);
}

function metricCard(label, value, sub) {
	const card = document.createElement('div');
	card.className = 'metric-card';
	const valEl = document.createElement('b');
	valEl.className = 'metric-value';
	valEl.textContent = value;
	const labelEl = document.createElement('span');
	labelEl.className = 'metric-label';
	labelEl.textContent = label;
	card.append(valEl, labelEl);
	if (sub) {
		const subEl = document.createElement('div');
		subEl.className = 'metric-sub';
		if (typeof sub === 'string') {
			subEl.textContent = sub;
		} else {
			subEl.append(sub);
		}
		card.append(subEl);
	}
	return card;
}

function renderSeveritySummary(bySeverity) {
	const frag = document.createDocumentFragment();
	const order = ['critical', 'high', 'medium', 'low', 'info', 'unspecified'];
	for (const sev of order) {
		const count = bySeverity?.[sev];
		if (!count) continue;
		const dot = document.createElement('span');
		dot.className = `sev-dot-mini sev-${sev}`;
		dot.textContent = count;
		frag.append(dot);
	}
	return frag;
}

/* ── Export handlers ──────────────────────────────────────────────── */

async function handleExport(type) {
	if (!state.sessionId) return;

	let url;
	let filename;

	switch (type) {
		case 'findings-markdown':
			url = `/sessions/${state.sessionId}/export/findings?format=markdown`;
			filename = `findings-${state.sessionId}.md`;
			break;
		case 'findings-github':
			url = `/sessions/${state.sessionId}/export/findings?format=github`;
			filename = `findings-github.json`;
			break;
		case 'findings-jira':
			url = `/sessions/${state.sessionId}/export/findings?format=jira`;
			filename = `findings-jira.json`;
			break;
		case 'findings-linear':
			url = `/sessions/${state.sessionId}/export/findings?format=linear`;
			filename = `findings-linear.json`;
			break;
		case 'testcases-json':
			url = `/test-cases/export?format=json`;
			filename = 'test-cases.json';
			break;
		case 'testcases-csv':
			url = `/test-cases/export?format=csv`;
			filename = 'test-cases.csv';
			break;
		default:
			return;
	}

	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Export failed: ${res.status}`);
		const blob = await res.blob();

		const disposition = res.headers.get('Content-Disposition') || '';
		const match = disposition.match(/filename="([^"]+)"/);
		if (match) filename = match[1];

		const downloadUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = filename;
		document.body.append(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(downloadUrl);
		toast(`${type.split('-')[1]?.toUpperCase() ?? 'File'} exported`);
	} catch (error) {
		toast(`Export failed: ${error.message}`);
	}
}

// Wire up export buttons
document.addEventListener('click', event => {
	const btn = event.target.closest('[data-export]');
	if (!btn) return;
	handleExport(btn.dataset.export);
});

/* ── Bugs Hub ─────────────────────────────────────────────────────── */

const bugState = {
	findings: [],
	detailId: null
};

const SEV_LABELS = {
	critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium',
	low: '🔵 Low', info: '⚪ Info'
};

const STATUS_LABELS = {
	open: 'Open', in_testing: 'In Testing', resolved: 'Resolved', closed: 'Closed'
};

function timeAgo(ts) {
	const diff = Date.now() - ts;
	const days = Math.floor(diff / 86400000);
	if (days > 0) return `${days}d ago`;
	const hrs = Math.floor(diff / 3600000);
	if (hrs > 0) return `${hrs}h ago`;
	const mins = Math.floor(diff / 60000);
	if (mins > 0) return `${mins}m ago`;
	return 'just now';
}

async function loadBugs() {
	const projectId = state.projectId ?? '';
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const query = params.toString() ? `?${params.toString()}` : '';
	bugState.findings = await api(`/findings${query}`);

	// Populate category dropdown from data.
	const cats = [...new Set(bugState.findings.map(f => f.category).filter(Boolean))].sort();
	el.bugFilterCategory.innerHTML = '<option value="">All categories</option>' +
		cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

	// Update badge count.
	const openCount = bugState.findings.filter(f => f.status === 'open').length;
	el.countBugs.textContent = openCount > 0 ? openCount : '';

	renderBugsBoard();
	renderBugsStats();
}

function getFilteredBugs() {
	let filtered = bugState.findings;
	const sev = el.bugFilterSeverity.value;
	const status = el.bugFilterStatus.value;
	const cat = el.bugFilterCategory.value;
	const q = el.bugSearch.value.trim().toLowerCase();
	if (sev) filtered = filtered.filter(f => f.severity === sev);
	if (status) filtered = filtered.filter(f => f.status === status);
	if (cat) filtered = filtered.filter(f => f.category === cat);
	if (q) {
		filtered = filtered.filter(f => {
			const haystack = `${f.title} ${f.category} ${f.url} ${f.expected} ${f.actual}`.toLowerCase();
			return haystack.includes(q);
		});
	}
	return filtered;
}

function renderBugsStats() {
	const filtered = getFilteredBugs();
	const open = filtered.filter(f => f.status === 'open').length;
	const testing = filtered.filter(f => f.status === 'in_testing').length;
	const resolved = filtered.filter(f => f.status === 'resolved').length;
	const closed = filtered.filter(f => f.status === 'closed').length;
	el.bugsStats.innerHTML = '';
	for (const [label, count, cls] of [
		['Open', open, 'bug-status-open'],
		['In Testing', testing, 'bug-status-in_testing'],
		['Resolved', resolved, 'bug-status-resolved'],
		['Closed', closed, 'bug-status-closed']
	]) {
		const stat = document.createElement('div');
		stat.className = 'bug-stat';
		stat.innerHTML = `<div class="stat-val ${cls}">${count}</div><div class="stat-lbl">${label}</div>`;
		el.bugsStats.append(stat);
	}
}

function renderBugsBoard() {
	const bugs = getFilteredBugs();
	el.bugsBoard.innerHTML = '';

	if (bugs.length === 0) {
		el.bugsBoard.innerHTML = '<div class="bug-empty">No bugs match the current filters.</div>';
		return;
	}

	for (const bug of bugs) {
		const card = document.createElement('div');
		card.className = 'bug-card';
		card.innerHTML = `
			<div class="bug-card-head">
				<div class="bug-card-title">${escapeHtml(bug.title)}</div>
				<div class="bug-badges">
					<span class="bug-sev-badge bug-sev-${bug.severity}">${bug.severity}</span>
					<span class="bug-status-badge bug-status-${bug.status}">${STATUS_LABELS[bug.status] ?? bug.status}</span>
				</div>
			</div>
			<div class="bug-card-meta">
				<span class="cat">📁 ${escapeHtml(bug.category || 'general')}</span>
				${bug.url ? `<span>🔗 ${escapeHtml(bug.url)}</span>` : ''}
				${bug.assignee ? `<span>👤 ${escapeHtml(bug.assignee)}</span>` : ''}
				<span>⏱ ${timeAgo(bug.ts)}</span>
				${(bug.comments?.length ?? 0) > 0 ? `<span>💬 ${bug.comments.length}</span>` : ''}
				${(bug.testCaseIds?.length ?? 0) > 0 ? `<span>🧪 ${bug.testCaseIds.length} tests</span>` : ''}
			</div>
		`;
		card.addEventListener('click', () => openBugDetail(bug.id));
		el.bugsBoard.append(card);
	}
}

async function openBugDetail(id) {
	bugState.detailId = id;
	try {
		const bug = await api(`/findings/${id}`);
		renderBugDetail(bug);
		el.bugDetail.showModal();
	} catch (error) {
		fail(error);
	}
}

function renderBugDetail(bug) {
	el.bugDetailTitle.textContent = bug.title;

	const body = el.bugDetailBody;
	body.innerHTML = '';

	// Badges.
	const meta = document.createElement('div');
	meta.className = 'bug-detail-meta';
	meta.innerHTML = `
		<span class="bug-sev-badge bug-sev-${bug.severity}">${SEV_LABELS[bug.severity] ?? bug.severity}</span>
		<span class="bug-status-badge bug-status-${bug.status}">${STATUS_LABELS[bug.status] ?? bug.status}</span>
		${bug.category ? `<span class="bug-status-badge">📁 ${escapeHtml(bug.category)}</span>` : ''}
		${bug.assignee ? `<span class="bug-status-badge">👤 ${escapeHtml(bug.assignee)}</span>` : ''}
	`;
	body.append(meta);

	// URL.
	if (bug.url) {
		const urlDiv = document.createElement('div');
		urlDiv.className = 'bug-detail-section';
		urlDiv.innerHTML = `<h4>URL</h4><div><a href="${escapeHtml(bug.url)}" target="_blank" rel="noopener">${escapeHtml(bug.url)}</a></div>`;
		body.append(urlDiv);
	}

	// Steps.
	if (bug.steps?.length) {
		const steps = document.createElement('div');
		steps.className = 'bug-detail-section';
		steps.innerHTML = '<h4>Steps to Reproduce</h4>';
		const ol = document.createElement('ol');
		ol.className = 'bug-detail-steps';
		ol.innerHTML = bug.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('');
		steps.append(ol);
		body.append(steps);
	}

	// Expected / Actual.
	const ea = document.createElement('div');
	ea.className = 'bug-detail-section';
	ea.innerHTML = `
		<h4>Expected vs Actual</h4>
		<div class="bug-detail-ea"><strong>Expected:</strong> ${escapeHtml(bug.expected || '—')}</div>
		<div class="bug-detail-ea"><strong>Actual:</strong> ${escapeHtml(bug.actual || '—')}</div>
	`;
	body.append(ea);

	// Evidence.
	if (bug.evidence) {
		const ev = document.createElement('div');
		ev.className = 'bug-detail-section';
		ev.innerHTML = `<h4>Evidence</h4><pre style="white-space:pre-wrap;font-size:12px;background:var(--surface);padding:8px;border-radius:6px;border:1px solid var(--border)">${escapeHtml(bug.evidence)}</pre>`;
		body.append(ev);
	}

	// Linked test cases.
	const tcSection = document.createElement('div');
	tcSection.className = 'bug-detail-section';
	tcSection.innerHTML = '<h4>Linked Test Cases</h4>';
	const linked = bug.linkedTests ?? [];
	if (linked.length > 0) {
		for (const tc of linked) {
			const row = document.createElement('div');
			row.className = 'bug-link-row';
			row.innerHTML = `<span>🧪 ${escapeHtml(tc.name)}</span><span class="bug-sev-badge bug-sev-${tc.severity || 'low'}">${tc.severity || 'low'}</span>`;
			const unlinkBtn = document.createElement('button');
			unlinkBtn.className = 'btn btn-ghost btn-sm';
			unlinkBtn.textContent = '✕ Unlink';
			unlinkBtn.addEventListener('click', async () => {
				await api(`/findings/${bug.id}/link/${tc.id}`, { method: 'DELETE' });
				const updated = await api(`/findings/${bug.id}`);
				renderBugDetail(updated);
			});
			row.append(unlinkBtn);
			tcSection.append(row);
		}
	} else {
		tcSection.innerHTML += '<div class="bug-empty" style="padding:8px">No test cases linked.</div>';
	}
	body.append(tcSection);

	// Comments.
	const commentsSection = document.createElement('div');
	commentsSection.className = 'bug-detail-section';
	commentsSection.innerHTML = '<h4>Comments</h4>';
	const commentsDiv = document.createElement('div');
	commentsDiv.className = 'bug-detail-comments';
	if (bug.comments?.length) {
		for (const c of bug.comments) {
			const cdiv = document.createElement('div');
			cdiv.className = 'bug-comment';
			cdiv.innerHTML = `<div class="bug-comment-head">${escapeHtml(c.author)} · ${timeAgo(c.ts)}</div><div>${escapeHtml(c.text)}</div>`;
			commentsDiv.append(cdiv);
		}
	} else {
		commentsDiv.innerHTML = '<div class="bug-empty" style="padding:8px">No comments yet.</div>';
	}
	commentsSection.append(commentsDiv);

	// Comment input.
	const commentRow = document.createElement('div');
	commentRow.className = 'bug-comment-input-row';
	const commentInput = document.createElement('input');
	commentInput.type = 'text';
	commentInput.placeholder = 'Add a comment…';
	const commentBtn = document.createElement('button');
	commentBtn.className = 'btn btn-primary btn-sm';
	commentBtn.textContent = 'Post';
	commentBtn.addEventListener('click', async () => {
		if (!commentInput.value.trim()) return;
		await api(`/findings/${bug.id}/comments`, {
			method: 'POST',
			body: JSON.stringify({ author: 'user', text: commentInput.value.trim() })
		});
		commentInput.value = '';
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
	});
	commentRow.append(commentInput, commentBtn);
	commentsSection.append(commentRow);
	body.append(commentsSection);

	// History.
	if (bug.history?.length) {
		const histSection = document.createElement('div');
		histSection.className = 'bug-detail-section';
		histSection.innerHTML = '<h4>History</h4>';
		const timeline = document.createElement('ul');
		timeline.className = 'bug-history-timeline';
		for (const h of bug.history) {
			const li = document.createElement('li');
			li.className = 'bug-history-entry';
			let action;
			if (h.to === 'linked_test') {
				action = `linked test case ${h.detail?.slice(0, 8) ?? ''}`;
			} else if (h.to === 'unlinked_test') {
				action = `unlinked test case ${h.detail?.slice(0, 8) ?? ''}`;
			} else {
				action = `${h.from ?? 'created'} → ${h.to}`;
			}
			li.textContent = `${new Date(h.ts).toLocaleString()} — ${escapeHtml(h.by)}: ${action}`;
			timeline.append(li);
		}
		histSection.append(timeline);
		body.append(histSection);
	}

	// Footer: status control, assignee, edit, delete.
	const foot = el.bugDetailFoot;
	foot.innerHTML = '';

	// Status dropdown.
	const statusDiv = document.createElement('div');
	statusDiv.className = 'bug-status-control';
	statusDiv.innerHTML = '<span style="font-size:12px;opacity:0.6">Status:</span>';
	const statusSelect = document.createElement('select');
	for (const s of ['open', 'in_testing', 'resolved', 'closed']) {
		const opt = document.createElement('option');
		opt.value = s;
		opt.textContent = STATUS_LABELS[s];
		if (bug.status === s) opt.selected = true;
		statusSelect.append(opt);
	}
	statusSelect.addEventListener('change', async () => {
		await api(`/findings/${bug.id}/status`, {
			method: 'PATCH',
			body: JSON.stringify({ status: statusSelect.value, by: 'user' })
		});
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
		await loadBugs();
	});
	statusDiv.append(statusSelect);

	// Assignee input.
	const assigneeDiv = document.createElement('div');
	assigneeDiv.className = 'bug-status-control';
	assigneeDiv.innerHTML = '<span style="font-size:12px;opacity:0.6">Assignee:</span>';
	const assigneeInput = document.createElement('input');
	assigneeInput.type = 'text';
	assigneeInput.className = 'bug-assignee-input';
	assigneeInput.value = bug.assignee ?? '';
	assigneeInput.placeholder = 'Unassigned';
	const saveAssignee = async () => {
		await api(`/findings/${bug.id}`, {
			method: 'PUT',
			body: JSON.stringify({ assignee: assigneeInput.value.trim() })
		});
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
		await loadBugs();
	};
	assigneeInput.addEventListener('change', saveAssignee);
	assigneeDiv.append(assigneeInput);

	const spacer = document.createElement('div');
	spacer.style.flex = '1';

	// Delete button.
	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'btn btn-ghost btn-sm';
	deleteBtn.style.color = 'var(--danger, #ff453a)';
	deleteBtn.textContent = '🗑 Delete';
	deleteBtn.addEventListener('click', async () => {
		if (!confirm('Delete this bug? This cannot be undone.')) return;
		await api(`/findings/${bug.id}`, { method: 'DELETE' });
		el.bugDetail.close();
		await loadBugs();
		toast('Bug deleted');
	});

	foot.style.display = 'flex';
	foot.style.gap = '8px';
	foot.style.alignItems = 'center';
	foot.style.flexWrap = 'wrap';
	foot.append(statusDiv, assigneeDiv, spacer, deleteBtn);}

/* ── Bug editor (new bug) ─────────────────────────────────────────── */

function openBugEditor() {
	el.bugEditTitle.value = '';
	el.bugEditSeverity.value = 'medium';
	el.bugEditCategory.value = '';
	el.bugEditUrl.value = '';
	el.bugEditSteps.value = '';
	el.bugEditExpected.value = '';
	el.bugEditActual.value = '';
	el.bugEditEvidence.value = '';
	el.bugEditor.showModal();
}

async function saveNewBug() {
	const data = {
		title: el.bugEditTitle.value.trim(),
		severity: el.bugEditSeverity.value,
		category: el.bugEditCategory.value.trim() || 'general',
		url: el.bugEditUrl.value.trim(),
		steps: el.bugEditSteps.value.split('\n').map(s => s.trim()).filter(Boolean),
		expected: el.bugEditExpected.value.trim(),
		actual: el.bugEditActual.value.trim(),
		evidence: el.bugEditEvidence.value.trim() || undefined,
		projectId: state.projectId
	};
	if (!data.title) {
		toast('Title is required', 'bad');
		return;
	}
	try {
		await api('/findings', { method: 'POST', body: JSON.stringify(data) });
		el.bugEditor.close();
		await loadBugs();
		toast('Bug created');
	} catch (error) {
		fail(error);
	}
}

/* ── Bugs Hub event wiring ────────────────────────────────────────── */

el.openBugs.addEventListener('click', async () => {
	el.bugsHub.hidden = false;
	await loadBugs();
});

el.closeBugs.addEventListener('click', () => {
	el.bugsHub.hidden = true;
});

el.btnNewBug.addEventListener('click', openBugEditor);
el.bugEditorClose.addEventListener('click', () => el.bugEditor.close());
el.bugEditorSave.addEventListener('click', saveNewBug);
el.bugDetailClose.addEventListener('click', () => el.bugDetail.close());

el.bugSearch.addEventListener('input', () => { renderBugsBoard(); renderBugsStats(); });
el.bugFilterSeverity.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });
el.bugFilterStatus.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });
el.bugFilterCategory.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });

// Cross-session export buttons.
document.querySelectorAll('[data-bug-export]').forEach(btn => {
	btn.addEventListener('click', async () => {
		const format = btn.dataset.bugExport;
		const params = new URLSearchParams();
		const projectId = state.projectId;
		if (projectId) params.set('projectId', projectId);
		try {
			const res = await fetch(`/api/findings/export?format=${format}&${params}`);
			if (!res.ok) throw new Error('Export failed');
			const blob = await res.blob();
			const disposition = res.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^"]+)"?/);
			const filename = match?.[1] || `bugs-${format}.${format === 'markdown' ? 'md' : 'json'}`;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
			toast(`Bugs exported as ${format}`);
		} catch (error) {
			fail(error);
		}
	});
});

/* ── Boot ────────────────────────────────────────────────────────── */

(async function boot() {
	const config = await api('/config').catch(() => undefined);
	if (config) {
		paintConfig(config);
	}

	// Load projects and restore remembered selection.
	await loadProjects();
	const rememberedProject = localStorage.getItem('qase.project');
	if (rememberedProject && state.projects.some(p => p.id === rememberedProject)) {
		state.projectId = rememberedProject;
	} else if (state.projects.length > 0) {
		state.projectId = state.projects[0].id;
	}
	renderProjectSelect();

	const runs = await api(`/sessions${state.projectId ? `?projectId=${state.projectId}` : ''}`).catch(() => []);
	const remembered = localStorage.getItem('qase.session');
	const target = runs.find(run => run.id === remembered) ?? runs[0];

	if (target) {
		await selectSession(target.id);
	} else {
		await startRun();
	}
	el.composerInput.focus();
})();
