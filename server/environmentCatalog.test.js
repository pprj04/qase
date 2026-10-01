import test from 'node:test';
import assert from 'node:assert/strict';

import {
	ENVIRONMENT_CATALOG_VERSION,
	PLATFORMS,
	BROWSERS,
	BROWSER_VERSIONS,
	MACOS_SAFARI_VERSIONS,
	safariVersionFor,
	generateEnvironments,
	buildEnvId,
	isCombinationSupported,
	getDevice,
	getBrowser,
	availabilityReport
} from './environmentCatalog.js';

test('catalog exposes a version stamp', () => {
	assert.match(ENVIRONMENT_CATALOG_VERSION, /^\d{4}\.\d{2}\.\d+$/);
});

test('all requested iPhone models are present', () => {
	const wanted = [
		'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max',
		'iPhone 12', 'iPhone 12 mini', 'iPhone 12 Pro', 'iPhone 12 Pro Max',
		'iPhone 13', 'iPhone 13 mini', 'iPhone 13 Pro', 'iPhone 13 Pro Max',
		'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max',
		'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max',
		'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16e',
		'iPhone 17', 'iPhone 17 Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max'
	];
	for (const name of wanted) {
		assert.ok(getDevice(name), `missing device: ${name}`);
	}
});

test('requested iPad lines are present as representative generations', () => {
	for (const name of ['iPad', 'iPad mini', 'iPad Air', 'iPad Pro 11-inch', 'iPad Pro 12.9-inch', 'iPad Pro 13-inch']) {
		assert.ok(getDevice(name), `missing device: ${name}`);
	}
});

test('all five macOS versions are present', () => {
	for (const name of ['macOS Monterey', 'macOS Ventura', 'macOS Sonoma', 'macOS Sequoia', 'macOS Tahoe']) {
		assert.ok(getDevice(name), `missing device: ${name}`);
	}
});

test('macOS devices carry a numeric OS version', () => {
	const sonoma = getDevice('macOS Sonoma');
	assert.equal(sonoma.macOsVersion, '14');
});

test('no environment exists for a browser unavailable on its platform', () => {
	// 2026.10 expansion: the only forbidden pair left is Safari on
	// Android/Windows (Apple ships no Safari for those platforms).
	const environments = generateEnvironments();
	const byBrowser = new Set(environments.map((env) => `${env.platform}:${env.browser}`));
	assert.ok(!byBrowser.has('android:Safari'), 'Safari must never appear on Android');
	assert.ok(!byBrowser.has('windows:Safari'), 'Safari must never appear on Windows');
});

test('iOS/iPadOS environments offer all seven App Store browsers', () => {
	const mobileBrowsers = new Set(
		generateEnvironments()
			.filter((env) => env.platform === 'ios' || env.platform === 'ipados')
			.map((env) => env.browser)
	);
	assert.deepEqual([...mobileBrowsers].sort(),
		['Brave', 'Chrome', 'DuckDuckGo', 'Edge', 'Firefox', 'Opera', 'Safari']);
});

test('macOS environments offer all seven browsers', () => {
	const macBrowsers = new Set(generateEnvironments().filter((env) => env.platform === 'macos').map((env) => env.browser));
	assert.deepEqual([...macBrowsers].sort(),
		['Brave', 'Chrome', 'DuckDuckGo', 'Edge', 'Firefox', 'Opera', 'Safari']);
});

test('Android and Windows environments offer six browsers, never Safari', () => {
	for (const platform of ['android', 'windows']) {
		const browsers = new Set(generateEnvironments().filter((env) => env.platform === platform).map((env) => env.browser));
		assert.deepEqual([...browsers].sort(),
			['Brave', 'Chrome', 'DuckDuckGo', 'Edge', 'Firefox', 'Opera'], platform);
	}
});

test('every generated environment has a unique envId', () => {
	const ids = generateEnvironments().map((env) => env.envId);
	assert.equal(new Set(ids).size, ids.length);
});

