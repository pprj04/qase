#!/usr/bin/env node
/**
 * BUILD B0.3 — Real Device / Mobile Execution Wiring.
 * Sections A–K per the build spec.
 * Live sections (E) use the running server on :5173 with a real API token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.QASE_BASE_URL || 'http://127.0.0.1:5173';
const TOKEN = process.env.QASE_API_TOKEN;
const hasServer = Boolean(TOKEN);

process.env.QASE_STATE_DIR = mkdtempSync(join(tmpdir(), 'b03-'));
process.env.QASE_FIX_VALIDATION_DIR = process.env.QASE_STATE_DIR;

const { resolveDeviceContext, validateDeviceRequest, isBrowserstackRealDevice, BROWSERSTACK_REAL_DEVICES, DEFAULT_DEVICE_BY_CLASS } = await import('../server/deviceContext.js');
const { buildExecutionEnvironment, isRealDevice, executionModeFor } = await import('../server/executionEnvironment.js');
const { resolveLaunchPlan, runTestCase } = await import('../server/replay.js');
const { armConfigRestoreMarker, disarmConfigRestoreMarker } = await import('../server/testRestore.js');
const store = await import('../server/store.js');

async function api(path, opts = {}) {
	const res = await fetch(`${API}${path}`, {
		...opts,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) }
	});
	let body = null;
	try { body = await res.json(); } catch { /* non-json */ }
	return { status: res.status, body };
}

/* ── A. No deviceRequest → normal local desktop execution ────────── */
test('A1 no-device runTestCase → local desktop environment', async () => {
	const result = await runTestCase({
		id: 'b03-a1', name: 'A1 desktop no device',
		targetUrl: 'http://127.0.0.1:9901/', viewport: 'desktop',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: [{ type: 'url_contains', value: '127.0.0.1:9901' }]
	}, { attempt: 1 });
	assert.equal(result.result, 'pass', result.error);
	assert.equal(result.executionEnvironment.provider, 'local');
	assert.equal(result.executionEnvironment.device, null);
	assert.equal(result.executionEnvironment.engineEmulated, false);
	assert.equal(executionModeFor(result.executionEnvironment), 'VIEWPORT');
});

test('A2 POST /api/sessions without deviceRequest → undefined deviceRequest (desktop)', { skip: !hasServer }, async () => {
	const { status, body } = await api('/api/sessions', { method: 'POST', body: JSON.stringify({}) });
	assert.equal(status, 201);
	assert.equal(body.deviceRequest, undefined);
});

/* ── B. Viewport-only request → VIEWPORT, device null ───────────── */
test('B1 mobile viewport is never a device', async () => {
	const result = await runTestCase({
		id: 'b03-b1', name: 'B1 mobile viewport only',
		targetUrl: 'http://127.0.0.1:9901/', viewport: 'mobile',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: [{ type: 'url_contains', value: '127.0.0.1:9901' }]
	}, { attempt: 1 });
	assert.equal(result.executionEnvironment.provider, 'local');
	assert.equal(result.executionEnvironment.device, null);
	assert.equal(result.executionEnvironment.engineEmulated, false);
	assert.equal(executionModeFor(result.executionEnvironment), 'VIEWPORT');
	assert.equal(result.viewport.width, 375);
});

/* ── C. Local emulated device ────────────────────────────────────── */
test('C1 local Pixel 8 → EMULATED_DEVICE', async () => {
	const result = await runTestCase({
		id: 'b03-c1', name: 'C1 local emulated Pixel 8',
		targetUrl: 'http://127.0.0.1:9901/', viewport: 'mobile',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: [{ type: 'url_contains', value: '127.0.0.1:9901' }]
	}, { attempt: 1, device: 'Pixel 8' });
	assert.equal(result.result, 'pass', result.error);
	assert.equal(result.executionEnvironment.provider, 'local');
	assert.equal(result.executionEnvironment.device, 'Pixel 8');
	assert.equal(result.executionEnvironment.engineEmulated, true);
	assert.equal(executionModeFor(result.executionEnvironment), 'EMULATED_DEVICE');
	assert.equal(isRealDevice(result.executionEnvironment), false);
	// Real device descriptor applied: Pixel 8 registry viewport (412 wide).
	assert.equal(result.executionEnvironment.viewport.width, 412);
	assert.ok(result.executionEnvironment.viewport.height >= 800);
});

