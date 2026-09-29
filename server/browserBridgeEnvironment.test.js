import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBrowserBridge } from './browserBridge.js';
import { generateEnvironments } from './environmentCatalog.js';
import { resolveExecution } from './browserstackProvider.js';

function minimalSession(overrides = {}) {
	return {
		id: '00000000-0000-4000-8000-000000000009',
		title: 'Env run',
		targetUrl: 'https://example.com/',
		device: 'desktop',
		deviceLandscape: false,
		...overrides
	};
}

function fakeService() {
	const page = {
		isClosed: () => false,
		url: () => 'https://example.com/start',
		title: async () => 'Target',
		viewportSize: () => ({ width: 1440, height: 900 }),
		waitForLoadState: async () => undefined
	};
	const context = {
		routes: [],
		addInitScript: async () => {},
		route: async () => { context.routes.push('route'); }
	};
	const browser = {
		contexts: () => [context],
		newContext: async () => context,
		close: async () => { browser.closed = true; }
	};
	return {
		page, context, browser,
		service: {
			activePage: page,
			context,
			options: {},
			snapshot: async () => ({ elements: [] }),
			ensurePage: async () => page,
			locator: async () => fakeLocator(),
			fill: async () => {},
			typeText: async () => {},
			open: async () => {},
			click: async () => {},
			close: async () => {}
		}
	};
}

function fakeLocator() {
	const locator = { filter: () => locator, count: async () => 0, first: () => locator };
	return locator;
}

test('a browserstack environment resolves remote execution and never launches local chromium', async t => {
	const environments = generateEnvironments();
	const snapshot = environments.find(env => env.envId === 'ENV-IOS-IP16PRO-18.3-CHR-140');
	const session = minimalSession({ environmentSnapshot: snapshot });
	const fake = fakeService();

	const execution = resolveExecution(snapshot, { username: 'u', accessKey: 'k' });
	assert.equal(execution.mode, 'browserstack');

	// The bridge surfaces the execution plan for the UI/reports.
	const bridge = attachBrowserBridge(session, fake.service, stubStore(), {
		execution,
		environment: snapshot
	});
	assert.equal(bridge.execution.mode, 'browserstack');
	assert.match(bridge.execution.label, /BrowserStack real device/);
	t.after(() => bridge.dispose());
});

test('without credentials the same environment downgrades to emulated with the device viewport', async t => {
	const environments = generateEnvironments();
	const snapshot = environments.find(env => env.envId === 'ENV-IOS-IP16PRO-18.3-CHR-140');
	const session = minimalSession({ environmentSnapshot: snapshot });
	const fake = fakeService();

	const bridge = attachBrowserBridge(session, fake.service, stubStore(), {
		environment: snapshot,
		browserstackCredentials: null
	});
	assert.equal(bridge.execution.mode, 'emulated');
	assert.match(bridge.execution.label, /local \(emulated; BrowserStack credentials not configured\)/);
	t.after(() => bridge.dispose());
});

function stubStore() {
	return { commit: async () => {}, addMessage: async () => {} };
}
