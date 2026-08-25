/**
 * B0 regression tests — export URLs, tests-page run wiring, config authority.
 *
 * Guards the two B0 UI fixes + the config precedence contract:
 *   1. Export endpoints must build URLs WITH the /api prefix (was 404).
 *   2. Tests-page run-all must NOT hardcode concurrency/retries.
 *   3. Config precedence: stored .qase/config.json beats env for generic
 *      fields; BrowserStack fields follow the stored-beats-env carve-out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const testsJs = readFileSync(new URL('../public/tests.js', import.meta.url), 'utf8');

test('B0-1: every export URL in app.js handleExport carries the /api prefix', () => {
	const urls = [...appJs.matchAll(/url = `([^`]+)`;/g)].map(m => m[1]);
	assert.ok(urls.length >= 6, `expected >=6 export URLs, found ${urls.length}`);
	for (const url of urls) {
		assert.ok(url.startsWith('/api/'), `export URL missing /api prefix: ${url}`);
	}
});

test('B0-1: bugs.js export URLs also carry the /api prefix (regression guard)', () => {
	const bugsJs = readFileSync(new URL('../public/bugs.js', import.meta.url), 'utf8');
	const urls = [...bugsJs.matchAll(/fetch\(`([^`]+)`\)/g)].map(m => m[1]);
	for (const url of urls) {
		assert.ok(url.startsWith('/api') || url.startsWith('http'), `bugs.js fetch without /api prefix: ${url}`);
	}
});

test('B0-2: tests.js run-all no longer hardcodes concurrency or retries', () => {
	assert.ok(!testsJs.includes('concurrency: 3'), 'hardcoded concurrency: 3 is back');
	assert.ok(!/retries:\s*0/.test(testsJs), 'hardcoded retries: 0 is back');
	// The request body must still pass the ids (the run call itself stays).
	assert.ok(testsJs.includes("'/test-cases/run'"), 'run-all endpoint call missing');
});

test('B0-2: tests.js single-run no longer sends a dead credentials literal', () => {
	// The old code computed credentials as `undefined : undefined` — dead
	// expression. The fix sends an empty object; keep it from regressing.
	assert.ok(!testsJs.includes('? undefined\n\t\t\t: undefined'), 'dead credentials ternary is back');
});

test('B0-3: config merge order — stored overrides env for generic fields', () => {
	const configJs = readFileSync(new URL('../server/config.js', import.meta.url), 'utf8');
	// The merge loop must apply fromEnv() BEFORE readStored() so stored wins.
	const envIdx = configJs.indexOf('for (const source of [fromEnv(), readStored()])');
	assert.ok(envIdx > -1, 'config merge loop (env then stored) not found');
});

test('B0-3: BrowserStack carve-out — stored user/key/enable beat env', () => {
	const configJs = readFileSync(new URL('../server/config.js', import.meta.url), 'utf8');
	assert.ok(configJs.includes('storedBs.browserstackUser'), 'BS user carve-out missing');
	assert.ok(configJs.includes('storedBs.browserstackKey'), 'BS key carve-out missing');
	assert.ok(configJs.includes('storedBs.browserstackEnabled'), 'BS enable carve-out missing');
});
