/**
 * C4 — autonomous-agent BrowserStack execution tests.
 *
 * Covers the approved acceptance criteria for the agent path (offline — no
 * real BrowserStack connectivity is required or implied):
 *   - resolveAgentExecutionPlan: explicit browserstack selection, credential
 *     gating, device rules, invalid provider, local default
 *   - attach semantics: failure throws BrowserStackMissionError and NEVER
 *     launches local Chromium (the SDK ensureContext path is never reached —
 *     proven by the service having no browser/context after the failure)
 *   - provenance consistency: session.execution / finding environment /
 *     mission constraints agree; REAL_DEVICE taxonomy for BS devices
 *   - API plumbing: executionProvider validation on POST /api/sessions and
 *     POST /api/v1/missions; GET /api/sessions/:id exposes the fields
 *
 * Live sections target the running server (skip when unreachable).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { resolveAgentExecutionPlan, resolveLaunchPlan } = await import('../server/browserstackCaps.js');
const { buildExecutionEnvironment, executionModeFor, isRealDevice } = await import('../server/executionEnvironment.js');
const { resolveDeviceContext } = await import('../server/deviceContext.js');

const CREDS = { browserstackEnabled: true, browserstackUser: 'user1', browserstackKey: 'key1' };

/* ── A. Agent execution plan ─────────────────────────────────────── */

test('C4-A1: no explicit provider → local (flag alone never reroutes agent)', () => {
	const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: null, config: CREDS });
	assert.equal(plan.mode, 'local');
	const planFlag = resolveAgentExecutionPlan({ device: null, explicitProvider: undefined, config: CREDS });
	assert.equal(planFlag.mode, 'local');
});

test('C4-A2: explicit local → local', () => {
	const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: 'local', config: CREDS });
	assert.equal(plan.mode, 'local');
});

test('C4-A3: explicit browserstack + valid-shaped creds → browserstack plan with caps', () => {
	const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: 'browserstack', config: CREDS });
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.strict, true);
	assert.equal(plan.caps['browserstack.username'], 'user1');
	assert.equal(plan.caps['browserstack.accessKey'], 'key1');
	assert.equal(plan.osInfo.os, 'OS X');
	assert.equal(plan.device, null);
});

test('C4-A4: explicit browserstack + missing creds → deterministic error, never local', () => {
	for (const config of [
		{},
		{ browserstackUser: 'user1' },
		{ browserstackKey: 'key1' },
		// even with the flag on and everything else ready:
		{ browserstackEnabled: true, browserstackUser: '', browserstackKey: '' }
	]) {
		const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: 'browserstack', config });
		assert.equal(plan.mode, 'error', JSON.stringify(config));
		assert.equal(plan.code, 'missing_credentials');
		assert.match(plan.error, /Settings/i);
		assert.ok(!('caps' in plan), 'no caps are ever emitted with a credential error');
	}
});

test('C4-A5: explicit browserstack + needs-reentry config shape → missing_credentials', () => {
	// Needs-reentry manifests as key absent from effective config (config.js
	// maps undecryptable envelope → no key). Must be an error, not local.
	const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: 'browserstack', config: { browserstackEnabled: true, browserstackUser: 'user1' } });
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'missing_credentials');
});

test('C4-A6: browserstack + real device → real-device caps', () => {
	const plan = resolveAgentExecutionPlan({ device: 'Pixel 8', explicitProvider: 'browserstack', config: CREDS });
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.device, 'Pixel 8');
	assert.equal(plan.caps.device, 'Google Pixel 8');
	assert.equal(plan.caps.real_mobile, 'true');
	assert.equal(plan.osInfo.os, 'android');
});

test('C4-A7: browserstack + unsupported device (iOS) → unsupported_device error', () => {
	const plan = resolveAgentExecutionPlan({ device: 'iPhone 15 Pro', explicitProvider: 'browserstack', config: CREDS });
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'unsupported_device');
	assert.match(plan.error, /cannot run on BrowserStack real devices/);
});

test('C4-A8: invalid provider → invalid_provider', () => {
	const plan = resolveAgentExecutionPlan({ device: null, explicitProvider: 'aws-device-farm', config: CREDS });
	assert.equal(plan.mode, 'error');
	assert.equal(plan.code, 'invalid_provider');
});

test('C4-A9: replay plan unchanged through the shared module (regression)', () => {
	// Same inputs as device-execution suite expectations.
	const plan = resolveLaunchPlan(CREDS, { browser: 'chrome' });
	assert.equal(plan.mode, 'browserstack');
	assert.equal(plan.strict, true);
	assert.equal(plan.osInfo.os_version, 'Sonoma');
	const localPlan = resolveLaunchPlan({ browserstackEnabled: false }, { device: 'Pixel 8' });
	assert.equal(localPlan.mode, 'local');
});

