/**
 * Pure Founder Mode presentation helpers — TypeScript port of
 * public/founderPresentation.js. Durable state in, lifecycle labels out;
 * never mutates run state or observations.
 */

const PRODUCT_FINDING_CATEGORIES = new Set<string>([
	'product_clarity', 'user_experience', 'visual_interface', 'onboarding',
	'activation', 'retention', 'trust_security', 'accessibility', 'technical_product_quality',
]);

export interface FounderObservation {
	id?: string;
	title?: string;
	summary?: string;
	category?: string;
	type?: string;
	confidence?: string;
	evidence?: { activityId?: string; [key: string]: unknown }[];
	[key: string]: unknown;
}

export interface FounderTraceItem {
	evidenceObservationIds?: unknown[];
	assumptions?: unknown[];
	[key: string]: unknown;
}

export interface FounderRecommendation {
	id?: string;
	title?: string;
	rationale?: string;
	actions?: unknown[];
	impact?: string;
	effort?: string;
	confidence?: string;
	assumptions?: unknown[];
	[key: string]: unknown;
}

export interface FounderReport {
	executiveSummary?: string;
	quickWins?: unknown[];
	recommendations?: FounderRecommendation[];
	coverage?: {
		categoriesReviewed?: string[];
		totalCategories?: number;
		evidenceBackedObservations?: number;
		[key: string]: unknown;
	};
	evidenceConfidence?: {
		observationConfidence?: { high?: number; medium?: number; low?: number };
		categoryCoverageRatio?: number;
		uniqueBrowserActivities?: number;
		assumptionCount?: number;
		rating?: string;
		limitation?: string;
	};
	icp?: { primary?: string; users?: unknown[]; buyers?: unknown[]; jobs?: unknown[]; pains?: unknown[]; assumptions?: unknown[]; [key: string]: unknown };
	positioning?: { category?: unknown; oneLiner?: unknown; valueProposition?: unknown; differentiators?: unknown[]; alternatives?: unknown[]; assumptions?: unknown[]; [key: string]: unknown };
	monetization?: { model?: unknown; valueMetric?: unknown; packages?: unknown[]; pricingPresentation?: unknown; nextTests?: unknown[]; assumptions?: unknown[]; [key: string]: unknown };
	sales?: { motion?: string; qualificationQuestions?: unknown[]; salesAssets?: unknown[]; objectionResponses?: { objection?: string; response?: unknown }[]; assumptions?: unknown[]; [key: string]: unknown };
	marketing?: { channels?: { channel?: string; rationale?: string; firstTest?: string; confidence?: string; assumptions?: unknown[] }[]; contentAngles?: unknown[]; launchMotions?: unknown[]; growthLoops?: unknown[]; assumptions?: unknown[]; [key: string]: unknown };
	plan?: { days30?: unknown[]; days60?: unknown[]; days90?: unknown[] };
	risks?: { title?: string; mitigation?: unknown; likelihood?: string; impact?: string; assumptions?: unknown[] }[];
	metrics?: {
		northStar?: { name?: string; definition?: unknown; why?: string; assumptions?: unknown[] };
		candidates?: { name?: string; definition?: unknown; assumptions?: unknown[] }[];
		experiments?: { hypothesis?: string; change?: string; successMetric?: string; timebox?: string; guardrail?: string; assumptions?: unknown[] }[];
	};
	caveat?: string;
}

export interface FounderState {
	scope?: {
		target?: { name?: string; release?: string; environment?: string; url?: string };
		productContext?: { stage?: string; businessModel?: string; targetCustomer?: string; primaryGoal?: string };
		categories?: string[];
	};
	observations?: FounderObservation[];
	finalizedAt?: string;
	report?: FounderReport;
}

export interface FounderLifecycle {
	phase: string;
	status: string;
	finalized: boolean;
	label: string;
	badge: string;
	detail: string;
	message?: string;
}

/** Convert durable Founder state into a truthful, non-final lifecycle label. */
export function describeFounderLifecycle(founder: FounderState = {}, runStatus = 'idle', activityCount = 0): FounderLifecycle {
	const observationCount = Array.isArray(founder?.observations) ? founder.observations.length : 0;
	const totalCategories = founder?.scope?.categories?.length ?? founder?.report?.coverage?.totalCategories ?? 0;
	if (founder?.finalizedAt && founder?.report) {
		return {
			phase: 'complete', status: 'complete', finalized: true,
			label: 'Founder brief complete', badge: 'complete',
			detail: `${founder.report.coverage?.categoriesReviewed?.length ?? totalCategories}/${totalCategories} lenses reviewed · ${founder.report.coverage?.evidenceBackedObservations ?? observationCount} evidence-backed observations`,
		};
	}
	if (runStatus === 'running') {
		return {
			phase: 'running', status: 'running', finalized: false, label: 'Review running', badge: 'running',
			detail: `${observationCount} observations captured`,
			message: 'Founder Mode is collecting browser evidence. The strategic brief appears only after finalization.',
		};
	}
	if (runStatus === 'awaiting_input') {
		return {
			phase: 'waiting', status: 'waiting', finalized: false, label: 'Waiting for context', badge: 'waiting',
			detail: 'Answer the agent to continue the evidence review.',
			message: 'The agent needs your context before it can continue the review.',
		};
	}
	if (runStatus === 'error') {
		return {
			phase: 'error', status: 'error', finalized: false, label: 'Review failed', badge: 'error',
			detail: 'The last execution ended with an error; no Founder brief was published.',
			message: 'Resolve the reported error, then send an instruction to continue from the saved evidence.',
		};
	}
	if (runStatus === 'interrupted') {
		return {
			phase: 'interrupted', status: 'interrupted', finalized: false, label: 'Review interrupted', badge: 'interrupted',
			detail: `${observationCount} observations remain saved from the interrupted execution.`,
			message: 'The previous execution was interrupted. Send an instruction to resume evidence collection.',
		};
	}
	if (observationCount > 0 || activityCount > 0) {
		return {
			phase: 'paused', status: 'paused', finalized: false, label: 'Review paused', badge: 'paused',
			detail: `${observationCount} observations saved`,
			message: 'The review is paused. Send an instruction to continue from the saved evidence.',
		};
	}
	return {
		phase: 'ready', status: 'ready', finalized: false, label: 'Ready to review', badge: 'ready',
		detail: 'The scope is saved; product review has not started.',
		message: 'The review scope is saved. Send the target URL to begin evidence collection.',
	};
}

