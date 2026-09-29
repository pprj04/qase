import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	createLocalEnvironmentBackend,
	createEnvironmentService,
	normalizeEnvironmentInput,
	EnvironmentValidationError,
	EnvironmentConflictError
} from './environmentService.js';

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'qase-env-'));
}

test('local backend seed is idempotent and preserves deprecations', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	const first = await backend.seed();
	assert.ok(first.inserted >= 250);

	await backend.update(null, 'ENV-IOS-IP16PRO-18.3-CHR-140', { active: false });
	await backend.seed(); // reseed must not resurrect the deactivated row
	const env = await backend.get(null, 'ENV-IOS-IP16PRO-18.3-CHR-140');
	assert.equal(env.active, false, 'operator deprecation must survive reseed');
	assert.equal((await backend.list(null, {})).length >= 250, true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test('local backend persists across restarts via .qase/environments.json', async () => {
	const dir = tempDir();
	const backendOne = createLocalEnvironmentBackend({ stateDir: dir });
	await backendOne.seed();
	await backendOne.update(null, 'ENV-MAC-SONOMA-CHR-140', { active: false });

	const backendTwo = createLocalEnvironmentBackend({ stateDir: dir }); // fresh instance, same disk
	const env = await backendTwo.get(null, 'ENV-MAC-SONOMA-CHR-140');
	assert.ok(env, 'records survive a process restart');
	assert.equal(env.active, false, 'deprecation survives restart');
	fs.rmSync(dir, { recursive: true, force: true });
});

test('local backend filters match the documented dimensions', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	await backend.seed();

	const hits = await backend.list(null, { platform: 'ios', osVersion: '18.3', browser: 'Chrome', browserVersion: '140' });
	assert.ok(hits.length > 0);
	for (const env of hits) {
		assert.equal(env.platform, 'ios');
		assert.equal(env.osVersion, '18.3');
		assert.equal(env.browser, 'Chrome');
		assert.equal(env.browserVersion, '140');
	}

	const search = await backend.list(null, { search: 'IP16PRO' });
	assert.ok(search.length > 0);
	assert.ok(search.every((env) => env.envId.includes('IP16PRO') || env.device.includes('iPhone 16 Pro')));
	fs.rmSync(dir, { recursive: true, force: true });
});

test('local backend create enforces validation and uniqueness', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	await backend.seed();

	await assert.rejects(
		() => backend.create(null, { platform: 'ios', device: 'iPhone 16 Pro', osVersion: '18.3', browser: 'duckduckgo' }),
		EnvironmentValidationError
	);
	const duplicate = await backend.create(null, { platform: 'ios', device: 'iPhone 16 Pro', osVersion: '18.3', browser: 'chrome', browserVersion: '140' })
		.catch((error) => error);
	assert.ok(duplicate instanceof EnvironmentConflictError);
	fs.rmSync(dir, { recursive: true, force: true });
});

test('environment service facade returns camelCase records and facets', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	const service = createEnvironmentService(backend);
	await service.seed();

	const list = await service.list({ platform: 'macos' });
	assert.ok(list.length > 0);
	for (const env of list) {
		assert.ok(env.envId);
		assert.ok(env.browserstackCapabilities);
		assert.equal(typeof env.browserVersion, 'string');
		assert.equal(env.os, 'macOS');
		assert.ok(!('os_version' in env), 'no snake_case leakage');
	}

	const facets = await service.facets({ platform: 'ios' });
	assert.ok(facets.total >= 250);
	assert.ok(facets.browser.some((entry) => entry.value === 'Safari'));
	assert.ok(!facets.browser.some((entry) => entry.value === 'Firefox'), 'Firefox never appears on iOS');
	fs.rmSync(dir, { recursive: true, force: true });
});

test('normalizeEnvironmentInput rejects Safari on iOS 17 with wrong version', async () => {
	await assert.rejects(
		() => normalizeEnvironmentInput({ platform: 'ios', device: 'iPhone 15 Pro', osVersion: '17.0', browser: 'safari', browserVersion: '18' }),
		EnvironmentValidationError
	);
});

