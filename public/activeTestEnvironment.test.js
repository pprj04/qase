import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createActiveTestEnvironmentStore,
	resolveForEnvironment
} from './activeTestEnvironment.js';

const ENV = Object.freeze({
	envId: 'ENV-IOS-IP17P-26-SAF-26',
	device: 'iPhone 17 Pro',
	deviceType: 'mobile',
	platform: 'ios',
	os: 'iOS',
	osVersion: '26.0',
	browser: 'Safari',
	browserCode: 'safari',
	browserVersion: '26.0',
	screenResolution: '1179x2556',
	orientation: 'portrait',
	active: true
});

function memoryStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k)
	};
}

test('resolveForEnvironment produces the canonical single-source shape', () => {
	const view = resolveForEnvironment(ENV);
	assert.equal(view.envId, ENV.envId);
	assert.equal(view.deviceId, ENV.envId);
	assert.equal(view.device, 'iPhone 17 Pro');
	assert.equal(view.osVersion, '26.0');
	assert.equal(view.browserVersion, '26.0');
	assert.equal(view.orientation, 'portrait');
	assert.equal(resolveForEnvironment(null), null);
});

test('store set/get/clear round-trips and persists', () => {
	const storage = memoryStorage();
	const store = createActiveTestEnvironmentStore({ storage });
	assert.equal(store.get(), null);
	const view = store.setSelection(ENV);
	assert.equal(view.device, 'iPhone 17 Pro');
	assert.equal(store.get().envId, ENV.envId);
	assert.equal(JSON.parse(storage.getItem('qase.activeTestEnvironment')).envId, ENV.envId);
	// legacy key kept in sync for startEnvironmentRun/presets
	assert.equal(storage.getItem('qase.environmentId'), ENV.envId);
	store.clear();
	assert.equal(store.get(), null);
	assert.equal(storage.getItem('qase.environmentId'), null);
});

test('persistedEnvId survives a fresh store instance (reload)', () => {
	const storage = memoryStorage();
	const store = createActiveTestEnvironmentStore({ storage });
	store.setSelection(ENV);
	const reloaded = createActiveTestEnvironmentStore({ storage });
	assert.equal(reloaded.persistedEnvId(), ENV.envId);
	// Legacy-only users (old qase.environmentId, no new key) hydrate too —
	// and the new key takes precedence when both exist.
	storage.removeItem('qase.activeTestEnvironment');
	storage.setItem('qase.environmentId', 'ENV-LEGACY-1');
	assert.equal(createActiveTestEnvironmentStore({ storage }).persistedEnvId(), 'ENV-LEGACY-1');
});
