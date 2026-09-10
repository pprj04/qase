import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunKeepalive, isRunStatusActive } from './keepalive.js';

function harness(overrides = {}) {
	const calls = [];
	const keepalive = createRunKeepalive({
		intervalMs: 10,
		quietAfterMs: 25,
		getUrl: () => 'http://127.0.0.1:5173/healthz',
		fetchImpl: async url => { calls.push(url); return new Response('ok'); },
		logger: { warn() {}, info() {} },
		...overrides
	});
	return { keepalive, calls };
}

test('idle keepalive never pings', async () => {
	const { calls } = harness();
	await new Promise(resolve => setTimeout(resolve, 40));
	assert.deepEqual(calls, []);
});

test('keepalive pings healthz while a run is active and stops after quiet period', async () => {
	const { keepalive, calls } = harness();
	keepalive.noteActive();
	await new Promise(resolve => setTimeout(resolve, 40));
	assert.ok(calls.length >= 1, 'expected at least one ping while active');
	assert.ok(calls.every(url => url.endsWith('/healthz')), 'all pings target healthz');
	// Let the quiet window (25ms) pass; no further pings should occur.
	const before = calls.length;
	await new Promise(resolve => setTimeout(resolve, 60));
	assert.equal(calls.length, before, 'pings must stop after the quiet period');
	keepalive.stop();
});

test('keepalive swallows fetch failures without unhandled rejections', async () => {
	const warnings = [];
	const { keepalive } = harness({
		fetchImpl: async () => { throw new TypeError('fetch failed'); },
		logger: { warn: (event, meta) => warnings.push([event, meta]), info() {} }
	});
	keepalive.noteActive();
	await new Promise((resolve, reject) => {
		process.on('unhandledRejection', reject);
		setTimeout(resolve, 35);
	});
	assert.ok(warnings.length >= 1, 'failure was logged, not thrown');
	keepalive.stop();
});

test('stop clears the timer permanently', async () => {
	const { keepalive, calls } = harness();
	keepalive.noteActive();
	await new Promise(resolve => setTimeout(resolve, 25));
	keepalive.stop();
	const before = calls.length;
	keepalive.noteActive();
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.equal(calls.length, before, 'no pings after stop even if noteActive is called');
});

test('active run statuses are recognized', () => {
	assert.equal(isRunStatusActive('running'), true);
	assert.equal(isRunStatusActive('awaiting_input'), true);
	assert.equal(isRunStatusActive('idle'), false);
	assert.equal(isRunStatusActive('done'), false);
	assert.equal(isRunStatusActive('interrupted'), false);
	assert.equal(isRunStatusActive('error'), false);
});
