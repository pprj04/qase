import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { attachBrowserBridge } from './browserBridge.js';

class FakeRunStore {
	commit() { return Promise.resolve(); }
	subscribe() { return () => undefined; }
	publish() {}
}

test('readRuntimeFacts reports the emulated iPhone UA and viewport honestly (integration)', async () => {
	const browser = await chromium.launch({ headless: true });
	// The bridge overrides ensureContext/ensurePage itself; a minimal service
	// that only knows how to launch the shared browser is enough.
	const service = {
		browser: undefined,
		context: undefined,
		activePage: undefined,
		options: { headless: true },
		pages() { return service.context?.pages?.() ?? []; },
		async ensureContext() {
			if (!service.context) {
				service.browser ??= browser;
				service.context = await service.browser.newContext();
			}
			return service.context;
		},
		async ensurePage() {
			const context = await service.ensureContext();
			if (!service.activePage || service.activePage.isClosed()) {
				service.activePage = await context.newPage();
			}
			return service.activePage;
		},
		registerPage(page) { service.activePage = page; },
		async snapshot() { return { elements: [] }; },
		async locator(page, input) { return page.locator('body'); },
		async fill() {},
		async typeText() {},
		async suspend() {},
		async restoreSession() {},
		async getDiagnostics() { return {}; }
	};
	const environment = {
		envId: 'ENV-IOS-IP16PRO-18.3-SAF-18.3',
		platform: 'ios',
		device: 'iPhone 16 Pro',
		osVersion: '18.3',
		browserCode: 'safari',
		deviceType: 'mobile',
		executionProvider: 'local',
		emulation: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
		permissionScenario: { camera: 'deny' },
		orientationScenario: 'portrait'
	};
	try {
		const bridge = attachBrowserBridge({}, service, new FakeRunStore(), { environment });

		// Honest level facts are available immediately.
		assert.equal(bridge.execution.level, 'SIMULATED');
		assert.equal(bridge.execution.provider, 'local');
		assert.match(bridge.execution.emulatedUserAgent, /iPhone/);

		// The bridge's overridden ensureContext creates the emulated context.
		const context = await service.ensureContext();
		const page = await service.ensurePage();
		await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);

		const facts = await bridge.readRuntimeFacts();
		assert.ok(facts, 'facts available once a page exists');
		assert.match(facts.userAgent, /iPhone/, 'the page actually saw the iPhone UA');
		assert.equal(facts.viewport.width, 393, 'observed viewport is the emulation viewport');
		assert.equal(facts.viewport.height, 852);
		assert.equal(facts.maxTouchPoints, 5, 'touch emulation is active');
		assert.equal(facts.devicePixelRatio, 3, 'DPR 3 from the catalog profile');
		// Context-level cached facts (read at context creation) agree.
		assert.match(bridge.runtimeFacts.userAgent, /iPhone/);
	} finally {
		await browser.close().catch(() => {});
		process.exit(0);
	}
});
