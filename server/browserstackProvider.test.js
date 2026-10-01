import test from 'node:test';
import assert from 'node:assert/strict';
import {
	browserstackConnectOptions,
	browserstackCredentials,
	connectBrowserstack,
	environmentEmulationOptions,
	resolveExecution
} from './browserstackProvider.js';
import { generateEnvironments } from './environmentCatalog.js';

const CREDENTIALS = { username: 'qase_user', accessKey: 'qase_key' };

test('credentials require both values; half-configured integrations return null', () => {
	assert.deepEqual(browserstackCredentials({
		BROWSERSTACK_USERNAME: 'user', BROWSERSTACK_ACCESS_KEY: 'key'
	}), { username: 'user', accessKey: 'key' });
	assert.equal(browserstackCredentials({ BROWSERSTACK_USERNAME: 'user' }), null);
	assert.equal(browserstackCredentials({ BROWSERSTACK_ACCESS_KEY: 'key' }), null);
	assert.equal(browserstackCredentials({}), null);
	// Whitespace-only values count as missing.
	assert.equal(browserstackCredentials({ BROWSERSTACK_USERNAME: '  ', BROWSERSTACK_ACCESS_KEY: ' ' }), null);
});

test('connect options carry the environment capability map verbatim', () => {
	const environments = generateEnvironments();
	const iPhone = environments.find(env => env.envId === 'ENV-IOS-IP16PRO-18.3-CHR-140');
	assert.ok(iPhone, 'catalog contains the spec example environment');
	const options = browserstackConnectOptions(iPhone, CREDENTIALS);
	assert.equal(options.endpointURL, 'https://cdp.browserstack.com/playwright');
	assert.deepEqual(options.httpCredentials, { username: 'qase_user', password: 'qase_key' });
	assert.deepEqual(options.capabilities, iPhone.runtimeCapabilities);
	assert.equal(options.capabilities.deviceName, 'iPhone 16 Pro');
	assert.equal(options.capabilities.realMobile, true);
});

test('connect options refuse environments that cannot execute on BrowserStack', () => {
	assert.equal(browserstackConnectOptions(null, CREDENTIALS), null);
	assert.equal(browserstackConnectOptions({ executionProvider: 'local' }, CREDENTIALS), null);
	assert.equal(browserstackConnectOptions({ executionProvider: 'environment' }, null), null);
	assert.equal(
		browserstackConnectOptions({ executionProvider: 'environment', runtimeCapabilities: null }, CREDENTIALS),
		null
	);
});

test('resolveExecution: browserstack envs with credentials execute remotely', () => {
	const environments = generateEnvironments();
	const macChrome = environments.find(env => env.envId.startsWith('ENV-MAC-SONOMA-CHR'));
	const resolved = resolveExecution(macChrome, CREDENTIALS);
	assert.equal(resolved.mode, 'environment');
	assert.match(resolved.label, /environment runtime/);
	assert.equal(resolved.connectOptions.capabilities.os, 'OS X');
	assert.equal(resolved.connectOptions.capabilities.osVersion, 'Sonoma');
});

test('resolveExecution: without credentials a browserstack env downgrades to labeled emulation', () => {
	const environments = generateEnvironments();
	const iPhoneSafari = environments.find(env => env.envId === 'ENV-IOS-IP16PRO-18.0-SAF-18.0');
	const resolved = resolveExecution(iPhoneSafari, null);
	assert.equal(resolved.mode, 'emulated');
	assert.match(resolved.label, /local \(emulated; remote runtime not configured\)/);
	assert.deepEqual(resolved.emulation.viewport, { width: 402, height: 874 });
	assert.equal(resolved.emulation.isMobile, true);
	assert.equal(resolved.emulation.hasTouch, true);
});

test('resolveExecution: no environment keeps the legacy default mode', () => {
	const resolved = resolveExecution(undefined, CREDENTIALS);
	assert.equal(resolved.mode, 'default');
	assert.equal(resolved.label, 'local browser (no environment)');
});

test('environmentEmulationOptions: desktop uses the default viewport; mobile uses catalog hints', () => {
	const environments = generateEnvironments();
	const mac = environments.find(env => env.platform === 'macos');
	assert.deepEqual(environmentEmulationOptions(mac), { viewport: { width: 1440, height: 900 }, acceptDownloads: true });

	const iPad = environments.find(env => env.platform === 'ipados');
	const options = environmentEmulationOptions(iPad);
	assert.equal(options.hasTouch, true);
	assert.equal(options.isMobile, true);
	assert.ok(options.viewport.width > 0);
	assert.equal(environmentEmulationOptions(undefined), undefined);
});

test('connectBrowserstack delegates to chromium.connectOverCDP with auth + capabilities', async () => {
	const calls = [];
	const fakeChromium = {
		connectOverCDP: async (endpointURL, options) => {
			calls.push({ endpointURL, options });
			return { fakeBrowser: true };
		}
	};
	const connectOptions = browserstackConnectOptions(
		generateEnvironments().find(env => env.envId === 'ENV-IOS-IP16PRO-18.3-CHR-140'), CREDENTIALS);
	const browser = await connectBrowserstack(fakeChromium, connectOptions);
	assert.equal(browser.fakeBrowser, true);
	assert.equal(calls[0].endpointURL, 'https://cdp.browserstack.com/playwright');
	assert.equal(calls[0].options.httpCredentials.username, 'qase_user');
	assert.equal(calls[0].options.capabilities.browserName, 'chrome');
	await assert.rejects(() => connectBrowserstack({}, connectOptions), /Playwright chromium API/);
});
