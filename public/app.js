/**
 * Qase dashboard — core module.
 *
 * Runs/Sessions/Chat, Workflows, Regression/Schedules, Metrics, Export,
 * Settings, SSE event handling, and boot.
 *
 * Bugs, Tests, and Pipeline logic live in their respective modules.
 */

import { $, el, state, api, apiRaw, toast, fail, escapeHtml, markdown, hostOf, relativeTime, truncate, STEP_ICONS, CRON_PRESETS, initThemeToggle } from './shared.js';
import { initRouter, navigate, currentPage, runIdFromHash, setRunRoute } from './router.js';
import { initShell, setProjectSwitching, setShellAuth } from './shell.js';
import { loadTestCases, initTestsWiring } from './tests.js';
import { loadBugs, initBugsWiring } from './bugs.js';
import { renderPipeline, loadPipelineFromSession, renderDevIntel, loadDevIntelFromSession, pipelineState, devIntelState } from './pipeline.js';
import { loadWorkflowsPage, initWorkflowsWiring } from './workflows.js';
import { loadSchedulesPage, initSchedulesWiring } from './schedules.js';
import { initOverview, loadOverview, markOverviewStale } from './overview.js';
import { initNewRun, openNewRun } from './newRun.js';
import {
	authenticationChallengePresentation,
	buildCredentialFields,
	browserHistoryPresentation,
	canonicalRunPresentation,
	credentialRequestSnapshot,
	executionHealthPresentation,
	isCurrentCredentialRequest,
	isCurrentRunView,
	normalizeGeneratedReportMarkdown,
	reportPresentation,
	runMetricPresentation,
	runViewSnapshot,
	safeRunDiagnostic,
	shouldRefreshRunOnReentry
} from './runDetail.js';
import { classifyViewport } from './deviceClassify.js';
import { resolveLiveDevicePresentation } from './deviceLiveView.js';
import { renderExecMeta, renderExecutionHealth, renderSessionFindings, handleTabActivation, initExecutionDetail, loadSessionEvidence } from './executionDetail.js';

async function refreshRuns(projectId = state.projectId, projectVersion = state.projectVersion) {
	const query = projectId ? `?projectId=${projectId}` : '';
	let runs;
	try {
		runs = await api(`/sessions${query}`);
	} catch (err) {
		if (projectVersion !== state.projectVersion || projectId !== state.projectId) return false;
		el.runList.innerHTML = '<div class="feed-empty">Unable to load runs. <a href="#" onclick="location.reload();return false;">Retry</a></div>';
		return false;
	}
	if (projectVersion !== state.projectVersion || projectId !== state.projectId) return false;
	if (runs.length === 0) {
		el.runList.innerHTML = '<div class="feed-empty">No runs yet</div>';
		return true;
	}
	el.runList.replaceChildren(...runs.map(renderRun));
	return true;
}

