import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'qase-startup-health-'));
process.env.QASE_DATA_DIR = scratch;

const health = await import('../server/executionHealth.js');
const artifacts = await import('../server/artifactStore.js');
const evidence = await import('../server/evidenceGraph.js');

test.after(() => rmSync(scratch, { recursive: true, force: true }));

function initial() {
	return health.createExecutionHealth({ provider: 'custom', executionProvider: 'local' });
}

test('startup credential rejection is provider-specific, terminal, and never retried', async () => {
	let calls = 0;
	const result = await health.runWithBoundedExecutionRetries(async () => {
		calls += 1;
		const error = new Error('Provider request failed with status code 401; api_key=unit-secret-value');
		error.cause = { response: { status: 401 } };
		throw error;
	}, { health: initial(), context: { stage: 'runtime_start' }, retryDelayMs: 0 });

	assert.equal(calls, 1);
	assert.equal(result.ok, false);
	assert.equal(result.issue.category, 'provider_credentials');
	assert.equal(result.issue.code, 'PROVIDER_AUTH_FAILED');
	assert.equal(result.issue.retryable, false);
	assert.equal(result.health.components.provider, 'failed');
	assert.equal(result.health.components.worker, 'blocked');
	assert.equal(result.health.components.browser, 'pending');
	assert.equal(result.health.components.target, 'pending');
	assert.match(result.issue.nextAction, /Settings/i);
	assert.doesNotMatch(JSON.stringify(result.health), /unit-secret-value/);
});

test('first provider request credential rejection blocks the worker before browser launch', () => {
	const issue = health.classifyExecutionFailure(
		Object.assign(new Error('Unauthorized provider response'), { status: 401 }),
		{ stage: 'agent_turn' }
	);
	const result = health.applyExecutionFailure(initial(), issue, { terminal: true, retryAttempt: 0, maxRetries: 2 });
	assert.equal(result.components.provider, 'failed');
	assert.equal(result.components.worker, 'blocked');
	assert.equal(result.components.browser, 'pending');
	assert.equal(result.components.target, 'pending');
});

test('startup connection failure is attributed to the model provider', () => {
	const issue = health.classifyExecutionFailure(new Error('fetch failed: ECONNRESET'), { stage: 'runtime_start' });
	assert.equal(issue.category, 'llm_provider');
	assert.equal(issue.code, 'PROVIDER_CONNECTION_FAILED');
	assert.equal(issue.retryable, true);
});

test('every index launch path delegates startup handling to the centralized runner', () => {
	const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /ensureRuntime\(session\)/, 'index must not pre-start runtimes outside the shared policy');
	assert.match(source, /runWithBoundedExecutionRetries\(/);
	assert.doesNotMatch(source, /Agent runtime failed to start:/, 'raw ad-hoc startup error handling must not return');
});

test('transient startup failure retries to the shared limit then reports exhaustion', async () => {
	let calls = 0;
	const states = [];
	const result = await health.runWithBoundedExecutionRetries(async () => {
		calls += 1;
		throw Object.assign(new Error('Temporary gateway failure, HTTP 503'), { status: 503 });
	}, {
		health: initial(), context: { stage: 'runtime_start' }, retryDelayMs: 0,
		onTransition: transition => states.push(structuredClone(transition.health))
	});

	assert.equal(calls, health.EXECUTION_RETRY_LIMIT + 1, 'initial attempt plus two retries');
	assert.deepEqual(states.map(state => state.overall), ['retrying', 'retrying', 'failed']);
	assert.deepEqual(states.map(state => state.lastIssue.retry.attempt), [1, 2, 2]);
	assert.equal(states[0].lastIssue.retry.maxAttempts, 2);
	assert.equal(states[0].lastIssue.retry.nextAttempt, 1);
	assert.equal(states[2].lastIssue.retry.willRetry, false);
	assert.equal(states[2].lastIssue.retry.exhausted, true);
	assert.equal(states[2].components.provider, 'failed');
	assert.equal(states[2].components.worker, 'blocked');
	assert.equal(states[2].components.browser, 'pending');
	assert.equal(states[2].components.target, 'pending');
});

test('a successful startup remains unchanged and emits no failure transition', async () => {
	let transitions = 0;
	const start = initial();
	const result = await health.runWithBoundedExecutionRetries(async () => 'started', {
		health: start, retryDelayMs: 0, onTransition: () => { transitions += 1; }
	});
	assert.equal(result.ok, true);
	assert.equal(result.result, 'started');
	assert.equal(result.health, start);
	assert.equal(transitions, 0);
});

test('provider failure after screenshot evidence preserves linked, retrievable bytes', async () => {
	const sessionId = 'startup-evidence-session';
	const missionId = 'startup-evidence-mission';
	const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
	const artifact = artifacts.persistScreenshotArtifact({
		sessionId, missionId, stepId: 'shot-1', toolCallId: 'tool-1',
		base64, url: 'https://target.example/login', title: 'Login'
	});
	assert.equal(artifact.persisted, true);

	const session = {
		id: sessionId, capturedSteps: [{
			id: 'shot-1', toolCallId: 'tool-1', action: 'screenshot',
			url: 'https://target.example/login', ts: Date.now(),
			outcome: { status: 'success' },
			screenshot: { captureAttempted: true, persisted: true, status: 'persisted', artifactId: artifact.artifactId, bytes: artifact.bytes, capturedAt: artifact.capturedAt }
		}], findings: []
	};
	evidence.collectSessionEvidence(session, { id: missionId }, 1);
	const beforeSteps = structuredClone(session.capturedSteps);

	const result = await health.runWithBoundedExecutionRetries(async () => {
		throw new Error('Connection reset by provider');
	}, { health: initial(), context: { stage: 'agent_turn' }, maxRetries: 0, retryDelayMs: 0 });

	assert.equal(result.ok, false);
	assert.deepEqual(session.capturedSteps, beforeSteps, 'failure transition must not mutate captured evidence');
	assert.ok(artifacts.getArtifact(artifact.artifactId), 'screenshot remains retrievable');
	const linked = evidence.getSessionEvidence(sessionId);
	assert.equal(linked.length, 1);
	assert.equal(linked[0].metadata.artifact.id, artifact.artifactId);
	assert.equal(linked[0].missionId, missionId);
});
