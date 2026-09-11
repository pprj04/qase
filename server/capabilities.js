/**
 * Capability Registry + Orchestrator
 *
 * An evolutionary migration from the hardcoded linear pipeline (pipeline.js)
 * to a capability-driven architecture. Each pipeline stage becomes a registered
 * capability with a formal contract (inputs, outputs, dependencies).
 *
 * The Orchestrator:
 * 1. Topologically sorts capabilities by dependsOn
 * 2. Filters to enabled ones (based on config + available evidence)
 * 3. Executes in order, collecting results as an evidence object
 * 4. Skips downstream capabilities when a dependency fails
 *
 * Behavior is identical to the existing pipeline — this is a structural
 * refactor, not a functional change. The SSE events and result shapes
 * stay the same because the capability execute() functions wrap the
 * exact same logic from pipeline.js.
 *
 * See: .drytis/CAPABILITIES.md and .drytis/ARCHITECTURE.md
 */

import { emit } from './store.js';
import { getConfig } from './config.js';
import { saveWorkflow } from './workflows.js';
import { createTestCases } from './testCases.js';
import { generateTestCasesFromWorkflow } from './testGen.js';
import { runTestSuite } from './replay.js';
import { analyzeSessionFindings, scoreFindingQuality, calculateMissionQuality, buildImprovementPrompt } from './devIntelligence.js';
import { listMissions, finalizeMission, recordIteration } from './missions.js';
import { autonomyGateForCapabilities } from './autonomyBridge.js';
import { prepareMissionOutcome } from './missionOutcome.js';
import { missionBus } from './missions.js';
import { analyzeFeatureGaps, enhanceGapsWithLLM, gapsToFindings } from './featureGap.js';
import { syncSessionFinding } from './findings.js';
import { withRetry, wrapError, classifyError, isRetryableType, ERROR_TYPES } from './errorTypes.js';
import { buildAppUnderstanding } from './appUnderstanding.js';
import { summarizeAppModel } from './appModel.js';
import { queryKnowledge, detectAppMetadata, validateKnowledge, detectKnowledgeConflicts, writeKnowledge, getPatternById } from './knowledge.js';
import { makeDecisionSafe, DECISION_TYPES, TERMINAL_DECISIONS, trackBudget, computeBudgetRemaining } from './decisionEngine.js';

/* ── Pipeline Stage Info (shared with pipeline.js) ──────────────── */

const STAGE_INFO = {
	app_understanding: { icon: '🧭', label: 'Understanding' },
	workflow_save:    { icon: '📋', label: 'Workflow' },
	test_generation:  { icon: '🧪', label: 'Tests' },
	smoke_run:        { icon: '💨', label: 'Smoke' },
	schedule_create:  { icon: '📅', label: 'Schedule' },
	dev_intelligence: { icon: '🧠', label: 'Dev Report' },
	feature_gap:      { icon: '🔍', label: 'Feature Gaps' },
	mission_finalize: { icon: '🎯', label: 'Mission' },
	knowledge_write:  { icon: '📚', label: 'Knowledge' },
	knowledge_query:  { icon: '🔎', label: 'Knowledge Query' }
};

function emitProgress(session, stage, status, detail, result) {
	emit(session, 'pipeline_progress', { stage, status, detail, result });
}

/* ── Capability Registry ────────────────────────────────────────── */

class CapabilityRegistry {
	constructor() {
		this.capabilities = new Map();
	}

	register(cap) {
		if (this.capabilities.has(cap.id)) {
			throw new Error(`Capability already registered: ${cap.id}`);
		}
		this.capabilities.set(cap.id, cap);
	}

	get(id) {
		return this.capabilities.get(id);
	}

	list() {
		return [...this.capabilities.values()];
	}

	has(id) {
		return this.capabilities.has(id);
	}
}

/* ── Reliability constants ──────────────────────────────────────── */

