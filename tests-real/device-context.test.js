/**
 * Device context + device live view tests
 *
 * Covers:
 *   - resolveDeviceContext for named devices, aliases, structured requests,
 *     and desktop/null passthrough
 *   - context option mapping (UA / viewport / DPR / touch)
 *   - describeDevice labels
 *   - viewport classification thresholds used by the live view UI
 *   - session deviceRequest plumbing into createSession
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeviceContext, describeDevice, contextOptionsFor } from '../server/deviceContext.js';

test('resolveDeviceContext: named phone returns full context', () => {
	const ctx = resolveDeviceContext('iPhone 15 Pro');
	assert.ok(ctx, 'should resolve');
	assert.equal(ctx.deviceName, 'iPhone 15 Pro');
	assert.equal(ctx.deviceType, 'phone');
	assert.equal(ctx.viewport.width, 393);
	assert.equal(ctx.viewport.height, 659);
	assert.equal(ctx.hasTouch, true);
	assert.equal(ctx.isMobile, true);
	assert.ok(ctx.userAgent.includes('iPhone'), 'UA must be the real device UA');
});

test('resolveDeviceContext: android alias (case-insensitive)', () => {
	const ctx = resolveDeviceContext('pixel 8');
	assert.equal(ctx.deviceName, 'Pixel 8');
	assert.equal(ctx.deviceType, 'phone');
	assert.equal(ctx.os, 'Android 14');
	// HOTFIX C — local execution always runs Chromium; the label states the
	// actual engine, never the emulated platform browser as if real.
	assert.equal(ctx.browser, 'Chromium');
});

test('resolveDeviceContext: tablet classification', () => {
	const ctx = resolveDeviceContext({ device: 'iPad Pro 11' });
	assert.equal(ctx.deviceType, 'tablet');
	assert.equal(ctx.viewport.width, 834);
});

test('resolveDeviceContext: desktop requests return null', () => {
	assert.equal(resolveDeviceContext(null), null);
	assert.equal(resolveDeviceContext(''), null);
	assert.equal(resolveDeviceContext('desktop'), null);
	assert.equal(resolveDeviceContext('Desktop'), null);
	assert.equal(resolveDeviceContext('default'), null);
	assert.equal(resolveDeviceContext({ device: 'none' }), null);
	assert.equal(resolveDeviceContext({}), null);
	assert.equal(resolveDeviceContext({ device: 42 }), null, 'non-string device value');
});

test('resolveDeviceContext: unknown device returns null (no fake fallback)', () => {
	assert.equal(resolveDeviceContext('Commodore 64'), null);
	assert.equal(resolveDeviceContext('Samsung Fridge'), null);
});

test('contextOptionsFor maps the real descriptor fields', () => {
	const ctx = resolveDeviceContext('iPhone 15 Pro');
	const options = contextOptionsFor(ctx);
	assert.equal(options.viewport.width, 393);
	assert.equal(options.viewport.height, 659);
	assert.equal(options.userAgent, ctx.userAgent);
	assert.equal(options.deviceScaleFactor, 3);
	assert.equal(options.isMobile, true);
	assert.equal(options.hasTouch, true);
});

test('describeDevice produces a human label', () => {
	const ctx = resolveDeviceContext('Pixel 8');
	assert.match(describeDevice(ctx), /Pixel 8/);
	assert.match(describeDevice(ctx), /Android 14/);
	assert.equal(describeDevice(null), 'Desktop · 1440×900');
});

test('viewport classification (live view thresholds)', async () => {
	const { classifyViewport } = await import('../public/deviceClassify.js');
	// Phones
	assert.equal(classifyViewport({ width: 393, height: 659 }), 'phone');
	assert.equal(classifyViewport({ width: 412, height: 839 }), 'phone');
	assert.equal(classifyViewport({ width: 320, height: 568 }), 'phone');
	// Tablets (portrait)
	assert.equal(classifyViewport({ width: 768, height: 1024 }), 'tablet');
	assert.equal(classifyViewport({ width: 834, height: 1194 }), 'tablet');
	// Tablet landscape
	assert.equal(classifyViewport({ width: 1194, height: 834 }), 'tablet');
	assert.equal(classifyViewport({ width: 1024, height: 768 }), 'tablet');
	// Desktop stays desktop
	assert.equal(classifyViewport({ width: 1440, height: 900 }), 'desktop');
	assert.equal(classifyViewport({ width: 1920, height: 1080 }), 'desktop');
	// No viewport — desktop
	assert.equal(classifyViewport(null), 'desktop');
	assert.equal(classifyViewport({}), 'desktop');
	// Desktop resized small in height only must NOT become a phone
	assert.equal(classifyViewport({ width: 900, height: 400 }), 'desktop');
});

test('createSession accepts deviceRequest option', async () => {
	const store = await import('../server/store.js');
	const session = store.createSession('device test', undefined, { deviceRequest: 'Pixel 8' });
	assert.equal(session.deviceRequest, 'Pixel 8');
	assert.equal(session.device, undefined, 'device set only after runtime applies it');
	const plain = store.createSession('plain', undefined, {});
	assert.equal(plain.deviceRequest, undefined);
	// cleanup
	store.deleteSession(session.id);
	store.deleteSession(plain.id);
});
