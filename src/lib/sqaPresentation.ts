/**
 * Pure presentation helpers for SQA results — TypeScript port of
 * SQA presentation. No DOM; components render from these values.
 * Labels only; never changes evaluator results.
 */

const FINAL_RESULTS: Readonly<Record<string, { label: string; mark: string }>> = Object.freeze({
	pass: { label: 'Pass', mark: '✓' },
	fail: { label: 'Fail', mark: '×' },
	blocked: { label: 'Blocked', mark: '!' },
	not_assessed: { label: 'Not assessed', mark: '—' },
});

/**
 * Evidence types that the browser agent can defensibly produce or reference
 * during a run. Every other type represents an operator/reviewer artifact.
 * Keep this presentation boundary aligned with the server-side SQA evidence
 * contract; it changes labels only and never changes evaluator results.
 */
export const SQA_AGENT_CAPABLE_EVIDENCE_TYPES: readonly string[] = Object.freeze([
	'assessment_record',
	'configuration_record',
	'security_report',
	'test_result',
	'wcag_report',
]);

const AGENT_CAPABLE_EVIDENCE = new Set<string>(SQA_AGENT_CAPABLE_EVIDENCE_TYPES);

export function humanizeSqaId(value: unknown): string {
	return String(value ?? '')
		.split('_')
		.join(' ')
		.replace(/\b\w/g, (character: string) => character.toUpperCase());
}

/** Accept arrays or keyed objects (catalog sources arrive keyed). */
export function sqaValues<T>(value: T[] | Record<string, T> | undefined | null): T[] {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') return Object.values(value as Record<string, T>);
	return [];
}

export interface SqaEvidenceRequirement {
	type?: string;
	description?: string;
	satisfied?: boolean;
}

export interface SqaEvidenceCoverage {
	required?: number;
	satisfied?: number;
	missing?: string[];
	requirements?: SqaEvidenceRequirement[];
}

export interface SqaControlResult {
	controlId: string;
	title: string;
	status: string;
	domain?: string;
	severity?: string;
	automationLevel?: string;
	mandatory?: boolean;
	rationale?: string;
	decisionNotes?: string[];
	evidence?: { type?: string; reference?: string; summary?: string }[];
	evidenceCoverage?: SqaEvidenceCoverage;
	sources?: string[];
}

export interface SqaAssessment {
	assessmentId?: string;
	verdict?: string;
	disclaimer?: string;
	catalogVersion?: string;
	target?: { name?: string; release?: string; environment?: string; url?: string };
	profiles?: string[];
	attributes?: string[];
	scopeNotes?: string;
	risk?: { level?: string };
	gates?: { title: string; status: string; detail?: string }[];
	coverage?: { observed?: number; conclusive?: number; mandatoryPassed?: number; evidence?: number };
	summary?: { fail?: number; [key: string]: unknown };
	technicalSummary?: { applicableControls?: number; verdict?: string; pass?: number; fail?: number; blocked?: number; not_assessed?: number };
	results?: SqaControlResult[];
	frameworkCoverage?: {
		sourceId?: string;
		title?: string;
		url?: string;
		status?: string;
		controls?: number;
		coverage?: number;
		[key: string]: unknown;
	}[];
	[key: string]: unknown;
}

export interface SqaState {
	scope?: Record<string, unknown>;
	assessment?: SqaAssessment | null;
	finalizedAt?: string;
	observations?: unknown[];
	[key: string]: unknown;
}

function missingEvidenceTypes(result: SqaControlResult): string[] {
	return (result?.evidenceCoverage?.requirements ?? [])
		.filter((requirement) => !requirement?.satisfied && typeof requirement?.type === 'string')
		.map((requirement) => requirement.type as string);
}

/**
 * Split unresolved controls by who can supply the missing evidence. Failures
 * stay distinct so missing paperwork is never presented as a failed web test.
 */