/**
 * Per-capability timeout in ms. Capabilities that exceed this are failed.
 * Env override QASE_CAPABILITY_TIMEOUT_MS exists because test_generation is
 * a long-horizon LLM call: real workflows with 50–100 captured steps produce
 * prompts whose completions legitimately run past 3 minutes on slower
 * gateways — the hard-coded 180s failed healthy generations (observed live:
 * 'capability:test_generation timed out after 180000ms' while the same
 * request completed in ~46–75s via the manual endpoint).
 */
const CAPABILITY_TIMEOUT_MS = Number(process.env.QASE_CAPABILITY_TIMEOUT_MS ?? 180_000);
/** Max retry attempts for retryable capability failures. */
const CAPABILITY_MAX_RETRIES = 1;
/** Delay between capability retries. */
const CAPABILITY_RETRY_DELAY_MS = 3000;

/* ── Orchestrator ───────────────────────────────────────────────── */

class Orchestrator {
	constructor(registry) {
		this.registry = registry;
	}

	/**
	 * Topologically sorts capabilities by their dependencies.
	 * Returns the execution order.
	 *
	 * Uses Kahn's algorithm — repeatedly picks capabilities with no
	 * unsatisfied dependencies.
	 */
	plan(availableIds) {
		const caps = this.registry.list().filter(c => availableIds.includes(c.id));
		const sorted = [];
		const visited = new Set();
		const visiting = new Set();

		const visit = (cap) => {
			if (visited.has(cap.id)) return;
			if (visiting.has(cap.id)) {
				throw new Error(`Circular dependency detected at: ${cap.id}`);
			}
			visiting.add(cap.id);
			for (const depId of cap.dependsOn ?? []) {
				const dep = this.registry.get(depId);
				if (dep && availableIds.includes(depId)) {
					visit(dep);
				}
			}
			visiting.delete(cap.id);
			visited.add(cap.id);
			sorted.push(cap);
		};

		for (const cap of caps) {
			visit(cap);
		}

		return sorted;
	}

	/**
	 * Executes capabilities in dependency order.
	 * Collects evidence from each capability's output.
	 * Skips downstream capabilities when a dependency is skipped or fails.
	 *
	 * Phase 1 reliability: each capability is wrapped in a timeout and
	 * bounded retry. Transient failures (LLM timeout, network blip) get
	 * one retry; non-retryable failures skip the capability and mark
	 * downstream deps as failed.
	 */
	async execute(session, config, options = {}) {
		const allCaps = this.registry.list();
		const evidence = {};

		// B2 — curated runs (e.g. the deterministic turn-budget close-out) can
		// exclude expensive auxiliary stages while keeping the analysis chain
		// that derives findings from already-collected evidence.
		const filter = typeof options.capabilityFilter === 'function' ? options.capabilityFilter : null;

		// Determine which capabilities are enabled
		const enabledIds = allCaps
			.filter(cap => cap.enabled(config, evidence))
			.filter(cap => !filter || filter(cap.id))
			.map(cap => cap.id);

		// Plan execution order
		const plan = this.plan(enabledIds);

		// Build results object for all stages (for SSE compatibility)
		const results = {};
		for (const cap of this.registry.list()) {
			results[cap.id] = { status: 'pending' };
		}

		// Track which capabilities were skipped due to dependency failure
		const failedDeps = new Set();

		// Emit pipeline_start
		emit(session, 'pipeline_start', {
			stages: plan.map(c => ({ key: c.id, ...STAGE_INFO[c.id] }))
		});

		// Execute each capability in order
		for (const cap of plan) {
			// Check if any dependency was skipped or failed
			const depFailed = (cap.dependsOn ?? []).some(depId => failedDeps.has(depId));
			if (depFailed) {
				results[cap.id] = { status: 'skipped', reason: 'dependency_failed' };
				failedDeps.add(cap.id);
				continue;
			}

			// Check if required evidence is available
			const missingEvidence = (cap.requiredEvidence ?? []).filter(key => evidence[key] === undefined || evidence[key] === null);
			if (missingEvidence.length > 0) {
				results[cap.id] = { status: 'skipped', reason: `missing_evidence:${missingEvidence.join(',')}` };
				failedDeps.add(cap.id);
				continue;
			}

			try {
				// Wrap each capability in a bounded timeout + retry.
				const result = await withRetry(
					(attempt) => cap.execute(session, evidence, config),
					{
						maxRetries: CAPABILITY_MAX_RETRIES,
						delayMs: CAPABILITY_RETRY_DELAY_MS,
						// test_generation holds the workflow prompt for the full
						// LLM round-trip; apply the per-capability timeout
						// PER ATTEMPT (a 3-minute timeout applied across a
						// retry + 3s delay cut healthy generations short).
						timeoutMs: cap.id === 'test_generation'
							? Math.max(CAPABILITY_TIMEOUT_MS, 300_000)
							: CAPABILITY_TIMEOUT_MS,
						label: `capability:${cap.id}`
					}
				);
				results[cap.id] = { status: 'done', result };

				// Collect produced evidence
				for (const evidenceKey of cap.producesEvidence ?? []) {
					if (result?.[evidenceKey] !== undefined) {
						evidence[evidenceKey] = result[evidenceKey];
					}
				}
			} catch (error) {
				const wrapped = wrapError(error, { capability: cap.id });
				results[cap.id] = { status: 'failed', error: wrapped.message, errorType: wrapped.errorType };
				failedDeps.add(cap.id);
			}
		}

		return { results, evidence };
	}
}

