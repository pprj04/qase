import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function firstMatrixSessionId'), source.indexOf('if (qaUi.dialog)', source.indexOf('function firstMatrixSessionId')));

function harness(api) {
	let elapsed = 0;
	const context = vm.createContext({
		api,
		Date: { now: () => elapsed },
		window: { setTimeout: (callback, ms) => { elapsed += ms; callback(); } }
	});
	vm.runInContext(helpers, context);
	return context;
}

test('launch opens the running session ahead of earlier finished sessions', async () => {
	const context = harness(() => { throw new Error('No poll expected'); });
	const id = await context.waitForFirstMatrixSession({ id: 'run', items: [
		{ status: 'PASSED', sessionId: 'previous' }, { status: 'RUNNING', sessionId: 'active' }
	] });
	assert.equal(id, 'active');
});

test('created batches are polled until a real session starts, including transient read failures', async () => {
	let reads = 0;
	const context = harness(async path => {
		assert.equal(path, '/matrix-runs/run');
		reads += 1;
		if (reads === 1) throw new Error('Temporary connection failure');
		return { run: { id: 'run', status: 'running', items: reads === 2
			? [{ status: 'QUEUED', sessionId: null }]
			: [{ status: 'RUNNING', sessionId: 'real-session' }] } };
	});
	assert.equal(await context.waitForFirstMatrixSession({ id: 'run', status: 'pending', items: [] }), 'real-session');
	assert.equal(reads, 3);
});

test('a terminal run blocked before launch does not fabricate a session or keep polling', async () => {
	const context = harness(() => { throw new Error('Terminal runs must not be polled'); });
	assert.equal(await context.waitForFirstMatrixSession({ id: 'run', status: 'done', items: [
		{ status: 'UNAVAILABLE', reason: 'Browser executable is missing', sessionId: null }
	] }), null);
});

test('slow preparation hands off to run progress after a bounded wait', async () => {
	let reads = 0;
	const context = harness(async () => {
		reads += 1;
		return { run: { id: 'run', status: 'pending', items: [] } };
	});
	assert.equal(await context.waitForFirstMatrixSession({ id: 'run', status: 'pending', items: [] }, { timeoutMs: 1000, pollMs: 250 }), null);
	assert.equal(reads, 4);
});