function renderRun(run) {
	const presentation = canonicalRunPresentation(run);
	const node = document.createElement('div');
	node.className = `run${run.id === state.sessionId ? ' is-active' : ''}`;
	node.setAttribute('role', 'button');
	node.tabIndex = 0;
	node.setAttribute('aria-label', `Open ${run.targetUrl ? hostOf(run.targetUrl) : run.title || 'run'}, status ${presentation.label}`);
	node.onclick = () => {
		closeMobileRunsDrawer();
		selectSession(run.id);
	};
	node.onkeydown = event => {
		if (event.target !== node || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		selectSession(run.id);
	};

	const title = document.createElement('div');
	title.className = 'run-title';
	title.textContent = run.targetUrl ? hostOf(run.targetUrl) : run.title;

	const meta = document.createElement('div');
	meta.className = 'run-meta';
	const dot = document.createElement('span');
	dot.className = 'run-status-dot';
	dot.dataset.status = presentation.key;
	dot.setAttribute('aria-hidden', 'true');
	const statusLabel = document.createElement('span');
	statusLabel.className = 'run-status-label';
	statusLabel.textContent = presentation.label;
	meta.append(dot, statusLabel, document.createTextNode(relativeTime(run.updatedAt)));
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
	remove.setAttribute('aria-label', `Delete ${run.targetUrl ? hostOf(run.targetUrl) : run.title || 'run'}`);
	remove.onclick = async event => {
		event.stopPropagation();
		await api(`/sessions/${run.id}`, { method: 'DELETE' }).catch(fail);
		if (run.id === state.sessionId) {
			// Select the next run if one exists; otherwise show the empty hero
			// (no auto-created replacement shell).
			state.sessionId = null;
			state.session = null;
			const remaining = await api('/sessions').catch(() => []);
			await (remaining[0] ? selectSession(remaining[0].id) : refreshRuns());
			if (!remaining.length) {
				el.chatEmpty.hidden = false;
			}
		} else {
			await refreshRuns();
		}
	};

	node.append(title, meta, remove);
	return node;
}

function closeMobileRunsDrawer() {
	document.querySelector('.panel.runs')?.classList.remove('mobile-open');
	const toggle = document.getElementById('mobile-runs-toggle');
	if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

/* ── Session loading ─────────────────────────────────────────────── */

async function selectSession(id, projectVersion = state.projectVersion) {
	state.stream?.close();
	state.stream = undefined;
	clearTimeout(state._reconnectTimer);
	const runViewVersion = ++state.runViewVersion;
	state.sessionId = id;
	state.bubbles.clear();
	// Viewport is per-session live state: reset it so a desktop session never
	// inherits the previous device session's frame dimensions.
	state.viewport = null;
	localStorage.setItem('qase.session', id);
	// Keep the URL shareable in either the path-based or legacy hash scheme.
	setRunRoute(id);
	const snapshot = runViewSnapshot(state, id);

	const session = await api(`/sessions/${id}`).catch(err => {
		if (isCurrentRunView(state, snapshot)) fail(err);
		return null;
	});
	if (!session) return;
	if (runViewVersion !== state.runViewVersion || !isCurrentRunView(state, snapshot)
		|| projectVersion !== state.projectVersion || session.projectId !== state.projectId) return;
	state.session = session;

	// Lazy-load heavy arrays if stripped (large sessions).
	if (!session.messages && session.messageCount > 0) {
		const [messages, steps, findings] = await Promise.all([
			api(`/sessions/${id}/detail?field=messages`).catch(() => []),
			api(`/sessions/${id}/detail?field=capturedSteps`).catch(() => []),
			api(`/sessions/${id}/detail?field=findings`).catch(() => [])
		]);
		if (!isCurrentRunView(state, snapshot) || projectVersion !== state.projectVersion || session.projectId !== state.projectId) return;
		session.messages = messages;
		session.capturedSteps = steps;
		session.findings = findings;
	} else if (!session.messages) {
		session.messages = session.messages ?? [];
	}
	if (!session.capturedSteps) session.capturedSteps = [];
	if (!session.findings) session.findings = [];
	if (!session.activities) session.activities = [];
	if (!session.todos) session.todos = [];
	// Device context persists across refresh: prefer the resolved device,
	// fall back to the request, else classify from the live frame viewport.
	state.device = session.device ?? null;
	if (!state.device && session.deviceRequest) {
		const requested = typeof session.deviceRequest === 'string'
			? session.deviceRequest
			: session.deviceRequest?.device ?? session.deviceRequest?.deviceName;
		state.device = requested ? { deviceName: requested, deviceType: /ipad|tablet|nexus 7/i.test(requested) ? 'tablet' : 'phone' } : null;
	}
	// Initial strip render happens after the frame is applied below — but for
	// desktop sessions with no frame there is nothing to render, so hide any
	// leftover strip from the previous session right away.
	renderDeviceStrip();

	// Render everything synchronously first — this is instant.
	renderHeader();
	renderExecMeta(session);
	renderExecutionHealth(session);
	renderTranscript();
	resetThinking();
	renderQuestion();
	renderActivities();
	renderTodos();
	renderFindings();
	renderSessionFindings(session);
	handleTabActivation(document.querySelector('.tab.is-active')?.dataset.tab ?? null);
	renderReport();
	updateExecStats();
	renderBrowserHistory(session);
	if (session.frame) applyFrame(session.frame);
	else el.stageInner.classList.remove('device-phone', 'device-tablet', 'device-landscape');

	// Parallelize all secondary data loads — no more sequential blocking.
	// SSE connection opens immediately so live events aren't missed.
	connect(id, snapshot);

	await Promise.allSettled([
		loadWorkflows(),
		loadTestCases(),
		loadRegression(),
		loadMetrics(),
		loadPipelineFromSession(id),
		loadDevIntelFromSession(id),
		loadSessionMission(id),
		loadSessionEvidence(id),
		refreshRuns(),
	]);
	if (!isCurrentRunView(state, snapshot) || projectVersion !== state.projectVersion || session.projectId !== state.projectId) return;

	// Restore persisted summary bar (Phase 15: previously only shown on live SSE).
	const persistedSummary = session.pipeline?.summary;
	if (persistedSummary && persistedSummary.qualityScore != null) {
		updateMissionSummary(persistedSummary);
	}

}

function renderHeader() {
	const session = state.session;
	el.statusChip.hidden = false;
	el.chatTitle.textContent = session.targetUrl ? hostOf(session.targetUrl) : session.title;
	el.chatTarget.textContent = session.targetUrl ?? 'Send a URL to begin';
	setStatus(session.status);
	renderRunSummary(session);
	// BUILD 1: late joiners (selecting an already-running session) should see
	// the same phase tracker a live viewer gets — hydrate from current status.
	updateMissionPhase(session.status, session.latestActivity ?? null);
}

function setStatus(status) {
	if (state.session) state.session.status = status;
	const presentation = canonicalRunPresentation(state.session ?? { status });
	el.statusChip.dataset.status = presentation.key;
	el.statusChip.textContent = presentation.label;
	el.statusChip.title = state.session?.outcomeReason ? `Outcome reason: ${safeRunDiagnostic(state.session.outcomeReason)}` : '';
	const running = status === 'running' && presentation.key === 'running';
	el.stopRun.hidden = !running;
	if (!running) {
		el.stopRun.disabled = false;
		el.stopRun.textContent = 'Stop';
	}
	el.sendBtn.disabled = running;
	el.browserDot.className = `dot${running ? ' is-busy' : state.session?.targetUrl ? ' is-live' : ''}`;
	// A question raised while the tab is in the background should be noticeable.
	document.title = presentation.key === 'awaiting_input'
		? 'Qase — awaiting input'
		: 'Qase — autonomous QA agent';
	updateThinkingStrip();
}

/* ── Mission phase tracker ─────────────────────────────────────────── */

const missionEl = () => document.getElementById('mission-phases');

function updateMissionPhase(status, activityLabel) {
	const phases = missionEl();
	if (!phases) return;

	if (status === 'idle' || status === 'done' || status === 'error' || status === 'interrupted') {
		phases.hidden = true;
		return;
	}

	phases.hidden = false;

	// Infer phase from the activity or status
	const text = (activityLabel || status || '').toLowerCase();
	let phase = 'explore';
	if (text.includes('test') || text.includes('assert') || text.includes('form') ||
		text.includes('click') || text.includes('fill') || text.includes('login')) {
		phase = 'test';
	}
	if (text.includes('report') || text.includes('finding') || text.includes('summary')) {
		phase = 'report';
	}

	const order = ['explore', 'test', 'report'];
	const currentIdx = order.indexOf(phase);

	for (let i = 0; i < order.length; i++) {
		const el = phases.querySelector(`[data-phase="${order[i]}"]`);
		if (!el) continue;
		el.classList.remove('is-active', 'is-done');
		if (i < currentIdx) el.classList.add('is-done');
		if (i === currentIdx) el.classList.add('is-active');
	}
}

/* ── Execution stats bar (Step 4) ─────────────────────────────────── */

function updateExecStats() {
	const bar = document.getElementById('exec-stats-bar');
	if (!bar) return;

	const session = state.session;
	if (!session) { bar.hidden = true; return; }

	const findings = session.findings ?? [];
	const metrics = runMetricPresentation(session);
	const status = canonicalRunPresentation(session);
	const running = status.key === 'running';

	const pages = metrics.pages;
	const actions = metrics.actions;
	const findingsCount = metrics.findings.value;
	const criticalCount = findings.filter(f => f.severity === 'critical').length;

	// Elapsed time
	let elapsedStr = '';
	if (metrics.durationMs != null) {
		const secs = Math.floor(metrics.durationMs / 1000);
		const mins = Math.floor(secs / 60);
		const s = secs % 60;
		elapsedStr = `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	// Build the stats bar
	const stats = [];
	if (elapsedStr) stats.push(`<span class="es-item"><span class="es-icon">⏱</span> ${elapsedStr}</span>`);
	if (pages != null) stats.push(`<span class="es-item"><span class="es-icon">📄</span> ${pages} page${pages === 1 ? '' : 's'}</span>`);
	if (actions != null) stats.push(`<span class="es-item"><span class="es-icon">🖱</span> ${actions} action${actions === 1 ? '' : 's'}</span>`);
	if (findingsCount != null) {
		const critBadge = criticalCount > 0
			? ` · <span class="es-crit">${criticalCount} critical</span>`
			: '';
		stats.push(`<span class="es-item es-findings"><span class="es-icon">🔍</span> ${findingsCount} finding${findingsCount === 1 ? '' : 's'}${critBadge}</span>`);
	}
	if (running) {
		stats.push('<span class="es-item es-live"><span class="es-pulse"></span> LIVE</span>');
	} else if (status.key === 'completed') {
		stats.push('<span class="es-item es-done">✓ COMPLETED</span>');
	} else if (['failed', 'blocked', 'partial', 'cancelled', 'interrupted'].includes(status.key)) {
		stats.push(`<span class="es-item es-failed">${escapeHtml(status.label.toUpperCase())}</span>`);
	}

	bar.innerHTML = stats.join('');
	bar.hidden = false;
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
		state.renderedQuestionKey = null;
		return;
	}
	const challenge = authenticationChallengePresentation(question, state.session?.targetUrl);
	const questionKey = `${state.sessionId}:${question.id ?? question.question ?? challenge.kind}`;
	const isNewQuestion = state.renderedQuestionKey !== questionKey;
	state.renderedQuestionKey = questionKey;

	const card = document.createElement('div');
	card.className = `question ${challenge.kind === 'credentials' ? 'authentication-required' : 'awaiting-input'}`;
	card.setAttribute('aria-labelledby', 'run-question-title');

	const tag = document.createElement('div');
	tag.className = 'question-tag';
	tag.textContent = challenge.kind === 'credentials' ? 'Secure continuation' : 'Run paused';

	const heading = document.createElement('h2');
	heading.id = 'run-question-title';
	heading.className = 'question-title';
	heading.textContent = challenge.title;

	const text = document.createElement('p');
	text.className = 'question-text';
	text.textContent = challenge.kind === 'credentials'
		? 'QASE needs credentials to continue testing this application.'
		: String(question.question ?? 'QASE needs your input to continue this run.');

	card.append(tag, heading, text);

	if (question.summary && challenge.kind !== 'credentials') {
		const summary = document.createElement('div');
		summary.className = 'question-summary';
		summary.textContent = question.summary;
		card.append(summary);
	}

	card.append(challenge.kind === 'credentials' ? credentialForm(challenge, questionKey) : optionForm(question));
	el.questionSlot.append(card);
	if (isNewQuestion && window.matchMedia('(max-width: 700px)').matches) {
		activateRunSegment('details');
	}
	if (isNewQuestion) card.querySelector('input, button')?.focus({ preventScroll: true });
}

function optionForm(question) {
	const wrap = document.createDocumentFragment();

	if ((question.options ?? []).length > 0) {
		const options = document.createElement('div');
		options.className = 'question-options';
		for (const option of question.options ?? []) {
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
function credentialForm(challenge, questionKey) {
	const form = document.createElement('form');
	form.className = 'cred-form';
	form.noValidate = true;
	state.credentialRequestVersion += 1;

	const row = document.createElement('div');
	row.className = 'cred-row';
	const controls = {};
	const addField = (name, labelText, type, autocomplete, inputMode) => {
		const label = document.createElement('label');
		label.className = 'cred-field';
		const labelNode = document.createElement('span');
		labelNode.textContent = labelText;
		const input = document.createElement('input');
		input.name = name;
		input.type = type;
		input.autocomplete = autocomplete;
		input.required = true;
		if (inputMode) input.inputMode = inputMode;
		input.setAttribute('aria-describedby', 'credential-security-note credential-error');
		label.append(labelNode, input);
		row.append(label);
		controls[name] = input;
	};
	if (challenge.fields.includes('username')) addField('username', 'Email or username', 'text', 'off');
	if (challenge.fields.includes('password')) addField('password', 'Password', 'password', 'off');
	if (challenge.fields.includes('otp')) addField('otp', 'One-time code', 'password', 'off', 'numeric');

	const note = document.createElement('div');
	note.className = 'cred-note';
	note.id = 'credential-security-note';
	note.textContent = 'Credentials are sent directly to the existing in-memory session vault. Values are not added to activity, findings, reports, URLs, or browser storage.';
	const errorNode = document.createElement('p');
	errorNode.id = 'credential-error';
	errorNode.className = 'credential-error';
	errorNode.setAttribute('role', 'alert');
	const progress = document.createElement('p');
	progress.className = 'credential-progress';
	progress.setAttribute('aria-live', 'polite');

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

	form.append(row, note, errorNode, progress, actions);
	form.onsubmit = async event => {
		event.preventDefault();
		errorNode.textContent = '';
		const fields = buildCredentialFields({
			username: controls.username?.value,
			password: controls.password?.value,
			otp: controls.otp?.value
		}, challenge.fields);
		if (Object.keys(fields).length === 0) {
			errorNode.textContent = 'Enter the requested authentication information.';
			Object.values(controls)[0]?.focus();
			return;
		}
		for (const control of Object.values(controls)) control.disabled = true;
		submit.disabled = true;
		skip.disabled = true;
		progress.textContent = 'Submitting securely…';
		const sessionId = state.sessionId;
		state.credentialRequestVersion += 1;
		const requestSnapshot = credentialRequestSnapshot(state, sessionId);
		const requestIsCurrent = () => isCurrentCredentialRequest(state, requestSnapshot, {
			formConnected: form.isConnected,
			questionKey
		});
		try {
			await api(`/sessions/${sessionId}/credentials`, { method: 'POST', body: JSON.stringify({ fields }) });
			if (!requestIsCurrent()) return;
			for (const control of Object.values(controls)) control.value = '';
			state.session.pendingQuestion = undefined;
			state.renderedQuestionKey = null;
			el.questionSlot.replaceChildren();
			toast('Authentication submitted. This run is continuing in the same session.', 'good');
		} catch (caught) {
			if (!requestIsCurrent()) return;
			for (const control of Object.values(controls)) control.disabled = false;
			submit.disabled = false;
			skip.disabled = false;
			progress.textContent = '';
			const safeMessage = caught instanceof Error ? caught.message : 'Authentication was rejected.';
			errorNode.textContent = safeRunDiagnostic(safeMessage) || 'Authentication was rejected.';
		}
	};

	return form;
}

async function sendAnswer(answer) {
	const sessionId = state.sessionId;
	try {
		await api(`/sessions/${sessionId}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
		if (sessionId !== state.sessionId) return;
		el.questionSlot.replaceChildren();
		state.session.pendingQuestion = undefined;
		state.renderedQuestionKey = null;
	} catch (error) {
		fail(error);
	}
}

/* ── Live browser view ───────────────────────────────────────────── */

function applyFrame(frame) {
	el.frame.onerror = null;
	el.frame.src = `data:${frame.mimeType};base64,${frame.base64}`;
	el.frame.alt = 'Current live view of the application under test';
	el.stageEmpty.hidden = true;
	el.stageInner.hidden = false;
	el.stageInner.removeAttribute('data-mode');
	document.getElementById('overlay')?.removeAttribute('hidden');
	const browserState = document.getElementById('browser-state-label');
	if (browserState) browserState.textContent = 'Live browser connected';
	// P0-F5 — a real frame arrived: the browser is back. The reconnecting
	// placeholder (if any) is no longer the truthful state.
	delete el.stageEmpty.dataset.mode;
	if (frame.viewport) {
		state.viewport = frame.viewport;
	}
	if (frame.url) {
		el.browserUrl.textContent = frame.url;
	}
	el.browserTitle.textContent = truncate(frame.title ?? '', 40);
	// Device frame + strip follow the REAL viewport on every frame.
	renderDeviceStrip();
	applyDeviceFrameClass();
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

/* ── Device live view (mobile / tablet) ────────────────────────────── */

/**
 * Classifies the REAL execution viewport into phone / tablet / desktop.
 * Only the actual frame dimensions decide — a CSS-resized desktop window is
 * never misreported as a phone. Shared implementation lives in
 * deviceClassify.js so tests can exercise it without a DOM.
 */


/** Applies / removes the device frame classes on the stage. */
function applyDeviceFrameClass() {
	const device = state.device;
	const presentation = resolveLiveDevicePresentation({
		device,
		capturedViewport: state.viewport
	});
	const { kind, viewport } = presentation;
	const landscape = viewport?.width > viewport?.height;
	el.stageInner.classList.remove('device-phone', 'device-tablet', 'device-landscape');
	el.stageInner.style.removeProperty('--device-frame-aspect');
	if (kind === 'desktop' || !el.frame.src) return;
	el.stageInner.classList.add(kind === 'phone' ? 'device-phone' : 'device-tablet');
	el.stageInner.style.setProperty('--device-frame-aspect', presentation.frameAspect);
	if (landscape) el.stageInner.classList.add('device-landscape');
}

/**
 * Renders the device info strip: device, OS, browser, viewport, mode.
 * Shows only fields actually available; hidden entirely for desktop.
 */
function renderDeviceStrip() {
	const strip = document.getElementById('device-strip');
	const device = state.device;
	if (!strip) return;
	const presentation = resolveLiveDevicePresentation({
		device,
		capturedViewport: state.viewport
	});
	const { viewport, kind } = presentation;
	if (kind === 'desktop') {
		strip.hidden = true;
		strip.replaceChildren();
		return;
	}
	const parts = [];
	if (device?.deviceName) {
		parts.push(['Device', `<span class="device-name">${escapeHtml(device.deviceName)}</span>`]);
	}
	if (device?.os) parts.push(['OS', `<b>${escapeHtml(device.os)}</b>`]);
	if (device?.browser) parts.push(['Browser', `<b>${escapeHtml(device.browser)}</b>`]);
	if (viewport?.width && viewport?.height) {
		parts.push([presentation.captured ? 'Captured viewport' : 'Viewport', `<b>${viewport.width}×${viewport.height}</b>`]);
	}
	parts.push(['Mode', `<b>${kind === 'phone' ? 'Mobile' : 'Tablet'}</b>`]);
	strip.innerHTML = parts
		.map(([label, value]) => `<span class="device-field">${label}: ${value}</span>`)
		.join('<span class="device-sep">·</span>')
		+ `<span class="device-mode">${kind === 'phone' ? 'MOBILE' : 'TABLET'}</span>`;
	strip.hidden = false;
	applyDeviceFrameClass();
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

	// Use action-type icon when available, falling back to status icon
	const icon = document.createElement('span');
	icon.className = 'act-icon';
	const actionIcon = inferActivityIcon(activity.label);
	if (activity.status === 'running') {
		icon.classList.add('spinning');
		icon.textContent = actionIcon || '⟳';
	} else if (activity.status === 'failed') {
		icon.textContent = '⚠';
	} else {
		icon.textContent = actionIcon || '✓';
	}

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

/** Maps activity labels to contextual icons for better visual scanning. */
function inferActivityIcon(label) {
	const text = (label || '').toLowerCase();
	if (text.includes('navigate') || text.includes('goto') || text.includes('url')) return '🧭';
	if (text.includes('click') || text.includes('tap')) return '👆';
	if (text.includes('fill') || text.includes('type') || text.includes('input')) return '✏️';
	if (text.includes('screenshot') || text.includes('snapshot')) return '📸';
	if (text.includes('form') || text.includes('submit')) return '📝';
	if (text.includes('login') || text.includes('auth')) return '🔐';
	if (text.includes('explore') || text.includes('discover')) return '🔍';
	if (text.includes('test') || text.includes('assert')) return '🧪';
	if (text.includes('report') || text.includes('finding')) return '📋';
	if (text.includes('error') || text.includes('console')) return '⚠';
	if (text.includes('scroll')) return '📜';
	if (text.includes('hover')) return '🖱️';
	return null;
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
	const planDetails = document.getElementById('ev-plan-details');
	if (planDetails) planDetails.hidden = todos.length === 0;
	el.planList.replaceChildren();
	if (todos.length === 0) {
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
	// BUILD 1: the session findings pane was removed with the Phase 15 tab
	// restructure — findings live on the dedicated Bugs page and in the
	// session report. Only the exec-stats counter remains here.
	updateExecStats();
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

/** Typed evidence chips for an evidence item — only types QASE actually produces. */
const EVIDENCE_TYPE_META = {
	browser_action: { icon: '🖱', label: 'Browser action' },
	step_outcome: { icon: '✔', label: 'Step outcome' },
	console: { icon: '⌨', label: 'Console' },
	network: { icon: '🌐', label: 'Network' },
	finding_detail: { icon: '🔎', label: 'Finding detail' },
	screenshot: { icon: '📷', label: 'Screenshot' }
};

function renderGraphEvidence(container, items) {
	container.replaceChildren();
	if (!Array.isArray(items) || items.length === 0) {
		const none = document.createElement('div');
		none.className = 'ev-none';
		none.textContent = 'No typed evidence linked to this finding in the evidence graph.';
		container.append(none);
		return;
	}
	const header = document.createElement('div');
	header.className = 'finding-evidence-label';
	header.textContent = `Collected evidence (${items.length}):`;
	container.append(header);
	for (const item of items) {
		const meta = EVIDENCE_TYPE_META[item.type] ?? { icon: '•', label: item.type ?? 'evidence' };
		const row = document.createElement('div');
		row.className = 'ev-item';
		const chip = document.createElement('span');
		chip.className = 'ev-type-chip';
		chip.textContent = `${meta.icon} ${meta.label}`;
		row.append(chip);
		const info = document.createElement('div');
		info.className = 'ev-info';
		if (item.observation) {
			const obs = document.createElement('div');
			obs.className = 'ev-obs';
			obs.textContent = item.observation;
			info.append(obs);
		}
		if (item.payload) {
			const pay = document.createElement('pre');
			pay.className = 'ev-payload';
			pay.textContent = item.payload;
			info.append(pay);
		}
		if (item.target) {
			const tgt = document.createElement('div');
			tgt.className = 'ev-target';
			tgt.textContent = item.target;
			info.append(tgt);
		}
		if (item.timestamp) {
			const ts = document.createElement('div');
			ts.className = 'ev-ts';
			ts.textContent = new Date(item.timestamp).toLocaleString();
			info.append(ts);
		}
		row.append(info);
		container.append(row);
	}
}

const VERDICTS = {
	pass: { mark: '✓', label: 'Pass', tone: 'ok' },
	pass_with_issues: { mark: '!', label: 'Pass with issues', tone: 'warn' },
	fail: { mark: '✕', label: 'Fail', tone: 'bad' },
	blocked: { mark: '—', label: 'Blocked', tone: 'dim' }
};

async function renderReport() {
	const session = state.session;
	const report = state.session.report;
	const reportState = reportPresentation(session);
	el.reportView.replaceChildren();
	loadUxQualityPanel();
	if (!report) {
		if (!reportState.available) {
			el.reportView.innerHTML = `<div class="feed-empty"><strong>Report unavailable</strong><br><span class="subtle">Execution outcome: ${escapeHtml(reportState.execution.label)}.</span></div>`;
			return;
		}
		el.reportView.innerHTML = '<div class="feed-empty">Loading report…</div>';
		try {
			// B1 W3 — authed read through the shared raw helper (text body).
			const markdownText = await apiRaw(`/sessions/${state.sessionId}/report.md`).then(r => r.text());
			if (state.session.report) return; // agent published meanwhile
			renderGeneratedReport(normalizeGeneratedReportMarkdown(markdownText, session), reportState);
		} catch (err) {
			el.reportView.innerHTML = `<div class="feed-empty"><strong>Report available — content unavailable</strong><br><span class="subtle">Execution outcome: ${escapeHtml(reportState.execution.label)}. ${escapeHtml(err.message)}</span></div>`;
		}
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
	// HOTFIX B — surface the execution outcome next to the verdict so a
	// blocked/incomplete run can never read as a normal completed test.
	const findingCount = reportState.currentFindingCount;
	const countLabel = findingCount == null ? 'Current findings not reported' : `${findingCount} current finding${findingCount === 1 ? '' : 's'}`;
	const snapshotLabel = reportState.snapshotDiffers ? ` · Report snapshot: ${reportState.snapshotFindingCount}` : '';
	const timestamp = report.ts ? ` · ${new Date(report.ts).toLocaleString()}` : '';
	sub.textContent = `${countLabel}${snapshotLabel}${timestamp} · Execution: ${reportState.execution.label}`;
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
		// B1 W3 — authed read via the raw helper (markdown text).
		const markdownText = await apiRaw(`/sessions/${state.sessionId}/report.md`).then(r => r.text()).catch(() => '');
		await navigator.clipboard.writeText(markdownText);
		toast('Report copied to the clipboard.', 'good');
	};
	actions.append(download, copy);
	el.reportView.append(actions);
}

/**
 * Renders the server-generated report.md (honest fallback for runs that
 * never published a structured report — e.g. watchdog-ended sessions).
 * Parses the lightweight markdown the server emits: title, metadata list,
 * headings and list items.
 */
function renderGeneratedReport(markdownText, reportState = reportPresentation(state.session)) {
	const wrap = document.createElement('div');
	wrap.className = 'report-generated';

	const outcome = document.createElement('div');
	outcome.className = 'ev-empty ev-note';
	outcome.textContent = `Report available — execution ${reportState.execution.label.toLowerCase()}.`;
	wrap.append(outcome);

	const note = document.createElement('div');
	note.className = 'ev-empty ev-note';
	note.innerHTML = '📝 This report was <b>generated from the run transcript</b> — the agent did not publish its final report before the session ended. Details reflect what was completed up to that point.';
	wrap.append(note);

	const body = document.createElement('div');
	body.className = 'report-md';
	const lines = String(markdownText).split('\n');
	for (const line of lines) {
		if (!line.trim()) continue;
		const node = document.createElement('div');
		if (line.startsWith('### ')) { node.className = 'report-md-h3'; node.textContent = line.slice(4); }
		else if (line.startsWith('## ')) { node.className = 'report-md-h2'; node.textContent = line.slice(3); }
		else if (line.startsWith('# ')) { node.className = 'report-md-h1'; node.textContent = line.slice(2); }
		else if (/^[-*] /.test(line)) {
			node.className = 'report-md-li';
			const clean = line.slice(2).replace(/\*\*/g, '');
			node.textContent = '• ' + clean;
		} else {
			node.className = 'report-md-p';
			node.textContent = line.replace(/\*\*/g, '').replace(/^[-*]\s*/, '');
		}
		body.append(node);
	}
	wrap.append(body);

	const actions = document.createElement('div');
	actions.className = 'report-actions';
	const download = document.createElement('a');
	download.className = 'btn btn-ghost btn-sm';
	download.href = `/api/sessions/${state.sessionId}/report.md`;
	download.download = 'qase-report.md';
	download.textContent = 'Download .md';
	download.onclick = event => {
		event.preventDefault();
		const objectUrl = URL.createObjectURL(new Blob([markdownText], { type: 'text/markdown;charset=utf-8' }));
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = 'qase-report.md';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
	};
	const copy = document.createElement('button');
	copy.className = 'btn btn-ghost btn-sm';
	copy.type = 'button';
	copy.textContent = 'Copy report';
	copy.onclick = async () => {
		await navigator.clipboard.writeText(markdownText);
		toast('Report copied to the clipboard.', 'good');
	};
	actions.append(download, copy);
	wrap.append(actions);

	el.reportView.replaceChildren(wrap);
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
	// BUILD 1: session workflow capture renders via the Workflows page
	// (workflows.js). The hidden #workflow-pane from the Phase 15 tabs is
	// gone; keep captured-steps state fresh for that page.
	state.capturedSteps = Array.isArray(state.capturedSteps) ? state.capturedSteps : [];
}


function renderWorkflowStep(step) {
	const node = document.createElement('div');
	node.className = 'wf-step';

	const icon = document.createElement('span');
	icon.className = 'wf-step-icon';
	icon.textContent = STEP_ICONS[step.action] ?? '•';

	// Outcome indicator (success/fail) from captured step data
	if (step.outcome) {
		const status = step.outcome.status;
		if (status === 'success') node.classList.add('wf-step-ok');
		else if (status === 'error' || status === 'fail') node.classList.add('wf-step-fail');
	}

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


async function loadRegression() {
	const projectId = state.session?.projectId ?? state.projectId;
	const projectVersion = state.projectVersion;
	state.schedules = [];
	state.regressionTrend = [];
	const pq = projectId ? `?projectId=${projectId}` : '';
	try {
		const schedules = await api(`/schedules${pq}`);
		if (projectVersion !== state.projectVersion || projectId !== (state.session?.projectId ?? state.projectId)) return;
		state.schedules = schedules;
	} catch { /* empty */ }
	try {
		const trend = await api(`/regression/trend?limit=15${projectId ? `&projectId=${projectId}` : ''}`);
		if (projectVersion !== state.projectVersion || projectId !== (state.session?.projectId ?? state.projectId)) return;
		state.regressionTrend = trend;
	} catch { /* empty */ }
	if (projectVersion !== state.projectVersion || projectId !== (state.session?.projectId ?? state.projectId)) return;
	renderRegression();
}

function renderRegression() {
	// BUILD 1: schedules + regression trend render on the Schedules page
	// (schedules.js). The hidden #regression-pane is gone.
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
			fail(error);
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
			fail(error);
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
	if (sched.lastRun && sched.lastRun.ts) {
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
			fail(error);
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
			toast(`Deleted "${sched.name}".`, 'good');
		} catch (error) {
			fail(error);
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

function connect(id, snapshot = runViewSnapshot(state, id)) {
	state.stream?.close();
	clearTimeout(state._reconnectTimer);
	// The HttpOnly qase_session cookie authenticates the stream (same-origin
	// EventSource sends cookies). The ?token= query remains supported by the
	// server for CI/machine consumers only.
	const stream = new EventSource(`/api/sessions/${id}/events`);
	state.stream = stream;

	stream.onopen = () => {
		if (!isCurrentRunView(state, snapshot)) { stream.close(); return; }
		el.connDot.className = 'dot is-live';
		el.connLabel.textContent = 'connected';
	};
	stream.onerror = () => {
		if (!isCurrentRunView(state, snapshot)) { stream.close(); return; }
		void fetch('/api/auth/me', { cache: 'no-store' }).then(response => {
			if (response.status === 401) { stream.close(); location.replace('/login'); }
		}).catch(() => {});
		el.connDot.className = 'dot';
		// Debounce the "reconnecting…" label — EventSource auto-reconnects
		// and brief drops are normal. Only show the label if the connection
		// doesn't recover within 2 seconds.
		clearTimeout(state._reconnectTimer);
		state._reconnectTimer = setTimeout(() => {
			el.connLabel.textContent = 'reconnecting…';
		}, 2000);
	};
	stream.onmessage = event => {
		if (!isCurrentRunView(state, snapshot)) { stream.close(); return; }
		let data;
		try { data = JSON.parse(event.data); } catch { return; }
		if (data.sessionId === snapshot.sessionId) {
			handleEvent(data);
		}
	};
	// Device context arrives once when the emulated device context is applied.
	// Payload shape: { type: 'device', sessionId, device: {...} } — emit()
	// spreads payloads at the top level, so event.data holds the whole event.
	stream.addEventListener('device', event => {
		if (!isCurrentRunView(state, snapshot)) { stream.close(); return; }
		try {
			const data = JSON.parse(event.data);
			if (data.sessionId && data.sessionId !== snapshot.sessionId) return;
			state.device = data.device ?? null;
		} catch {
			return;
		}
		renderDeviceStrip();
		applyDeviceFrameClass();
	});
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
		if (!Array.isArray(session.activities)) session.activities = [];
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
			updateExecStats();
			break;
		}

		case 'todos':
			session.todos = event.todos;
			renderTodos();
			break;

		case 'finding':
			if (!Array.isArray(session.findings)) session.findings = [];
			session.findings.push(event.finding);
			// The incoming finding is newer than the initial canonical count. Use
			// the local de-duplicated fallback until the next server projection.
			delete session.findingCount;
			renderFindings();
			renderSessionFindings(session);
			renderRunSummary(session);
			if (event.finding.severity === 'critical' || event.finding.severity === 'high') {
				toast(`${event.finding.severity.toUpperCase()}: ${event.finding.title}`, 'bad');
			}
			break;

		case 'report':
			session.report = event.report;
			session.reportAvailable = true;
			if (['failed', 'blocked', 'partial', 'incomplete', 'cancelled'].includes(event.report?.executionOutcome)) {
				session.executionOutcome = event.report.executionOutcome;
			}
			renderRunSummary(session);
			renderReport();
			// HOTFIX B — the toast must reflect the OUTCOME, not just the fact
			// that a report exists. A blocked/failed run producing a report is
			// not a success story.
			const apiOutcome = session.executionOutcome ?? session.outcome?.outcome;
			const executionOutcome = ['failed', 'blocked', 'partial', 'cancelled'].includes(apiOutcome)
				? apiOutcome
				: event.report?.executionOutcome ?? apiOutcome;
			if (executionOutcome === 'blocked' || event.report?.verdict === 'blocked') {
				toast('Report available — execution blocked.', 'bad');
			} else if (['partial', 'incomplete'].includes(executionOutcome)) {
				toast('Report available — execution partial.', 'warn' );
			} else if (executionOutcome === 'failed') {
				toast('Report available — execution failed.', 'bad');
			} else if (executionOutcome === 'cancelled') {
				toast('Report available — execution was cancelled.', 'warn');
			} else if (event.report?.verdict === 'fail') {
				toast('Report available — verdict: fail.', 'bad');
			} else {
				toast('Report available — execution completed.', 'good');
			}
			break;

		case 'pipeline_start':
			pipelineState.stages = {};
			pipelineState.startTime = Date.now();
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
			injectPipelineMessage(event.stage, event.status, event.result);
			break;
		}

		case 'pipeline_complete': {
			pipelineState.summary = event.summary;
			pipelineState.stages = event.stages;
			renderPipeline();
			updateMissionSummary(event.summary);

			// Inject release assessment block into conversation
			injectReleaseAssessment(event.summary);
			break;
		}

		case 'dev_intelligence_complete': {
			devIntelState.data = event.devIntelligence;
			renderDevIntel();
			break;
		}

		case 'ux_assessment_ready': {
			// Phase 17: UX assessment finished post-finalize — refresh the
			// REPORT tab panel if it's the mission we're viewing.
		if (event.missionId && state.missionId === event.missionId) {
			uxQualityState.missionId = event.missionId;
			loadUxQualityPanel();
		}
			break;
		}

		case 'workflow_step':
			state.capturedSteps.push(event.step);
			renderWorkflows();
			updateExecStats();
			break;

		case 'question':
			session.pendingQuestion = event.question;
			renderQuestion();
			break;

		case 'status':
			// P0-F3 — the interruption reason travels with the status event;
			// keep it on the session so setStatus can render it truthfully.
			if (event.interruptedReason !== undefined) {
				session.interruptedReason = event.interruptedReason;
			}
			if (event.interruptedWhile !== undefined) {
				session.interruptedWhile = event.interruptedWhile;
			}
			if (['queued', 'running'].includes(session.executionOutcome) && !['queued', 'running', 'awaiting_input'].includes(event.status)) {
				delete session.executionOutcome;
				delete session.outcome;
			}
			setStatus(event.status);
			renderRunSummary(session);
			renderBrowserHistory(session);
			updateMissionPhase(event.status, event.activity);
			updateExecStats();
			if (event.status !== 'running') {
				void refreshRuns();
			}
			if (event.detail && event.status === 'error') {
				toast(event.detail, 'bad');
			}
			break;

		case 'execution_health':
			session.executionHealth = event.health;
			renderExecutionHealth(session);
			renderBrowserHistory(session);
			break;

		case 'browser':
			// P0-F5 — a resumed session whose browser was closed emits a
			// truthful reconnecting state: the agent is working, the browser
			// is being re-established. Show that instead of the false
			// "No browser yet" while waiting for the first real frame.
			// A live frame element means the panel already shows reality.
			if (event.browser?.action === 'reconnecting' && !el.frame.src) {
				el.stageEmpty.hidden = false;
				el.stageInner.hidden = true;
				el.stageEmpty.dataset.mode = 'reconnecting';
			} else if (event.browser?.action === 'restored') {
				delete el.stageEmpty.dataset.mode;
			}
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
	keyClear: $('cfg-key-clear'),
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
	browserstackTestBtn: $('cfg-browserstack-test-btn'),
	browserstackTest: $('cfg-browserstack-test'),
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
	if (el.modelBadge) {
		el.modelBadge.textContent = config.ready ? '' : (config.problem ?? '');
	}
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
	// C4 — truthful credential state: needs-re-entry wins over "set".
	if (config.browserstackNeedsReentry) {
		cfg.browserstackKey.placeholder = '⚠ key needs re-entry — enter it again and Save';
	} else if (config.browserstackKeyEncrypted) {
		// C4.1 — masked length hint makes a wrong paste (e.g. 11 chars)
		// diagnosable without ever exposing key material.
		cfg.browserstackKey.placeholder = config.browserstackKeyLength
			? `•••• (stored encrypted, ${config.browserstackKeyLength} chars — leave blank to keep)`
			: '•••• (stored encrypted — leave blank to keep)';
	} else {
		cfg.browserstackKey.placeholder = config.hasBrowserstackKey
			? (config.browserstackKeyLength
				? `•••• (set, ${config.browserstackKeyLength} chars — leave blank to keep)`
				: '•••• (set — leave blank to keep)')
			: 'your-access-key';
	}
	if (cfg.browserstackTest) {
		cfg.browserstackTest.className = 'test-result';
		cfg.browserstackTest.hidden = false;
		const last = config.browserstackLastVerified;
		if (config.browserstackNeedsReentry) {
			cfg.browserstackTest.className = 'test-result bad';
			cfg.browserstackTest.textContent = '⚠ Stored key could not be decrypted (master key changed or legacy data). Re-enter the BrowserStack access key and Save.';
		} else if (last) {
			cfg.browserstackTest.className = `test-result ${last.ok ? 'ok' : 'bad'}`;
			cfg.browserstackTest.textContent = last.ok
				? `✓ Last verified ${new Date(last.ts).toLocaleString()} — connected`
				: `✗ Last test ${new Date(last.ts).toLocaleString()} — failed: ${last.message ?? 'credentials rejected'}`;
		} else {
			cfg.browserstackTest.textContent = 'Not verified yet.';
		}
	}

	// Self-Healing
	cfg.selfHealEnabled.checked = config.selfHealEnabled !== false;
	cfg.selfHealThreshold.value = config.selfHealThreshold ?? 0.8;

	// The stored key is never sent to the browser; leaving the box empty keeps it.
	cfg.key.value = '';
	delete cfg.key.dataset.cleared;
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
	} else if (cfg.key.dataset.cleared === '1') {
		patch.clearApiKey = true;
	}
	delete cfg.key.dataset.cleared;
	if (cfg.browserstackKey.value.trim()) {
		patch.browserstackKey = cfg.browserstackKey.value.trim();
	} else if (cfg.browserstackKey.dataset.cleared === '1') {
		patch.browserstackKey = '';
	}
	delete cfg.browserstackKey.dataset.cleared;
	return patch;
}

cfg.provider.onchange = syncProviderFields;

cfg.keyClear.onclick = () => {
	cfg.key.value = '';
	cfg.key.dataset.cleared = '1';
	cfg.key.placeholder = 'API key will be cleared on Save.';
};

cfg.browserstackKeyClear.onclick = () => {
	cfg.browserstackKey.value = ' ';
	cfg.browserstackKey.dataset.cleared = '1';
	cfg.browserstackKey.value = '';
	cfg.browserstackKey.placeholder = 'Key will be cleared on Save.';
};

async function openSettings() {
	try {
		fillSettings(await api('/config'));
		cfg.dialog.showModal();
		// D2 — user accounts are admin-only; load them for the master
		// token AND for signed-in admin USERS (kind 'user').
		const isAdminish = !state.session || state.session.kind === 'master'
			|| (state.auth && state.auth.kind === 'user' && state.auth.role === 'admin');
		if (isAdminish) {
			loadUsers();
		} else {
			const users = document.getElementById('cfg-user-list');
			if (users) users.textContent = '';
		}
	} catch (err) {
		toast(String(err?.message ?? err), 'bad');
	}
}

async function loadUsers() {
	try {
		const data = await api('/auth/users');
		const list = document.getElementById('cfg-user-list');
		if (!list) return;
		const users = data?.users ?? [];
		list.innerHTML = users.length === 0
			? '<div class="subtle">No users.</div>'
			: users.map(u => `<div class="cfg-user-row" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border,#333);">
				<span style="flex:1">${escapeHtml(u.email)} <span class="subtle">(${u.role})</span>${u.disabledAt ? ' <span class="subtle">[disabled]</span>' : ''}</span>
			</div>`).join('');
	} catch { /* admin-only — may 403 for non-admins */ }
}

const userCreateBtn = $('cfg-user-create');
const userResult = $('cfg-user-result');

userCreateBtn?.addEventListener('click', async () => {
	const email = document.getElementById('cfg-user-email')?.value.trim() || '';
	const name = document.getElementById('cfg-user-name')?.value.trim() || '';
	const password = document.getElementById('cfg-user-password')?.value || '';
	const role = document.getElementById('cfg-user-role')?.value || 'operator';
	if (!email || !password) return toast('Email and initial password are required.', 'bad');
	userCreateBtn.disabled = true;
	if (userResult) { userResult.hidden = false; userResult.className = 'test-result busy'; userResult.textContent = 'Creating…'; }
	try {
		const created = await api('/auth/users', { method: 'POST', body: JSON.stringify({ email, name, password, role }) });
		if (userResult) { userResult.className = 'test-result ok'; userResult.textContent = `User created: ${created.user.email} (${created.user.role})`; }
		for (const id of ['cfg-user-email', 'cfg-user-name', 'cfg-user-password']) {
			const node = document.getElementById(id);
			if (node) node.value = '';
		}
		await loadUsers();
	} catch (err) {
		if (userResult) { userResult.className = 'test-result bad'; userResult.textContent = String(err?.message ?? err); }
	} finally {
		userCreateBtn.disabled = false;
	}
});

$('open-settings').onclick = openSettings;
if (el.modelBadge) el.modelBadge.onclick = openSettings;

cfg.testBtn.onclick = async () => {
	cfg.test.className = 'test-result busy';
	cfg.test.textContent = 'Probing the endpoint…';
	const result = await api('/config/test', {
		method: 'POST',
		body: JSON.stringify(readSettings())
	}).catch(error => ({ ok: false, error: error.message }));

	cfg.test.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
	if (!result.ok) {
		const detail = result.diagnostic?.category
			? ` [${result.diagnostic.category}${result.diagnostic.causeCode ? `: ${result.diagnostic.causeCode}` : ''}]`
			: '';
		cfg.test.textContent = `${result.error ?? 'Provider test failed.'}${detail}`;
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

// BUILD B0.1 — Test BrowserStack Connection (real auth + CDP probe).
// The access key is only ever SENT; it is never displayed or logged.
cfg.browserstackTestBtn.onclick = async () => {
	if (!cfg.browserstackTestBtn) return;
	const btn = cfg.browserstackTestBtn;
	const out = cfg.browserstackTest;
	btn.disabled = true;
	out.className = 'test-result busy';
	out.hidden = false;
	out.textContent = 'Testing BrowserStack (auth + CDP)…';
	const body = { browserstackUser: cfg.browserstackUser.value.trim() };
	if (cfg.browserstackKey.value.trim()) body.browserstackKey = cfg.browserstackKey.value.trim();
	else if (cfg.browserstackKey.dataset.cleared !== '1' && $('cfg-browserstack-enabled')?.checked !== true) {
		// leave blank → the server tests the SAVED credentials, which is the
		// desired behaviour when the user has not typed anything new.
	}
	try {
		const result = await api('/config/test-browserstack', { method: 'POST', body: JSON.stringify(body) });
		out.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
		const when = result.lastVerifiedTs ? ` · ${new Date(result.lastVerifiedTs).toLocaleString()}` : '';
		if (result.ok) {
			// B0.1: never hide a partial result — if the CDP execution path was
			// not probed, the user must see that qualifier.
			out.textContent = result.cdp?.ok === true
				? `✓ Connected${result.maskedUser ? ` as ${result.maskedUser}` : ''} — credentials valid, execution endpoint reachable.${when}`
				: `✓ Authenticated${result.maskedUser ? ` as ${result.maskedUser}` : ''} — credentials valid.${result.cdp?.code === 'not_probed' ? ' (CDP execution endpoint not probed in this runtime.)' : ''}${when}`;
		} else {
			out.textContent = `✗ Failed — ${result.message || 'unknown error'}${when}`;
		}
	} catch (error) {
		out.className = 'test-result bad';
		out.hidden = false;
		out.textContent = `✗ Failed — ${error instanceof Error ? error.message : String(error)}`;
	} finally {
		btn.disabled = false;
	}
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
	let text = el.composerInput.value.trim();
	if (!text) {
		return;
	}

	if (!state.sessionId) {
		openNewRun(/^https?:\/\//i.test(text) ? { targetUrl: text } : { objective: text });
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

el.newRun.onclick = () => window.dispatchEvent(new CustomEvent('qase:start-run'));
window.addEventListener('qase:start-run', event => {
	openNewRun(event.detail?.defaults);
	event.detail?.done?.();
});
window.addEventListener('qase:select-run', event => {
	const id = event.detail?.id;
	if (id) void selectSession(id).catch(fail);
});
window.addEventListener('qase:evidence-state', event => {
	if (event.detail?.sessionId !== state.sessionId || !state.session) return;
	renderBrowserHistory(state.session, event.detail);
});
function beginStopRequest() {
	el.stopRun.disabled = true;
	el.stopRun.textContent = 'Stopping…';
	return { method: 'POST' };
}

el.stopRun.onclick = () => api(`/sessions/${state.sessionId}/stop`, beginStopRequest())
	.catch(error => {
		fail(error);
		el.stopRun.disabled = false;
		el.stopRun.textContent = 'Stop';
	});

el.thinkingHead.onclick = () => {
	if (el.thinkingStrip.classList.contains('has-detail')) {
		el.thinkingStrip.classList.toggle('is-open');
		updateThinkingStrip();
	}
};

document.addEventListener('keydown', event => {
	if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
		event.preventDefault();
		window.dispatchEvent(new CustomEvent('qase:start-run'));
	}
	if ((event.metaKey || event.ctrlKey) && event.key === ',') {
		event.preventDefault();
		void openSettings();
	}
});

const runTabs = [...document.querySelectorAll('#tabs .tab')];
function activateRunTab(tab, { focus = false } = {}) {
	if (!tab) return;
	for (const other of runTabs) {
		other.classList.toggle('is-active', other === tab);
		other.setAttribute('aria-selected', String(other === tab));
		other.tabIndex = other === tab ? 0 : -1;
	}
	for (const pane of document.querySelectorAll('.tab-pane')) {
		pane.classList.toggle('is-active', pane.dataset.pane === tab.dataset.tab);
	}
	handleTabActivation(tab.dataset.tab);
	if (focus) tab.focus();
}
for (const tab of runTabs) {
	tab.onclick = () => activateRunTab(tab);
	tab.onkeydown = event => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const currentIndex = runTabs.indexOf(tab);
		const nextIndex = event.key === 'Home' ? 0
			: event.key === 'End' ? runTabs.length - 1
				: (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + runTabs.length) % runTabs.length;
		activateRunTab(runTabs[nextIndex], { focus: true });
	};
}

function activateRunSegment(selected) {
	for (const button of document.querySelectorAll('[data-run-segment]')) {
		const active = button.dataset.runSegment === selected;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', String(active));
	}
	document.querySelector('.run-workspace-grid')?.setAttribute('data-mobile-segment', selected);
}

for (const segment of document.querySelectorAll('[data-run-segment]')) {
	segment.addEventListener('click', () => activateRunSegment(segment.dataset.runSegment));
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
	const projectId = id || undefined;
	const projectVersion = ++state.projectVersion;
	setProjectSwitching(true);
	markOverviewStale();
	state.stream?.close();
	state.stream = undefined;
	state.runViewVersion += 1;
	state.session = undefined;
	state.sessionId = undefined;
	state.projectId = projectId;
	window.dispatchEvent(new CustomEvent('qase:project-change'));
	localStorage.setItem('qase.project', projectId || '');
	renderProjectSelect();
	if (currentPage() === 'overview') void loadOverview();
	try {
	await refreshRuns(projectId, projectVersion);
	if (projectVersion !== state.projectVersion) return;
	let selectedSession = false;
	// If there is a run in the selected project, selectSession refreshes all
	// project-scoped data. Otherwise refresh it explicitly to prevent stale
	// counts from the previously selected project.
	if (state.session?.projectId !== projectId) {
		const runs = await api(`/sessions${projectId ? `?projectId=${projectId}` : ''}`).catch(err => { fail(err); return []; });
		if (projectVersion !== state.projectVersion) return;
		if (runs.length > 0) {
			await selectSession(runs[0].id, projectVersion);
			if (projectVersion !== state.projectVersion) return;
			selectedSession = true;
		}
	}
	if (!selectedSession) {
		el.chatTitle.textContent = 'No run selected';
		el.chatTarget.textContent = 'Start a run in this project to begin testing';
		el.statusChip.hidden = true;
		el.stopRun.hidden = true;
		el.chatEmpty.hidden = false;
		el.transcript.replaceChildren(el.chatEmpty);
		el.reportView.replaceChildren();
		el.activityFeed.replaceChildren();
		for (const id of ['run-summary-duration', 'run-summary-pages', 'run-summary-actions', 'run-summary-findings', 'run-report-availability']) {
			const node = document.getElementById(id);
			if (node) node.textContent = 'Not reported';
		}
		renderExecutionHealth({});
		renderBrowserHistory({ id: state.sessionId, status: 'queued' }, { loaded: false, items: [] });
		await Promise.allSettled([loadWorkflowsPage(), loadTestCases(), loadSchedulesPage(), loadMetrics()]);
	}
	if (currentPage() === 'findings') await loadBugs({ reset: true });
	} finally {
		if (projectVersion === state.projectVersion) setProjectSwitching(false);
	}
}

function formatDuration(milliseconds) {
	if (!Number.isFinite(milliseconds)) return 'Not reported';
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours) return `${hours}h ${minutes % 60}m`;
	if (minutes) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function renderRunSummary(session) {
	const metrics = runMetricPresentation(session);
	const report = reportPresentation(session);
	const duration = document.getElementById('run-summary-duration');
	const pages = document.getElementById('run-summary-pages');
	const actions = document.getElementById('run-summary-actions');
	const findings = document.getElementById('run-summary-findings');
	const reportAvailable = document.getElementById('run-report-availability');
	if (duration) duration.textContent = formatDuration(metrics.durationMs);
	if (pages) pages.textContent = metrics.pages == null ? 'Not reported' : String(metrics.pages);
	if (actions) actions.textContent = metrics.actions == null ? 'Not reported' : String(metrics.actions);
	if (findings) {
		findings.textContent = metrics.findings.value == null ? 'Not reported' : String(metrics.findings.value);
		findings.title = metrics.findings.canonical ? 'Canonical current finding count' : 'Historical session fallback';
	}
	if (reportAvailable) {
		reportAvailable.textContent = report.label;
		reportAvailable.dataset.available = String(report.available);
		reportAvailable.title = `${report.label} — execution ${report.execution.label.toLowerCase()}`;
	}
}

function renderBrowserHistory(session, evidence = {}) {
	if (!session || session.id !== state.sessionId) return;
	el.browserUrl.textContent = session.targetUrl ?? 'about:blank';
	if (!session.frame) el.browserTitle.textContent = '';
	const view = browserHistoryPresentation(session, evidence);
	const label = document.getElementById('browser-state-label');
	const title = el.stageEmpty?.querySelector('span');
	const detail = el.stageEmpty?.querySelector('small');
	if (label) label.textContent = view.title;
	if (session.frame || view.key === 'live') return;
	if (title) title.textContent = view.title;
	if (detail) detail.textContent = view.detail;
	if (el.stageEmpty) {
		el.stageEmpty.dataset.mode = view.key;
		el.stageEmpty.hidden = Boolean(view.imageUrl);
	}
	if (view.imageUrl) {
		el.frame.onerror = () => {
			if (session.id !== state.sessionId || el.stageInner.dataset.mode !== 'persisted') return;
			el.frame.onerror = null;
			el.frame.removeAttribute('src');
			el.stageInner.removeAttribute('data-mode');
			el.stageInner.hidden = true;
			if (el.stageEmpty) {
				el.stageEmpty.hidden = false;
				el.stageEmpty.dataset.mode = 'unavailable';
			}
			if (title) title.textContent = 'Persisted screenshot unavailable';
			if (detail) detail.textContent = 'Open Evidence to review the remaining recorded actions.';
			if (label) label.textContent = 'Persisted screenshot unavailable';
		};
		el.frame.src = view.imageUrl;
		el.frame.alt = 'Persisted screenshot evidence from this run';
		el.stageInner.dataset.mode = 'persisted';
		el.stageInner.hidden = false;
		document.getElementById('overlay')?.setAttribute('hidden', '');
	} else {
		el.frame.onerror = null;
		el.frame.removeAttribute('src');
		el.stageInner.removeAttribute('data-mode');
		el.stageInner.hidden = true;
		document.getElementById('overlay')?.removeAttribute('hidden');
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
	const projectId = state.session?.projectId ?? state.projectId;
	const projectVersion = state.projectVersion;
	try {
		const query = projectId ? `?projectId=${projectId}` : '';
		const metrics = await api(`/metrics/dashboard${query}`);
		if (projectVersion !== state.projectVersion || projectId !== (state.session?.projectId ?? state.projectId)) return;
		if (!metrics?.sessions || !metrics?.findings || !metrics?.testCases || !metrics?.regression) {
			throw new Error('invalid dashboard metrics response');
		}
		renderMetricsOverview(metrics);
	} catch {
		if (projectVersion !== state.projectVersion || projectId !== (state.session?.projectId ?? state.projectId)) return;
		el.metricsOverview.replaceChildren();
		const unavailable = document.createElement('div');
		unavailable.className = 'metric-card';
		unavailable.textContent = 'Dashboard metrics unavailable.';
		el.metricsOverview.append(unavailable);
	}
}

/** Loads the mission linked to the current session (if any) so the
 *  FINDINGS tab can offer Revalidate and mission context. */
async function loadSessionMission(sessionId) {
	const projectVersion = state.projectVersion;
	state.missionId = null;
	try {
		// B1 W3 — the API requires auth; use the shared helper so the token
		// from Settings (localStorage) is attached.
		const mission = await api(`/missions/${sessionId}/mission-for-session`).catch(() => null);
		if (projectVersion !== state.projectVersion || sessionId !== state.sessionId) return;
		if (mission && mission.missionId) {
			state.missionId = mission.missionId;
			// Findings already rendered — re-render with mission context.
			renderFindings();
		}
	} catch {
		// Mission link is optional — sessions without missions are normal.
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
		renderMetricSummary(
			metrics.findings.bySeverity,
			(metrics.findings.canonical ?? metrics.findings.total) + ' canonical · ' + (metrics.findings.duplicates ?? 0) + ' duplicates'
		)
	);

	// Test cases card
	const tcCard = metricCard('Test Cases', String(metrics.testCases.total),
		renderMetricSummary(metrics.testCases.bySeverity, (metrics.testCases.suites ?? 0) + ' referenced suites')
	);

	// Regression card
	const regCard = metricCard('Regression Pass Rate',
		metrics.regression.overallPassRate == null ? '—' : metrics.regression.overallPassRate + '%',
		metrics.regression.completedRuns + ' completed of ' + metrics.regression.totalRuns + ' recorded runs · '
			+ metrics.regression.totalTests + ' completed test executions'
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

function renderMetricSummary(bySeverity, note) {
	const wrap = document.createDocumentFragment();
	wrap.append(renderSeveritySummary(bySeverity));
	const detail = document.createElement('span');
	detail.textContent = note;
	wrap.append(detail);
	return wrap;
}

/* ── Conversation-Driven AI: pipeline milestones inject agent messages ── */

const STAGE_MESSAGES = {
	workflow_save: {
		running: () => `Understanding application...`,
		done: (result) => {
			const steps = result?.stepCount ?? result?.count ?? 0;
			return `**Application understood.** ${steps} interaction${steps === 1 ? '' : 's'} captured.\n\nPlanning validation approach...`;
		}
	},
	dev_intelligence: {
		running: () => `Analyzing findings and root causes...`,
		done: (result) => {
			const findings = result?.findingsAnalyzed ?? 0;
			return `**Analysis complete.** ${findings} finding${findings === 1 ? '' : 's'} analyzed for root cause and fix recommendations.`;
		}
	},
	feature_gap: {
		running: () => `Detecting application purpose and feature gaps...`,
		done: (result) => {
			const purpose = result?.gapAnalysis?.purpose?.name ?? result?.purpose?.name ?? 'this application';
			const appType = result?.gapAnalysis?.inventory?.appType ?? '';
			const gaps = result?.featureGaps ?? result?.gapAnalysis?.gaps ?? [];
			const conf = result?.gapAnalysis?.purpose?.confidence ?? result?.purpose?.confidence ?? 0;
			const confPct = Math.round(conf * 100);
			const detected = result?.gapAnalysis?.inventory?.capabilities ?? {};
			const foundFeatures = Object.entries(detected).filter(([_, v]) => v).map(([k]) => k);
			let msg = `**Application identified as ${purpose}**${appType ? ` (${appType})` : ''}.\n\nDetected with ${confPct}% confidence.`;
			if (foundFeatures.length > 0) {
				msg += `\n\n**Detected features:** ${foundFeatures.join(', ')}`;
			}
			if (gaps.length > 0) {
				const features = gaps.slice(0, 5).map(g => g.name || g.feature || g.description || 'Unknown').join(', ');
				msg += `\n\n**Missing features:** ${features}${gaps.length > 5 ? ` (+${gaps.length - 5} more)` : ''}`;
			}
			return msg;
		}
	},
	test_generation: {
		running: () => `Generating test scenarios...`,
		done: (result) => {
			const count = result?.count ?? 0;
			return `**Test cases generated.** ${count} scenario${count === 1 ? '' : 's'} covering critical paths and edge cases.`;
		}
	},
	smoke_run: {
		running: () => `Running validation tests...`,
		done: (result) => {
			const passed = result?.passed ?? 0;
			const failed = result?.failed ?? 0;
			const total = result?.total ?? (passed + failed);
			return `**Validation complete.** ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}.`;
		}
	},
	mission_finalize: {
		running: () => `Assessing release readiness...`,
		done: (result) => {
			const score = result?.qualityScore;
			const ready = result?.releaseReady;
			let msg = '**Release assessment complete.**';
			if (score != null) msg += ` Quality score: **${Math.round(score)}/100**.`;
			if (ready) msg += '\n\n✓ Application is **release-ready**.';
			else msg += '\n\n✕ Application is **not release-ready** — review findings below.';
			return msg;
		}
	},
	knowledge_write: {
		running: () => null,
		done: () => `**Knowledge updated.** Patterns from this mission saved for future runs.`
	},
	decision_engine: {
		running: () => null,
		done: (result) => {
			const dec = result?.decision;
			if (!dec) return '**Decision evaluated.**';
			let msg = `**Decision: ${dec.decision}**`;
			if (dec.confidence != null) msg += ` (confidence: ${(dec.confidence * 100).toFixed(0)}%)`;
			if (dec.reason) msg += `\n\n${dec.reason.slice(0, 150)}`;
			return msg;
		}
	}
};

function injectPipelineMessage(stage, status, result) {
	const config = STAGE_MESSAGES[stage];
	if (!config) return;
	const text = config[status]?.(result);
	if (!text) return;

	const message = {
		id: `pipeline-${stage}-${status}-${Date.now()}`,
		role: 'agent',
		text,
		kind: status === 'running' ? 'pipeline-running' : 'pipeline-status'
	};

	// Add to session messages
	if (state.session?.messages) {
		state.session.messages.push(message);
	}

	// Render into transcript
	el.chatEmpty.hidden = true;
	const node = renderMessage(message);
	el.transcript.append(node);
	scrollTranscript();
}

/**
 * Injects a structured release assessment block at the end of a mission.
 */
function injectReleaseAssessment(summary) {
	if (!summary) return;

	const score = summary.qualityScore;
	const ready = summary.releaseReady;
	const critical = summary.criticalIssues ?? 0;
	const gaps = summary.featureGapsCount ?? 0;
	const appType = summary.appType ?? 'Unknown';
	const confidence = summary.confidence != null ? Math.round(summary.confidence * 100) : null;

	const lines = ['---', '', '**RELEASE ASSESSMENT**', ''];
	lines.push(`Application: \`${appType}\``);
	if (score != null) lines.push(`Quality Score: \`${Math.round(score)}/100\``);
	if (confidence != null) lines.push(`Confidence: \`${confidence}%\``);
	lines.push(`Critical Issues: \`${critical}\``);
	lines.push(`Feature Gaps: \`${gaps}\``);
	lines.push('');
	if (ready) {
		lines.push('**Status: [ READY ]**');
		lines.push('Application meets quality threshold for release.');
	} else {
		lines.push('**Status: [ NOT READY ]**');
		lines.push('Address critical issues and feature gaps before release.');
		if (critical > 0) {
			lines.push(`\n**Recommended action:** Fix ${critical} critical issue${critical === 1 ? '' : 's'}, then revalidate.`);
		} else if (gaps > 0) {
			lines.push(`\n**Recommended action:** Implement ${gaps} missing feature${gaps === 1 ? '' : 's'}, then revalidate.`);
		}
	}
	lines.push('', '---');

	const message = {
		id: `release-assessment-${Date.now()}`,
		role: 'agent',
		text: lines.join('\n'),
		kind: 'release-assessment'
	};

	if (state.session?.messages) {
		state.session.messages.push(message);
	}

	el.chatEmpty.hidden = true;
	const node = renderMessage(message);
	el.transcript.append(node);
	scrollTranscript();
}

/* ── Mission Summary Bar ─────────────────────────────────────────── */

function updateMissionSummary(summary) {
	if (!summary) return;

	const bar = document.getElementById('mission-summary-bar');
	if (!bar) return;

	const appType = summary.appType || summary.purpose || 'Unknown';
	const qualityScore = summary.qualityScore != null ? Math.round(summary.qualityScore) : '—';
	const releaseReady = summary.releaseReady ?? false;
	const confidence = summary.confidence != null ? Math.round(summary.confidence * 100) + '%' : '—';
	const criticalCount = summary.criticalIssues != null
		? summary.criticalIssues
		: (summary.findings ? summary.findings.filter(f => f.severity === 'critical').length : 0);
	const gapCount = summary.featureGapsCount != null
		? summary.featureGapsCount
		: (summary.gaps ? summary.gaps.length : 0);

	const setText = (id, val) => {
		const node = document.getElementById(id);
		if (node) node.textContent = val;
	};

	setText('ms-app-type', appType);
	setText('ms-quality', String(qualityScore));
	setText('ms-release', releaseReady ? '[ READY ]' : '[ BLOCKED ]');
	setText('ms-confidence', String(confidence));
	setText('ms-critical', String(criticalCount));
	setText('ms-gaps', String(gapCount));

	bar.hidden = false;
}

// Restore the summary bar when pipeline data is loaded after a refresh (Phase 15).
window.addEventListener('pipeline:summary-restored', (e) => {
	updateMissionSummary(e.detail);
});

/* ── Export handlers ──────────────────────────────────────────────── */

async function handleExport(type) {
	if (!state.sessionId) return;

	let url;
	let filename;

	switch (type) {
		case 'findings-markdown':
			url = `/api/sessions/${state.sessionId}/export/findings?format=markdown`;
			filename = `findings-${state.sessionId}.md`;
			break;
		case 'findings-github':
			url = `/api/sessions/${state.sessionId}/export/findings?format=github`;
			filename = `findings-github.json`;
			break;
		case 'findings-jira':
			url = `/api/sessions/${state.sessionId}/export/findings?format=jira`;
			filename = `findings-jira.json`;
			break;
		case 'findings-linear':
			url = `/api/sessions/${state.sessionId}/export/findings?format=linear`;
			filename = `findings-linear.json`;
			break;
		case 'testcases-json':
			url = `/api/test-cases/export?format=json`;
			filename = 'test-cases.json';
			break;
		case 'testcases-csv':
			url = `/api/test-cases/export?format=csv`;
			filename = 'test-cases.csv';
			break;
		default:
			return;
	}

	try {
		// B1 W3 — authed export via the raw helper (token from Settings).
		const res = await apiRaw(url.startsWith('/api') ? url.slice(4) : url);
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
	try {
		const identity = await fetch('/api/auth/me', { cache: 'no-store' });
		if (identity.status === 401) { location.replace('/login'); return; }
		if (!identity.ok) throw new Error('Authentication unavailable');
	} catch { document.body.textContent = 'QASE is unavailable. Reload to try again.'; return; }
	// ── Prompt chips (empty state suggested prompts) ──────────────────
	// Attach early — before any async calls — so chips work immediately.
	document.querySelectorAll('.prompt-chip').forEach(chip => {
		chip.addEventListener('click', () => {
			const prompt = chip.dataset.prompt || chip.textContent.trim();
			const input = document.getElementById('composer-input');
			if (input) {
				input.value = prompt;
				input.focus();
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
		});
	});

	// ── Router: load page-specific data on navigation ──────────────
	window.addEventListener('routechange', (e) => {
		const page = e.detail.page;
		const wasRunRouteActive = state.runRouteActive;
		state.runRouteActive = page === 'runs';
		if (page !== 'runs' && state.sessionId) {
			state.stream?.close();
			state.stream = undefined;
			state.runViewVersion += 1;
			clearTimeout(state._reconnectTimer);
		}
		if (shouldRefreshRunOnReentry(state, page, wasRunRouteActive)) {
			// selectSession owns the authoritative refresh, complete rerender, and
			// exactly-one SSE handoff. Reusing it also remounts any pending
			// credential challenge with enabled controls.
			void selectSession(state.sessionId, state.projectVersion);
		}
		if (page === 'overview' && state.projects.length > 0) void loadOverview();
		if (page === 'findings') loadBugs();
		if (page === 'test-cases') loadTestCases();
		if (page === 'workflows') loadWorkflowsPage();
		if (page === 'schedules') loadSchedulesPage();
	});
	// Deep links select a run when the browser moves through either URL scheme.
	// Cold-load selection remains in boot(), after authentication is established.
	const followRunRoute = () => {
		const id = runIdFromHash();
		if (id && id !== state.sessionId) {
			void selectSession(id);
		}
	};
	window.addEventListener('hashchange', followRunRoute);
	window.addEventListener('popstate', followRunRoute);
	initShell();
	initOverview();
	initNewRun();
	initRouter();

	// Wire up event listeners.
	initBugsWiring();
	initTestsWiring();
	initWorkflowsWiring();
	initSchedulesWiring();
	initExecutionDetail();
	initThemeToggle();

	// Fire independent boot requests in parallel (config + projects).
	const [config, projects] = await Promise.all([
		api('/config').catch(err => { console.error('[boot] config fetch failed:', err.message); return undefined; }),
		api('/projects').catch(err => { console.error('[boot] projects fetch failed:', err.message); return []; })
	]);

	if (config) {
		paintConfig(config);
	} else {
		// Config failure — tell the user, don't silently boot into broken state
		toast('Unable to load configuration. Check that the server is running.', 'bad');
	}

	// D2 — resolve WHO is authenticated (master or user account) and adapt
	// the UI: non-admin users do not see Settings; everyone gets an identity
	// chip with sign-out.
	try {
		const who = await fetch('/api/auth/me').then(r => (r.ok ? r.json() : null));
		state.auth = who ?? { kind: 'anonymous' };
		if (who && who.kind === 'user' && who.role !== 'admin') {
			toast(`Signed in as ${who.name || who.email} (${who.role})`, 'good');
		} else if (who && who.kind === 'user' && who.role === 'admin') {
			toast(`Signed in as ${who.name || who.email} (admin)`, 'good');
		}
		setShellAuth();
	} catch { /* whoami is advisory — UI still works if it fails */ }

	// Resolve project selection from parallel-fetched data.
	state.projects = projects;
	const rememberedProject = localStorage.getItem('qase.project');
	if (rememberedProject && state.projects.some(p => p.id === rememberedProject)) {
		state.projectId = rememberedProject;
	} else if (state.projects.length > 0) {
		state.projectId = state.projects[0].id;
	}
	renderProjectSelect();
	if (currentPage() === 'overview') void loadOverview();

	// Sessions depend on projectId — fetch after project resolution.
	const runs = await api(`/sessions${state.projectId ? `?projectId=${state.projectId}` : ''}`).catch(err => {
		fail(err);
		return [];
	});
	const remembered = localStorage.getItem('qase.session');
	// Deep link #/runs/<id> wins over the remembered/first run.
	const deepLinked = runIdFromHash();
	const target = (deepLinked && runs.some(r => r.id === deepLinked) ? { id: deepLinked } : null)
		?? runs.find(run => run.id === remembered) ?? runs[0];

	if (target) {
		await selectSession(target.id);
	}
	// No sessions exist → show the empty hero ("No run selected") instead of
	// silently creating one. Build 4: the boot-time auto-create left a trail
	// of idle "New test run" shells that read as duplicates to a new user.
	if (!state.sessionId) {
		el.chatEmpty.hidden = false;
		el.statusChip.hidden = true;
		el.stopRun.hidden = true;
	}
	// No session (and therefore no event stream) — say so instead of
	// leaving the boot-time "connecting…" label up forever.
	if (!state.sessionId) {
		el.connDot.className = 'dot';
		el.connLabel.textContent = 'idle — no run selected';
	}
	el.composerInput.focus();


	// ── Mobile viewer toggle ─────────────────────────────────────────
	const viewerToggle = document.getElementById('viewer-toggle');
	const viewerClose = document.getElementById('viewer-close');
	const viewerPanel = document.querySelector('.panel.viewer');

	if (viewerToggle && viewerPanel) {
		viewerToggle.hidden = false;
		viewerToggle.addEventListener('click', () => {
			viewerPanel.classList.add('mobile-open');
			viewerClose.hidden = false;
		});
	}
	if (viewerClose && viewerPanel) {
		viewerClose.addEventListener('click', () => {
			viewerPanel.classList.remove('mobile-open');
			viewerClose.hidden = true;
		});
	}

	// Phase 2 — the run list is an on-demand drawer below the desktop
	// breakpoint. It reuses the existing list and actions; selection closes it.
	const mobileRunsToggle = document.getElementById('mobile-runs-toggle');
	const closeRunsDrawer = document.getElementById('close-runs-drawer');
	const runsPanel = document.querySelector('.panel.runs');
	if (mobileRunsToggle && runsPanel) {
		mobileRunsToggle.addEventListener('click', () => {
			const open = runsPanel.classList.toggle('mobile-open');
			mobileRunsToggle.setAttribute('aria-expanded', String(open));
		});
	}
	closeRunsDrawer?.addEventListener('click', closeMobileRunsDrawer);
})();

/* ── Phase 17: Application Quality / UX Intelligence panel ──────── */

const uxQualityState = { missionId: null, data: null, filter: 'all' };

async function loadUxQualityPanel() {
	// Resolve the mission for this session (mission id == session's mission)
	const panel = document.getElementById('ux-quality-panel');
	if (!panel) return;
	let missionId = uxQualityState.missionId;
	if (!missionId && state.session?.id) {
		try {
			// B1 W3 — authed read via the shared helper.
			const j = await api(`/missions/${state.session.id}/mission-for-session`).catch(() => null);
			if (j && j.missionId) {
				missionId = j.missionId;
				uxQualityState.missionId = missionId;
			}
		} catch { /* offline / transient — panel stays hidden */ }
	}
	if (!missionId) { panel.hidden = true; return; }
	try {
		// B1 W3 — authed read via the shared helper (token from Settings).
		const data = await api(`/missions/${missionId}/ux-quality`).catch(() => null);
		if (!data) { panel.hidden = true; return; }
		uxQualityState.data = data;
		panel.hidden = false;
		renderUxQualityPanel();
	} catch { panel.hidden = true; }
}

function renderUxQualityPanel() {
	const data = uxQualityState.data;
	if (!data) return;

	// Head: overall score + meta
	const overall = document.getElementById('uxq-overall');
	const q = data.quality?.overall;
	if (q?.score != null) {
		overall.textContent = `${q.score}/100`;
		overall.title = `confidence ${(q.confidence * 100).toFixed(0)}%`;
	} else {
		overall.textContent = '—';
	}
	document.getElementById('uxq-meta').textContent =
		`confidence ${(q?.confidence * 100).toFixed(0)}% · evidence coverage ${(q?.evidenceCoverage * 100).toFixed(0)}% · ${q?.dimensionsScored ?? 0}/${(q?.dimensionsScored ?? 0) + (q?.dimensionsMissing?.length ?? 0)} dimensions`;

	// Dimensions
	const dimsBox = document.getElementById('uxq-dimensions');
	dimsBox.replaceChildren();
	for (const d of data.quality?.dimensions ?? []) {
		const row = document.createElement('div');
		row.className = 'uxq-dim';
		const name = document.createElement('div');
		name.className = 'uxq-dim-name';
		const nm = document.createElement('span'); nm.textContent = d.dimension;
		const sc = document.createElement('span'); sc.textContent = d.score != null ? `${d.score}` : '—';
		name.append(nm, sc);
		const bar = document.createElement('div'); bar.className = 'uxq-dim-bar';
		const fill = document.createElement('div'); fill.className = 'uxq-dim-fill';
		if (d.score != null) {
			fill.style.width = `${Math.max(0, Math.min(100, d.score))}%`;
			fill.dataset.band = d.score >= 80 ? 'ok' : d.score >= 60 ? 'warn' : 'bad';
		}
		bar.append(fill);
		const meta = document.createElement('div');
		meta.className = 'uxq-dim-meta';
		meta.textContent = `confidence ${(d.confidence * 100).toFixed(0)}% · evidence ${(d.evidenceCoverage * 100).toFixed(0)}% · ${d.basis ?? ''}`;
		row.append(name, bar, meta);
		dimsBox.append(row);
	}
	if (!dimsBox.children.length) dimsBox.innerHTML = '<div class="uxq-empty">No quality dimensions could be scored.</div>';

	renderUxIssues();
	renderUxRecs();
	renderUxUnverified();
}

function renderUxIssues() {
	const box = document.getElementById('uxq-issues');
	box.replaceChildren();
	const issues = (uxQualityState.data?.ux?.issues ?? [])
		.filter(i => uxQualityState.filter === 'all' || i.severity === uxQualityState.filter);
	for (const i of issues) {
		const row = document.createElement('div');
		row.className = 'uxq-issue';
		row.dataset.sev = i.severity;
		row.addEventListener('click', () => openUxIssueDetail(i));
		const main = document.createElement('div');
		main.className = 'uxq-issue-main';
		const title = document.createElement('div');
		title.className = 'uxq-issue-title';
		title.textContent = `[${i.severity.toUpperCase()}] ${i.title}`;
		const sub = document.createElement('div');
		sub.className = 'uxq-issue-sub';
		sub.textContent = `${i.dimension}${i.viewports?.length ? ` · ${i.viewports.join('/')}` : ''}${i.occurrences > 1 ? ` · ×${i.occurrences}` : ''} · confidence ${(i.confidence * 100).toFixed(0)}%`;
		main.append(title, sub);
		const pill = document.createElement('span');
		pill.className = 'uxq-pill';
		pill.dataset.state = i.reviewState;
		pill.textContent = i.reviewState === 'AUTO_VERIFIED' ? 'VERIFIED' : i.reviewState === 'REJECTED' ? 'REJECTED' : 'REVIEW';
		row.append(main, pill);
		box.append(row);
	}
	if (!box.children.length) box.innerHTML = '<div class="uxq-empty">No UX issues at this filter level.</div>';
}

function renderUxRecs() {
	const box = document.getElementById('uxq-recs');
	box.replaceChildren();
	for (const r of uxQualityState.data?.recommendations ?? []) {
		const row = document.createElement('div');
		row.className = 'uxq-rec';
		const title = document.createElement('div');
		title.className = 'uxq-rec-title';
		title.textContent = `[${r.priority}] ${r.issueTitle}`;
		const body = document.createElement('div');
		body.className = 'uxq-rec-body';
		body.textContent = r.recommendation;
		row.append(title, body);
		box.append(row);
	}
	if (!box.children.length) box.innerHTML = '<div class="uxq-empty">No recommendations.</div>';
}

function renderUxUnverified() {
	const box = document.getElementById('uxq-unverified');
	box.replaceChildren();
	const areas = uxQualityState.data?.ux?.unverifiedAreas ?? [];
	const grouped = new Map();
	for (const u of areas) {
		const key = `${u.checkId ?? '?'} (${u.dimension ?? '?'})`;
		grouped.set(key, (grouped.get(key) ?? 0) + 1);
	}
	for (const [k, n] of grouped) {
		const item = document.createElement('div');
		item.className = 'uxq-unverified-item';
		item.textContent = `${k} — ${n} observation(s) could not be verified`;
		box.append(item);
	}
	if (!box.children.length) box.innerHTML = '<div class="uxq-empty">Everything observed was verifiable.</div>';
}

function openUxIssueDetail(issue) {
	const dlg = document.getElementById('ux-issue-detail');
	if (!dlg) return;
	document.getElementById('ux-issue-title').textContent = issue.title;
	const body = document.getElementById('ux-issue-body');
	body.replaceChildren();
	const addRow = (label, value) => {
		const d = document.createElement('div');
		d.style.marginBottom = '10px';
		const l = document.createElement('div');
		l.style.cssText = 'font-size:11px;letter-spacing:.08em;color:var(--text-dim);margin-bottom:2px';
		l.textContent = label.toUpperCase();
		const v = document.createElement('div');
		v.style.cssText = 'font-size:13px;color:var(--text);white-space:pre-wrap;word-break:break-word';
		v.textContent = value;
		d.append(l, v);
		body.append(d);
	};
	addRow('Severity / dimension', `${issue.severity} · ${issue.dimension}${issue.viewports?.length ? ` · ${issue.viewports.join('/')}` : ''}`);
	addRow('Review state', `${issue.reviewState}${issue.reviewedBy ? ` (by ${issue.reviewedBy})` : ''}`);
	addRow('Confidence', `${(issue.confidence * 100).toFixed(0)}%${issue.occurrences > 1 ? ` across ${issue.occurrences} observations` : ''}`);
	if (issue.expected) addRow('Expected', issue.expected);
	if (issue.actual) addRow('Actual', issue.actual);
	if (issue.impact) addRow('Impact', issue.impact);
	if (issue.urls?.length) addRow('Where', issue.urls.slice(0, 8).join('\n'));
	if (issue.evidence?.length) {
		const evBox = document.createElement('div');
		for (const e of issue.evidence.slice(0, 10)) {
			const d = document.createElement('div');
			d.style.cssText = 'font-size:12px;color:var(--text-dim);border-left:2px solid var(--hair);padding-left:8px;margin:4px 0';
			d.textContent = `${e.kind ?? 'evidence'}: ${e.detail ?? ''}`;
			evBox.append(d);
		}
		addRow('Evidence', '');
		body.append(evBox);
	}
	if (issue.reviewReason) addRow('Review note', issue.reviewReason);

	// Review actions (human-only states; server enforces transitions)
	const foot = document.getElementById('ux-issue-foot');
	foot.replaceChildren();
	const mkBtn = (label, state, style) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = `btn btn-sm ${style}`;
		b.textContent = label;
		b.addEventListener('click', () => reviewUxIssue(issue, state, b));
		return b;
	};
	if (issue.reviewState !== 'REJECTED') {
		foot.append(mkBtn('Reject', 'REJECTED', 'btn-danger'));
	}
	if (issue.reviewState === 'REVIEW_REQUIRED') {
		foot.append(mkBtn('Approve', 'AUTO_VERIFIED', 'btn-primary'));
	}
	dlg.showModal();
}

async function reviewUxIssue(issue, reviewState, btn) {
	const missionId = uxQualityState.missionId;
	if (!missionId) return;
	btn.disabled = true;
	try {
		// B1 W3 — mutation through the shared authed helper.
		const j = await api(`/v1/missions/${missionId}/ux/issues/${encodeURIComponent(issue.id)}/review`, {
			method: 'PATCH',
			body: JSON.stringify({ reviewState, reason: 'reviewed in dashboard', by: 'dashboard' }),
		}).catch(() => null);
		if (!j) throw new Error('HTTP error');
		issue.reviewState = j.issue.reviewState;
		issue.reviewedBy = j.issue.reviewedBy;
		issue.reviewedAt = j.issue.reviewedAt;
		renderUxIssues();
		document.getElementById('ux-issue-detail')?.close();
	} catch (err) {
		btn.disabled = false;
		btn.textContent = `Failed: ${err.message}`;
	}

}

// Severity filter buttons
document.addEventListener('click', (e) => {
	const btn = e.target.closest('.uxq-filter');
	if (!btn) return;
	for (const b of document.querySelectorAll('.uxq-filter')) b.classList.toggle('is-active', b === btn);
	uxQualityState.filter = btn.dataset.filter;
	if (uxQualityState.data) renderUxIssues();
});
document.addEventListener('click', (e) => {
	if (e.target.id === 'ux-issue-close') document.getElementById('ux-issue-detail')?.close();
});
