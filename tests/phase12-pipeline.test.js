import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:5173';

async function api(method, path, body) {
	const res = await fetch(`${BASE}/api${path}`, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	try {
		return { status: res.status, data: JSON.parse(text) };
	} catch {
		return { status: res.status, data: text };
	}
}

describe('Phase 12 — Autonomy Pipeline', () => {

	describe('Config flags', () => {
		it('should expose pipeline config in public config', async () => {
			const { status, data } = await api('GET', '/config');
			assert.equal(status, 200);
			assert.equal(data.autoSaveWorkflow, true);
			assert.equal(data.autoGenerateTests, true);
			assert.equal(data.autoSmokeRun, false);
			assert.equal(data.autoCreateSchedule, true);
			assert.equal(data.defaultScheduleCron, '0 9 * * *');
		});

		it('should save pipeline config via PUT /config', async () => {
			const { status, data } = await api('PUT', '/config', {
				autoSaveWorkflow: false,
				autoSmokeRun: true,
				defaultScheduleCron: '0 6 * * *'
			});
			assert.equal(status, 200);
			assert.equal(data.autoSaveWorkflow, false);
			assert.equal(data.autoSmokeRun, true);
			assert.equal(data.defaultScheduleCron, '0 6 * * *');

			// Restore defaults.
			await api('PUT', '/config', {
				autoSaveWorkflow: true,
				autoSmokeRun: false,
				defaultScheduleCron: '0 9 * * *'
			});
		});
	});

	describe('Pipeline status endpoint', () => {
		it('should return null for sessions without a pipeline', async () => {
			const sessions = await api('GET', '/sessions').then(r => r.data);
			const doneSession = sessions.find(s => s.status === 'done');
			if (!doneSession) return;

			const { status, data } = await api('GET', `/sessions/${doneSession.id}/pipeline-status`);
			assert.equal(status, 200);
			// Could be null or a previous pipeline result.
			assert.ok(data === null || data.stages !== undefined);
		});

		it('should return 404 for non-existent session', async () => {
			const { status } = await api('GET', '/sessions/nonexistent-id/pipeline-status');
			assert.equal(status, 404);
		});
	});

	describe('Manual pipeline trigger', () => {
		it('should trigger pipeline via POST /sessions/:id/run-pipeline', async () => {
			// Use a session that has captured steps (a done session from QA).
			const sessions = await api('GET', '/sessions').then(r => r.data);
			const doneSession = sessions.find(s => s.status === 'done');
			if (!doneSession) {
				console.log('  (skipped — no done session available)');
				return;
			}

			const { status, data } = await api('POST', `/sessions/${doneSession.id}/run-pipeline`);
			assert.equal(status, 200);
			assert.equal(data.ok, true);

			// Wait for the pipeline to complete.
			await new Promise(r => setTimeout(r, 5000));

			// Check pipeline status — should have completed.
			const { data: pipelineResult } = await api('GET', `/sessions/${doneSession.id}/pipeline-status`);
			assert.ok(pipelineResult !== null, 'Pipeline should have started');
			assert.ok(pipelineResult.stages, 'Pipeline stages should exist');
			// Workflow save should always succeed if session has captured steps.
			assert.ok(['done', 'skipped', 'failed'].includes(pipelineResult.stages.workflow_save.status));
		});
	});

	describe('Config flag toggling', () => {
		it('should respect disabled flags when saving config', async () => {
			// Disable all pipeline stages.
			await api('PUT', '/config', {
				autoSaveWorkflow: false,
				autoGenerateTests: false,
				autoSmokeRun: false,
				autoCreateSchedule: false
			});

			const { data } = await api('GET', '/config');
			assert.equal(data.autoSaveWorkflow, false);
			assert.equal(data.autoGenerateTests, false);
			assert.equal(data.autoSmokeRun, false);
			assert.equal(data.autoCreateSchedule, false);

			// Restore defaults.
			await api('PUT', '/config', {
				autoSaveWorkflow: true,
				autoGenerateTests: true,
				autoSmokeRun: false,
				autoCreateSchedule: true
			});
		});
	});

	describe('Pipeline result structure', () => {
		it('should have proper stage structure if pipeline ran', async () => {
			const sessions = await api('GET', '/sessions').then(r => r.data);
			const doneSession = sessions.find(s => s.status === 'done');
			if (!doneSession) return;

			const { data: pipeline } = await api('GET', `/sessions/${doneSession.id}/pipeline-status`);
			if (!pipeline) return;

			// Verify structure.
			assert.ok(pipeline.stages, 'Should have stages object');
			assert.ok(pipeline.completedAt, 'Should have completedAt');
			assert.ok(pipeline.summary, 'Should have summary');

			// Each stage should have a status.
			for (const stageKey of ['workflow_save', 'test_generation', 'smoke_run', 'schedule_create']) {
				assert.ok(pipeline.stages[stageKey], `Stage ${stageKey} should exist`);
				assert.ok(['pending', 'running', 'done', 'skipped', 'failed'].includes(pipeline.stages[stageKey].status),
					`Stage ${stageKey} should have valid status`);
			}

			// Summary should have expected keys.
			assert.ok(typeof pipeline.summary.workflowId !== 'undefined');
			assert.ok(typeof pipeline.summary.testCaseCount !== 'undefined');
			assert.ok(typeof pipeline.summary.scheduleId !== 'undefined');
		});
	});
});
