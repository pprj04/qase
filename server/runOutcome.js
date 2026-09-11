const SUCCESS_STEP = new Set(['success', 'passed', 'done']);

export function canonicalFindingCount(...collections) {
	const seen = new Set();
	let anonymous = 0;
	for (const list of collections) for (const finding of list ?? []) {
		if (finding?.isDuplicate === true || finding?.duplicateOf) continue;
		if (finding?.id) seen.add(finding.id);
		else if (finding) anonymous++;
	}
	return seen.size + anonymous;
}

export function syncReportFindingCount(report, ...collections) {
	if (!report) return null;
	report.findingsSnapshot ??= Number.isFinite(report.findings) ? report.findings : null;
	report.findings = canonicalFindingCount(...collections);
	report.findingCountCurrent = report.findings;
	report.findingCountSemantics = 'canonical_current';
	return report;
}

export function deriveRunOutcome({ mission = {}, session = {} } = {}) {
	const missionStatus = mission.status ?? null;
	const sessionStatus = session.status ?? null;
	const health = session.executionHealth ?? {};
	const report = session.report ?? null;
	const steps = session.capturedSteps ?? [];
	const successfulSteps = steps.filter(step => SUCCESS_STEP.has(step?.outcome?.status ?? step?.status)).length;
	const persistedEvidence = Number(mission.evidenceStats?.evidencePersisted ?? session.evidenceStats?.evidencePersisted ?? 0);
	const meaningfulExecution = successfulSteps > 0 || persistedEvidence > 0;
	const actions = steps.length;
	const pages = new Set(steps.map(step => step?.urlAfter ?? step?.url).filter(Boolean)).size;
	const reportAvailable = Boolean(report || mission.reportAvailable);
	const reason = report?.outcomeReason ?? session.stopCause ?? mission.failureReason ?? health.failure?.code ?? null;

	let outcome = 'pending';
	if (['cancelled', 'aborted'].includes(missionStatus) || sessionStatus === 'cancelled' || reason === 'manual_stop' || reason === 'integration_stop') outcome = 'cancelled';
	else if (missionStatus === 'timeout' || report?.executionOutcome === 'incomplete' || ['turn_budget_exhausted', 'session_wall_clock_timeout'].includes(reason)) outcome = 'partial';
	else if (health.components?.browser === 'blocked' || health.failure?.code === 'BROWSER_RUNTIME_DEPENDENCY_MISSING') outcome = 'blocked';
	else if (health.components?.provider === 'failed' && !meaningfulExecution) outcome = 'blocked';
	else if (['failed', 'interrupted'].includes(missionStatus) || ['error', 'failed', 'interrupted'].includes(sessionStatus) || health.overall === 'failed') outcome = 'failed';
	else if ((missionStatus === 'completed' && (!sessionStatus || sessionStatus === 'done')) || (!missionStatus && sessionStatus === 'done')) outcome = 'completed';
	else if (missionStatus === 'running' || ['running', 'awaiting_input'].includes(sessionStatus)) outcome = 'running';
	else if (missionStatus === 'queued') outcome = 'queued';

	return { outcome, reason, terminal: ['completed', 'failed', 'blocked', 'partial', 'cancelled'].includes(outcome), reportAvailable, meaningfulExecution, successfulSteps, actions, pages };
}
