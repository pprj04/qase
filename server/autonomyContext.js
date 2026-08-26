/**
 * BUILD B2 — W1: Autonomy Context Builder.
 *
 * The missing producer for session.testContext. prompt.js buildQaContext()
 * renders testContext.promptSection / adaptiveGuidance / urgencyNote on EVERY
 * turn, and qaTools.js mutates testContext via reassessRiskWithFindings() when
 * findings are reported — but before B2 nothing ever ASSIGNED session.testContext,
 * so every live run rendered an empty risk/priority block in its operating brief.
 *
 * This module derives the pre-exploration context from real evidence:
 *   - mission intent (type, objectives, success criteria, build prompt)
 *   - historical knowledge patterns (queryKnowledge at mission target)
 *   - whether the target looks like it needs auth (credential vault)
 *
 * It is deterministic: NO LLM, no network, no browser. buildAppUnderstanding()
 * (LLM-capable) stays where it is in the pipeline; this builder only wires the
 * already-existing deterministic riskModel into the per-turn prompt.
 *
 * Call it once, BEFORE the first agent turn of a mission session (see
 * startMissionExecution call-sites in index.js).
 */

import { assessRisk, formatRiskForPrompt } from './riskModel.js';
import { detectAppMetadata, queryKnowledge } from './knowledge.js';

/**
 * Builds and assigns session.testContext.
 *
 * @param {object} session - the agent session (mutated: testContext assigned)
 * @param {object|null} mission - the mission record
 * @returns {object|null} the assigned testContext, or null when disabled
 */
export function buildTestContext(session, mission = null) {
	// Never rebuild mid-mission: qaTools' adaptive updates must survive.
	if (!session || session.testContext) return session?.testContext ?? null;

	const missionContext = mission?.context ?? {};
	const objectives = Array.isArray(mission?.objectives) ? mission.objectives : [];

	// Intent text fed to the transactional/form keyword detectors in assessRisk.
	const buildPrompt = String(missionContext.buildPrompt ?? '');
	const requirements = [
		mission?.type ? String(mission.type) : '',
		...objectives.map(o => String(o ?? ''))
	].filter(Boolean);

	// Historical knowledge at this target (best-effort — knowledge store may be
	// empty on a fresh install; that is a legitimate zero-risk-signals case).
	let knowledgePatterns = [];
	try {
		const meta = detectAppMetadata({ targetUrl: session.targetUrl ?? mission?.targetUrl });
		const result = queryKnowledge(meta);
		knowledgePatterns = (result.hints ?? result.patterns ?? []).slice(0, 10);
	} catch {
		knowledgePatterns = [];
	}

	const hasCredentials = Array.isArray(session.secretNames) && session.secretNames.length > 0;

	const assessment = assessRisk({
		purpose: null, // purpose derivation is the LLM pipeline's job (appUnderstanding)
		expectedFeatures: [],
		authDetected: hasCredentials, // credentials imply an auth flow is in scope
		hasCredentials,
		knowledgePatterns,
		currentFindings: [],
		buildPrompt,
		requirements
	});

	const promptSection = formatRiskForPrompt(assessment) || '';

	session.testContext = {
		builtAt: Date.now(),
		missionId: mission?.id ?? null,
		riskAssessment: assessment,
		promptSection,
		adaptiveGuidance: '',
		urgencyNote: null,
		knowledgePatternCount: knowledgePatterns.length
	};
	return session.testContext;
}
