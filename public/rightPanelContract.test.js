import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* UI Fix Phase 3 — source-contract tests: right-panel device card reads the
 * single view-model; sidebar has no Device Matrix/Environments primary
 * entry; Device Management lives under Settings; the dock chip reads the
 * store; Results targets run history. */

test('settings dialog hosts Device Management; sidebar foot has no admin entries', async () => {
	const html = await readFile('public/index.html', 'utf8');
	const settingsBlock = html.slice(html.indexOf('id="settings"'), html.indexOf('</dialog>', html.indexOf('id="settings"')));
	assert.match(settingsBlock, /id="open-device-matrix"/, 'open-device-matrix must live inside #settings');
	const footStart = html.indexOf('<footer class="panel-foot">');
	const foot = html.slice(footStart, html.indexOf('</footer>', footStart));
	assert.ok(!foot.includes('open-device-matrix'), 'sidebar foot must not list Device Matrix');
	assert.ok(!foot.includes('open-environments'), 'sidebar foot must not list Environments');
	for (const everyday of ['open-profile', 'open-settings', 'open-test-cases', 'open-bulk-run']) {
		assert.ok(foot.includes(everyday), `foot should keep ${everyday}`);
	}
});

test('device details buttons target the Settings-hosted Device Management entry', async () => {
	const app = await readFile('public/app.js', 'utf8');
	const wire = app.slice(app.indexOf('wireEnvironmentCardActions'));
	assert.match(wire, /getElementById\('open-device-matrix'\)\?\.click\(\)/);
});

test('dock chip reads the active selection via the store accessor, not drawer state', async () => {
	const drawer = await readFile('public/deviceDrawer.js', 'utf8');
	const paint = drawer.slice(drawer.indexOf('function paintChip'), drawer.indexOf('// ── Drawer sections'));
	assert.match(paint, /__qaseActiveSelection\?\.\(\)/);
	assert.ok(!/^\t\tconst envId = state\.defaultEnvId/m.test(paint), 'the store must be the first source');
	const app = await readFile('public/app.js', 'utf8');
	assert.match(app, /__qaseActiveSelection = \(\) => activeTestEnvStore\.get\(\)/);
});

test('chip execution label comes from requested/attested levels only (honest)', async () => {
	const drawer = await readFile('public/deviceDrawer.js', 'utf8');
	const paint = drawer.slice(drawer.indexOf('function paintChip'), drawer.indexOf('// ── Drawer sections'));
	assert.match(paint, /executionLevelRequested \?\? env\.runtimeAttestedLevel \?\? null/);
	assert.ok(!paint.includes('env.isRealDevice'), 'catalog isRealDevice must not drive the chip badge');
});

test('Results quick action refreshes run history instead of a phantom foot click', async () => {
	const app = await readFile('public/app.js', 'utf8');
	const qa = app.slice(app.indexOf('quickActions.viewResults'), app.indexOf('quickActions.createBug'));
	assert.match(qa, /refreshRuns\(\)/);
	assert.ok(!qa.includes('panel-foot .foot-btn'), 'must not click a random foot button');
});

test('runtime status vocabulary covers the agreed states via one map', async () => {
	const are = await readFile('public/activeRuntimeEnvironment.js', 'utf8');
	const fn = are.slice(are.indexOf('export function runtimeStatusFor'), are.indexOf('export function executionTypeFor'));
	for (const word of ['queued', 'connecting', 'running', 'completed', 'failed', 'device_unavailable']) {
		assert.ok(fn.includes(`'${word}'`), `runtimeStatusFor must produce '${word}'`);
	}
	// The right-panel renderer reads only this vocabulary.
	const app = await readFile('public/app.js', 'utf8');
	const header = app.slice(app.indexOf('function renderLiveDeviceViewHeader'), app.indexOf('/* Environment card'));
	for (const word of ['RESERVING', 'CONNECTING', 'CONNECTED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEVICE UNAVAILABLE']) {
		assert.ok(header.includes(word), `live header must render '${word}'`);
	}
});
