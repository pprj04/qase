import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const ROOT = new URL('..', import.meta.url).pathname;

/*
 * P0-F1 — BrowserStack configuration is validated BEFORE execution.
 *
 * The live defect: browserstackEnabled=true with a username but no stored key
 * made resolveLaunchPlan silently plan LOCAL for replay runs (and, before the
 * enc-envelope was cleared, build caps with an empty access key). Runs then
 * either executed locally while claiming browserstack provenance, or errored
 * with an unexplained CDP auth failure. Required behavior (P0-F1):
 *   - enabled + incomplete credentials → deterministic provider failure,
 *     mode:'error', code 'invalid_credentials', BEFORE any launch attempt
 *   - never silently local, never a phantom browserstack claim
 *   - complete credentials still plan browserstack
 *   - provider not enabled → local unchanged
 */

const baseConfig = (over = {}) => ({
	browserstackEnabled: false,
	browserstackUser: '',
	browserstackKey: '',
	browserstackStrict: true,
	...over
});

test('TEST A · complete BrowserStack config still plans browserstack (desktop caps)', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveLaunchPlan(baseConfig({
		browserstackEnabled: true,
		browserstackUser: 'user-a',
		browserstackKey: 'key-a'
	}), { device: null, browser: 'chrome' });
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.caps?.['browserstack.username'], 'user-a');
	assert.equal(plan.caps?.['browserstack.accessKey'], 'key-a');
	assert.equal(plan.strict, true);
});

test('TEST A · complete BrowserStack config still plans browserstack (real device)', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	// The contract takes a RESOLVED PLAYWRIGHT device name (the descriptor
	// key); the caps carry the BrowserStack display name it maps to.
	const plan = resolveLaunchPlan(baseConfig({
		browserstackEnabled: true,
		browserstackUser: 'user-a',
		browserstackKey: 'key-a'
	}), { device: 'Pixel 7', browser: 'chrome' });
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.caps?.device, 'Google Pixel 7');
});

test('TEST B · enabled + user only (key missing) → mode error invalid_credentials, no launch', async () => {
	const { resolveLaunchPlan, validateBrowserstackConfig } = await import('../server/browserstackCaps.js');
	const cfg = baseConfig({ browserstackEnabled: true, browserstackUser: 'user-a', browserstackKey: '' });
	const check = validateBrowserstackConfig(cfg);
	assert.equal(check.ok, false);
	assert.equal(check.code, 'invalid_credentials');
	const plan = resolveLaunchPlan(cfg, {});
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'invalid_credentials');
	assert.ok(plan.error.length > 40, 'actionable message');
	assert.ok(!plan.error.includes('key-a'), 'message carries no credential material');
	// strict by default even though browserstackStrict:true was set —
	// config errors must never fall back locally.
	assert.equal(plan.strict, true);
});

test('TEST B · enabled + key only (user missing) → mode error invalid_credentials', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveLaunchPlan(baseConfig({
		browserstackEnabled: true, browserstackUser: '', browserstackKey: 'key-a'
	}), {});
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'invalid_credentials');
});

test('TEST B · enabled with NO credentials stored at all → mode error (not silent local)', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveLaunchPlan(baseConfig({ browserstackEnabled: true }), {});
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'invalid_credentials');
});

test('TEST C · error plan is never local and carries no phantom provider claim', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveLaunchPlan(baseConfig({ browserstackEnabled: true, browserstackUser: 'u' }), {});
	assert.notEqual(plan.mode, 'local');
	assert.equal(plan.caps, undefined, 'no caps are built for a config-error plan');
});