/** Group observations without changing their order or trusting display text. */
export function groupFounderObservations(observations: FounderObservation[] = []) {
	const groups: {
		strengths: FounderObservation[];
		frictions: FounderObservation[];
		opportunities: FounderObservation[];
		risks: FounderObservation[];
		productFindings: FounderObservation[];
		byCategory: Record<string, FounderObservation[]>;
	} = { strengths: [], frictions: [], opportunities: [], risks: [], productFindings: [], byCategory: {} };
	for (const observation of Array.isArray(observations) ? observations : []) {
		if (!observation || typeof observation !== 'object') continue;
		if (observation.category) {
			groups.byCategory[observation.category] ??= [];
			groups.byCategory[observation.category].push(observation);
		}
		if (observation.type === 'strength') groups.strengths.push(observation);
		else if (observation.type === 'friction') groups.frictions.push(observation);
		else if (observation.type === 'opportunity') groups.opportunities.push(observation);
		else if (observation.type === 'risk') groups.risks.push(observation);
		if (typeof observation.category === 'string' && PRODUCT_FINDING_CATEGORIES.has(observation.category)) {
			groups.productFindings.push(observation);
		}
	}
	return groups;
}

export function resolveFounderQuickWins(report: FounderReport = {}): FounderRecommendation[] {
	const byId = new Map((report.recommendations ?? []).map((item) => [item.id, item]));
	return (report.quickWins ?? []).map((id) => byId.get(String(id))).filter(Boolean) as FounderRecommendation[];
}

export function founderEvidenceSummary(founder: FounderState = {}) {
	const observations = Array.isArray(founder?.observations) ? founder.observations : [];
	const confidence = { high: 0, medium: 0, low: 0 };
	let artifacts = 0;
	const activities = new Set<string>();
	for (const observation of observations) {
		if (observation?.confidence && confidence[observation.confidence as 'high' | 'medium' | 'low'] !== undefined) {
			confidence[observation.confidence as 'high' | 'medium' | 'low'] += 1;
		}
		artifacts += Array.isArray(observation?.evidence) ? observation.evidence.length : 0;
		for (const evidence of observation?.evidence ?? []) {
			if (evidence?.activityId) activities.add(String(evidence.activityId));
		}
	}
	const reviewed = founder?.report?.coverage?.categoriesReviewed?.length
		?? new Set(observations.map((item) => item?.category).filter(Boolean)).size;
	const total = founder?.report?.coverage?.totalCategories ?? founder?.scope?.categories?.length ?? 0;
	return { observations: observations.length, artifacts, activities: activities.size, reviewed, total, confidence };
}

/** Collect every explicit hypothesis boundary for one scannable risk section. */
export function collectFounderAssumptions(report: FounderReport = {}): { source: string; text: unknown }[] {
	const values: { source: string; text: unknown }[] = [];
	const add = (source: string, assumptions: unknown) => {
		for (const text of Array.isArray(assumptions) ? assumptions : []) values.push({ source, text });
	};
	add('ICP', report.icp?.assumptions);
	add('Positioning', report.positioning?.assumptions);
	add('Monetization', report.monetization?.assumptions);
	add('Marketing', report.marketing?.assumptions);
	add('Sales', report.sales?.assumptions);
	add('North-star metric', report.metrics?.northStar?.assumptions);
	for (const item of report.recommendations ?? []) add(item.title ?? 'Recommendation', item.assumptions);
	for (const item of report.risks ?? []) add(item.title ?? 'Risk', item.assumptions);
	for (const item of report.marketing?.channels ?? []) add(item.channel ?? 'Channel', item.assumptions);
	for (const [index, item] of (report.metrics?.experiments ?? []).entries()) add(`Experiment ${index + 1}`, item.assumptions);
	for (const item of report.metrics?.candidates ?? []) add(item.name ?? 'Metric candidate', item.assumptions);
	return values;
}

export { PRODUCT_FINDING_CATEGORIES };