/* ── Default Registry (existing pipeline stages as capabilities) ── */

function createDefaultRegistry() {
	const registry = new CapabilityRegistry();

	// Capability 1: Workflow Save
	registry.register({
		id: 'workflow_save',
		name: 'Auto-Save Workflow',
		category: 'extraction',
		dependsOn: [],
		requiredEvidence: [],
		producesEvidence: ['workflow'],
		enabled: (config) => config.autoSaveWorkflow !== false,
		confidence: 0.95,
		cost: 'low',
		async execute(session, evidence, config) {
			const capturedSteps = session.capturedSteps ?? [];
			if (capturedSteps.length === 0) {
				emitProgress(session, 'workflow_save', 'skipped', 'No captured steps to save');
				return { workflow: null };
			}
			emitProgress(session, 'workflow_save', 'running', `Saving ${capturedSteps.length} steps…`);
			const name = `Auto: ${session.targetUrl || 'Untitled'}`;
			const wf = saveWorkflow(session, { name });
			emitProgress(session, 'workflow_save', 'done', `Saved "${wf.name}" (${wf.steps.length} steps)`, { workflowId: wf.id, stepCount: wf.steps.length });
			return { workflow: wf, workflowId: wf.id, stepCount: wf.steps.length };
		}
	});

	// Capability 2: Test Generation
	registry.register({
		id: 'test_generation',
		name: 'Generate Test Cases',
		category: 'generation',
		dependsOn: ['workflow_save'],
		requiredEvidence: ['workflow'],
		producesEvidence: ['testCases'],
		enabled: (config) => config.autoGenerateTests !== false,
		confidence: 0.8,
		cost: 'medium',
		async execute(session, evidence, config) {
			const wf = evidence.workflow;
			if (!wf) {
				emitProgress(session, 'test_generation', 'skipped', 'No workflow available');
				return { testCases: [] };
			}
			emitProgress(session, 'test_generation', 'running', 'Generating test cases via LLM…');
			const findings = session.findings ?? [];
			const raw = await generateTestCasesFromWorkflow(wf, findings);
			// D1 — provenance: generated test cases carry the origin mission
			// and session so the UI (D1.9 Source row) and the API can trace a
			// test case back to the run that produced its workflow.
			const testCases = createTestCases(raw.map(rec => ({
				...rec,
				missionId: session.missionId ?? undefined,
				sessionId: session.id
			})), {
				projectId: session.projectId,
				workflowId: wf.id,
				targetUrl: session.targetUrl
			});
			emitProgress(session, 'test_generation', 'done', `Generated ${testCases.length} test case${testCases.length === 1 ? '' : 's'}`, { count: testCases.length });
			return { testCases, count: testCases.length, ids: testCases.map(tc => tc.id) };
		}
	});

	// Capability 3: Smoke Run
	registry.register({
		id: 'smoke_run',
		name: 'Quick Validation Run',
		category: 'validation',
		dependsOn: ['test_generation'],
		requiredEvidence: ['testCases'],
		producesEvidence: ['smokeResults'],
		enabled: (config) => config.autoSmokeRun === true,
		confidence: 0.7,
		cost: 'high',
		async execute(session, evidence, config) {
			const testCases = evidence.testCases ?? [];
			if (testCases.length === 0) {
				emitProgress(session, 'smoke_run', 'skipped', 'No test cases to run');
				return { smokeResults: null };
			}
			emitProgress(session, 'smoke_run', 'running', `Validating ${testCases.length} tests…`);
			const result = await runTestSuite(testCases, {
				credentials: session.credentials ?? {},
				concurrency: 1,
				retries: 0
			});
			emitProgress(session, 'smoke_run', 'done', `${result.passed}/${result.total} passed`, { passed: result.passed, failed: result.failed, total: result.total });
			return { smokeResults: result, passed: result.passed, failed: result.failed, errored: result.errored, total: result.total };
		}
	});

	// Capability 4: Schedule Create
	registry.register({
		id: 'schedule_create',
		name: 'Create Regression Schedule (explicit only)',
		category: 'generation',
		dependsOn: ['test_generation'],
		requiredEvidence: ['testCases'],
		producesEvidence: ['schedule'],
		// P0 scheduler reliability: recurring schedules are an explicit user
		// resource. A normal mission, retry, browser run, or close-out pipeline
		// must never create one, regardless of legacy stored configuration.
		enabled: () => false,
		confidence: 0.9,
		cost: 'low',
		async execute(session) {
			emitProgress(session, 'schedule_create', 'skipped', 'Schedules are created only through the scheduling API or UI');
			return { schedule: null, scheduleId: null, nextRun: null };
		}
	});

	// Capability 5: Dev Intelligence
	registry.register({
		id: 'dev_intelligence',
		name: 'Developer Intelligence Report',
		category: 'analysis',
		dependsOn: [],
		requiredEvidence: [],
		producesEvidence: ['devReport'],
		enabled: (config) => config.autoDevReport !== false,
		confidence: 0.75,
		cost: 'medium',
		async execute(session, evidence, config) {
			const findings = session.findings ?? [];
			if (findings.length === 0) {
				emitProgress(session, 'dev_intelligence', 'skipped', 'No findings to analyze');
				return { devReport: null };
			}
			emitProgress(session, 'dev_intelligence', 'running', `Analyzing ${findings.length} finding${findings.length === 1 ? '' : 's'}…`);
			const dev = await analyzeSessionFindings(findings, { targetUrl: session.targetUrl });
			session.devIntelligence = dev;
			const analyzedCount = dev.results.filter(r => r.status === 'done').length;
			emitProgress(session, 'dev_intelligence', 'done', `Analyzed ${analyzedCount} finding${analyzedCount === 1 ? '' : 's'}${dev.appReport ? ' + app report' : ''}`, { findingsAnalyzed: analyzedCount, hasAppReport: Boolean(dev.appReport) });
			return { devReport: dev, findingsAnalyzed: analyzedCount, hasAppReport: Boolean(dev.appReport), priorityCount: dev.appReport?.priority?.length ?? 0 };
		}
	});

	// Capability 6: Application Understanding (Phase 2)
	// Builds a structured Application Model from all evidence sources.
	// Runs BEFORE feature_gap so downstream capabilities can consume the model.
	registry.register({
		id: 'application_understanding',
		name: 'Application Understanding',
		category: 'analysis',
		dependsOn: [],
		requiredEvidence: [],
		producesEvidence: ['appModel'],
		enabled: () => true,
		confidence: 0.7,
		cost: 'medium',
		async execute(session, evidence, config) {
			const linkedMission = listMissions({}).find(m => m.sessionId === session.id);
			const missionContext = linkedMission?.context || null;

			emitProgress(session, 'application_understanding', 'running', 'Building application model…');

			const appModel = await buildAppUnderstanding(session, missionContext, {
				useLLM: Boolean(config.model && config.baseUrl)
			});

			// Store on session for downstream capabilities and API access
			session.appModel = appModel;

			const summary = summarizeAppModel(appModel);
			const purposeName = summary.purpose?.name || 'Unknown';
			const confidence = summary.confidence?.purpose ?? 0;

			emitProgress(session, 'application_understanding', 'done',
				`Application understood: ${purposeName} (${Math.round(confidence * 100)}% confidence)`,
				{
					purpose: summary.purpose,
					confidence: summary.confidence,
					features: summary.features,
					workflows: summary.workflows,
					unknowns: summary.unknowns,
					conflicts: summary.conflicts,
					status: summary.status,
					evidenceCount: summary.evidenceCount,
					roles: summary.roles,
				});

			return { appModel, appModelSummary: summary };
		}
	});

	// Capability 7: Feature Gap Analysis
	registry.register({
		id: 'feature_gap',
		name: 'Feature Gap Analysis',
		category: 'analysis',
		dependsOn: ['application_understanding'],
		requiredEvidence: [],
		producesEvidence: ['featureGaps'],
		enabled: (config) => config.autoFeatureGap !== false,
		confidence: 0.6,
		cost: 'medium',
		async execute(session, evidence, config) {
			// Find linked mission for context
			const linkedMission = listMissions({}).find(m => m.sessionId === session.id);
			const missionContext = linkedMission?.context || null;

			// Consume Application Model if available (from application_understanding)
			const appModel = session.appModel || evidence.appModel || null;

			// Knowledge query — surface known patterns before analysis
			const appMeta = detectAppMetadata(session);
			const knowledgeResult = queryKnowledge(appMeta);

			const gapAnalysis = analyzeFeatureGaps(session, missionContext);

			let gaps = gapAnalysis.gaps;
			// B2 — deterministic close-out skips LLM enhancement (it can hang
			// for minutes on empty gateway responses). Heuristic gaps still
			// produce findings; the full pipeline (non-close-out path) gets
			// the LLM-enhanced gap set.
			if (config.model && config.baseUrl && !session._deterministicCloseOut) {
				gaps = await enhanceGapsWithLLM(session, gaps);
			}

			if (gaps.length > 0) {
				const gapFindings = gapsToFindings(gaps, session);
				session.findings = [...(session.findings ?? []), ...gapFindings];
				for (const f of gapFindings) {
					syncSessionFinding(session, f);
				}
			}

			emitProgress(session, 'feature_gap', 'done',
				`Found ${gaps.length} gap${gaps.length === 1 ? '' : 's'} (${gaps.filter(g => g.isWorkflowGap).length} workflow), purpose: ${gapAnalysis.purpose.name}`,
				{
					gapsFound: gaps.length,
					bySeverity: {
						critical: gaps.filter(g => g.severity === 'critical').length,
						high: gaps.filter(g => g.severity === 'high').length,
						medium: gaps.filter(g => g.severity === 'medium').length,
						low: gaps.filter(g => g.severity === 'low').length
					},
					appType: gapAnalysis.inventory.appType,
					purpose: gapAnalysis.purpose,
					workflowGaps: gaps.filter(g => g.isWorkflowGap).length,
					knowledgePatterns: knowledgeResult.patterns.length,
					knowledgeHints: knowledgeResult.hints
				});

			return { featureGaps: gaps, gapAnalysis, knowledgeResult };
		}
	});

	// Capability 7: Mission Finalize
	registry.register({
		id: 'mission_finalize',
		name: 'Finalize Mission',
		category: 'analysis',
		dependsOn: ['feature_gap'],
		requiredEvidence: [],
		producesEvidence: ['missionResult'],
		enabled: () => true,
		confidence: 0.9,
		cost: 'low',
		async execute(session, evidence, config) {
			const linkedMissions = listMissions({}).filter(m => m.sessionId === session.id);
			if (linkedMissions.length === 0) {
				emitProgress(session, 'mission_finalize', 'skipped', 'No mission linked to this session');
				return { missionResult: null };
			}

			// BUILD B2 — the autonomy gate. Before the terminal write, the
			// settled session gets one autonomy decision: STOP (pins
			// stopReason) or REVALIDATE (deferred to the new iteration's own
			// settle path — we do NOT finalize here). Fail-open on error.
			const gate = await autonomyGateForCapabilities(session);
			if (gate === 'deferred') {
				emitProgress(session, 'mission_finalize', 'deferred',
					'Autonomy chose revalidation — finalization deferred to the next iteration');
				return { missionResult: null, deferred: true };
			}

			const findings = session.findings ?? [];
			for (const f of findings) {
				const scored = scoreFindingQuality(f, findings);
				if (f.confidence == null) f.confidence = scored.confidence;
				if (f.isDuplicate == null) f.isDuplicate = scored.isDuplicate;
				if (f.duplicateOf == null && scored.duplicateOf) f.duplicateOf = scored.duplicateOf;
				if (f.reproducibility == null) f.reproducibility = scored.reproducibility;
			}

			for (const mission of linkedMissions) prepareMissionOutcome(mission,{status:'completed'});
			const quality = calculateMissionQuality(findings,{session,executionStatus:'completed'});
			let finalizedCount = 0;

			for (const mission of linkedMissions) {
				const report = buildImprovementPrompt(mission, findings, quality);
				recordIteration(mission.id, {
					sessionId: session.id,
					findings,
					qualityScore: quality.score,
					verdict: quality.verdict,
					releaseReady: quality.releaseReady,
					improvementPrompt: report.improvementPrompt
				});
				finalizeMission(mission.id, {
					status: 'completed',
					qualityScore: quality.score,
					verdict: quality.verdict,
					improvementPrompt: report.improvementPrompt,
					releaseReady: quality.releaseReady,
					findings,
					summary: session.report?.summary || null
				});
				finalizedCount++;
			}

			emitProgress(session, 'mission_finalize', 'done',
				`Finalized ${finalizedCount} mission${finalizedCount === 1 ? '' : 's'} — Score: ${quality.score}, Verdict: ${quality.verdict}`,
				{ missionsFinalized: finalizedCount, qualityScore: quality.score, verdict: quality.verdict });

			// Emit on missionBus so index.js can fire webhooks
			for (const mission of linkedMissions) {
				const report = buildImprovementPrompt(mission, findings, quality);
				missionBus.emit('finalized', { missionId: mission.id, report, quality });
			}

			return { missionResult: { quality, finalizedCount, linkedMissions } };
		}
	});

	// Capability 8: Decision Engine (Phase 4)
	registry.register({
		id: 'decision_engine',
		name: 'Decision Engine',
		category: 'decision',
		dependsOn: ['mission_finalize'],
		requiredEvidence: [],
		producesEvidence: ['decision'],
		enabled: () => true,
		confidence: 0.95,
		cost: 'low',
		async execute(session, evidence, config) {
			// Find the linked mission
			const linkedMissions = listMissions({}).filter(m => m.sessionId === session.id);
			const mission = linkedMissions[0] ?? null;

			// Build the decision from all available evidence
			const decision = makeDecisionSafe(session, evidence, mission);

			// Emit progress
			const isTerminal = TERMINAL_DECISIONS.has(decision.decision);
			emitProgress(session, 'decision_engine', 'done',
				`Decision: ${decision.decision} — ${decision.reason.slice(0, 120)}`,
				{
					decision: decision.decision,
					confidence: decision.confidence,
					reason: decision.reason,
					terminal: isTerminal,
					factors: decision.factors,
					recommendedAction: decision.recommendedAction
				});

			return { decision };
		}
	});

	// Capability 9: Knowledge Write (Phase 3 Enhanced)
	registry.register({
		id: 'knowledge_write',
		name: 'Write Knowledge Patterns',
		category: 'extraction',
		dependsOn: ['decision_engine'],
		requiredEvidence: [],
		producesEvidence: ['knowledgePatterns'],
		enabled: () => true,
		confidence: 0.85,
		cost: 'low',
		async execute(session, evidence, config) {
			const findings = session.findings ?? [];
			const missionResult = evidence.missionResult;
			const linkedMissions = missionResult?.linkedMissions ?? [];
			const missionForKnowledge = linkedMissions[0];

			// Phase 3: Validate patterns that were surfaced before this mission
			const patternsUsed = session.knowledgePatternsUsed || [];
			let validationResults = [];
			let conflicts = [];
			if (patternsUsed.length > 0) {
				// Re-fetch the pattern objects by ID using the ESM import
				const relevantPatterns = patternsUsed.map(id => getPatternById(id)).filter(Boolean);

				if (relevantPatterns.length > 0) {
					validationResults = validateKnowledge(relevantPatterns, session, missionForKnowledge?.id || session.id);
					conflicts = detectKnowledgeConflicts(relevantPatterns, session.appModel || evidence.appModel, findings);
					if (validationResults.length > 0 || conflicts.length > 0) {
						console.log(`[knowledge] Validated ${validationResults.length} patterns, found ${conflicts.length} conflicts for session ${session.id}`);
					}
				}
			}

			// Write new knowledge from findings
			if (findings.length === 0 || !missionForKnowledge) {
				emitProgress(session, 'knowledge_write', 'skipped', 'No findings or mission');
				return { knowledgePatterns: [], validationResults, conflicts };
			}

			const written = writeKnowledge(findings, session, missionForKnowledge.id);
			if (written.length === 0) {
				emitProgress(session, 'knowledge_write', 'skipped', 'No notable findings');
				return { knowledgePatterns: [], validationResults, conflicts };
			}

			emitProgress(session, 'knowledge_write', 'done',
				`Learned ${written.length} pattern${written.length === 1 ? '' : 's'} (${written.filter(w => w.action === 'created').length} new), validated ${validationResults.length}, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`,
				{
					patternsWritten: written.length,
					newPatterns: written.filter(w => w.action === 'created').length,
					accumulated: written.filter(w => w.action === 'accumulated').length,
					validatedPatterns: validationResults.length,
					conflictsDetected: conflicts.length
				});

			return { knowledgePatterns: written, validationResults, conflicts };
		}
	});

	return registry;
}