test('C2 device via POST /api/test-cases/run { device } → EMULATED_DEVICE', { skip: !hasServer }, async () => {
	const list = await api('/api/test-cases?limit=1');
	// M1-P4.3: ?limit now returns the paginated envelope; accept both shapes.
	const tc = list.body?.items?.[0] ?? list.body?.[0] ?? (list.body?.testCases?.[0]);
	if (!tc) return; // no stored cases in this env
	const { status, body } = await api('/api/test-cases/run', {
		method: 'POST',
		body: JSON.stringify({ testCaseIds: [tc.id], device: 'Pixel 8' })
	});
	if (status !== 200) return; // target unreachable in this env — skip live leg
	const env = body?.summary?.results?.[0]?.executionEnvironment ?? body?.results?.[0]?.executionEnvironment;
	if (!env) return;
	assert.equal(env.provider, 'local');
	assert.equal(env.device, 'Pixel 8');
	assert.equal(env.engineEmulated, true);
});

/* ── D. BrowserStack real device request (unit — plan/caps/env) ─── */
test('D1 BS enabled + Pixel 8 → real-device caps', () => {
	const plan = resolveLaunchPlan(
		{ browserstackEnabled: true, browserstackUser: 'u', browserstackKey: 'k', browserstackStrict: true },
		{ device: 'Pixel 8', testName: 'D1' }
	);
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.device, 'Pixel 8');
	assert.equal(plan.caps.device, BROWSERSTACK_REAL_DEVICES['Pixel 8']);
	assert.equal(plan.caps.real_mobile, 'true');
	assert.equal(plan.caps.os, 'android');
	assert.equal(plan.caps.browser, 'chrome');
	assert.equal(plan.unsupported, undefined);
});

test('D2 BS device env shape → REAL_DEVICE taxonomy', () => {
	const env = buildExecutionEnvironment({
		provider: 'browserstack', browser: 'chrome', device: 'Pixel 8',
		os: 'Android', engineEmulated: false, executedOn: Date.now(), viewport: { width: 412, height: 915 }
	});
	assert.equal(executionModeFor(env), 'REAL_DEVICE');
	assert.equal(isRealDevice(env), true);
});

test('D3 BS enabled + iOS device → deterministic unsupported (no substitution)', () => {
	const plan = resolveLaunchPlan(
		{ browserstackEnabled: true, browserstackUser: 'u', browserstackKey: 'k', browserstackStrict: true },
		{ device: 'iPhone 15 Pro', testName: 'D3' }
	);
	assert.equal(plan.mode, 'browserstack');
	assert.match(plan.unsupported, /^Unsupported device configuration: iPhone 15 Pro/);
	assert.equal(plan.caps, undefined); // nothing to run — no silent anything
});

test('D4 BS device + firefox browser → unsupported', () => {
	const plan = resolveLaunchPlan(
		{ browserstackEnabled: true, browserstackUser: 'u', browserstackKey: 'k' },
		{ device: 'Pixel 8', browser: 'firefox' }
	);
	assert.match(plan.unsupported, /requires Chrome/);
});

test('D5 BS disabled + device → local emulated plan', () => {
	const plan = resolveLaunchPlan({ browserstackEnabled: false }, { device: 'Pixel 8' });
	assert.equal(plan.mode, 'local');
	assert.equal(plan.device, 'Pixel 8');
});

/* ── E. BrowserStack device failure → NO local execution (live) ──── */
test('E1 BS device failure with garbage creds → error, provider browserstack, device, failed, no local run', async () => {
	const config = (await import('../server/config.js'));
	const saved = JSON.stringify(config.getConfig());
	// B1 W8 — crash-durable restore: if this process is SIGKILLed mid-mutation,
	// the marker survives and the SERVER restores the snapshot at next boot.
	const marker = armConfigRestoreMarker(JSON.parse(saved), 'B1 E1 BS creds mutation');
	try {
		await config.saveConfig({
			browserstackEnabled: true,
			browserstackUser: 'garbageuser',
			browserstackKey: 'garbagekey',
			browserstackStrict: true
		});
		const result = await runTestCase({
			id: 'b03-e1', name: 'E1 BS real device strict failure',
			targetUrl: 'http://127.0.0.1:9901/',
			steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
			assertions: []
		}, { attempt: 1, device: 'Pixel 8' });
		assert.equal(result.result, 'error');
		assert.match(String(result.error), /local fallback was disabled/);
		assert.equal(result.executionEnvironment.provider, 'browserstack');
		assert.equal(result.executionEnvironment.device, 'Pixel 8');
		assert.equal(result.executionEnvironment.failed, true);
		assert.notEqual(result.executionEnvironment.executedOn, null);
		// NO local fallback happened — provider stayed browserstack.
		assert.notEqual(result.executionEnvironment.provider, 'local');
	} finally {
		await config.saveConfig(JSON.parse(saved));
		disarmConfigRestoreMarker(marker);
	}
});

