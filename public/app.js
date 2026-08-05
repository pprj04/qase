/**
 * Qase dashboard — core module.
 *
 * Runs/Sessions/Chat, Workflows, Regression/Schedules, Metrics, Export,
 * Settings, SSE event handling, and boot.
 *
 * Bugs, Tests, and Pipeline logic live in their respective modules.
 */

import { $, el, state, api, toast, fail, escapeHtml, markdown, hostOf, relativeTime, truncate, STEP_ICONS, CRON_PRESETS, initThemeToggle } from './shared.js';
import { initRouter, navigate, currentPage } from './router.js';
import { loadTestCases, renderTestCases, initTestsWiring } from './tests.js';
import { loadBugs, openBugDetail, initBugsWiring } from './bugs.js';
import { renderPipeline, loadPipelineFromSession, renderDevIntel, loadDevIntelFromSession, pipelineState, devIntelState } from './pipeline.js';
import { loadWorkflowsPage, initWorkflowsWiring } from './workflows.js';
import { loadSchedulesPage, initSchedulesWiring } from './schedules.js';

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
	dot.className = 'run-status-dot';
	dot.dataset.status = run.status || 'idle';
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

	// Lazy-load heavy arrays if stripped (large sessions).
	if (!session.messages && session.messageCount > 0) {
		const [messages, steps, findings] = await Promise.all([
			api(`/sessions/${id}/detail?field=messages`).catch(() => []),
			api(`/sessions/${id}/detail?field=capturedSteps`).catch(() => []),
			api(`/sessions/${id}/detail?field=findings`).catch(() => [])
		]);
		session.messages = messages;
		session.capturedSteps = steps;
		session.findings = findings;
	} else if (!session.messages) {
		session.messages = session.messages ?? [];
	}
	if (!session.capturedSteps) session.capturedSteps = [];
	if (!session.findings) session.findings = [];

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
	await loadPipelineFromSession(id);
	await loadDevIntelFromSession(id);

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
	if (activity.status === 'running') icon.textContent = '⟳';
	else if (activity.status === 'failed') icon.textContent = '⚠';
	else icon.textContent = '✓';

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

		case 'pipeline_start':
			pipelineState.stages = {};
			for (const stage of (event.stages ?? [])) {
				pipelineState.stages[stage.key] = { status: 'pending', info: stage };
			}
			renderPipeline();
			break;

		case 'pipeline_progress': {
			if (!pipelineState.stages) pipelineState.stages = {};
			pipelineState.stages[event.stage] = {
				status: event.status,
				detail: event.detail,
				result: event.result
			};
			renderPipeline();
			break;
		}

		case 'pipeline_complete': {
			pipelineState.summary = event.summary;
			pipelineState.stages = event.stages;
			renderPipeline();
			break;
		}

		case 'dev_intelligence_complete': {
			devIntelState.data = event.devIntelligence;
			renderDevIntel();
			break;
		}

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
	autoSaveWorkflow: $('cfg-auto-save-workflow'),
	autoGenTests: $('cfg-auto-gen-tests'),
	autoSmokeRun: $('cfg-auto-smoke-run'),
	autoCreateSchedule: $('cfg-auto-create-schedule'),
	autoDevReport: $('cfg-auto-dev-report'),
	exploreViewports: $('cfg-explore-viewports'),
	defaultCron: $('cfg-default-cron'),
	browserstackEnabled: $('cfg-browserstack-enabled'),
	browserstackBrowsers: $('cfg-browserstack-browsers'),
	browserstackUser: $('cfg-browserstack-user'),
	browserstackKey: $('cfg-browserstack-key'),
	browserstackKeyClear: $('cfg-browserstack-key-clear'),
	selfHealEnabled: $('cfg-self-heal-enabled'),
	selfHealThreshold: $('cfg-self-heal-threshold'),
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
	cfg.autoSaveWorkflow.checked = config.autoSaveWorkflow !== false;
	cfg.autoGenTests.checked = config.autoGenerateTests !== false;
	cfg.autoSmokeRun.checked = config.autoSmokeRun === true;
	cfg.autoCreateSchedule.checked = config.autoCreateSchedule !== false;
	cfg.autoDevReport.checked = config.autoDevReport !== false;
	cfg.exploreViewports.checked = config.exploreViewports !== false;
	cfg.defaultCron.value = config.defaultScheduleCron ?? '0 9 * * *';

	// BrowserStack
	cfg.browserstackEnabled.checked = config.browserstackEnabled === true;
	cfg.browserstackBrowsers.value = config.browserstackBrowsers ?? 'chrome';
	cfg.browserstackUser.value = config.browserstackUser ?? '';
	cfg.browserstackKey.value = '';
	cfg.browserstackKey.placeholder = config.hasBrowserstackKey ? '•••• (set — leave blank to keep)' : 'your-access-key';

	// Self-Healing
	cfg.selfHealEnabled.checked = config.selfHealEnabled !== false;
	cfg.selfHealThreshold.value = config.selfHealThreshold ?? 0.8;

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
		retriesCount: Number(cfg.retriesCount.value) || 0,
		autoSaveWorkflow: cfg.autoSaveWorkflow.checked,
		autoGenerateTests: cfg.autoGenTests.checked,
		autoSmokeRun: cfg.autoSmokeRun.checked,
		autoCreateSchedule: cfg.autoCreateSchedule.checked,
		autoDevReport: cfg.autoDevReport.checked,
		exploreViewports: cfg.exploreViewports.checked,
		defaultScheduleCron: cfg.defaultCron.value.trim(),
		browserstackEnabled: cfg.browserstackEnabled.checked,
		browserstackBrowsers: cfg.browserstackBrowsers.value.trim(),
		browserstackUser: cfg.browserstackUser.value.trim(),
		selfHealEnabled: cfg.selfHealEnabled.checked,
		selfHealThreshold: Number(cfg.selfHealThreshold.value)
	};
	if (cfg.key.value.trim()) {
		patch.apiKey = cfg.key.value.trim();
	}
	if (cfg.apiToken.value.trim()) {
		patch.apiToken = cfg.apiToken.value.trim();
	} else if (cfg.apiToken.dataset.cleared === '1') {
		patch.apiToken = '';
	}
	if (cfg.browserstackKey.value.trim()) {
		patch.browserstackKey = cfg.browserstackKey.value.trim();
	} else if (cfg.browserstackKey.dataset.cleared === '1') {
		patch.browserstackKey = '';
	}
	delete cfg.apiToken.dataset.cleared;
	delete cfg.browserstackKey.dataset.cleared;
	return patch;
}

