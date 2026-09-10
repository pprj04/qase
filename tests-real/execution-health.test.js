import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createExecutionHealth,
	markExecutionComponent,
	completeExecutionHealth,
	classifyExecutionFailure,
	applyExecutionFailure,
	shouldRetryExecutionFailure,
	sanitizeDiagnostic
} from '../server/executionHealth.js';

test('generic agent connection error is attributed to the model provider', () => {
	const issue = classifyExecutionFailure(new Error('Connection error.'), { stage: 'agent_turn' });
	assert.equal(issue.category, 'llm_provider');
	assert.equal(issue.code, 'PROVIDER_CONNECTION_FAILED');
	assert.equal(issue.retryable, true);
	assert.doesNotMatch(issue.summary, /application failed/i);
});

test('provider authentication and rate limits have distinct categories', () => {
	assert.equal(classifyExecutionFailure({ message: 'Unauthorized', status: 401 }, { stage: 'provider' }).category, 'provider_credentials');
	assert.equal(classifyExecutionFailure({ message: 'Too many requests', status: 429 }, { stage: 'provider' }).category, 'rate_limit');
	assert.equal(shouldRetryExecutionFailure(classifyExecutionFailure({ message: 'Unauthorized', status: 401 }, { stage: 'runtime_start' })), false);
	assert.equal(shouldRetryExecutionFailure(classifyExecutionFailure({ message: 'Too many requests', status: 429 }, { stage: 'runtime_start' })), true);
});

test('target DNS failure is not blamed on QASE or the model', () => {
	const issue = classifyExecutionFailure(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED'), {
		stage: 'browser_tool', toolName: 'browser_open'
	});
	assert.equal(issue.category, 'target_network');
	assert.equal(issue.code, 'TARGET_UNREACHABLE');
});

test('BrowserStack launch failures retain provider attribution', () => {
	const issue = classifyExecutionFailure(new Error('CDP handshake connection refused'), {
		stage: 'runtime_start', executionProvider: 'browserstack'
	});
	assert.equal(issue.category, 'browserstack');
});

test('retry state and terminal state are explicit', () => {
	const health = createExecutionHealth({ provider: 'custom' });
	const issue = classifyExecutionFailure(new Error('Connection error.'), { stage: 'agent_turn' });
	const retrying = applyExecutionFailure(health, issue, { terminal: false, retryAttempt: 0, maxRetries: 2 });
	assert.equal(retrying.overall, 'retrying');
	assert.equal(retrying.components.provider, 'degraded');
	assert.equal(retrying.lastIssue.retry.willRetry, true);
	const failed = applyExecutionFailure(retrying, issue, { terminal: true, retryAttempt: 2, maxRetries: 2 });
	assert.equal(failed.overall, 'failed');
	assert.equal(failed.components.provider, 'failed');
});

test('a recovered provider and completed run clear unhealthy overall state', () => {
	const health = createExecutionHealth({ provider: 'custom' });
	const issue = classifyExecutionFailure(new Error('Connection error.'), { stage: 'agent_turn' });
	const retrying = applyExecutionFailure(health, issue, { terminal: false, retryAttempt: 0, maxRetries: 2 });
	const recovered = markExecutionComponent(retrying, 'provider', 'healthy');
	assert.equal(recovered.overall, 'running');
	const complete = completeExecutionHealth(recovered);
	assert.equal(complete.overall, 'healthy');
	assert.equal(complete.failure, null);
});

test('diagnostics redact credentials and URL tokens', () => {
	const safe = sanitizeDiagnostic('Authorization: Bearer abc123 token=supersecret https://x.test/?key=rawvalue');
	assert.doesNotMatch(safe, /abc123|supersecret|rawvalue/);
	assert.match(safe, /••••••/);
});