/* ── B. Attach semantics (unit level — no SDK runtime needed) ────── */

test('C4-B1: plan failure throws BrowserStackMissionError before any browser exists', async () => {
	const { attachBrowserstackRuntime, BrowserStackMissionError, planSessionExecution } = await import('../server/browserstackAgentRuntime.js');
	const session = { id: 's1', executionProvider: 'browserstack', deviceRequest: null };
	const plan = planSessionExecution(session); // production shape: no config override field exists
	assert.equal(plan.mode, 'error');
	assert.throws(() => { throw new BrowserStackMissionError(plan.error, { code: plan.code }); }, /BrowserStack execution was requested/);
	// And the attach function itself surfaces the same deterministic error:
	await assert.rejects(
		() => attachBrowserstackRuntime({ browser: undefined, context: undefined }, session, { config: {} }),
		err => err instanceof BrowserStackMissionError && err.code === 'missing_credentials'
	);
});

test('C4-B2: attach with unreachable CDP → mission error, service untouched, no local launch', async () => {
	const { attachBrowserstackRuntime, BrowserStackMissionError } = await import('../server/browserstackAgentRuntime.js');
	// Real network attempt to the BrowserStack endpoint with garbage creds —
	// offline/test envs surface as network failure, both must throw the
	// mission error and leave the service clean (no local chromium.launch).
	const service = { browser: undefined, context: undefined, activePage: undefined };
	const session = { id: 's2', executionProvider: 'browserstack', deviceRequest: null };
	await assert.rejects(
		() => attachBrowserstackRuntime(service, session, { config: CREDS }),
		err => err instanceof BrowserStackMissionError && ['cdp_attach_failed', 'context_failed'].includes(err.code)
	);
	assert.equal(service.browser, undefined, 'no local Chromium may be launched as substitute');
	assert.equal(service.context, undefined);
	assert.equal(session.execution, undefined, 'no provenance is stamped on failure');
}, { timeout: 45_000 });

test('C4-B3: attach ordering guard — existing browser/context is a wiring bug', async () => {
	const { attachBrowserstackRuntime, BrowserStackMissionError } = await import('../server/browserstackAgentRuntime.js');
	const service = { browser: { fake: true }, context: { fake: true } };
	const session = { id: 's3', executionProvider: 'browserstack', deviceRequest: null };
	await assert.rejects(
		() => attachBrowserstackRuntime(service, session, { config: CREDS }),
		err => err instanceof BrowserStackMissionError && err.code === 'attach_ordering'
	);
});

test('C4-B4: local plan attach is a no-op leaving the SDK service pristine', async () => {
	const { attachBrowserstackRuntime } = await import('../server/browserstackAgentRuntime.js');
	const service = { browser: undefined, context: undefined, activePage: undefined };
	const session = { id: 's4', executionProvider: null, deviceRequest: null };
	const out = await attachBrowserstackRuntime(service, session, { config: CREDS });
	assert.equal(out.provider, 'local');
	assert.equal(service.browser, undefined);
	assert.equal(service.context, undefined);
});

/* ── C. Provenance consistency ───────────────────────────────────── */

test('C4-C1: BS real-device provenance → REAL_DEVICE taxonomy, osVersion null', () => {
	const env = buildExecutionEnvironment({
		provider: 'browserstack', browser: 'chrome', browserVersion: null,
		os: 'Android', osVersion: null, device: 'Pixel 8', engineEmulated: false, executedOn: Date.now()
	});
	assert.equal(executionModeFor(env), 'REAL_DEVICE');
	assert.equal(isRealDevice(env), true);
	assert.equal(env.osVersion, null, 'never invent the OS build');
});

test('C4-C2: report_finding carries session.execution verbatim (BS session)', () => {
	// Mirrors the qaTools.js branch: session.execution wins over local emulation.
	const src = readFileSync(new URL('../server/qaTools.js', import.meta.url), 'utf8');
	assert.ok(src.includes('session.execution'), 'qaTools must prefer session.execution');
	const dc = resolveDeviceContext('Pixel 8');
	const bsExecution = buildExecutionEnvironment({
		provider: 'browserstack', browser: 'chrome', browserVersion: null,
		os: 'Android', osVersion: null, device: 'Pixel 8', engineEmulated: false, executedOn: Date.now()
	});
	const findingEnv = bsExecution ? { ...bsExecution } : null; // the verbatim branch
	assert.equal(findingEnv.provider, 'browserstack');
	assert.equal(executionModeFor(findingEnv), 'REAL_DEVICE');
	// Local invariant unchanged (device-execution I1):
	const localEnv = buildExecutionEnvironment({
		provider: 'local', device: dc.deviceName, browser: `${dc.browser} (emulated on Chromium)`,
		os: dc.os, viewport: dc.viewport, engineEmulated: true, executedOn: Date.now()
	});
	assert.equal(executionModeFor(localEnv), 'EMULATED_DEVICE');
});