test('env ids follow the documented scheme', () => {
	const environments = generateEnvironments();
	const byId = new Map(environments.map((env) => [env.envId, env]));
	assert.ok(byId.has('ENV-IOS-IP16PRO-18.3-CHR-140'), 'example from the spec must exist');
	assert.ok(byId.has('ENV-IOS-IP16PRO-18.3-SAF-18.3'), 'Safari env uses derived version');
	assert.ok(byId.has('ENV-MAC-SONOMA-CHR-140'), 'macOS env uses OS name in device slot');
	assert.ok(byId.has('ENV-IPADOS-IPADPRO13-18.3-CHR-140'));
	const env = byId.get('ENV-IOS-IP16PRO-18.3-CHR-140');
	assert.equal(env.device, 'iPhone 16 Pro');
	assert.equal(env.os, 'iOS');
	assert.equal(env.osVersion, '18.3');
	assert.equal(env.browser, 'Chrome');
	assert.equal(env.browserVersion, '140');
	assert.equal(env.deviceType, 'mobile');
	assert.equal(env.screenSize, '6.3 inch');
	assert.equal(env.executionProvider, 'environment');
	assert.equal(env.isRealDevice, true);
});

test('buildEnvId is deterministic and normalizes macOS names', () => {
	assert.equal(buildEnvId('ios', 'IP16PRO', '18.3', 'CHR', '140'), 'ENV-IOS-IP16PRO-18.3-CHR-140');
	assert.equal(buildEnvId('macos', 'SONOMA', 'Sonoma', 'SAF', '18.6'), 'ENV-MAC-SONOMA-SAF-18.6');
	assert.equal(buildEnvId('macos', 'SONOMA', 'sonoma', 'CHR', '140'), 'ENV-MAC-SONOMA-CHR-140');
});

test('Safari version derives from the OS version, never independent', () => {
	assert.equal(safariVersionFor('ios', '18.3'), '18.3');
	assert.equal(safariVersionFor('ios', '26.0'), '26.0');
	assert.equal(safariVersionFor('ipados', '17.0'), '17.0');
	assert.equal(safariVersionFor('macos', 'Sonoma'), '18.6');
	assert.equal(safariVersionFor('macos', 'sequoia'), '26.2');
	assert.equal(safariVersionFor('macos', 'Tahoe'), '26.4');
	// #14166: multi-word macOS names resolve case-insensitively too.
	assert.equal(safariVersionFor('macos', 'Big Sur'), '14.1.2');
	assert.equal(safariVersionFor('macos', 'high sierra'), '11.1.2');
	assert.equal(safariVersionFor('macos', 'Windows 98'), null);
	assert.equal(safariVersionFor('android', '18.3'), null);
});

test('generated Safari environments match their derived OS-bound version', () => {
	for (const env of generateEnvironments().filter((env) => env.browser === 'Safari')) {
		const derived = safariVersionFor(env.platform, env.osVersion);
		assert.equal(env.browserVersion, derived, `${env.envId} must carry derived Safari version`);
	}
});

test('every generated environment passes the combination validator', () => {
	for (const env of generateEnvironments()) {
		const verdict = isCombinationSupported(env.platform, env.device, env.osVersion, env.browser, env.browserVersion);
		assert.ok(verdict.ok, `${env.envId} must validate: ${verdict.reason}`);
	}
});

