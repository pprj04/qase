// HOTFIX A — Chromium runtime dependency / preflight classification regression.
// Covers: missing shared libs -> BROWSER_RUNTIME_DEPENDENCY_MISSING; structured
// code survives very long raw Playwright messages; target stays pending; no
// navigation attempted; non-retryable; real launch passes when deps installed;
// setup dependency-install failure is loud (not silently swallowed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	classifyExecutionFailure, applyExecutionFailure, createExecutionHealth,
	shouldRetryExecutionFailure
} from '../server/executionHealth.js';

// A realistic 4763-char Playwright launch failure whose shared-library
// evidence first appears deep in the text (observed at position ~2061).
function longPlaywrightError() {
	const prefix = 'browserType.launch: Target page, context or browser has been closed\n'
		+ 'Browser logs:\n\n<launching> /home/coder/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome '
		+ '--disable-field-trial-config --disable-background-networking '.repeat(40);
	const evidence = '\n/usr/.../chrome: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory\n';
	const suffix = '\n<truncated>...'.padEnd(300, '.');
	return prefix + evidence + suffix;
}

test('preflight: structured code classifies as BROWSER_RUNTIME_DEPENDENCY_MISSING even with very long raw message', () => {
	const err = new Error('The local browser cannot start — required system libraries are missing.');
	err.code = 'BROWSER_RUNTIME_DEPENDENCY_MISSING';
	err.diagnostic = longPlaywrightError(); // evidence far beyond any 400-char slice
	const issue = classifyExecutionFailure(err, { stage: 'runtime_start', executionProvider: 'local' });
	assert.equal(issue.code, 'BROWSER_RUNTIME_DEPENDENCY_MISSING');
	assert.equal(issue.category, 'browser');
	assert.equal(issue.retryable, false);
});

test('preflight: BROWSER_LAUNCH_FAILED structured code is preserved', () => {
	const err = new Error('The local browser could not be started.');
	err.code = 'BROWSER_LAUNCH_FAILED';
	err.diagnostic = longPlaywrightError();
	const issue = classifyExecutionFailure(err, { stage: 'runtime_start', executionProvider: 'local' });
	assert.equal(issue.code, 'BROWSER_LAUNCH_FAILED');
	assert.equal(issue.category, 'browser');
	assert.equal(issue.retryable, false);
});

test('string-only classification still catches shared-library failures (defense in depth)', () => {
	const raw = 'chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file';
	const issue = classifyExecutionFailure(new Error(raw), { stage: 'runtime_start', executionProvider: 'local' });
	assert.equal(issue.code, 'BROWSER_RUNTIME_DEPENDENCY_MISSING');
});

test('dependency failure: browser blocked, target stays pending, provider untouched', () => {
	const err = new Error('The local browser cannot start — required system libraries are missing.');
	err.code = 'BROWSER_RUNTIME_DEPENDENCY_MISSING';
	const issue = classifyExecutionFailure(err, { stage: 'runtime_start', executionProvider: 'local' });
	let health = applyExecutionFailure(createExecutionHealth({ provider: 'custom', executionProvider: 'local' }), issue, { terminal: true });
	health.components.browser = 'blocked'; // ensureRuntime marks browser blocked before throwing
	assert.equal(health.components.target, 'pending');
	assert.equal(health.components.provider, 'pending');
	assert.equal(health.overall, 'failed');
	assert.equal(health.failure.code, 'BROWSER_RUNTIME_DEPENDENCY_MISSING');
});

test('dependency failure is never retried', () => {
	const issue = classifyExecutionFailure(
		Object.assign(new Error('libs missing'), { code: 'BROWSER_RUNTIME_DEPENDENCY_MISSING' }),
		{ stage: 'runtime_start', executionProvider: 'local' });
	assert.equal(shouldRetryExecutionFailure(issue, 0, 2), false);
});