/* ── Default Orchestrator Instance ──────────────────────────────── */

const defaultRegistry = createDefaultRegistry();
const defaultOrchestrator = new Orchestrator(defaultRegistry);

/**
 * Runs the full autonomy pipeline via the Orchestrator.
 * This replaces the original runAutonomyPipeline function in pipeline.js
 * but produces identical behavior and result shapes.
 *
 * Phase 1 reliability: idempotency guard prevents concurrent or duplicate
 * pipeline executions for the same session. A session whose pipeline
 * already ran successfully returns the cached result.
 */
export async function runAutonomyPipeline(session, options = {}) {
	// Idempotency guard — prevent duplicate/concurrent pipeline runs
	if (session._pipelineRunning) {
		if (options.force) {
			// Forced re-run (e.g. from run-pipeline endpoint): wait for the
			// current one to finish, then re-read the result if it succeeded.
			// This is a safety valve, not a normal path.
			console.warn(`[pipeline] Session ${session.id} pipeline already running, force=true — waiting for completion`);
			// Wait up to 5 minutes for the existing run
			for (let i = 0; i < 60; i++) {
				if (!session._pipelineRunning) break;
				await new Promise(r => setTimeout(r, 5000));
			}
		} else {
			// Already ran or running — return cached result if available
			if (session.pipeline?.completedAt) {
				return { summary: session.pipeline.summary, stages: session.pipeline.stages };
			}
			// Running but not yet complete — wait for it
			console.warn(`[pipeline] Session ${session.id} pipeline already running, waiting…`);
			for (let i = 0; i < 60; i++) {
				if (!session._pipelineRunning) break;
				await new Promise(r => setTimeout(r, 5000));
			}
			if (session.pipeline?.completedAt) {
				return { summary: session.pipeline.summary, stages: session.pipeline.stages };
			}
		}
	}

	// If already completed and not forced, return cached
	if (session.pipeline?.completedAt && !options.force) {
		return { summary: session.pipeline.summary, stages: session.pipeline.stages };
	}

	session._pipelineRunning = true;
	const startedAt = Date.now();

	try {
		const config = getConfig();
		const { results, evidence } = await defaultOrchestrator.execute(session, config, options);

		// Extract structured data for UI mission summary bar
		const appUnderstandingResult = results.application_understanding?.result ?? null;
		const featureGapResult = results.feature_gap?.result ?? null;
		const devIntelResult = results.dev_intelligence?.result ?? null;
		const missionFinalizeResult = results.mission_finalize?.result ?? null;
		const decisionEngineResult = results.decision_engine?.result ?? null;
		const qualityScore = missionFinalizeResult?.qualityScore ?? missionFinalizeResult?.missionResult?.quality?.score ?? null;
		const releaseReady = missionFinalizeResult?.missionResult?.quality?.releaseReady ?? false;
		const gaps = featureGapResult?.featureGaps ?? featureGapResult?.gapAnalysis?.gaps ?? [];
		// Purpose now comes from the Application Model when available
		const appModelSummary = appUnderstandingResult?.appModelSummary ?? null;
		const purpose = appModelSummary?.purpose ?? featureGapResult?.gapAnalysis?.purpose ?? featureGapResult?.purpose ?? null;
		const appType = appModelSummary?.applicationType
			?? featureGapResult?.gapAnalysis?.inventory?.appType
			?? purpose?.name
			?? devIntelResult?.summary?.appType
			?? 'Unknown';
		const findings = session.findings ?? [];
		const criticalCount = findings.filter(f => f.severity === 'critical').length;

		// Build the summary object for backward compat with pipeline.js consumers
		const summary = {
			workflowId: results.workflow_save?.result?.workflowId ?? null,
			testCaseCount: results.test_generation?.result?.count ?? 0,
			smokeResults: results.smoke_run?.result ?? null,
			scheduleId: results.schedule_create?.result?.scheduleId ?? null,
			devIntelligence: devIntelResult,
			featureGaps: featureGapResult,
			knowledgeWrite: results.knowledge_write?.result ?? null,
				// Phase 2: Application Understanding data
				appUnderstanding: appModelSummary,
				// Phase 3: Knowledge data
				knowledgeValidation: results.knowledge_write?.result?.validationResults ?? [],
				knowledgeConflicts: results.knowledge_write?.result?.conflicts ?? [],
				knowledgeHintsInjected: session.knowledgeHints?.length ?? 0,
			// Phase 4: Decision Engine data
			decision: decisionEngineResult?.decision ?? null,
			// Enriched fields for the AI-first Mission Summary Bar
			qualityScore,
			releaseReady,
			appType,
			purpose: purpose ? (purpose.name ?? purpose) : null,
			confidence: purpose?.confidence ?? appModelSummary?.confidence?.purpose ?? 0,
			criticalIssues: criticalCount,
			featureGapsCount: Array.isArray(gaps) ? gaps.length : 0,
			findings
		};

		session.pipeline = {
			stages: results,
			completedAt: Date.now(),
			summary
		};
		emit(session, 'pipeline_complete', { summary, stages: results });

		return { summary, stages: results };
	} catch (error) {
		// The pipeline itself threw (orchestrator-level, not per-capability).
		// Record the failure on the session so consumers know.
		const wrapped = wrapError(error, { phase: 'pipeline' });
		session.pipeline = {
			stages: {},
			completedAt: Date.now(),
			error: wrapped.message,
			errorType: wrapped.errorType
		};
		emit(session, 'pipeline_error', { error: wrapped.message, errorType: wrapped.errorType });
		throw wrapped;
	} finally {
		session._pipelineRunning = false;
		// B2 — the deterministic close-out flag is cleared on ANY pipeline
		// exit (success, per-stage failures, or throw) so bounded waiters in
		// finalizeMissionFromSession don't hold a mission hostage behind a
		// dead flag.
		if (session._closeOutPipeline) {
			session._closeOutPipeline = false;
		}
	}
}

// Export for testing and external use
export { CapabilityRegistry, Orchestrator, createDefaultRegistry, defaultRegistry, defaultOrchestrator, STAGE_INFO };
