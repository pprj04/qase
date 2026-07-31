/**
 * Autonomy Pipeline (Phase 12)
 *
 * Chains the 4 post-report stages automatically so a finished QA session
 * produces workflows, test cases, optional smoke validation, and a regression
 * schedule with zero human intervention.
 *
 * Stages:
 *   1. workflow_save    — auto-save captured steps as a named workflow
 *   2. test_generation  — generate structured test cases via LLM
 *   3. smoke_run        — quick single-thread validation run (off by default)
 *   4. schedule_create  — create a daily regression schedule
 *   5. dev_intelligence — per-finding root cause + app-level improvement report
 *
 * Each stage is independently skippable via config. Failures in one stage do
 * not block subsequent stages. All progress is emitted as SSE events and
 * persisted on the session object.
 */

import { saveWorkflow } from './workflows.js';
import { createTestCases } from './testCases.js';
import { generateTestCasesFromWorkflow } from './testGen.js';
import { createSchedule } from './scheduler.js';
import { runTestSuite } from './replay.js';
import { getConfig } from './config.js';
import { emit } from './store.js';
import { analyzeSessionFindings } from './devIntelligence.js';

const STAGE_INFO = {
	workflow_save:   { icon: '📋', label: 'Workflow' },
	test_generation: { icon: '🧪', label: 'Tests' },
	smoke_run:       { icon: '💨', label: 'Smoke' },
	schedule_create: { icon: '📅', label: 'Schedule' },
	dev_intelligence:{ icon: '🧠', label: 'Dev Report' }
};

/**
 * Emits a pipeline_progress SSE event for a single stage.
 */
function emitProgress(session, stage, status, detail, result) {
	emit(session, 'pipeline_progress', { stage, status, detail, result });
}

/**
 * The main pipeline entry point. Fire-and-forget after finish_qa_report.
 *
 * @param {object} session  — the full session object (must include id, capturedSteps, findings, targetUrl, projectId)
 * @param {object} options  — optional overrides (force: true to re-run)
 */
