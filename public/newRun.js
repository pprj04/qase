/** QASE V1 New Run — one explicit, direct mission-creation flow. */
import { $, state, api } from './shared.js';
import { navigate } from './router.js';
import { buildNewRunMissionPayload } from './missionIntent.js';

let initialized = false;
let submission = { phase: 'idle', idempotencyKey: null, snapshot: null, awaitingOutcome: false };

const dialog = () => $('new-run-dialog');
const form = () => $('new-run-form');
const target = () => $('new-run-target');
const objective = () => $('new-run-objective');
const requirements = () => $('new-run-requirements');
const device = () => $('new-run-device');
const project = () => $('new-run-project');
const progress = () => $('new-run-progress');
const formError = () => $('new-run-error');
const targetError = () => $('new-run-target-error');
const submit = () => $('new-run-submit');

function currentProjectName() {
	return state.projects.find(item => item.id === state.projectId)?.name ?? 'Current project';
}

function projectSnapshot() {
	return { projectId: state.projectId, projectVersion: state.projectVersion };
}

function isCurrent(snapshot) {
	return snapshot.projectId === state.projectId && snapshot.projectVersion === state.projectVersion;
}

function createIdempotencyKey() {
	return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setText(node, text = '') {
	if (node) node.textContent = text;
}

function resetValidation() {
	target()?.removeAttribute('aria-invalid');
	setText(targetError());
	setText(formError());
}

function renderProject() {
	setText(project(), currentProjectName());
}

function setPhase(phase, message = '') {
	submission.phase = phase;
	const pending = phase === 'submitting' || phase === 'validating';
	if (submit()) {
		submit().disabled = pending || phase === 'setup_required';
		submit().textContent = pending ? 'Starting QA run…' : phase === 'setup_required' ? 'Workspace setup required' : phase === 'error' ? 'Retry starting QA run' : 'Start QA run';
	}
	if (form()) form().setAttribute('aria-busy', String(pending));
	setText(progress(), message);
}

function executionSetupMessage() {
	return state.config?.executionStatusMessage
		?? 'AI execution is not configured for this workspace. Contact your workspace administrator.';
}

function showTargetError(message) {
	target()?.setAttribute('aria-invalid', 'true');
	setText(targetError(), message);
	setText(formError());
	target()?.focus();
}

function sanitizeError(error) {
	const message = error instanceof Error ? error.message : String(error ?? 'Unable to start the run.');
	return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function showStaleProjectAcceptance() {
	// A response accepted in Project A must never be retried under Project B
	// with A's user-scoped idempotency key.
	submission.awaitingOutcome = false;
	submission.idempotencyKey = createIdempotencyKey();
	setPhase('idle', 'A run was accepted for the previous project. Switch back to that project to view it.');
}

function missionPayload() {
	if (!state.projectId) return { payload: null, error: 'Select a project before starting a QA run.', field: 'project' };
	return buildNewRunMissionPayload({
		targetUrl: target()?.value,
		objective: objective()?.value,
		requirementsText: requirements()?.value,
		device: device()?.value,
		projectId: state.projectId
	});
}

function selectRun(sessionId, snapshot) {
	if (!sessionId || !isCurrent(snapshot)) return false;
	navigate('runs');
	window.dispatchEvent(new CustomEvent('qase:select-run', { detail: { id: sessionId } }));
	dialog()?.close();
	return true;
}

async function resolveImmediateSession(missionId, snapshot) {
	const mission = await api(`/v1/missions/${encodeURIComponent(missionId)}`);
	if (!isCurrent(snapshot)) return { stale: true };
	return { sessionId: mission?.sessionId ?? null };
}

async function submitMission() {
	if (submission.phase === 'submitting' || submission.phase === 'validating') return;
	resetValidation();
	if (state.config?.executionReady === false) {
		setPhase('setup_required', executionSetupMessage());
		setText(formError(), executionSetupMessage());
		return;
	}
	setPhase('validating', 'Validating run details…');
	const built = missionPayload();
	if (built.error) {
		setPhase('idle');
		if (built.field === 'project') setText(formError(), built.error);
		else showTargetError(built.error);
		return;
	}
	const snapshot = projectSnapshot();
	submission.snapshot = snapshot;
	submission.idempotencyKey ??= createIdempotencyKey();
	// Keep this key until a response proves whether the request was accepted.
	// If the response is lost, a later retry must replay the same mission.
	submission.awaitingOutcome = true;
	setPhase('submitting', 'Starting QA run…');
	try {
		const created = await api('/v1/missions', {
			method: 'POST',
			headers: { 'Idempotency-Key': submission.idempotencyKey },
			body: JSON.stringify(built.payload)
		});
		submission.awaitingOutcome = false;
		if (!isCurrent(snapshot)) {
			showStaleProjectAcceptance();
			return;
		}
		if (created?.status === 'queued') {
			setPhase('queued', `Queued${Number.isFinite(created.queuePosition) ? ` — position ${created.queuePosition}` : ''}. QASE will start when execution capacity is available.`);
			return;
		}
		const resolved = await resolveImmediateSession(created?.missionId, snapshot).catch(() => ({ sessionId: null }));
		if (resolved.stale) {
			showStaleProjectAcceptance();
			return;
		}
		if (selectRun(resolved.sessionId, snapshot)) return;
		setPhase('queued', 'Run accepted and starting. It will appear in Runs when its session is ready.');
	} catch (error) {
		setPhase('error');
		setText(formError(), sanitizeError(error));
	}
}

function preserveRetrySafety() {
	if (submission.phase !== 'error') return;
	submission.idempotencyKey = createIdempotencyKey();
	submission.awaitingOutcome = false;
	const setupRequired = state.config?.executionReady === false;
	setPhase(setupRequired ? 'setup_required' : 'idle', setupRequired ? executionSetupMessage() : '');
	setText(formError(), setupRequired ? executionSetupMessage() : '');
}

export function openNewRun(defaults = {}) {
	const node = dialog();
	if (!node) return;
	const opening = !node.open;
	// A close/open cycle is still the same retry after an interrupted request.
	// Start a fresh identity only once a previous request has a known outcome.
	if (opening && !submission.awaitingOutcome) submission = { phase: 'idle', idempotencyKey: createIdempotencyKey(), snapshot: null, awaitingOutcome: false };
	if (defaults.targetUrl && target() && !target().value.trim()) target().value = String(defaults.targetUrl).trim();
	if (defaults.objective && objective() && !objective().value.trim()) objective().value = String(defaults.objective).trim();
	renderProject();
	resetValidation();
	if (opening) node.showModal();
	const setupRequired = state.config?.executionReady === false;
	setPhase(setupRequired ? 'setup_required' : 'idle', setupRequired ? executionSetupMessage() : '');
	if (setupRequired) setText(formError(), executionSetupMessage());
	setTimeout(() => (target()?.value.trim() ? objective() : target())?.focus(), 0);
}

export function initNewRun() {
	if (initialized) return;
	initialized = true;
	form()?.addEventListener('submit', event => { event.preventDefault(); void submitMission(); });
	[target(), objective(), requirements(), device()].filter(Boolean).forEach(node => {
		node.addEventListener('input', preserveRetrySafety);
		node.addEventListener('change', preserveRetrySafety);
	});
	document.addEventListener('click', event => {
		const source = event.target instanceof Element ? event.target : null;
		if (source?.closest('[data-open-new-run]')) { openNewRun(); return; }
		if (source?.closest('[data-new-run-close]') && submission.phase !== 'submitting' && submission.phase !== 'validating') dialog()?.close();
	});
	dialog()?.addEventListener('cancel', event => {
		if (submission.phase === 'submitting' || submission.phase === 'validating') event.preventDefault();
	});
	window.addEventListener('qase:project-change', renderProject);
}
