/**
 * UI-4 run-detail presentation rules.
 *
 * This module consumes certified session facts. It never derives execution
 * success from a report, frame, screenshot, or absence of an error.
 */

const OUTCOMES = {
	queued: { key: 'queued', label: 'Queued' },
	running: { key: 'running', label: 'Running' },
	awaiting_input: { key: 'awaiting_input', label: 'Awaiting Input' },
	completed: { key: 'completed', label: 'Completed' },
	partial: { key: 'partial', label: 'Partial' },
	blocked: { key: 'blocked', label: 'Blocked' },
	failed: { key: 'failed', label: 'Failed' },
	cancelled: { key: 'cancelled', label: 'Cancelled' },
	interrupted: { key: 'interrupted', label: 'Interrupted' }
};

const normalizeOutcome = value => {
	const raw = String(value ?? '').trim().toLowerCase();
	return ({
		pending: 'queued', idle: 'queued',
		done: 'completed', success: 'completed', passed: 'completed', pass: 'completed',
		incomplete: 'partial', timeout: 'partial', timed_out: 'partial',
		error: 'failed', fatal: 'failed',
		aborted: 'cancelled', stopped: 'cancelled', canceled: 'cancelled',
		waiting_for_input: 'awaiting_input'
	})[raw] ?? raw;
};

export function canonicalRunPresentation(session = {}) {
	// Awaiting input is an active first-class state. A stale canonical "running"
	// field must not hide a question the server says is currently pending.
	if (normalizeOutcome(session.status) === 'awaiting_input') return OUTCOMES.awaiting_input;

	// A persisted interruption reason is a specific certified terminal fact. It
	// remains non-successful, but is more useful to operators than the generic
	// failed outcome used by historical API projections.
	if (normalizeOutcome(session.status) === 'interrupted' && (session.interruptedReason || session.interruptedAt)) {
		return OUTCOMES.interrupted;
	}

	// Phase 2 fields are authoritative whenever present. Report facts are never
	// consulted here, so report persistence cannot promote a failed run.
	const canonical = normalizeOutcome(session.executionOutcome ?? session.outcome?.outcome);
	if (OUTCOMES[canonical]) return OUTCOMES[canonical];

	if (session.interruptedReason || session.interruptedAt || session.status === 'interrupted') {
		return OUTCOMES.interrupted;
	}
	const legacy = normalizeOutcome(session.status);
	if (OUTCOMES[legacy]) return OUTCOMES[legacy];

	// Unknown historical lifecycle values must never be presented as success.
	return OUTCOMES.interrupted;
}

