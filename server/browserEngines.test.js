import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGINE_IDS, engineRegistry, isEngineId, resolveEngine, ensureXvfb } from './browserEngines.js';

test('engine registry exposes the three engines with stable ids', () => {
	const ids = engineRegistry().map(engine => engine.id).sort();
	assert.deepEqual(ids, ['chromium', 'firefox', 'webkit']);
	assert.deepEqual(ENGINE_IDS, ['chromium', 'firefox', 'webkit']);
});

test('isEngineId validates and rejects junk', () => {
	assert.equal(isEngineId('chromium'), true);
	assert.equal(isEngineId('firefox'), true);
	assert.equal(isEngineId('webkit'), true);
	assert.equal(isEngineId('safari'), false);
	assert.equal(isEngineId(''), false);
	assert.equal(isEngineId(null), false);
	assert.equal(isEngineId(42), false);
});

test('resolveEngine defaults unknown ids to chromium', async () => {
	const engine = await resolveEngine('internet-explorer');
	assert.equal(engine.id, 'chromium');
	assert.equal(engine.available, true);
});

test('resolveEngine returns the matching playwright launcher type', async () => {
	assert.equal((await resolveEngine('chromium')).type.name(), 'chromium');
	assert.equal((await resolveEngine('firefox')).type.name(), 'firefox');
	assert.equal((await resolveEngine('webkit')).type.name(), 'webkit');
});

test('webkit resolution either works with GTK+xvfb or reports unavailable with a reason', async () => {
	const engine = await resolveEngine('webkit');
	if (engine.available) {
		assert.ok(engine.launch.executablePath.includes('minibrowser-gtk'), 'uses the GTK bundle');
		assert.match(engine.launch.env.DISPLAY, /^:\d+$/);
		assert.ok(engine.launch.env.LD_LIBRARY_PATH.includes('minibrowser-gtk'));
	} else {
		assert.ok(engine.reason && engine.reason.length > 10, 'unavailable engines carry a human reason');
	}
});

test('ensureXvfb is disabled via QASE_DISABLE_XVFB and reports null', async () => {
	const saved = process.env.QASE_DISABLE_XVFB;
	process.env.QASE_DISABLE_XVFB = 'true';
	try {
		const display = await ensureXvfb(':79');
		assert.equal(display, null);
	} finally {
		if (saved === undefined) delete process.env.QASE_DISABLE_XVFB;
		else process.env.QASE_DISABLE_XVFB = saved;
	}
});

test('engineRegistryResolved reports availability consistent with resolveEngine', async () => {
	const { engineRegistryResolved } = await import('./browserEngines.js');
	const registry = await engineRegistryResolved();
	assert.deepEqual(registry.map(entry => entry.id), ['chromium', 'firefox', 'webkit']);
	for (const entry of registry) {
		const resolved = await resolveEngine(entry.id);
		assert.equal(entry.available, resolved.available, `${entry.id} availability matches resolveEngine`);
		assert.equal(entry.reason ?? null, resolved.reason ?? null, `${entry.id} reason matches resolveEngine`);
	}
});

test('store.createSession accepts a valid engine and rejects junk', async () => {
	const { createSession } = await import('./store.js');
	const session = createSession('engine-check', { engine: 'firefox' });
	assert.equal(session.engine, 'firefox');
	assert.equal(createSession('default-engine', {}).engine, 'chromium');
	assert.throws(() => createSession('bad-engine', { engine: 'netscape' }), /unknown browser engine/);
});

test('firefox resolves unavailable when the browser bundle is missing', async () => {
	// Point the registry at a directory with no firefox-* bundle.
	const saved = process.env.PLAYWRIGHT_BROWSERS_PATH;
	process.env.PLAYWRIGHT_BROWSERS_PATH = '/tmp/definitely-not-playwright';
	try {
		const engine = await resolveEngine('firefox');
		assert.equal(engine.available, false);
		assert.match(engine.reason, /Firefox browser bundle is not installed/);
	} finally {
		if (saved === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
		else process.env.PLAYWRIGHT_BROWSERS_PATH = saved;
	}
});