export async function runAutonomyPipeline(session, options = {}) {
	const config = getConfig();

	const stages = [
		{ key: 'workflow_save',   enabled: config.autoSaveWorkflow !== false },
		{ key: 'test_generation', enabled: config.autoGenerateTests !== false },
		{ key: 'smoke_run',       enabled: config.autoSmokeRun === true }, // default OFF
		{ key: 'schedule_create', enabled: config.autoCreateSchedule !== false },
		{ key: 'dev_intelligence',enabled: config.autoDevReport !== false }
	];

	// Emit start event.
	emit(session, 'pipeline_start', {
		stages: stages.map(s => ({ ...s, ...STAGE_INFO[s.key] }))
	});

	const results = {
		workflow_save:    { status: 'pending' },
		test_generation:  { status: 'pending' },
		smoke_run:        { status: 'pending' },
		schedule_create:  { status: 'pending' },
		dev_intelligence: { status: 'pending' }
	};

	let savedWorkflow = null;
	let generatedTestCases = [];

	// ── Stage 1: Auto-Save Workflow ─────────────────────────────────
	if (stages[0].enabled) {
		try {
			const capturedSteps = session.capturedSteps ?? [];
			if (capturedSteps.length === 0) {
				results.workflow_save = { status: 'skipped', reason: 'no_captured_steps' };
				emitProgress(session, 'workflow_save', 'skipped', 'No captured steps to save');
				// No workflow means we can't generate tests or schedule.
				results.test_generation = { status: 'skipped', reason: 'no_workflow' };
				results.smoke_run = { status: 'skipped', reason: 'no_workflow' };
				results.schedule_create = { status: 'skipped', reason: 'no_workflow' };
				return finalizePipeline(session, results, options);
			}

			emitProgress(session, 'workflow_save', 'running', `Saving ${capturedSteps.length} steps…`);

			const name = `Auto: ${session.targetUrl || 'Untitled'}`;
			savedWorkflow = saveWorkflow(session, { name });
			results.workflow_save = {
				status: 'done',
				result: { workflowId: savedWorkflow.id, stepCount: savedWorkflow.steps.length }
			};
			emitProgress(session, 'workflow_save', 'done', `Saved "${savedWorkflow.name}" (${savedWorkflow.steps.length} steps)`, results.workflow_save.result);
		} catch (error) {
			results.workflow_save = { status: 'failed', error: error.message };
			emitProgress(session, 'workflow_save', 'failed', error.message);
			// No workflow → can't proceed with test gen.
			results.test_generation = { status: 'skipped', reason: 'workflow_save_failed' };
			results.smoke_run = { status: 'skipped', reason: 'workflow_save_failed' };
			results.schedule_create = { status: 'skipped', reason: 'workflow_save_failed' };
			return finalizePipeline(session, results, options);
		}
	} else {
		results.workflow_save = { status: 'skipped', reason: 'disabled' };
		emitProgress(session, 'workflow_save', 'skipped', 'Auto-save disabled');
	}

	// ── Stage 2: Auto-Generate Test Cases ───────────────────────────
	if (stages[1].enabled && savedWorkflow) {
		try {
			emitProgress(session, 'test_generation', 'running', 'Generating test cases via LLM…');

			const findings = session.findings ?? [];
			const rawTestCases = await generateTestCasesFromWorkflow(savedWorkflow, findings);

			generatedTestCases = createTestCases(rawTestCases, {
				projectId: session.projectId,
				workflowId: savedWorkflow.id,
				targetUrl: session.targetUrl
			});

			results.test_generation = {
				status: 'done',
				result: { count: generatedTestCases.length, ids: generatedTestCases.map(tc => tc.id) }
			};
			emitProgress(session, 'test_generation', 'done', `Generated ${generatedTestCases.length} test case${generatedTestCases.length === 1 ? '' : 's'}`, results.test_generation.result);
		} catch (error) {
			results.test_generation = { status: 'failed', error: error.message };
			emitProgress(session, 'test_generation', 'failed', error.message);
			// No tests → can't smoke run or schedule.
			results.smoke_run = { status: 'skipped', reason: 'test_generation_failed' };
			results.schedule_create = { status: 'skipped', reason: 'test_generation_failed' };
			return finalizePipeline(session, results, options);
		}
	} else if (!savedWorkflow) {
		results.test_generation = { status: 'skipped', reason: 'no_workflow' };
	} else {
		results.test_generation = { status: 'skipped', reason: 'disabled' };
		emitProgress(session, 'test_generation', 'skipped', 'Auto-gen disabled');
	}

	// ── Stage 3: Auto Smoke Run (off by default) ────────────────────
	if (stages[2].enabled && generatedTestCases.length > 0) {
		try {
			emitProgress(session, 'smoke_run', 'running', `Validating ${generatedTestCases.length} tests (concurrency=1, retries=0)…`);

			const smokeResult = await runTestSuite(generatedTestCases, {
				credentials: session.credentials ?? {},
				concurrency: 1,
				retries: 0
			});

			results.smoke_run = {
				status: 'done',
				result: {
					passed: smokeResult.passed,
					failed: smokeResult.failed,
					errored: smokeResult.errored,
					total: smokeResult.total
				}
			};
			const detail = `${smokeResult.passed}/${smokeResult.total} passed`;
			emitProgress(session, 'smoke_run', 'done', detail, results.smoke_run.result);
		} catch (error) {
			results.smoke_run = { status: 'failed', error: error.message };
			emitProgress(session, 'smoke_run', 'failed', error.message);
		}
	} else if (generatedTestCases.length === 0) {
		results.smoke_run = { status: 'skipped', reason: 'no_test_cases' };
	} else {
		results.smoke_run = { status: 'skipped', reason: 'disabled' };
		emitProgress(session, 'smoke_run', 'skipped', 'Smoke run disabled (off by default)');
	}

	// ── Stage 4: Auto-Create Schedule ───────────────────────────────
	if (stages[3].enabled && generatedTestCases.length > 0) {
		try {
			const cron = config.defaultScheduleCron || '0 9 * * *';
			const schedule = createSchedule({
				name: `Auto: ${session.targetUrl || 'Regression'}`,
				cronExpr: cron,
				testCaseIds: generatedTestCases.map(tc => tc.id),
				targetUrl: session.targetUrl,
				projectId: session.projectId
			});

			results.schedule_create = {
				status: 'done',
				result: { scheduleId: schedule.id, nextRun: schedule.nextRun }
			};
			const nextRunStr = schedule.nextRun ? new Date(schedule.nextRun).toLocaleString() : 'unknown';
			emitProgress(session, 'schedule_create', 'done', `Created "${schedule.name}" — next run: ${nextRunStr}`, results.schedule_create.result);
		} catch (error) {
			results.schedule_create = { status: 'failed', error: error.message };
			emitProgress(session, 'schedule_create', 'failed', error.message);
		}
	} else if (generatedTestCases.length === 0) {
		results.schedule_create = { status: 'skipped', reason: 'no_test_cases' };
	} else {
		results.schedule_create = { status: 'skipped', reason: 'disabled' };
		emitProgress(session, 'schedule_create', 'skipped', 'Auto-schedule disabled');
	}

	// ── Stage 5: Dev Intelligence Report ────────────────────────────
	if (stages[4].enabled) {
		const findings = session.findings ?? [];
		if (findings.length === 0) {
			results.dev_intelligence = { status: 'skipped', reason: 'no_findings' };
			emitProgress(session, 'dev_intelligence', 'skipped', 'No findings to analyze');
		} else {
			try {
				emitProgress(session, 'dev_intelligence', 'running', `Analyzing ${findings.length} finding${findings.length === 1 ? '' : 's'}…`);
				const dev = await analyzeSessionFindings(findings, { targetUrl: session.targetUrl });
				session.devIntelligence = dev;
				const analyzedCount = dev.results.filter(r => r.status === 'done').length;
				results.dev_intelligence = {
					status: 'done',
					result: {
						findingsAnalyzed: analyzedCount,
						hasAppReport: Boolean(dev.appReport),
						priorityCount: dev.appReport?.priority?.length ?? 0
					}
				};
				emitProgress(session, 'dev_intelligence', 'done', `Analyzed ${analyzedCount} finding${analyzedCount === 1 ? '' : 's'}${dev.appReport ? ' + app report' : ''}`, results.dev_intelligence.result);
			} catch (error) {
				results.dev_intelligence = { status: 'failed', error: error.message };
				emitProgress(session, 'dev_intelligence', 'failed', error.message);
			}
		}
	} else {
		results.dev_intelligence = { status: 'skipped', reason: 'disabled' };
		emitProgress(session, 'dev_intelligence', 'skipped', 'Dev report disabled');
	}

	return finalizePipeline(session, results, options);
}

/**
 * Finalizes the pipeline: stores results on session, emits complete event.
 */
function finalizePipeline(session, results, options) {
	const summary = {
		workflowId: results.workflow_save?.result?.workflowId ?? null,
		testCaseCount: results.test_generation?.result?.count ?? 0,
		smokeResults: results.smoke_run?.result ?? null,
		scheduleId: results.schedule_create?.result?.scheduleId ?? null,
		devIntelligence: results.dev_intelligence?.result ?? null
	};

	// Persist on the session object so it survives reloads (Phase 12C).
	session.pipeline = {
		stages: results,
		completedAt: Date.now(),
		summary
	};
	emit(session, 'pipeline_complete', { summary, stages: results });

	return { summary, stages: results };
}