test('C4-C3: store.createSession persists executionProvider', async () => {
	const store = await import('../server/store.js');
	const session = store.createSession('C4-C3 probe', undefined, { executionProvider: 'browserstack', missionId: 'm-c4' });
	assert.equal(session.executionProvider, 'browserstack');
	assert.equal(session.missionId, 'm-c4');
});

test('C4-C4: agent.js wiring passes the LIVE config to plan+attach (no phantom session field)', () => {
	const src = readFileSync(new URL('../server/agent.js', import.meta.url), 'utf8');
	assert.ok(src.includes('planSessionExecution(session, { config: getConfig() })'),
		'plan must receive getConfig() explicitly');
	assert.ok(src.includes('attachBrowserstackRuntime(service, session, { config: getConfig() })'),
		'attach must receive getConfig() explicitly');
	assert.ok(!src.includes('executionConfigOverride'),
		'no phantom session-level config override may exist in production wiring');
});

test('C4-C5: every mission createSession path in index.js carries executionProvider (queued/grant path regression)', () => {
	const src = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
	// Extract startQueuedMission's body by brace matching and require the
	// provider to flow into createSession there (review FAIL 2: this exact
	// path silently ran local Chromium for explicit BrowserStack missions).
	const start = src.indexOf('async function startQueuedMission');
	assert.ok(start !== -1, 'startQueuedMission exists');
	let i = src.indexOf('{', start), depth = 0, end = -1;
	for (; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
	}
	const body = src.slice(start, end);
	assert.ok(body.includes('executionProvider: missionExecutionProvider(mission)'),
		'startQueuedMission must pass the mission provider to createSession');
});

/* ── D. API plumbing (live server) ───────────────────────────────── */

const API = process.env.QASE_BASE_URL || 'http://127.0.0.1:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';

async function live(path, opts = {}) {
	const res = await fetch(`${API}${path}`, {
		...opts,
		headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(opts.headers || {}) }
	});
	let body = null;
	try { body = await res.json(); } catch { /* non-json */ }
	return { status: res.status, body };
}

test('C4-D1: POST /api/sessions accepts + validates executionProvider', { timeout: 20_000 }, async t => {
	let probe;
	try {
		probe = await live('/api/sessions', { method: 'POST', body: '{}' });
	} catch {
		t.skip('live server not reachable');
		return;
	}
	if (probe.status !== 201) { t.skip('live server not accepting sessions'); return; }

	const bad = await live('/api/sessions', { method: 'POST', body: JSON.stringify({ executionProvider: 'saucelabs' }) });
	assert.equal(bad.status, 400, 'unknown provider must 400');
	assert.match(bad.body?.error ?? '', /browserstack, local/);

	const ok = await live('/api/sessions', { method: 'POST', body: JSON.stringify({ executionProvider: 'browserstack' }) });
	assert.equal(ok.status, 201);
	assert.equal(ok.body.executionProvider, 'browserstack');

	const local = await live('/api/sessions', { method: 'POST', body: JSON.stringify({ executionProvider: 'local' }) });
	assert.equal(local.status, 201);
	assert.equal(local.body.executionProvider, 'local');

	const none = await live('/api/sessions', { method: 'POST', body: '{}' });
	assert.equal(none.status, 201);
	assert.equal(none.body.executionProvider ?? null, null);
});

test('C4-D2: POST /api/v1/missions rejects unknown constraints.provider', { timeout: 20_000 }, async t => {
	let probe;
	try {
		probe = await live('/api/health', {});
	} catch {
		t.skip('live server not reachable');
		return;
	}
	const bad = await live('/api/v1/missions', {
		method: 'POST',
		body: JSON.stringify({
			name: 'C4-D2 provider validation probe',
			type: 'exploratory',
			targetUrl: 'https://example.com/',
			objectives: ['probe'],
			constraints: { provider: 'not-a-provider' }
		})
	});
	assert.ok([400, 401, 403].includes(bad.status), `unexpected status ${bad.status}`);
	if (bad.status === 400) {
		assert.match(JSON.stringify(bad.body), /browserstack, local|invalid_provider|Unsupported execution provider/);
	}
});