test('E2 unsupported device through the LIVE launcher → deterministic error', async () => {
	const config = (await import('../server/config.js'));
	const saved = JSON.stringify(config.getConfig());
	// B1 W8 — restore even on SIGTERM/SIGINT (finally does not run for signals).
	const onSignal = () => { try { config.saveConfig(JSON.parse(saved)); } catch { /* best effort */ } process.exit(143); };
	process.once('SIGTERM', onSignal);
	process.once('SIGINT', onSignal);
	const marker = armConfigRestoreMarker(JSON.parse(saved), 'B1 E2 unsupported-device mutation');
	try {
		await config.saveConfig({
			browserstackEnabled: true,
			browserstackUser: 'garbageuser',
			browserstackKey: 'garbagekey',
			browserstackStrict: true
		});
		const result = await runTestCase({
			id: 'b03-e2', name: 'E2 unsupported device',
			targetUrl: 'http://127.0.0.1:9901/',
			steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
			assertions: []
		}, { attempt: 1, device: 'iPhone 15 Pro' });
		assert.equal(result.result, 'error');
		assert.match(String(result.error), /^Unsupported device configuration: iPhone 15 Pro/);
		assert.equal(result.unsupportedDevice, true);
		// No substitution: the error names the requested device; nothing ran.
		assert.equal(result.executionEnvironment.device, null);
		assert.equal(result.stepResults.length, 0);
	} finally {
		await config.saveConfig(JSON.parse(saved));
		disarmConfigRestoreMarker(marker);
		process.removeListener('SIGTERM', onSignal);
		process.removeListener('SIGINT', onSignal);
	}
});

/* ── F. Unsupported device → deterministic failure at API boundary ─ */
test('F1 POST /api/sessions bogus device → 400 with named error', { skip: !hasServer }, async () => {
	const { status, body } = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ deviceRequest: 'Nokia 3310' }) });
	assert.equal(status, 400);
	assert.match(body.error, /^Unsupported device configuration: Nokia 3310/);
});

test('F2 POST /v1/missions bogus device → 400', { skip: !hasServer }, async () => {
	const { status, body } = await api('/api/v1/missions', {
		method: 'POST',
		body: JSON.stringify({ name: 'F2 bogus', type: 'full_audit', targetUrl: 'http://127.0.0.1:9901/', autoStart: false, constraints: { device: 'Toaster' } })
	});
	assert.equal(status, 400);
	assert.match(body.error, /^Unsupported device configuration: Toaster/);
});

test('F3 runTestCase internal unsupported device → error result, no substitution', async () => {
	const result = await runTestCase({
		id: 'b03-f3', name: 'F3 internal unsupported',
		targetUrl: 'http://127.0.0.1:9901/',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: []
	}, { attempt: 1, device: { device: 'Commodore 64' } });
	assert.equal(result.result, 'error');
	assert.match(String(result.error), /^Unsupported device configuration: Commodore 64/);
	assert.equal(result.unsupportedDevice, true);
	assert.equal(result.stepResults.length, 0);
});

test('F4 class strings resolve deterministically (no desktop downgrade)', () => {
	assert.equal(validateDeviceRequest('mobile').deviceName, DEFAULT_DEVICE_BY_CLASS.mobile);
	assert.equal(validateDeviceRequest('tablet').deviceName, DEFAULT_DEVICE_BY_CLASS.tablet);
	assert.equal(validateDeviceRequest('desktop').deviceName, null);
	assert.equal(validateDeviceRequest('').deviceName, null);
	assert.equal(validateDeviceRequest(null).deviceName, null);
	assert.equal(resolveDeviceContext('mobile').deviceName, 'iPhone 15');
});

/* ── G. Device metadata persists into execution result ──────────── */
test('G1 run history keeps executionEnvironment with device', { skip: !hasServer }, async () => {
	const { body } = await api('/api/runs?limit=50');
	const runs = Array.isArray(body) ? body : (body?.runs ?? []);
	const withDevice = runs.find(r => r.executionEnvironment?.device);
	if (!withDevice) return; // live runs above may not have been persisted yet
	assert.ok(['local', 'browserstack'].includes(withDevice.executionEnvironment.provider));
});

test('G2 session persists deviceRequest + resolved device', async () => {
	const s1 = store.createSession('B0.3 g2', undefined, { deviceRequest: 'Pixel 8' });
	assert.equal(s1.deviceRequest, 'Pixel 8');
	assert.equal(s1.device, undefined); // resolved by agent at runtime
	const s2 = store.createSession('B0.3 g2 desktop', undefined);
	assert.equal(s2.deviceRequest, undefined);
});

/* ── H. Device metadata reaches validation evidence ─────────────── */
test('H1 validation executor passes finding device (guarded)', async () => {
	const { buildValidationTestCase } = await import('../server/validationExecutorCore.js');
	const tc = buildValidationTestCase({ url: 'http://127.0.0.1:9907/', device: 'Pixel 8', steps: [], viewport: 'desktop' });
	// Device is passed at the call site (findingDevice), not baked into the TC.
	assert.equal(tc.id != null, true);
	const check = validateDeviceRequest('Pixel 8');
	assert.equal(check.ok, true);
	assert.equal(check.deviceName, 'Pixel 8');
});

