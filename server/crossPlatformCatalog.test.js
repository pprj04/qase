import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalogSeed } from './deviceCatalogSeed.js';
import {
	ANDROID_DEVICES,
	WINDOWS_DEVICES,
	isCombinationSupported,
	buildEnvId
} from './environmentCatalog.js';

test('seed contains android manufacturers, models and OS versions', () => {
	const seed = buildCatalogSeed();
	const androidCategories = seed.deviceCategories.filter((c) => c.platform === 'android');
	for (const manufacturer of ['Samsung', 'Google Pixel', 'OnePlus', 'Motorola', 'Xiaomi', 'Redmi', 'Oppo', 'Vivo', 'Realme', 'Nothing']) {
		assert.ok(androidCategories.some((c) => c.display_name === manufacturer), `missing android category ${manufacturer}`);
	}
	const androidModels = seed.deviceModels.filter((m) => ['samsung', 'google-pixel', 'oneplus', 'motorola', 'xiaomi', 'redmi', 'oppo', 'vivo', 'realme', 'nothing', 'other-android'].includes(m.category_id));
	assert.ok(androidModels.length >= 30, `expected 30+ android models, got ${androidModels.length}`);
	for (const expected of ['Galaxy S24', 'Pixel 9', 'OnePlus 13R', 'Galaxy Z Fold', 'Pixel Fold']) {
		assert.ok(androidModels.some((m) => m.display_name === expected), `missing android model ${expected}`);
	}
	const androidOs = seed.osVersions.filter((v) => v.os_family_id === 'android').map((v) => v.version);
	assert.deepEqual(androidOs, ['11', '12', '13', '14', '15', '16']);
});

test('seed contains windows form factors, OS versions and browser support', () => {
	const seed = buildCatalogSeed();
	const windowsCategories = seed.deviceCategories.filter((c) => c.platform === 'windows');
	assert.deepEqual(windowsCategories.map((c) => c.id), ['windows-laptop', 'windows-desktop', 'windows-tablet']);
	const windowsModels = seed.deviceModels.filter((m) => m.category_id.startsWith('windows-'));
	assert.equal(windowsModels.length, 3);
	const windowsOs = seed.osVersions.filter((v) => v.os_family_id === 'windows').map((v) => v.version);
	assert.deepEqual(windowsOs, ['10', '11']);
	// Windows supports Chrome, Edge, Firefox, Opera, Brave, DuckDuckGo — never Safari.
	for (const browser of ['chrome', 'edge', 'firefox', 'opera', 'brave', 'duckduckgo']) {
		assert.ok(seed.browserPlatformSupport.some(
			(row) => row.browser_id === browser && row.platform === 'windows' && row.supported
		), `${browser} should be supported on windows`);
	}
	assert.ok(!seed.browserPlatformSupport.some((row) => row.browser_id === 'safari' && row.platform === 'windows' && row.supported));
	// Android supports Chrome; Safari never.
	assert.ok(seed.browserPlatformSupport.some((row) => row.browser_id === 'chrome' && row.platform === 'android' && row.supported));
	assert.ok(!seed.browserPlatformSupport.some((row) => row.browser_id === 'safari' && row.platform === 'android' && row.supported));
});

test('compatibility: valid android/windows combos accepted, invalid rejected', async () => {
	// Galaxy S24 → Android 14/15 (data-driven, not hard-coded)
	assert.equal((await isCombinationSupported('android', 'Galaxy S24', '15', 'chrome', '141')).ok, true);
	assert.equal((await isCombinationSupported('android', 'Galaxy S24', '14', 'chrome', '140')).ok, true);
	// Galaxy S24 + iOS → rejected
	const wrongPlatform = await isCombinationSupported('android', 'Galaxy S24', '18.3', 'chrome', '141');
	assert.equal(wrongPlatform.ok, false);
	assert.match(wrongPlatform.reason, /does not support/);
	// Pixel 9 → Android 15/16 accepted, Android 11 rejected (data: modern device)
	assert.equal((await isCombinationSupported('android', 'Pixel 9', '16', 'chrome', '141')).ok, true);
	assert.equal((await isCombinationSupported('android', 'Pixel 9', '11', 'chrome', '141')).ok, false);
	// Windows Laptop → Windows 11 + Edge; Windows + Safari rejected
	assert.equal((await isCombinationSupported('windows', 'Windows Laptop', '11', 'edge', '141')).ok, true);
	assert.equal((await isCombinationSupported('windows', 'Windows Desktop', '11', 'brave', '140')).ok, true);
	const safariOnWindows = await isCombinationSupported('windows', 'Windows Laptop', '11', 'safari');
	assert.equal(safariOnWindows.ok, false);
	assert.match(safariOnWindows.reason, /not available/);
	// Windows tolerates 'Windows 11' spelled out
	assert.equal((await isCombinationSupported('windows', 'Windows Laptop', 'Windows 11', 'edge', '141')).ok, true);
});