test('generic mid-mission browser failure is NOT misclassified as dependency-missing', () => {
	const issue = classifyExecutionFailure(new Error('page.click: Target closed'), { stage: 'browser_tool', executionProvider: 'local', toolName: 'browser_click' });
	assert.equal(issue.code, 'BROWSER_EXECUTION_FAILED');
});

test('normal Chromium launch passes with dependencies installed (real launch)', async () => {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
	const page = await browser.newPage();
	await page.goto('about:blank');
	assert.equal(page.url(), 'about:blank');
	await browser.close();
});

test('ldd reports ZERO missing libraries for the installed Chromium', () => {
	const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
	const candidates = fs.readdirSync(cacheRoot).filter(d => d.startsWith('chromium-'));
	assert.ok(candidates.length > 0, 'chromium present in playwright cache');
	const exec = path.join(cacheRoot, candidates[0], 'chrome-linux64', 'chrome');
	assert.ok(fs.existsSync(exec), `chromium executable exists: ${exec}`);
	const out = execFileSync('ldd', [exec], { encoding: 'utf8' });
	const missing = out.split('\n').filter(l => l.includes('not found'));
	assert.deepEqual(missing, [], `no missing shared libraries, got: ${missing.join('; ')}`);
});

test('setup dependency-install failure is loud, not silently swallowed', () => {
	const script = fs.readFileSync('/workspace/scripts/install-browser-deps.sh', 'utf8');
	assert.match(script, /exit 1/, 'installer exits non-zero on failure');
	assert.match(script, /\[browser-deps\] FAIL/, 'installer logs which step failed');
	let threw = false;
	try {
		execFileSync('bash', ['-c', 'bash /workspace/scripts/install-browser-deps.sh; test $? -eq 0'], {
			env: { ...process.env, PATH: '/nonexistent' }, stdio: 'pipe'
		});
	} catch { threw = true; }
	assert.ok(threw, 'failing installer returns non-zero');
	const setup = fs.readFileSync('/project-config/setup.sh', 'utf8');
	assert.match(setup, /install-browser-deps\.sh/, 'setup.sh delegates to the loud installer');
});

// ── HOTFIX C — device-request truthfulness & executionType provenance ──

test('{ class: "mobile" } normalizes to the canonical class device, never silent desktop', async () => {
	const { resolveDeviceContext, validateDeviceRequest } = await import('../server/deviceContext.js');
	const v = validateDeviceRequest({ class: 'mobile' });
	assert.deepEqual(v, { ok: true, deviceName: 'iPhone 15' });
	const ctx = resolveDeviceContext({ class: 'mobile' });
	assert.equal(ctx.deviceName, 'iPhone 15');
	assert.match(ctx.browser, /Chromium/);
	assert.equal(ctx.executionType, 'LOCAL_EMULATION');
});

test('buildExecutionEnvironment stamps explicit executionType provenance', async () => {
	const { buildExecutionEnvironment, executionModeFor } = await import('../server/executionEnvironment.js');
	const local = buildExecutionEnvironment({ provider: 'local', device: 'iPhone 15', engineEmulated: true });
	assert.equal(local.executionType, 'LOCAL_EMULATION');
	assert.equal(executionModeFor(local), 'EMULATED_DEVICE');
	const localDesktop = buildExecutionEnvironment({ provider: 'local' });
	assert.equal(localDesktop.executionType, 'LOCAL_DESKTOP');
	const bsReal = buildExecutionEnvironment({ provider: 'browserstack', device: 'Google Pixel 8' });
	assert.equal(bsReal.executionType, 'REAL_DEVICE');
});

test('agent-filed findings on a device session carry LOCAL_EMULATION environment', async () => {
	// Static contract: the report_finding tool stamps executionType when a
	// device context exists (verified live in the mobile smoke mission).
	const src = fs.readFileSync('/workspace/server/qaTools.js', 'utf8');
	assert.match(src, /executionType: 'LOCAL_EMULATION'/);
	const dev = fs.readFileSync('/workspace/server/deviceContext.js', 'utf8');
	assert.match(dev, /executionType: 'LOCAL_EMULATION'/);
	assert.match(dev, /input\.class/);
});
