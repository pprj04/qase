import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLiveDevicePresentation } from '../public/deviceLiveView.js';
import { buildQaContext } from '../server/prompt.js';
import { createQaTools } from '../server/qaTools.js';

const iphone = {
	deviceName: 'iPhone SE',
	deviceType: 'phone',
	viewport: { width: 320, height: 568 }
};

test('live phone shell uses the selected device before the first frame', () => {
	const result = resolveLiveDevicePresentation({ device: iphone });
	assert.equal(result.kind, 'phone');
	assert.deepEqual(result.viewport, { width: 320, height: 568 });
	assert.equal(result.frameAspect, '336 / 596');
	assert.equal(result.captured, false);
});

test('live phone shell follows the captured viewport rather than stale device metadata', () => {
	const result = resolveLiveDevicePresentation({
		device: iphone,
		capturedViewport: { width: 375, height: 667 }
	});
	assert.equal(result.kind, 'phone');
	assert.deepEqual(result.viewport, { width: 375, height: 667 });
	assert.equal(result.frameAspect, '391 / 695');
	assert.equal(result.captured, true);
});

test('a desktop capture is never wrapped in a selected phone shell', () => {
	const result = resolveLiveDevicePresentation({
		device: iphone,
		capturedViewport: { width: 1440, height: 900 }
	});
	assert.equal(result.kind, 'desktop');
	assert.equal(result.frameAspect, null);
});

test('device runs tell the agent not to resize their locked viewport', () => {
	const prompt = buildQaContext({
		targetUrl: 'https://example.test', secretNames: [], device: iphone, maxTurns: 10, turnCount: 0
	});
	assert.match(prompt, /Do NOT call set_viewport/);
	assert.match(prompt, /320×568/);
});

test('the viewport tool rejects a resize during a device execution', async () => {
	const tools = createQaTools({ id: 'device-run', device: iphone, findings: [], secretNames: [] });
	const viewportTool = tools.find(tool => tool.name === 'set_viewport');
	const result = await viewportTool.run({ width: 375, height: 667 });
	assert.equal(result.success, false);
	assert.match(result.error, /Viewport is locked/);
});