test('android and windows environments build deterministic ENV IDs', () => {
	assert.equal(
		buildEnvId('android', 'GALS24', '15', 'CHR', '141'),
		'ENV-AND-GALS24-15-CHR-141'
	);
	assert.equal(
		buildEnvId('windows', 'WINLAPTOP', '11', 'EDG', '141'),
		'ENV-WIN-11-EDG-141-WINLAPTOP'
	);
});

test('android device catalog integrity: slugs unique, compat rows match declared OS', () => {
	const slugs = new Set(ANDROID_DEVICES.map((d) => d.slug));
	assert.equal(slugs.size, ANDROID_DEVICES.length, 'android slugs must be unique');
	for (const device of ANDROID_DEVICES) {
		assert.ok(device.osVersions.length >= 1, `${device.slug} declares no OS versions`);
		assert.ok(device.osVersions.every((v) => Number(v) >= 11 && Number(v) <= 16), `${device.slug} has out-of-range android version ${device.osVersions}`);
	}
	const windowsSlugs = new Set(WINDOWS_DEVICES.map((d) => d.slug));
	assert.equal(windowsSlugs.size, WINDOWS_DEVICES.length);
});

test('environment service creates Android and Windows environments end-to-end (local backend)', async () => {
	const fs = await import('node:fs');
	const os = await import('node:os');
	const path = await import('node:path');
	const { createLocalDeviceCatalogBackend } = await import('./localDeviceCatalog.js');
	const { createLocalEnvironmentBackend, createEnvironmentService } = await import('./environmentService.js');

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-xplat-'));
	const catalog = createLocalDeviceCatalogBackend({ stateDir: dir, stateFile: path.join(dir, 'catalog.json') });
	await catalog.seed();
	const envs = createEnvironmentService(
		createLocalEnvironmentBackend({ stateDir: dir, stateFile: path.join(dir, 'environments.json'), catalogBackend: catalog }),
		{ tenantContext: {} }
	);
	await envs.seed();

	// Samsung Galaxy S24 / Android 15 / Chrome
	const android = await envs.create({
		platform: 'android', device: 'Galaxy S24', osVersion: '15',
		browserCode: 'chrome', browserVersion: '141'
	});
	assert.equal(android.envId, 'ENV-AND-GALS24-15-CHR-141');
	assert.equal(android.platform, 'android');
	assert.equal(android.os, 'Android');
	assert.equal(android.deviceType, 'mobile');
	assert.equal(android.orientation, 'portrait');
	assert.equal(android.browserstackCapabilities.os, 'android');
	assert.equal(android.browserstackCapabilities.deviceName, 'Samsung Galaxy S24');

	// Windows Laptop / Windows 11 / Edge
	const windows = await envs.create({
		platform: 'windows', device: 'Windows Laptop', osVersion: '11',
		browserCode: 'edge', browserVersion: '141'
	});
	assert.equal(windows.envId, 'ENV-WIN-11-EDG-141-WINLAPTOP');
	assert.equal(windows.platform, 'windows');
	assert.equal(windows.deviceType, 'desktop');
	assert.equal(windows.orientation, null);
	assert.equal(windows.browserstackCapabilities.os, 'Windows');
	assert.equal(windows.browserstackCapabilities.osVersion, '11');

	// Windows + Safari rejected end-to-end
	await assert.rejects(
		() => envs.create({ platform: 'windows', device: 'Windows Laptop', osVersion: '11', browserCode: 'safari' }),
		(error) => {
			assert.equal(error.code, 'QASE_ENVIRONMENT_INVALID');
			return true;
		}
	);

	// Both environments appear in the picker list alongside Apple ones.
	const listed = await envs.list({ limit: 1000 });
	assert.ok(listed.some((e) => e.envId === 'ENV-AND-GALS24-15-CHR-141'));
	assert.ok(listed.some((e) => e.envId === 'ENV-WIN-11-EDG-141-WINLAPTOP'));
	assert.ok(listed.some((e) => e.platform === 'ios'), 'apple environments still seeded');
});