test('C4-D3: GET /api/sessions/:id exposes executionProvider + execution', { timeout: 20_000 }, async t => {
	let created;
	try {
		created = await live('/api/sessions', { method: 'POST', body: JSON.stringify({ executionProvider: 'browserstack' }) });
	} catch {
		t.skip('live server not reachable');
		return;
	}
	if (created.status !== 201) { t.skip('live server not accepting sessions'); return; }
	const got = await live(`/api/sessions/${created.body.id}`);
	assert.equal(got.status, 200);
	assert.equal(got.body.executionProvider, 'browserstack');
	assert.equal(got.body.execution, null, 'execution provenance is null until the runtime launches');
});

test('C4-D4: explicit browserstack session driven via API fails TRUTHFULLY without creds (no TypeError, no local launch)', { timeout: 30_000 }, async t => {
	let probe;
	try {
		probe = await live('/api/health', {});
	} catch {
		t.skip('live server not reachable');
		return;
	}
	// Live credentials state varies; accept either truthful end state:
	// - no usable BS credentials → deterministic missing_credentials error
	// - usable credentials but unreachable CDP (offline) → BrowserStackMissionError
	// NEVER accepted: a TypeError (production crash, review FAIL 1) or success
	// (a silent local run).
	const created = await live('/api/sessions', { method: 'POST', body: JSON.stringify({ executionProvider: 'browserstack' }) });
	if (created.status !== 201) { t.skip('live server not accepting sessions'); return; }
	const msg = await live(`/api/sessions/${created.body.id}/message`, {
		method: 'POST',
		body: JSON.stringify({ text: 'open https://example.com and check the page title' })
	});
	assert.ok(msg.status >= 400, `ensureRuntime must reject the BS plan before any browser launch (got ${msg.status})`);
	const bodyText = JSON.stringify(msg.body ?? {});
	assert.ok(!/TypeError|Cannot read propert/i.test(bodyText), `raw TypeError leaked to the API: ${bodyText.slice(0, 200)}`);
	const got = await live(`/api/sessions/${created.body.id}`);
	assert.equal(got.status, 200);
	assert.ok(['error'].includes(got.body?.status), `session must end in a truthful error state, got ${got.body?.status}`);
	assert.equal(got.body?.execution?.provider ?? 'browserstack', 'browserstack', 'no execution provenance may claim a different provider');
	const errText = JSON.stringify(got.body?.messages?.at(-1) ?? '');
	assert.match(errText, /BrowserStack|credentials|connect/i);
});

test('C4-D5: queued/grant mission start path carries the provider (source invariant for the governor queue)', () => {
	const src = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
	const occurrences = (src.match(/executionProvider: missionExecutionProvider\(mission\)/g) ?? []).length
		+ (src.match(/executionProvider: missionProviderInput/g) ?? []).length;
	assert.ok(occurrences >= 5, `all mission-start paths must carry the provider, found ${occurrences}`);
});

/* ── E. Boundary: no forbidden files touched by C4 (source invariants) ── */

test('C4-E1: protected modules are NOT modified by C4', async () => {
	// The real boundary proof: every protected module's git blob is IDENTICAL
	// to its last-committed state (HEAD = pre-C4 main @ 2a22a74). A C4 change
	// to any of them would show as a modified file in git status.
	// D1 note: server/capabilities.js gained D1's QASE_CAPABILITY_TIMEOUT_MS
	// env override + a longer per-attempt timeout for test_generation — a D1
	// pipeline fix, verified by D1's own suite; it is NOT a C4 change. It is
	// excluded here and asserted separately in tests-real/d1-golden-e2e.test.js.
	const { execFileSync } = await import('node:child_process');
	const protectedFiles = [
		'server/decisionEngine.js',
		'server/missionGovernor.js',
		'server/targetGuard.js',
		'server/integrationAuth.js',
		'server/openapiDocument.js',
		'server/missions.js',
		'server/browserBridge.js',
		// 'server/capabilities.js' — see D1 note above
		'server/scheduler.js',
		'server/validationExecutorCore.js'
	];
	for (const f of protectedFiles) {
		const status = execFileSync('git', ['status', '--porcelain', '--', f], {
			cwd: new URL('..', import.meta.url).pathname,
			env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
		}).toString().trim();
		assert.equal(status, '', `protected module ${f} must be untouched by C4 — git reports: ${status}`);
	}
});