export function normalizeGeneratedReportMarkdown(markdownText, session = {}) {
	const executionLabel = canonicalRunPresentation(session).label;
	const outcomeLine = `- **Execution outcome:** ${executionLabel}`;
	const lines = String(markdownText ?? '').split(/\r?\n/);
	let replaced = false;
	const normalized = lines.map(line => {
		if (!/^\s*[-*]\s+\*\*Execution outcome:\*\*/i.test(line)) return line;
		replaced = true;
		return outcomeLine;
	});
	if (!replaced) {
		const titleIndex = normalized.findIndex(line => /^#\s+/.test(line));
		normalized.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, outcomeLine);
	}
	return normalized.join('\n');
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

export function currentFindingPresentation(session = {}) {
	const canonical = finite(session.findingCount);
	if (canonical != null) return { value: canonical, semantics: session.findingCountSemantics ?? 'canonical_current', canonical: true };
	const items = Array.isArray(session.findings) ? session.findings : null;
	if (!items) return { value: null, semantics: 'not_reported', canonical: false };
	const keys = new Set();
	for (const finding of items) {
		if (finding?.isDuplicate || finding?.duplicateOf) continue;
		keys.add(finding?.id ?? `${finding?.title ?? ''}|${finding?.url ?? ''}`);
	}
	return { value: keys.size, semantics: 'historical_session_fallback', canonical: false };
}

export function runMetricPresentation(session = {}, now = Date.now()) {
	const started = finite(session.startedAt ?? session.createdAt);
	const status = canonicalRunPresentation(session).key;
	const ended = ['queued', 'running', 'awaiting_input'].includes(status)
		? now
		: finite(session.endedAt ?? session.completedAt ?? session.updatedAt) ?? now;
	const durationMs = started == null ? null : Math.max(0, ended - started);
	const steps = Array.isArray(session.capturedSteps) ? session.capturedSteps : [];
	const urls = new Set(steps.map(step => step?.urlAfter ?? step?.url ?? step?.target).filter(Boolean).map(url => String(url).split('#')[0]));
	return {
		durationMs,
		pages: finite(session.outcome?.pages) ?? finite(session.pages) ?? urls.size,
		actions: finite(session.outcome?.actions) ?? finite(session.stepCount) ?? steps.length,
		findings: currentFindingPresentation(session)
	};
}

export function reportPresentation(session = {}) {
	const available = typeof session.reportAvailable === 'boolean'
		? session.reportAvailable
		: Boolean(session.report);
	const current = currentFindingPresentation(session);
	// A structured report owns its authored historical snapshot. The session
	// compatibility field is projected from the current canonical count, so it
	// is only a fallback when no authored report snapshot is available.
	const snapshot = finite(session.report?.findingsSnapshotCount ?? session.report?.findingsSnapshot ?? session.findingSnapshotCount);
	return {
		available,
		label: available ? 'Report available' : 'Report unavailable',
		execution: canonicalRunPresentation(session),
		currentFindingCount: current.value,
		snapshotFindingCount: snapshot,
		snapshotDiffers: snapshot != null && current.value != null && snapshot !== current.value
	};
}

const componentPresentation = raw => {
	const value = String(raw ?? '').toLowerCase();
	if (['healthy', 'completed', 'ready', 'ok'].includes(value)) return { key: 'healthy', label: 'Healthy' };
	if (['degraded', 'retrying', 'recovering', 'warning'].includes(value)) return { key: 'degraded', label: 'Degraded' };
	if (['failed', 'blocked', 'unavailable', 'missing'].includes(value)) return { key: 'unavailable', label: 'Unavailable' };
	return { key: 'not_reported', label: 'Not reported' };
};

export function safeRunDiagnostic(value) {
	const firstLine = String(value ?? '').split(/\r?\n/, 1)[0].trim();
	if (!firstLine) return '';
	return firstLine
		.replace(/(?:bearer\s+|sk-|gh[pousr]_)[A-Za-z0-9._-]+/gi, '[redacted]')
		.replace(/(password|token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
		.slice(0, 240);
}

export function executionHealthPresentation(session = {}) {
	const health = session.executionHealth ?? {};
	const components = health.components ?? {};
	const names = ['provider', 'worker', 'browser', 'target'];
	return {
		overall: componentPresentation(health.overall),
		components: names.map(name => ({ name, ...componentPresentation(components[name]) })),
		reason: safeRunDiagnostic(health.lastIssue?.summary ?? health.failure?.summary),
		nextAction: safeRunDiagnostic(health.lastIssue?.nextAction)
	};
}

export function evidenceScreenshotUrl(item = {}) {
	const metadata = item.metadata ?? {};
	if (metadata.artifact?.id && metadata.screenshotPersisted !== false) {
		return `/api/v1/artifacts/${encodeURIComponent(metadata.artifact.id)}/content`;
	}
	return metadata.artifactPath ? `/api/artifacts/${metadata.artifactPath}` : null;
}

export function browserHistoryPresentation(session = {}, evidence = {}) {
	if (session.frame) return { key: 'live', title: 'Live application', detail: 'Current browser frame', imageUrl: null };
	const outcome = canonicalRunPresentation(session).key;
	const health = executionHealthPresentation(session);
	const browserUnavailable = health.components.find(item => item.name === 'browser')?.key === 'unavailable';
	if (outcome === 'blocked' && browserUnavailable) {
		return { key: 'blocked', title: 'Browser unavailable', detail: health.reason || 'The browser dependency prevented execution from starting.', imageUrl: null };
	}
	if (evidence.loading) return { key: 'loading', title: 'Loading persisted evidence', detail: 'Checking this run’s execution history.', imageUrl: null };
	const items = Array.isArray(evidence.items) ? evidence.items : [];
	const screenshot = items.find(item => evidenceScreenshotUrl(item));
	const hasHistory = items.length > 0 || (session.capturedSteps?.length ?? session.stepCount ?? 0) > 0 || session.outcome?.meaningfulExecution === true;
	if (screenshot) {
		return {
			key: 'persisted',
			title: 'Live browser disconnected — persisted evidence remains available',
			detail: 'Showing the latest persisted screenshot from this run.',
			imageUrl: evidenceScreenshotUrl(screenshot)
		};
	}
	if (hasHistory) {
		return { key: 'history', title: 'Live browser disconnected — persisted evidence remains available', detail: 'Open Evidence to review recorded actions. No screenshot evidence was persisted.', imageUrl: null };
	}
	if (evidence.error) return { key: 'unavailable', title: 'Execution history unavailable', detail: safeRunDiagnostic(evidence.error.message ?? evidence.error), imageUrl: null };
	return {
		key: 'never_started',
		title: 'Browser has not started',
		detail: evidence.loaded ? 'No screenshot evidence captured.' : 'Waiting for browser execution facts.',
		imageUrl: null
	};
}

export function authenticationChallengePresentation(question = {}, targetUrl) {
	const credentialLike = question.credentialLike === true;
	if (!credentialLike) return { kind: 'question', title: 'Awaiting Input', host: null, fields: [] };
	const text = `${question.question ?? ''} ${question.summary ?? ''}`.toLowerCase();
	const fields = [];
	if (/email|user(?:name)?|sign[ -]?in|login|credential/.test(text)) fields.push('username');
	if (/password|passcode|sign[ -]?in|login|credential/.test(text)) fields.push('password');
	if (/\botp\b|one[ -]?time|verification code|two[ -]?factor|\b2fa\b/.test(text)) fields.push('otp');
	if (!fields.length) fields.push('username', 'password');
	let host = null;
	try {
		const parsed = new URL(targetUrl);
		if (['http:', 'https:'].includes(parsed.protocol)) host = parsed.host;
	} catch { /* exact destination is intentionally omitted */ }
	return { kind: 'credentials', title: host ? `Authentication required for ${host}` : 'Authentication required', host, fields: [...new Set(fields)] };
}

export function buildCredentialFields(values = {}, requested = []) {
	const fields = {};
	if (requested.includes('username') && String(values.username ?? '').trim()) fields.QA_USERNAME = String(values.username).trim();
	if (requested.includes('password') && String(values.password ?? '')) fields.QA_PASSWORD = String(values.password);
	if (requested.includes('otp') && String(values.otp ?? '')) fields.QA_OTP = String(values.otp);
	return fields;
}

export function runViewSnapshot(state, sessionId) {
	return { sessionId, projectId: state.projectId, projectVersion: state.projectVersion, runViewVersion: state.runViewVersion };
}

export function isCurrentRunView(state, snapshot) {
	return snapshot.sessionId === state.sessionId
		&& snapshot.projectId === state.projectId
		&& snapshot.projectVersion === state.projectVersion
		&& snapshot.runViewVersion === state.runViewVersion;
}

export function credentialRequestSnapshot(state, sessionId) {
	return {
		...runViewSnapshot(state, sessionId),
		credentialRequestVersion: state.credentialRequestVersion
	};
}

export function isCurrentCredentialRequest(state, snapshot, { formConnected = true, questionKey } = {}) {
	return formConnected
		&& snapshot.credentialRequestVersion === state.credentialRequestVersion
		&& (questionKey === undefined || questionKey === state.renderedQuestionKey)
		&& isCurrentRunView(state, snapshot);
}

export function runStreamLifecycleAction(state, page) {
	if (page !== 'runs') return state.stream ? 'close' : 'inactive';
	if (!state.sessionId || state.session?.id !== state.sessionId) return 'none';
	return state.stream ? 'none' : 'open';
}

export function shouldRefreshRunOnReentry(state, page, wasRunRouteActive) {
	return page === 'runs' && !wasRunRouteActive && Boolean(state.sessionId);
}
