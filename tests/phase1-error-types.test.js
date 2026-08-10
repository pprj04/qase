/**
 * Phase 1 — Execution Reliability: Error Types & Classification
 *
 * Tests the structured error classification system that underpins all
 * retry/abort decisions in the pipeline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ERROR_TYPES,
	PipelineError,
	classifyError,
	isRetryableType,
	wrapError,
	withRetry
} from '../server/errorTypes.js';

describe('Error Types', () => {

	describe('ERROR_TYPES constants', () => {
		it('defines all five categories', () => {
			assert.equal(ERROR_TYPES.TRANSIENT, 'transient');
			assert.equal(ERROR_TYPES.INFRASTRUCTURE, 'infrastructure');
			assert.equal(ERROR_TYPES.APPLICATION, 'application');
			assert.equal(ERROR_TYPES.CONFIG, 'config');
			assert.equal(ERROR_TYPES.TERMINAL, 'terminal');
		});
	});

	describe('PipelineError', () => {
		it('carries type, retryable flag, and context', () => {
			const err = new PipelineError('timed out', ERROR_TYPES.TRANSIENT, {
				retryable: true,
				context: { capability: 'test_generation' }
			});
			assert.equal(err.message, 'timed out');
			assert.equal(err.errorType, 'transient');
			assert.equal(err.retryable, true);
			assert.equal(err.context.capability, 'test_generation');
			assert.equal(err.name, 'PipelineError');
		});

		it('toJSON serializes structured fields', () => {
			const err = new PipelineError('fail', ERROR_TYPES.APPLICATION, {
				context: { detail: 'bad input' }
			});
			const json = err.toJSON();
			assert.equal(json.errorType, 'application');
			assert.equal(json.message, 'fail');
			assert.equal(json.context.detail, 'bad input');
		});

		it('is an instance of Error', () => {
			const err = new PipelineError('test', ERROR_TYPES.TRANSIENT);
			assert.ok(err instanceof Error);
		});
	});

	describe('isRetryableType', () => {
		it('returns true for transient and infrastructure', () => {
			assert.equal(isRetryableType(ERROR_TYPES.TRANSIENT), true);
			assert.equal(isRetryableType(ERROR_TYPES.INFRASTRUCTURE), true);
		});

		it('returns false for application, config, and terminal', () => {
			assert.equal(isRetryableType(ERROR_TYPES.APPLICATION), false);
			assert.equal(isRetryableType(ERROR_TYPES.CONFIG), false);
			assert.equal(isRetryableType(ERROR_TYPES.TERMINAL), false);
		});
	});
});

describe('Error Classification', () => {

	describe('classifyError', () => {

		it('classifies timeout as transient', () => {
			assert.equal(classifyError(new Error('Request timed out')), ERROR_TYPES.TRANSIENT);
			assert.equal(classifyError(new Error('deadline exceeded')), ERROR_TYPES.TRANSIENT);
			assert.equal(classifyError(new Error('The operation timed out after 30s')), ERROR_TYPES.TRANSIENT);
		});

		it('classifies empty LLM response as transient', () => {
			assert.equal(classifyError(new Error('LLM returned an empty response.')), ERROR_TYPES.TRANSIENT);
		});

		it('classifies 429 as transient', () => {
			const err = Object.assign(new Error('Rate limited'), { status: 429 });
			assert.equal(classifyError(err), ERROR_TYPES.TRANSIENT);
		});

		it('classifies 5xx as infrastructure', () => {
			for (const status of [500, 502, 503, 504]) {
				const err = Object.assign(new Error(`Server error ${status}`), { status });
				assert.equal(classifyError(err), ERROR_TYPES.INFRASTRUCTURE);
			}
		});

		it('classifies 401/403 as config', () => {
			for (const status of [401, 403]) {
				const err = Object.assign(new Error('Unauthorized'), { status });
				assert.equal(classifyError(err), ERROR_TYPES.CONFIG);
			}
		});

		it('classifies 400 as application', () => {
			const err = Object.assign(new Error('Bad request'), { status: 400 });
			assert.equal(classifyError(err), ERROR_TYPES.APPLICATION);
		});

		it('classifies network errors as infrastructure', () => {
			assert.equal(classifyError(new Error('fetch failed')), ERROR_TYPES.INFRASTRUCTURE);
			assert.equal(classifyError(new Error('ECONNRESET')), ERROR_TYPES.INFRASTRUCTURE);
			assert.equal(classifyError(new Error('socket hang up')), ERROR_TYPES.INFRASTRUCTURE);
		});

		it('classifies abort as terminal', () => {
			const err = Object.assign(new Error('Aborted'), { name: 'AbortError' });
			assert.equal(classifyError(err), ERROR_TYPES.TERMINAL);
		});

		it('classifies missing API key as config', () => {
			assert.equal(classifyError(new Error('No API key configured')), ERROR_TYPES.CONFIG);
		});

		it('classifies PipelineError by its own type', () => {
			const err = new PipelineError('custom', ERROR_TYPES.INFRASTRUCTURE);
			assert.equal(classifyError(err), ERROR_TYPES.INFRASTRUCTURE);
		});

		it('defaults unknown errors to application', () => {
			assert.equal(classifyError(new Error('something weird')), ERROR_TYPES.APPLICATION);
			assert.equal(classifyError(null), ERROR_TYPES.APPLICATION);
		});
	});

	describe('wrapError', () => {
		it('wraps a plain Error in PipelineError', () => {
			const original = new Error('timeout');
			const wrapped = wrapError(original, { label: 'test' });
			assert.ok(wrapped instanceof PipelineError);
			assert.equal(wrapped.errorType, ERROR_TYPES.TRANSIENT);
			assert.equal(wrapped.retryable, true);
			assert.equal(wrapped.context.label, 'test');
		});

		it('returns existing PipelineError unchanged', () => {
			const original = new PipelineError('test', ERROR_TYPES.CONFIG);
			const wrapped = wrapError(original, {});
			assert.equal(wrapped, original);
		});
	});
});

describe('withRetry', () => {

	it('returns the result on first success', async () => {
		const result = await withRetry(async () => 'OK', { label: 'test' });
		assert.equal(result, 'OK');
	});

	it('retries on transient errors and eventually succeeds', async () => {
		let attempts = 0;
		const result = await withRetry(async () => {
			attempts++;
			if (attempts < 2) {
				throw Object.assign(new Error('timeout'), { status: 500 });
			}
			return 'recovered';
		}, { maxRetries: 2, delayMs: 10, label: 'retry-test' });
		assert.equal(result, 'recovered');
		assert.equal(attempts, 2);
	});

	it('does NOT retry on non-retryable errors', async () => {
		let attempts = 0;
		await assert.rejects(async () => {
			await withRetry(async () => {
				attempts++;
				throw Object.assign(new Error('Unauthorized'), { status: 401 });
			}, { maxRetries: 3, delayMs: 10, label: 'no-retry' });
		});
		assert.equal(attempts, 1); // no retry
	});

	it('throws after exceeding maxRetries', async () => {
		let attempts = 0;
		await assert.rejects(async () => {
			await withRetry(async () => {
				attempts++;
				throw new Error('timeout');
			}, { maxRetries: 1, delayMs: 10, label: 'exhaust-retries' });
		});
		assert.equal(attempts, 2); // initial + 1 retry
	});

	it('respects timeoutMs', async () => {
		await assert.rejects(async () => {
			await withRetry(
				() => new Promise(resolve => setTimeout(resolve, 5000)),
				{ timeoutMs: 50, maxRetries: 0, label: 'timeout-test' }
			);
		}, /timed out/);
	});
});