export function groupSqaUnresolvedResults(results: SqaControlResult[] | undefined) {
	const groups = {
		failures: [] as SqaControlResult[],
		reviewer: [] as SqaControlResult[],
		mixed: [] as SqaControlResult[],
		automated: [] as SqaControlResult[],
	};
	for (const result of Array.isArray(results) ? results : []) {
		if (!result || result.status === 'pass') continue;
		if (result.status === 'fail') {
			groups.failures.push(result);
			continue;
		}

		const missingTypes = missingEvidenceTypes(result);
		const hasAgentEvidence = missingTypes.some((type) => AGENT_CAPABLE_EVIDENCE.has(type));
		const hasReviewerEvidence = missingTypes.some((type) => !AGENT_CAPABLE_EVIDENCE.has(type));
		if (result.automationLevel === 'manual' || (hasReviewerEvidence && !hasAgentEvidence)) {
			groups.reviewer.push(result);
		} else if (result.automationLevel === 'hybrid' || (hasAgentEvidence && hasReviewerEvidence)) {
			groups.mixed.push(result);
		} else {
			groups.automated.push(result);
		}
	}
	return groups;
}

export interface SqaLifecycle {
	phase: string;
	finalized: boolean;
	status: string;
	rawVerdict?: string;
	evidenceIncomplete?: boolean;
	evidenceGapCount?: number;
	eyebrow: string;
	label: string;
	mark: string;
	badge: string;
}

/**
 * Turn the persisted SQA lifecycle into user-facing state.
 *
 * A newly created assessment is pending and older sessions may still contain
 * a conservative, evidence-empty draft evaluation. Neither is a final
 * "blocked" verdict; only `finalizedAt` makes the result final.
 */
export function describeSqaLifecycle(sqa: SqaState | undefined, runStatus = 'idle', activityCount = 0): SqaLifecycle {
	const assessment = sqa?.assessment;
	if (sqa?.finalizedAt) {
		const status = (assessment?.verdict as string) ?? 'not_assessed';
		const result = FINAL_RESULTS[status] ?? {
			label: String(status).split('_').join(' '),
			mark: '•',
		};
		const groups = groupSqaUnresolvedResults(assessment?.results);
		const hasFailure = groups.failures.length > 0 || Number(assessment?.summary?.fail) > 0;
		const evidenceGapCount = groups.reviewer.length + groups.mixed.length;
		const evidenceIncomplete = status === 'blocked'
			&& !hasFailure
			&& groups.automated.length === 0
			&& evidenceGapCount > 0;
		const presentation = evidenceIncomplete
			? { label: 'Evidence incomplete', mark: '!', badge: 'evidence incomplete' }
			: { ...result, badge: result.label.toLowerCase() };
		return {
			phase: 'finalized',
			finalized: true,
			status,
			rawVerdict: status,
			evidenceIncomplete,
			evidenceGapCount,
			eyebrow: 'Final deterministic verdict',
			...presentation,
		};
	}

	if (runStatus === 'running') {
		return {
			phase: 'running', finalized: false, status: 'running', badge: 'running',
			label: 'Assessment running', mark: '…', eyebrow: 'Assessment lifecycle',
		};
	}
	if (runStatus === 'awaiting_input') {
		return {
			phase: 'waiting', finalized: false, status: 'waiting', badge: 'waiting',
			label: 'Waiting for input', mark: '?', eyebrow: 'Assessment lifecycle',
		};
	}

	const observationCount = Array.isArray(sqa?.observations) ? sqa.observations.length : 0;
	if (observationCount > 0 || activityCount > 0) {
		return {
			phase: 'in_progress', finalized: false, status: 'in_progress', badge: 'in progress',
			label: 'Assessment in progress', mark: '…', eyebrow: 'Assessment lifecycle',
		};
	}

	return {
		phase: 'ready', finalized: false, status: 'ready', badge: 'ready',
		label: 'Ready to test', mark: '>', eyebrow: 'Assessment lifecycle',
	};
}

export const SQA_RESULT_META: Readonly<Record<string, { label: string; mark: string }>> = Object.freeze({
	pass: { label: 'Pass', mark: '✓' },
	fail: { label: 'Fail', mark: '×' },
	blocked: { label: 'Blocked', mark: '!' },
	not_assessed: { label: 'Not assessed', mark: '—' },
	not_applicable: { label: 'Not applicable', mark: '—' },
});