test('validator rejects unsupported combinations with readable reasons', () => {
	// 2026.10 expansion: Safari remains the hard exclusion off Apple platforms.
	const safariOnAndroid = isCombinationSupported('android', 'Galaxy S24', '15', 'safari');
	assert.equal(safariOnAndroid.ok, false);
	assert.match(safariOnAndroid.reason, /not supported on Android/);

	const safariOnWindows = isCombinationSupported('windows', 'Windows Desktop', '11', 'safari');
	assert.equal(safariOnWindows.ok, false);

	// Expanded availability: these ARE supported now.
	assert.equal(isCombinationSupported('ios', 'iPhone 16 Pro', '18.3', 'firefox', '142').ok, true);
	assert.equal(isCombinationSupported('macos', 'macOS Sonoma', 'Sonoma', 'brave', '140').ok, true);
	assert.equal(isCombinationSupported('android', 'Galaxy S24', '15', 'brave', '140').ok, true);
	assert.equal(isCombinationSupported('ipados', 'iPad Pro 13-inch', '26.0', 'duckduckgo', '1').ok, true);

	const safariMismatch = isCombinationSupported('ios', 'iPhone 16 Pro', '18.3', 'safari', '17');
	assert.equal(safariMismatch.ok, false);
	assert.match(safariMismatch.reason, /derived from the OS/);

	const badOs = isCombinationSupported('ios', 'iPhone 11', '19.0', 'safari');
	assert.equal(badOs.ok, false);
	assert.match(badOs.reason, /does not support OS version/);

	const unknownDevice = isCombinationSupported('ios', 'Nokia 3310', '18.3', 'chrome', '140');
	assert.equal(unknownDevice.ok, false);

	const badChromeVersion = isCombinationSupported('macos', 'macOS Sonoma', 'Sonoma', 'chrome', '42');
	assert.equal(badChromeVersion.ok, false);
	assert.match(badChromeVersion.reason, /not available/);

	const crossPlatformDevice = isCombinationSupported('ios', 'iPad Pro 11-inch', '17.0', 'safari');
	assert.equal(crossPlatformDevice.ok, false);
});

test('browser version lists contain only plausible majors', () => {
	for (const [code, versions] of Object.entries(BROWSER_VERSIONS)) {
		assert.ok(versions.length >= 1, `${code} needs versions`);
		for (const version of versions) {
			assert.match(version, /^\d+$/, `${code} version "${version}" must be a bare major`);
		}
	}
	// Chrome majors are current-era (2026): all >= 138
	for (const version of BROWSER_VERSIONS.chrome) {
		assert.ok(Number(version) >= 138, `Chrome ${version} looks stale for ${ENVIRONMENT_CATALOG_VERSION}`);
	}
});

test('macOS Safari map covers every macOS device', () => {
	for (const os of Object.keys(MACOS_SAFARI_VERSIONS)) {
		assert.ok(getDevice(`macOS ${os}`), `Safari map references unknown macOS ${os}`);
	}
});

test('availability report explains gaps for every platform', () => {
	const report = availabilityReport();
	assert.equal(report.length, 5);
	// 2026.10 expansion: all seven browsers available on Apple platforms; the
	// only gaps left are Safari on Android/Windows.
	const mac = report.find((entry) => entry.platform === 'macos');
	assert.equal(mac.unavailable.length, 0);
	const iosEntry = report.find((entry) => entry.platform === 'ios');
	assert.equal(iosEntry.unavailable.length, 0);
	// Cross-platform (Phase 9): Chrome everywhere, Safari only on Apple.
	const android = report.find((entry) => entry.platform === 'android');
	assert.ok(android.available.includes('Chrome'));
	assert.ok(android.unavailable.some((entry) => entry.browser === 'Safari'));
	assert.ok(android.unavailable.every((entry) => entry.reason.length > 10));
	const windows = report.find((entry) => entry.platform === 'windows');
	assert.ok(windows.available.includes('Edge'));
	assert.ok(windows.available.includes('Brave'));
});

test('generated matrix size covers the full expanded availability', () => {
	// 2026.10.2 (#14166): deep browser-major back-catalog + 4 legacy macOS
	// versions push the matrix to ~14.6k environments.
	const count = generateEnvironments().length;
	assert.ok(count >= 14000 && count <= 16000, `unexpected matrix size: ${count}`);
});

test('chrome environments carry multiple versions per device/os', () => {
	const chrome16Pro = generateEnvironments().filter(
		(env) => env.envId.startsWith('ENV-IOS-IP16PRO-18.3-CHR-')
	);
	assert.deepEqual(chrome16Pro.map((env) => env.browserVersion).sort(), ['140','141','142','143','144','145','146','147','148','149','150','151','152','153','154','155','156']);
});