test('environment create carries screenResolution and orientation with device-type defaults', async () => {
	const mobile = await normalizeEnvironmentInput({
		platform: 'ios', device: 'iPhone 16 Pro', osVersion: '18.3', browser: 'chrome', browserVersion: '140'
	});
	assert.equal(mobile.orientation, 'portrait', 'mobile defaults to portrait');
	assert.ok(mobile.screenResolution, 'mobile resolution derived from device viewport');

	const explicit = await normalizeEnvironmentInput({
		platform: 'ios', device: 'iPhone 16 Pro', osVersion: '18.3', browser: 'chrome', browserVersion: '140',
		screenResolution: '2622x1206', orientation: 'landscape'
	});
	assert.equal(explicit.screenResolution, '2622x1206');
	assert.equal(explicit.orientation, 'landscape');

	const desktop = await normalizeEnvironmentInput({
		platform: 'macos', device: 'macOS Sonoma', osVersion: 'Sonoma', browser: 'chrome', browserVersion: '140'
	});
	assert.equal(desktop.orientation, null, 'desktop has no orientation (not applicable)');
});

test('local backend create/update persists resolution, orientation and description', async () => {
	const dir = tempDir();
	// Fresh catalog with an operator-added version (Chrome 153) so the created
	// environment is valid but NOT already in the deterministic seed matrix.
	const { createLocalDeviceCatalogBackend } = await import('./localDeviceCatalog.js');
	const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-catalog-env-'));
	const catalog = createLocalDeviceCatalogBackend({ stateDir: catalogDir, stateFile: path.join(catalogDir, 'catalog.json') });
	await catalog.seed();
	await catalog.create('browserVersions', { browser_id: 'chrome', version: '153', sort_key: '000153' });

	const backend = createLocalEnvironmentBackend({ stateDir: dir, catalogBackend: catalog });
	await backend.seed();

	const created = await backend.create(null, {
		platform: 'ios', device: 'iPhone 16 Pro', osVersion: '18.3', browser: 'chrome', browserVersion: '153',
		screenResolution: '2622x1206', orientation: 'landscape', description: 'Portrait-first device lab iPhone'
	});
	assert.equal(created.screenResolution, '2622x1206');
	assert.equal(created.orientation, 'landscape');
	assert.equal(created.description, 'Portrait-first device lab iPhone');

	const updated = await backend.update(null, created.envId, { orientation: 'portrait', description: 'Updated note' });
	assert.equal(updated.orientation, 'portrait');
	assert.equal(updated.description, 'Updated note');
	assert.equal(updated.screenResolution, '2622x1206', 'resolution untouched by patch');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.rmSync(catalogDir, { recursive: true, force: true });
});

test('disable excludes an environment from picker queries; enable restores it', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	await backend.seed();
	const envId = 'ENV-IOS-IP16PRO-18.3-CHR-140';

	await backend.update(null, envId, { active: false });
	const inactive = await backend.list(null, { active: 'true' });
	assert.ok(!inactive.some((env) => env.envId === envId), 'disabled env must not appear in active=true picker query');
	const stillThere = await backend.list(null, {});
	assert.ok(stillThere.some((env) => env.envId === envId), 'disabled env remains in unfiltered history');

	await backend.update(null, envId, { active: true });
	const restored = await backend.list(null, { active: 'true' });
	assert.ok(restored.some((env) => env.envId === envId), 're-enabled env returns to the picker');
	fs.rmSync(dir, { recursive: true, force: true });
});

test('availability explains the Brave/DuckDuckGo gap', async () => {
	const dir = tempDir();
	const backend = createLocalEnvironmentBackend({ stateDir: dir });
	const service = createEnvironmentService(backend);
	const report = service.availability();
	const mac = report.find((entry) => entry.platform === 'macos');
	assert.ok(mac.unavailable.some((entry) => entry.browser === 'Brave' || entry.browser === 'DuckDuckGo'));
	const iosEntry = report.find((entry) => entry.platform === 'ios');
	assert.ok(iosEntry.unavailable.some((entry) => entry.browser === 'Firefox'));
	fs.rmSync(dir, { recursive: true, force: true });
});

test('sanitizeFilters drops empty values', async () => {
	const { sanitizeFilters } = await import('./environmentService.js');
	assert.deepEqual(sanitizeFilters({ platform: 'ios', osVersion: '', device: undefined, active: 'true' }), {
		platform: 'ios',
		active: 'true'
	});
});
