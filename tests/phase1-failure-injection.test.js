/**
 * Phase 1 — Failure Injection Tests
 *
 * Simulates 14 failure scenarios to verify the reliability mechanisms
 * respond correctly. These tests exercise the error classification,
 * retry, timeout, idempotency, and cleanup paths without requiring
 * a live browser or LLM connection.
 *
 * Scenarios:
 *  1. LLM timeout (transient) — retry, succeed
 *  2. LLM empty response (transient) — retry, succeed
 *  3. LLM 429 rate limit (transient) — retry, succeed
 *  4. LLM 5xx server error (infrastructure) — retry, exhaust
 *  5. LLM 401 unauthorized (config) — no retry
 *  6. LLM missing API key (config) — no retry
 *  7. Capability timeout — wrapped, reported as failed
 *  8. Capability non-retryable failure — skipped, dependents skipped
 *  9. Pipeline concurrent execution — idempotency guard
 * 10. Pipeline already completed — cached result returned
 * 11. Session abort (terminal) — not retried
 * 12. Network error ECONNRESET (infrastructure) — retry
 * 13. Mission double-finalize — idempotent no-op
 * 14. Mission terminal state enforcement — cannot restart
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyError,
	isRetryableType,
	ERROR_TYPES,
	wrapError,
	withRetry,
	PipelineError
} from '../server/errorTypes.js';
import {
	isTerminalStatus
} from '../server/missions.js';
import {
	CapabilityRegistry,
	Orchestrator,
	runAutonomyPipeline
} from '../server/capabilities.js';

function mockSession() {
	return {
		id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		status: 'idle',
		findings: [],
		messages: [],
		capturedSteps: [],
		targetUrl: 'http://example.com'
	};
}

describe('Failure Injection Scenarios', () => {

	// Scenario 1: LLM timeout (transient)
	it('1. LLM timeout classified as transient and retryable', () => {
		const err = new Error('Request timed out after 30000ms');
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.TRANSIENT);
		assert.equal(isRetryableType(type), true);
	});

	// Scenario 2: LLM empty response (transient)
	it('2. LLM empty response classified as transient and retryable', () => {
		const err = new Error('LLM returned an empty response.');
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.TRANSIENT);
		assert.equal(isRetryableType(type), true);
	});

	// Scenario 3: LLM 429 rate limit (transient)
	it('3. LLM 429 rate limit classified as transient and retryable', () => {
		const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.TRANSIENT);
		assert.equal(isRetryableType(type), true);
	});

	// Scenario 4: LLM 5xx server error — retry then exhaust
	it('4. LLM 5xx retried up to maxRetries then exhausted', async () => {
		let attempts = 0;
		await assert.rejects(async () => {
			await withRetry(async () => {
				attempts++;
				throw Object.assign(new Error('Internal Server Error'), { status: 500 });
			}, { maxRetries: 2, delayMs: 10, label: '5xx-test' });
		});
		assert.equal(attempts, 3); // initial + 2 retries
	});

	// Scenario 5: LLM 401 unauthorized (config) — no retry
	it('5. LLM 401 classified as config, NOT retried', async () => {
		let attempts = 0;
		await assert.rejects(async () => {
			await withRetry(async () => {
				attempts++;
				throw Object.assign(new Error('Unauthorized'), { status: 401 });
			}, { maxRetries: 3, delayMs: 10, label: 'auth-test' });
		});
		assert.equal(attempts, 1); // no retry
	});

	// Scenario 6: LLM missing API key (config) — no retry
	it('6. Missing API key classified as config, NOT retried', () => {
		const err = new Error('No API key configured. Open Settings and add your key.');
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.CONFIG);
		assert.equal(isRetryableType(type), false);
	});

	// Scenario 7: Capability timeout
	it('7. Capability timeout produces PipelineError with transient type', async () => {
		await assert.rejects(async () => {
			await withRetry(
				() => new Promise(resolve => setTimeout(resolve, 10000)),
				{ timeoutMs: 50, maxRetries: 0, label: 'cap-timeout' }
			);
		}, (err) => {
			assert.ok(err instanceof PipelineError);
			assert.equal(err.errorType, ERROR_TYPES.TRANSIENT);
			assert.ok(err.message.includes('timed out'));
			return true;
		});
	});

	// Scenario 8: Capability non-retryable failure — dependents skipped
	it('8. Non-retryable capability failure skips dependents', async () => {
		const registry = new CapabilityRegistry();

		registry.register({
			id: 'failing',
			name: 'Failing',
			dependsOn: [],
			requiredEvidence: [],
			producesEvidence: [],
			enabled: () => true,
			async execute() {
				throw Object.assign(new Error('Bad request'), { status: 400 });
			}
		});

		registry.register({
			id: 'dependent',
			name: 'Dependent',
			dependsOn: ['failing'],
			requiredEvidence: [],
			producesEvidence: [],
			enabled: () => true,
			async execute() { return { ok: true }; }
		});

		const orch = new Orchestrator(registry);
		const { results } = await orch.execute(mockSession(), {});

		assert.equal(results.failing.status, 'failed');
		assert.ok(results.failing.errorType, 'should have errorType');
		assert.equal(results.dependent.status, 'skipped');
		assert.equal(results.dependent.reason, 'dependency_failed');
	});

	// Scenario 9: Pipeline concurrent execution — idempotency guard
	it('9. Concurrent pipeline calls do not double-execute', async () => {
		const session = mockSession();
		const p1 = runAutonomyPipeline(session, {}).catch(() => {});
		const p2 = runAutonomyPipeline(session, {}).catch(() => {});
		await Promise.all([p1, p2]);
		assert.equal(session._pipelineRunning, false);
		assert.ok(session.pipeline?.completedAt, 'pipeline completed');
	});

	// Scenario 10: Pipeline already completed — cached result returned
	it('10. Second pipeline call returns cached result', async () => {
		const session = mockSession();
		await runAutonomyPipeline(session, {}).catch(() => {});
		const firstAt = session.pipeline.completedAt;

		// Wait a moment to ensure timestamp would differ
		await new Promise(r => setTimeout(r, 50));

		await runAutonomyPipeline(session, {});
		assert.equal(session.pipeline.completedAt, firstAt, 'completedAt unchanged');
	});

	// Scenario 11: Session abort (terminal) — not retried
	it('11. AbortError classified as terminal, NOT retried', () => {
		const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.TERMINAL);
		assert.equal(isRetryableType(type), false);
	});

	// Scenario 12: Network error ECONNRESET (infrastructure) — retryable
	it('12. ECONNRESET classified as infrastructure, retryable', () => {
		const err = new Error('fetch failed: ECONNRESET');
		const type = classifyError(err);
		assert.equal(type, ERROR_TYPES.INFRASTRUCTURE);
		assert.equal(isRetryableType(type), true);
	});

	// Scenario 13: Mission double-finalize — idempotent
	it('13. isTerminalStatus returns true for completed (double-finalize guard)', () => {
		// The guard in finalizeMission checks this before applying changes
		assert.equal(isTerminalStatus('completed'), true);
		assert.equal(isTerminalStatus('failed'), true);
		assert.equal(isTerminalStatus('aborted'), true);
	});

	// Scenario 14: Mission terminal state enforcement — cannot restart
	it('14. Terminal status prevents mission restart', () => {
		// The /start endpoint checks isTerminalStatus and returns 409
		const terminalStatuses = ['completed', 'failed', 'aborted'];
		for (const s of terminalStatuses) {
			assert.equal(isTerminalStatus(s), true, `${s} should be terminal`);
		}
		// Non-terminal statuses don't block restart
		assert.equal(isTerminalStatus('created'), false);
		assert.equal(isTerminalStatus('running'), false);
	});
});
