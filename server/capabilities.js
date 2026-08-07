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
import { createSchedule } from './scheduler.js';
import { runTestSuite } from './replay.js';
import { analyzeSessionFindings, scoreFindingQuality, calculateMissionQuality, buildImprovementPrompt } from './devIntelligence.js';
import { listMissions, finalizeMission, recordIteration } from './missions.js';
import { missionBus } from './missions.js';
import { analyzeFeatureGaps, enhanceGapsWithLLM, gapsToFindings } from './featureGap.js';
import { syncSessionFinding } from './findings.js';

/* ── Pipeline Stage Info (shared with pipeline.js) ──────────────── */

const STAGE_INFO = {
	workflow_save:    { icon: '📋', label: 'Workflow' },
	test_generation:  { icon: '🧪', label: 'Tests' },
	smoke_run:        { icon: '💨', label: 'Smoke' },
	schedule_create:  { icon: '📅', label: 'Schedule' },
	dev_intelligence: { icon: '🧠', label: 'Dev Report' },
	feature_gap:      { icon: '🔍', label: 'Feature Gaps' },
	mission_finalize: { icon: '🎯', label: 'Mission' },
	knowledge_write:  { icon: '📚', label: 'Knowledge' }
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
	 */
	async execute(session, config) {
		const allCaps = this.registry.list();
		const evidence = {};

		// Determine which capabilities are enabled
		const enabledIds = allCaps
			.filter(cap => cap.enabled(config, evidence))
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
				const result = await cap.execute(session, evidence, config);
				results[cap.id] = { status: 'done', result };

				// Collect produced evidence
				for (const evidenceKey of cap.producesEvidence ?? []) {
					if (result?.[evidenceKey] !== undefined) {
						evidence[evidenceKey] = result[evidenceKey];
					}
				}
			} catch (error) {
				results[cap.id] = { status: 'failed', error: error.message };
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
			const testCases = createTestCases(raw, {
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
		name: 'Create Regression Schedule',
		category: 'generation',
		dependsOn: ['test_generation'],
		requiredEvidence: ['testCases'],
		producesEvidence: ['schedule'],
		enabled: (config) => config.autoCreateSchedule !== false,
		confidence: 0.9,
		cost: 'low',
		async execute(session, evidence, config) {
			const testCases = evidence.testCases ?? [];
			if (testCases.length === 0) {
				emitProgress(session, 'schedule_create', 'skipped', 'No test cases');
				return { schedule: null };
			}
			const cron = config.defaultScheduleCron || '0 9 * * *';
			const schedule = createSchedule({
				name: `Auto: ${session.targetUrl || 'Regression'}`,
				cronExpr: cron,
				testCaseIds: testCases.map(tc => tc.id),
				targetUrl: session.targetUrl,
				projectId: session.projectId
			});
			const nextStr = schedule.nextRun ? new Date(schedule.nextRun).toLocaleString() : 'unknown';
			emitProgress(session, 'schedule_create', 'done', `Created "${schedule.name}" — next run: ${nextStr}`, { scheduleId: schedule.id, nextRun: schedule.nextRun });
			return { schedule, scheduleId: schedule.id, nextRun: schedule.nextRun };
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

	// Capability 6: Feature Gap Analysis
	registry.register({
		id: 'feature_gap',
		name: 'Feature Gap Analysis',
		category: 'analysis',
		dependsOn: [],
		requiredEvidence: [],
		producesEvidence: ['featureGaps'],
		enabled: (config) => config.autoFeatureGap !== false,
		confidence: 0.6,
		cost: 'medium',
		async execute(session, evidence, config) {
			// Find linked mission for context
			const linkedMission = listMissions({}).find(m => m.sessionId === session.id);
			const missionContext = linkedMission?.context || null;

			// Knowledge query — surface known patterns before analysis
			const { queryKnowledge, detectAppMetadata } = await import('./knowledge.js');
			const appMeta = detectAppMetadata(session);
			const knowledgeResult = queryKnowledge(appMeta);

			const gapAnalysis = analyzeFeatureGaps(session, missionContext);

			let gaps = gapAnalysis.gaps;
			if (config.model && config.baseUrl) {
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

			const findings = session.findings ?? [];
			for (const f of findings) {
				const scored = scoreFindingQuality(f, findings);
				if (f.confidence == null) f.confidence = scored.confidence;
				if (f.isDuplicate == null) f.isDuplicate = scored.isDuplicate;
				if (f.duplicateOf == null && scored.duplicateOf) f.duplicateOf = scored.duplicateOf;
				if (f.reproducibility == null) f.reproducibility = scored.reproducibility;
			}

			const quality = calculateMissionQuality(findings);
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

	// Capability 8: Knowledge Write
	registry.register({
		id: 'knowledge_write',
		name: 'Write Knowledge Patterns',
		category: 'extraction',
		dependsOn: ['mission_finalize'],
		requiredEvidence: [],
		producesEvidence: ['knowledgePatterns'],
		enabled: () => true,
		confidence: 0.85,
		cost: 'low',
		async execute(session, evidence, config) {
			const { writeKnowledge } = await import('./knowledge.js');
			const findings = session.findings ?? [];
			const missionResult = evidence.missionResult;
			const linkedMissions = missionResult?.linkedMissions ?? [];
			const missionForKnowledge = linkedMissions[0];

			if (findings.length === 0 || !missionForKnowledge) {
				emitProgress(session, 'knowledge_write', 'skipped', 'No findings or mission');
				return { knowledgePatterns: [] };
			}

			const written = writeKnowledge(findings, session, missionForKnowledge.id);
			if (written.length === 0) {
				emitProgress(session, 'knowledge_write', 'skipped', 'No notable findings');
				return { knowledgePatterns: [] };
			}

			emitProgress(session, 'knowledge_write', 'done',
				`Learned ${written.length} pattern${written.length === 1 ? '' : 's'} (${written.filter(w => w.action === 'created').length} new)`,
				{
					patternsWritten: written.length,
					newPatterns: written.filter(w => w.action === 'created').length,
					accumulated: written.filter(w => w.action === 'accumulated').length
				});

			return { knowledgePatterns: written };
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
 */
export async function runAutonomyPipeline(session, options = {}) {
	const config = getConfig();
	const { results, evidence } = await defaultOrchestrator.execute(session, config);

	// Extract structured data for UI mission summary bar
	const featureGapResult = results.feature_gap?.result ?? null;
	const devIntelResult = results.dev_intelligence?.result ?? null;
	const missionFinalizeResult = results.mission_finalize?.result ?? null;
	const qualityScore = missionFinalizeResult?.qualityScore ?? null;
	const releaseReady = missionFinalizeResult?.releaseReady ?? false;
	const gaps = featureGapResult?.featureGaps ?? featureGapResult?.gapAnalysis?.gaps ?? [];
	const purpose = featureGapResult?.gapAnalysis?.purpose ?? featureGapResult?.purpose ?? null;
	const appType = featureGapResult?.gapAnalysis?.inventory?.appType
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
		// Enriched fields for the AI-first Mission Summary Bar
		qualityScore,
		releaseReady,
		appType,
		purpose: purpose ? (purpose.name ?? purpose) : null,
		confidence: purpose?.confidence ?? 0,
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
}

// Export for testing and external use
export { CapabilityRegistry, Orchestrator, createDefaultRegistry, defaultRegistry, defaultOrchestrator, STAGE_INFO };