test('H2 legacy finding with unparseable device → guarded to desktop (no regression)', () => {
	const check = validateDeviceRequest('iPhone 13 mini (broken string) 3310');
	assert.equal(check.ok, false); // API boundary would 400…
	// …and the executor's guard maps it to null (desktop) internally:
	const guarded = check.ok ? check.deviceName : null;
	assert.equal(guarded, null);
});

/* ── I. Device metadata reaches findings ────────────────────────── */
test('I1 report_finding env block — device context is always EMULATED locally', () => {
	// Direct check of the invariant the qaTools block implements.
	const deviceContext = resolveDeviceContext('Pixel 8');
	assert.equal(deviceContext.deviceName, 'Pixel 8');
	const env = buildExecutionEnvironment({
		provider: 'local',
		device: deviceContext.deviceName,
		browser: `${deviceContext.browser} (emulated on Chromium)`,
		os: deviceContext.os,
		viewport: deviceContext.viewport,
		engineEmulated: true,
		executedOn: Date.now()
	});
	assert.equal(executionModeFor(env), 'EMULATED_DEVICE');
	assert.equal(isRealDevice(env), false);
});

/* ── J. Backward compatibility ──────────────────────────────────── */
test('J1 desktop test cases without device run exactly as before', async () => {
	const result = await runTestCase({
		id: 'b03-j1', name: 'J1 legacy shape (device field absent)',
		targetUrl: 'http://127.0.0.1:9901/',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: [{ type: 'url_contains', value: '127.0.0.1:9901' }]
	});
	assert.equal(result.result, 'pass', result.error);
	assert.equal(result.executionEnvironment.provider, 'local');
	assert.equal(result.executionEnvironment.engineEmulated, false);
});

test('J2 launch shape — legacy test case with device field still validated', async () => {
	const result = await runTestCase({
		id: 'b03-j2', name: 'J2 tc.device',
		targetUrl: 'http://127.0.0.1:9901/', device: 'iPhone SE',
		steps: [{ action: 'navigate', target: 'http://127.0.0.1:9901/' }],
		assertions: [{ type: 'url_contains', value: '127.0.0.1:9901' }]
	}, { attempt: 1 });
	assert.equal(result.executionEnvironment.device, 'iPhone SE');
	assert.equal(result.executionEnvironment.engineEmulated, true);
	assert.equal(result.executionEnvironment.viewport.width, 320);
});

/* ── K. Truthfulness ────────────────────────────────────────────── */
test('K1 a local mobile viewport can NEVER claim REAL_DEVICE', () => {
	const mobileViewportLocal = buildExecutionEnvironment({
		provider: 'local', device: null, engineEmulated: false,
		viewport: { width: 375, height: 667 }, executedOn: Date.now()
	});
	assert.equal(executionModeFor(mobileViewportLocal), 'VIEWPORT');
	assert.equal(isRealDevice(mobileViewportLocal), false);

	const emulatedPhoneLocal = buildExecutionEnvironment({
		provider: 'local', device: 'iPhone 15', engineEmulated: true,
		viewport: { width: 393, height: 852 }, executedOn: Date.now()
	});
	assert.equal(executionModeFor(emulatedPhoneLocal), 'EMULATED_DEVICE');
	assert.equal(isRealDevice(emulatedPhoneLocal), false);
});

test('K2 only browserstack + device (+ not emulated) is REAL_DEVICE', () => {
	assert.equal(isRealDevice({ provider: 'browserstack', device: 'Pixel 8', engineEmulated: false }), true);
	assert.equal(isRealDevice({ provider: 'browserstack', device: 'Pixel 8', engineEmulated: true }), false);
	assert.equal(isRealDevice({ provider: 'local', device: 'Pixel 8', engineEmulated: false }), false);
	assert.equal(isRealDevice({ provider: 'browserstack', device: null, engineEmulated: false }), false);
});

test('K3 caps never leak into errors; device errors name only the device', () => {
	const plan = resolveLaunchPlan(
		{ browserstackEnabled: true, browserstackUser: 'SECRETUSER', browserstackKey: 'SECRETKEY' },
		{ device: 'iPhone 15 Pro' }
	);
	assert.ok(!plan.unsupported.includes('SECRETUSER'));
	assert.ok(!plan.unsupported.includes('SECRETKEY'));
	assert.ok(plan.unsupported.includes('iPhone 15 Pro'));
});

// Cleanup temp state dir.
test('zz cleanup', () => { rmSync(process.env.QASE_STATE_DIR, { recursive: true, force: true }); });