cfg.provider.onchange = syncProviderFields;

cfg.apiTokenClear.onclick = () => {
	cfg.apiToken.value = ' ';
	cfg.apiToken.dataset.cleared = '1';
	cfg.apiToken.value = '';
	cfg.apiTokenNote.textContent = 'Token will be cleared on Save.';
};

cfg.browserstackKeyClear.onclick = () => {
	cfg.browserstackKey.value = ' ';
	cfg.browserstackKey.dataset.cleared = '1';
	cfg.browserstackKey.value = '';
	cfg.browserstackKey.placeholder = 'Key will be cleared on Save.';
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

/* ── Autonomy Pipeline (Phase 12) ──────────────────────────────── */


/* ── Boot ────────────────────────────────────────────────────────── */

(async function boot() {
	// ── Router: load page-specific data on navigation ──────────────
	window.addEventListener('routechange', (e) => {
		const page = e.detail.page;
		if (page === 'bugs') loadBugs();
		if (page === 'tests') loadTestCases();
		if (page === 'workflows') loadWorkflowsPage();
		if (page === 'schedules') loadSchedulesPage();
	});
	initRouter();

	// Wire up event listeners.
	initBugsWiring();
	initTestsWiring();
	initWorkflowsWiring();
	initSchedulesWiring();
	initThemeToggle();

	// Fire independent boot requests in parallel (config + projects).
	const [config, projects] = await Promise.all([
		api('/config').catch(() => undefined),
		api('/projects').catch(() => [])
	]);

	if (config) {
		paintConfig(config);
	}

	// Resolve project selection from parallel-fetched data.
	state.projects = projects;
	const rememberedProject = localStorage.getItem('qase.project');
	if (rememberedProject && state.projects.some(p => p.id === rememberedProject)) {
		state.projectId = rememberedProject;
	} else if (state.projects.length > 0) {
		state.projectId = state.projects[0].id;
	}
	renderProjectSelect();

	// Sessions depend on projectId — fetch after project resolution.
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