test('TEST D · provider not enabled → local plan unchanged', async () => {
	const { resolveLaunchPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveLaunchPlan(baseConfig({ browserstackUser: 'u', browserstackKey: 'k' }), { device: 'iPhone 14' });
	assert.equal(plan.mode, 'local');
	assert.equal(plan.device, 'iPhone 14');
	assert.equal(plan.strict, false);
});

test('TEST B (agent path) · explicit browserstack + incomplete stored creds → deterministic mission error', async () => {
	const { resolveAgentExecutionPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveAgentExecutionPlan({
		device: null,
		explicitProvider: 'browserstack',
		config: baseConfig({ browserstackUser: 'u', browserstackKey: '' })
	});
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'missing_credentials');
});

test('TEST A (agent path) · explicit browserstack + complete creds → browserstack plan', async () => {
	const { resolveAgentExecutionPlan } = await import('../server/browserstackCaps.js');
	const plan = resolveAgentExecutionPlan({
		device: null,
		explicitProvider: 'browserstack',
		config: baseConfig({ browserstackEnabled: false, browserstackUser: 'u', browserstackKey: 'k' })
	});
	assert.equal(plan.mode, 'browserstack');
});

/*
 * Server-level: a replay run with enabled-but-incomplete BrowserStack must
 * error as a provider failure and record browserstack/failed provenance —
 * against a live child server with an isolated data dir (live .qase untouchable).
 */

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

async function bootServer(env) {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), 'p0f1-'));
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: 'disabled',
			QASE_API_TOKEN: '',
			PORT: String(port),
			QASE_DATA_DIR: join(home, '.qase'),
			QASE_PUBLIC_URL: '',
			// LLM endpoint not needed: the mission fails at provider config
			// validation before any model call.
			QASE_PROVIDER: 'custom',
			QASE_API_KEY: 'test-not-real',
			QASE_BASE_URL: 'http://127.0.0.1:1/v1',
			QASE_MODEL: 'test-model',
			NODE_PATH: join(ROOT, 'node_modules'),
			...env
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', d => { stderr += d; });
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 90; i += 1) {
		try {
			const r = await fetch(`${base}/api/health`);
			if (r.ok) break;
		} catch { /* not up yet */ }
		await delay(400);
	}
	return { child, base, home, stderr: () => stderr };
}

test('TEST B/C (live) · enabled-with-invalid BrowserStack config → run fails as provider failure, no local fallback', { timeout: 90_000 }, async () => {
	const srv = await bootServer();
	try {
		// Enable BrowserStack with an INCOMPLETE (non-secret dummy) config.
		const put = await fetch(`${srv.base}/api/config`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ browserstackEnabled: true, browserstackUser: 'p0f1-test-user' })
		});
		assert.ok(put.ok || put.status === 403, `config accept (${put.status})`);

		// Exercise the REAL replay path: create a one-step test case and run it.
		// The run must fail as a BrowserStack provider failure BEFORE any
		// browser launch, and record browserstack/failed provenance.
		const tc = await fetch(`${srv.base}/api/test-cases`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'P0-F1 invalid-BS-config probe',
				targetUrl: 'https://example.com/',
				steps: [{ type: 'navigate', url: 'https://example.com/' }],
				assertions: []
			})
		}).then(r => r.json());
		assert.ok(tc?.id, `test case created (${JSON.stringify(tc).slice(0, 120)})`);

		const runRes = await fetch(`${srv.base}/api/test-cases/${tc.id}/run`, { method: 'POST' }).then(r => r.json());
		const result = runRes?.result ?? runRes;
		assert.ok(result, `run returned a result (${JSON.stringify(runRes).slice(0, 200)})`);
		assert.equal(result.result, 'error', 'run must fail, not pass');
		assert.ok(result.error, 'run carries an error message');
		assert.ok(/BrowserStack/i.test(String(result.error)), `error names the provider: ${result.error}`);
		assert.ok(!result.error.includes('p0f1-test-user'), 'no credential material in the error');

		// Truthful provenance: browserstack + failed — never 'local'.
		assert.equal(result.executionEnvironment?.provider, 'browserstack', 'failed environment claims browserstack');
		assert.equal(result.executionEnvironment?.failed, true, 'failed flag set');
		assert.equal(result.providerFailure?.provider, 'browserstack', 'providerFailure.provider');
		assert.equal(result.providerFailure?.code, 'invalid_credentials', 'providerFailure.code');

		// No local browser may have been spawned for a browserstack-enabled run:
		// the launcher throws before any connectOverCDP/launch call.
		assert.ok(!srv.stderr().includes('Launching local'), 'no local launch logged');
	} finally {
		srv.child.kill('SIGKILL');
		rmSync(srv.home, { recursive: true, force: true });
	}
});

