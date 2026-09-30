import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeApplicationServices } from './localServices.js';

const RUN_ID = '6bf078e0-20df-48c3-a6f8-eb74ca14b9e1';

test('stop aborts a running turn but leaves the runtime for the loop to finalize', () => {
	const calls = [];
	const record = {
		running: true,
		controller: { abort: () => calls.push('abort') },
		dispose: () => calls.push('dispose')
	};
	const services = createRuntimeApplicationServices({ peekLive: () => record });
	services.agent.stop(RUN_ID);
	assert.deepEqual(calls, ['abort']);
});

test('stop on a non-running session disposes the stray runtime and stops frame streaming', () => {
	// The production gap: after a crash/recovery or an idle keep-open, the
	// run is not live but its browser runtime still holds Chromium. stop()
	// used to be a silent no-op, leaving the browser resident indefinitely.
	const calls = [];
	const record = {
		running: false,
		bridge: { stopFrames: () => calls.push('stopFrames') },
		dispose: () => calls.push('dispose'),
		runtime: {}
	};
	const services = createRuntimeApplicationServices({ peekLive: () => record });
	services.agent.stop(RUN_ID);
	assert.deepEqual(calls, ['stopFrames', 'dispose']);
	assert.equal(record.runtime, undefined, 'runtime reference dropped');
	assert.equal(record.bridge, undefined, 'bridge reference dropped');
});

test('stop is a safe no-op when no live record exists', () => {
	const services = createRuntimeApplicationServices({ peekLive: () => undefined });
	assert.doesNotThrow(() => services.agent.stop(RUN_ID));
});

test('stop on a non-running session is idempotent', () => {
	const calls = [];
	let record = {
		running: false,
		bridge: { stopFrames: () => calls.push('stopFrames') },
		dispose: () => calls.push('dispose'),
		runtime: {}
	};
	const services = createRuntimeApplicationServices({ peekLive: () => record });
	services.agent.stop(RUN_ID);
	services.agent.stop(RUN_ID);
	assert.deepEqual(calls, ['stopFrames', 'dispose'], 'second stop finds no bridge/dispose and does nothing');
});

test('artifact purge uses only non-creating live lookup and always drops the record', async () => {
	const calls = [];
	let record = {
		controller: { abort: () => calls.push('abort') },
		dispose: () => calls.push('dispose')
	};
	const runStore = {
		peekLive: () => record,
		dropLive: () => {
			calls.push('drop');
			record = undefined;
		},
		liveFor: () => {
			throw new Error('purge must not create a live record');
		}
	};
	const services = createRuntimeApplicationServices(runStore, {
		purgeRunWorkspace: async runId => calls.push(`workspace:${runId}`)
	});

	await services.agent.purgeArtifacts(RUN_ID);
	await services.agent.purgeArtifacts(RUN_ID);
	assert.deepEqual(calls, [
		'abort', 'dispose', 'drop', `workspace:${RUN_ID}`,
		'drop', `workspace:${RUN_ID}`
	]);
});

test('artifact purge still removes workspace and live entry when runtime disposal fails', async () => {
	const calls = [];
	const failure = new Error('runtime dispose failed');
	const runStore = {
		peekLive: () => ({ dispose: () => { throw failure; } }),
		dropLive: () => calls.push('drop'),
		liveFor: () => { throw new Error('must not be called'); }
	};
	const services = createRuntimeApplicationServices(runStore, {
		purgeRunWorkspace: async () => calls.push('workspace')
	});

	await assert.rejects(services.agent.purgeArtifacts(RUN_ID), failure);
	assert.deepEqual(calls, ['drop', 'workspace']);
});