test('TEST C (unit) · replay with error plan throws before any CDP/launch attempt', { timeout: 30_000 }, async () => {
	const caps = await import('../server/browserstackCaps.js');
	const plan = caps.resolveLaunchPlan({
		browserstackEnabled: true, browserstackUser: 'u', browserstackKey: '', browserstackStrict: true
	}, {});
	assert.equal(plan.mode, 'error');

	// Hermetic subprocess: the config module resolves from env + stored
	// config.json under cwd. A child with a temp cwd and enabled-with-user-
	// but-no-key env produces exactly the error plan above; the REAL replay
	// (public runTestCase surface) must fail as a provider failure BEFORE any
	// CDP/local launch attempt, and never record local provenance.
	const home = mkdtempSync(join(tmpdir(), 'p0f1-unit-'));
	const child = spawn(process.execPath, ['--input-type=module', '-e', `
		const { runTestCase } = await import(${JSON.stringify(join(ROOT, 'server', 'replay.js'))});
		const result = await runTestCase({
			id: 'p0f1-unit-tc', name: 'probe', device: null,
			targetUrl: 'https://example.com/',
			steps: [{ type: 'navigate', url: 'https://example.com/' }],
			assertions: []
		}, {});
		console.log(JSON.stringify({
			result: result.result,
			error: String(result.error ?? ''),
			providerFailure: result.providerFailure ?? null,
			env: result.executionEnvironment ?? null
		}));
	`], {
		cwd: home,
		env: {
			...process.env,
			QASE_BROWSERSTACK_ENABLED: 'true',
			QASE_BROWSERSTACK_USER: 'p0f1-unit-user',
			QASE_BROWSERSTACK_KEY: '',
			BROWSERSTACK_ACCESS_KEY: '',
			// No LLM endpoint is reached: the replay runner is deterministic.
			NODE_PATH: join(ROOT, 'node_modules')
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let out = '';
	child.stdout.on('data', d => { out += d; });
	child.stderr.on('data', d => { out += d; });
	const code = await new Promise(r => child.on('close', r));
	rmSync(home, { recursive: true, force: true });
	assert.equal(code, 0, `child exited cleanly\n${out.slice(0, 500)}`);
	const start = out.indexOf('{"result"');
	assert.ok(start >= 0, `child printed its JSON report\n${out.slice(0, 500)}`);
	const parsed = JSON.parse(out.slice(start, out.indexOf('\n', start) || undefined));
	assert.equal(parsed.result, 'error', 'run failed');
	assert.ok(/BrowserStack/i.test(parsed.error), `error names the provider: ${parsed.error}`);
	assert.ok(!parsed.error.includes('p0f1-unit-user'), 'no credential material in the error');
	assert.equal(parsed.providerFailure?.provider, 'browserstack', 'providerFailure.provider');
	assert.equal(parsed.providerFailure?.code, 'invalid_credentials', 'providerFailure.code');
	assert.equal(parsed.env?.provider, 'browserstack', 'environment claims browserstack');
	assert.equal(parsed.env?.failed, true, 'environment marked failed');
});

test('TEST C (suite rollup) · runTestSuite summary surfaces provider failure at run level', { timeout: 30_000 }, async () => {
	// Same hermetic subprocess pattern as the runTestCase unit above, but via
	// the suite surface the SCHEDULER calls. With an invalid BrowserStack
	// config the summary itself must carry providerFailure — an operator
	// reading only schedule.lastRun must see the provider failure.
	const home = mkdtempSync(join(tmpdir(), 'p0f1-suite-'));
	const child = spawn(process.execPath, ['--input-type=module', '-e', `
		const { runTestSuite } = await import(${JSON.stringify(join(ROOT, 'server', 'replay.js'))});
		const summary = await runTestSuite([{
			id: 'p0f1-suite-tc', name: 'probe', device: null,
			targetUrl: 'https://example.com/',
			steps: [{ type: 'navigate', url: 'https://example.com/' }],
			assertions: []
		}], { concurrency: 1, retries: 0 });
		console.log(JSON.stringify({
			total: summary.total,
			errored: summary.errored,
			providerFailure: summary.providerFailure ?? null,
			firstResultFailure: summary.results?.[0]?.providerFailure ?? null,
			providers: summary.execution?.providers ?? []
		}));
	`], {
		cwd: home,
		env: {
			...process.env,
			QASE_BROWSERSTACK_ENABLED: 'true',
			QASE_BROWSERSTACK_USER: 'p0f1-suite-user',
			QASE_BROWSERSTACK_KEY: '',
			BROWSERSTACK_ACCESS_KEY: '',
			NODE_PATH: join(ROOT, 'node_modules')
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let out = '';
	child.stdout.on('data', d => { out += d; });
	child.stderr.on('data', d => { out += d; });
	const code = await new Promise(r => child.on('close', r));
	rmSync(home, { recursive: true, force: true });
	assert.equal(code, 0, `child exited cleanly\n${out.slice(0, 500)}`);
	const start = out.indexOf('{"total"');
	assert.ok(start >= 0, `child printed its JSON report\n${out.slice(0, 500)}`);
	const parsed = JSON.parse(out.slice(start, out.indexOf('\n', start) || undefined));
	assert.equal(parsed.total, 1);
	assert.equal(parsed.errored, 1, 'the errored count reflects the provider failure');
	assert.equal(parsed.providerFailure?.provider, 'browserstack', 'summary.providerFailure.provider');
	assert.equal(parsed.providerFailure?.code, 'invalid_credentials', 'summary.providerFailure.code');
	assert.equal(parsed.firstResultFailure?.code, 'invalid_credentials', 'per-result providerFailure preserved');
	assert.deepEqual(parsed.providers, ['browserstack'], 'providers rollup claims browserstack only');
});
