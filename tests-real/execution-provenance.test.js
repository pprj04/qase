/**
 * BUILD B0.2 — Execution Truthfulness & Strict BrowserStack Mode
 *
 * Unit (no network): buildExecutionEnvironment / isRealDevice /
 * resolveLaunchPlan / strict error / config strict default.
 * Live (server on 5173): runTestCase result provenance, suite summary
 * provenance, finding device/environment sync, validation-run provenance,
 * strict-mode end-to-end (BS enabled with garbage creds → error, no local).
 *
 * Run: node tests/execution-provenance.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0;
let fail = 0;
function ok(cond, label) {
	if (cond) { pass += 1; console.log(`  ok ${pass} — ${label}`); }
	else { fail += 1; console.log(`  FAIL — ${label}`); }
}

// ── 1. buildExecutionEnvironment ──
console.log('\n[1] buildExecutionEnvironment — shape, nulls, validation');
{
	const mod = await import(path.join(ROOT, 'server', 'executionEnvironment.js'));
	const before = Date.now();
	const env = mod.buildExecutionEnvironment({
		provider: 'browserstack',
		browser: 'chrome', browserVersion: '121.0', os: 'OS X', osVersion: 'Sonoma',
		device: 'iPhone 15 Pro', viewport: { width: 393, height: 659 }
	});
	ok(env.provider === 'browserstack', 'provider kept');
	ok(env.device === 'iPhone 15 Pro', 'device kept');
	ok(env.browser === 'chrome' && env.browserVersion === '121.0', 'browser + version kept');
	ok(env.os === 'OS X' && env.osVersion === 'Sonoma', 'os + osVersion kept');
	ok(env.viewport.width === 393 && env.viewport.height === 659, 'viewport kept');
	ok(env.engineEmulated === false, 'engineEmulated defaults false');
	ok(Number.isFinite(env.executedOn) && env.executedOn >= before, `executedOn is a real timestamp (${env.executedOn})`);
	ok(!('failed' in env), 'failed flag absent unless explicitly failed');

	const sparse = mod.buildExecutionEnvironment({ provider: 'local' });
	ok(sparse.device === null && sparse.browserVersion === null && sparse.os === null && sparse.osVersion === null, 'unknown values are null, never invented');
	ok(sparse.viewport === null, 'unknown viewport null');

	let threw = null;
	try { mod.buildExecutionEnvironment({ provider: 'cloudmagic' }); } catch (e) { threw = e; }
	ok(threw instanceof Error && /provider/.test(threw.message), 'invalid provider rejected');

	const failedEnv = mod.buildExecutionEnvironment({ provider: 'browserstack', failed: true });
	ok(failedEnv.failed === true, 'failed flag recorded when launch failed');
}

// ── 2. isRealDevice — local emulation is NEVER a real device ──
console.log('\n[2] isRealDevice');
{
	const { buildExecutionEnvironment, isRealDevice } = await import(path.join(ROOT, 'server', 'executionEnvironment.js'));
	ok(isRealDevice(buildExecutionEnvironment({ provider: 'browserstack', device: 'iPhone 15 Pro' })) === true, 'browserstack + device = real device');
	ok(isRealDevice(buildExecutionEnvironment({ provider: 'browserstack', device: null })) === false, 'browserstack desktop browser is not a device run');
	ok(isRealDevice(buildExecutionEnvironment({ provider: 'local', device: 'iPhone 15 Pro', engineEmulated: true })) === false, 'local device EMULATION is not a real device');
	ok(isRealDevice(buildExecutionEnvironment({ provider: 'local', viewport: { width: 375, height: 812 } })) === false, 'local mobile viewport is not a real device');
	ok(isRealDevice(null) === false, 'null environment is not a real device');
}

// ── 3. resolveLaunchPlan + strict error ──
console.log('\n[3] resolveLaunchPlan — strict mode decision logic');
{
	const replay = await import(path.join(ROOT, 'server', 'replay.js'));

	const local = replay.resolveLaunchPlan({ browserstackEnabled: false }, {});
	ok(local.mode === 'local' && local.strict === false, 'BS disabled → local plan');

	const bsDefault = replay.resolveLaunchPlan({ browserstackEnabled: true, browserstackUser: 'u', browserstackKey: 'k' }, { browser: 'firefox' });
	ok(bsDefault.mode === 'browserstack', 'BS enabled → browserstack plan');
	ok(bsDefault.strict === true, 'strict is the DEFAULT');
	ok(bsDefault.caps.browser === 'firefox' && bsDefault.caps.os === 'OS X', 'caps built from OS map');
	ok(bsDefault.caps['browserstack.user'] === 'u' && bsDefault.caps['browserstack.key'] === 'k', 'caps carry credentials');

	const bsStrictOff = replay.resolveLaunchPlan({ browserstackEnabled: true, browserstackUser: 'u', browserstackKey: 'k', browserstackStrict: false }, {});
	ok(bsStrictOff.strict === false, 'explicit browserstackStrict=false honored (legacy loud fallback)');
	ok(bsStrictOff.caps.name === 'Qase test run', 'testName default present');

	const { BrowserStackStrictError } = await import(path.join(ROOT, 'server', 'executionEnvironment.js'));
	const err = new BrowserStackStrictError(new Error('401 Unauthorized'));
	ok(/BrowserStack execution failed — local fallback was disabled/.test(err.message), 'strict error message names the disabled fallback');
	ok(/Fix the BrowserStack configuration or disable BrowserStack/.test(err.message), 'strict error gives the actionable fix');
	ok(/401 Unauthorized/.test(err.message), 'strict error carries the underlying cause');
}

// ── 4. config strict default + persistence ──
console.log('\n[4] config — browserstackStrict default true');
{
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-b02-strict-'));
	const configUrl = 'file://' + JSON.stringify(path.join(ROOT, 'server', 'config.js')).slice(1, -1);
	const script = `
		const { getConfig, saveConfig } = await import('${configUrl}');
		const out = [];
		out.push(['default', getConfig().browserstackStrict]);
		saveConfig({ browserstackStrict: false });
		out.push(['persisted-off', getConfig().browserstackStrict]);
		saveConfig({ browserstackStrict: true });
		out.push(['persisted-on', getConfig().browserstackStrict]);
		console.log(JSON.stringify(out));
	`;
	const raw = execFileSync('node', ['--input-type=module', '-e', script], { cwd: tmp, encoding: 'utf8' });
	const out = JSON.parse(raw.trim().split('\n').pop());
	ok(out[0][1] === true, 'strict defaults to true in fresh config');
	ok(out[1][1] === false, 'strict=false persists');
	ok(out[2][1] === true, 'strict=true persists');
	fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 5. LIVE: runTestCase provenance (local) ──
console.log('\n[5] LIVE — local execution provenance');
{
	const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
	const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
	const token = (envText.match(/^QASE_API_TOKEN=(.*)$/m) || [])[1]?.trim() ?? '';
	ok(!!token, 'QASE_API_TOKEN found');

	const list = await fetch(`${BASE}/api/test-cases?limit=50`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null);
	const cases = Array.isArray(list) ? list : (list?.items ?? list?.testCases ?? list?.cases ?? []);
	ok(Array.isArray(cases) && cases.length > 0, `test cases available (${cases?.length ?? 0})`);

	// Pick a case whose targetUrl points at a benchmark app so the run can
	// actually execute; fall back to any case (local launch still provenance-stamps).
	const bench = cases.find(tc => /990[1-7]/.test(String(tc.targetUrl ?? ''))) ?? cases[0];
	const runRes = await fetch(`${BASE}/api/test-cases/${bench.id}/run`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({})
	}).then(r => r.json()).catch(() => null);
	const result = runRes?.result;
	ok(!!result, `single run returned a result (${result?.result})`);
	const env = result?.executionEnvironment;
	ok(!!env, 'result carries executionEnvironment');
	if (env) {
		ok(env.provider === 'local', `provider is local (${env.provider})`);
		ok(Number.isFinite(env.executedOn) && env.executedOn > 0, 'executedOn real timestamp');
		ok(env.browser === 'chromium', 'browser is chromium');
		ok(env.device === null, 'plain local run claims no device');
		ok(env.engineEmulated === false, 'plain local run claims no emulation');
		ok(env.os != null, `os recorded (${env.os})`);
		ok(env.viewport && Number.isFinite(env.viewport.width), 'viewport recorded');
	}

	// Suite run — summary + per-result
	const suiteRes = await fetch(`${BASE}/api/test-cases/run`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ testCaseIds: [bench.id] })
	}).then(r => r.json()).catch(() => null);
	ok(!!suiteRes?.results, 'suite summary returned');
	const r0 = suiteRes?.results?.[0];
	ok(r0?.executionEnvironment?.provider === 'local', 'suite per-result carries local provider');
	ok(Array.isArray(suiteRes?.execution?.providers) && suiteRes.execution.providers.includes('local'), `summary.execution.providers includes local (${JSON.stringify(suiteRes?.execution?.providers)})`);
}

// ── 6. LIVE: strict mode end-to-end (garbage BS creds → error, no local) ──
console.log('\n[6] LIVE — strict BrowserStack: failure is loud, never local');
{
	const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
	const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
	const token = (envText.match(/^QASE_API_TOKEN=(.*)$/m) || [])[1]?.trim() ?? '';

	const before = await fetch(`${BASE}/api/config`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
	const origEnabled = before.browserstackEnabled === true;
	const origStrict = before.browserstackStrict !== false;

	const origUser = before.browserstackUser ?? '';
	const origKey = before.browserstackKey ?? '';

	const restore = async () => {
		// BUILD 2 hardening — restore the FULL BrowserStack config, not just the
		// enable/strict flags. The old restore (enabled/strict only) permanently
		// leaked the garbage 'invalid_bs_user_zzz' credentials into the stored
		// config whenever the restore PUT raced a server restart, and the B0.1
		// authority model then made those stored values beat env on every boot.
		await fetch(`${BASE}/api/config`, {
			method: 'PUT',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ browserstackEnabled: origEnabled, browserstackStrict: origStrict, browserstackUser: origUser, browserstackKey: origKey })
		}).catch(() => {});
	};

	try {
		// Enable BS with invalid credentials + strict
		await fetch(`${BASE}/api/config`, {
			method: 'PUT',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ browserstackEnabled: true, browserstackStrict: true, browserstackUser: 'invalid_bs_user_zzz', browserstackKey: 'invalid_bs_key_zzz' })
		});
		const cfgNow = await fetch(`${BASE}/api/config`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
		ok(cfgNow.browserstackEnabled === true && cfgNow.browserstackStrict === true, 'BS enabled + strict in config');

		const list = await fetch(`${BASE}/api/test-cases?limit=50`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null);
		const cases = Array.isArray(list) ? list : (list?.items ?? list?.testCases ?? list?.cases ?? []);
		const bench = cases.find(tc => /990[1-7]/.test(String(tc.targetUrl ?? ''))) ?? cases[0];
		const runRes = await fetch(`${BASE}/api/test-cases/${bench.id}/run`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({})
		}).then(r => r.json()).catch(() => null);
		const result = runRes?.result;
		ok(result?.result === 'error', `strict BS failure → result error (got ${result?.result})`);
		ok(/local fallback was disabled/.test(String(result?.error ?? '')), `error names the disabled fallback (${String(result?.error ?? '').slice(0, 80)}…)`);
		const env = result?.executionEnvironment;
		ok(env?.provider === 'browserstack', `failed run is labeled browserstack, not local (${env?.provider})`);
		ok(env?.failed === true, 'failed flag set');
		ok(env?.device === null, 'no device invented');
	} finally {
		await restore();
		const after = await fetch(`${BASE}/api/config`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
		ok(after.browserstackEnabled === origEnabled, `config restored (enabled=${after.browserstackEnabled})`);
	}
}

// ── 7. findings: device/environment sync (isolated store) ──
console.log('\n[7] findings — device/environment provenance');
{
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-b02-findings-'));
	const findingsUrl = 'file://' + JSON.stringify(path.join(ROOT, 'server', 'findings.js')).slice(1, -1);
	const script = `
		const { syncSessionFinding, listFindings } = await import('${findingsUrl}');
		const out = [];
		const session = { id: 'sess-b02', projectId: 'p1' };
		const base = { id: 'f-b02-1', title: 'Login broken on phone', severity: 'high', category: 'authentication',
			url: 'http://x', steps: [], expected: 'e', actual: 'a' };
		// 1) with device context
		syncSessionFinding(session, { ...base, device: 'iPhone 15 Pro · iOS 17',
			environment: { provider: 'local', device: 'iPhone 15 Pro', browser: 'Safari', engineEmulated: true, executedOn: 123 } });
		let all = listFindings();
		let f = all.find(x => x.id === 'f-b02-1');
		out.push(['sync-new', f?.device ?? null, f?.environment?.provider ?? null, f?.environment?.engineEmulated ?? null]);
		// 2) sync again WITHOUT device — must NOT overwrite with null
		syncSessionFinding(session, { ...base, title: 'Login broken on phone (edited)' });
		all = listFindings();
		f = all.find(x => x.id === 'f-b02-1');
		out.push(['no-null-overwrite', f?.device ?? null, f?.environment?.provider ?? null]);
		// 3) finding without device context → device stays undefined
		syncSessionFinding({ id: 'sess2', projectId: 'p1' }, { ...base, id: 'f-b02-2' });
		f = listFindings().find(x => x.id === 'f-b02-2');
		out.push(['no-device-plain', f?.device ?? null, f?.environment ?? null]);
		console.log(JSON.stringify(out));
	`;
	const raw = execFileSync('node', ['--input-type=module', '-e', script], { cwd: tmp, encoding: 'utf8', env: { ...process.env, QASE_DATA_DIR: tmp } });
	const out = JSON.parse(raw.trim().split('\n').pop());
	ok(out[0][1] === 'iPhone 15 Pro · iOS 17', 'finding created via sync carries device');
	ok(out[0][2] === 'local' && out[0][3] === true, 'environment records local + engineEmulated (truthful emulation)');
	ok(out[1][1] === 'iPhone 15 Pro · iOS 17' && out[1][2] === 'local', 're-sync without device does NOT null the correct value');
	ok(out[2][1] === null && out[2][2] === null, 'plain finding has no device/environment (not invented)');
	fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 8. LIVE: fix-validation run carries provenance ──
console.log('\n[8] LIVE — Phase 18 validation provenance (behavior unchanged)');
{
	const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
	const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
	const token = (envText.match(/^QASE_API_TOKEN=(.*)$/m) || [])[1]?.trim() ?? '';

	// Find a finding with steps pointing at a benchmark app (9901-9907) so
	// validation can actually execute.
	const findings = await fetch(`${BASE}/api/findings?limit=200`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => []);
	const list = Array.isArray(findings) ? findings : (findings?.items ?? findings?.findings ?? []);
	const target = list.find(f => /990[1-7]/.test(String(f.url ?? '')) && Array.isArray(f.steps) && f.steps.length > 0);
	ok(!!target, `benchmark-app finding for validation (${target?.id ?? 'none'} — ${list?.length ?? 0} scanned)`);

	if (target) {
		const key = `b02-${Date.now()}`;
		const started = await fetch(`${BASE}/api/v1/findings/${target.id}/revalidate`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': key },
			body: JSON.stringify({})
		});
		ok(started.status === 202 || started.status === 200, `revalidate accepted (${started.status})`);
		const run0 = await started.json();
		const runId = run0?.validationId ?? run0?.run?.id ?? run0?.id;
		ok(!!runId, `run id (${runId})`);

		// Poll for completion (validation takes a few seconds × attempts).
		let run = null;
		for (let i = 0; i < 40; i++) {
			await new Promise(r => setTimeout(r, 3000));
			const resp = await fetch(`${BASE}/api/v1/findings/${target.id}/validation`, { headers: { authorization: `Bearer ${token}` } });
			const data = await resp.json().catch(() => null);
			run = data?.latest ?? data?.run ?? data?.validation ?? data;
			const status = run?.status;
			if (status === 'COMPLETED' || status === 'FAILED') break;
		}
		ok(run?.status === 'COMPLETED', `validation completed (${run?.status})`);
		ok(run?.fixStatus != null, `fixStatus still produced (${run?.fixStatus})`);
		ok(Number.isFinite(run?.executedOn), `run.executedOn stamped (${run?.executedOn})`);
		ok(run?.executionEnvironment?.provider === 'local', `run.executionEnvironment.provider local (${run?.executionEnvironment?.provider})`);
		const attemptEnv = run?.attempts?.map(a => a.executionEnvironment?.provider ?? null);
		ok(attemptEnv?.length > 0 && attemptEnv.every(p => p === 'local'), `every attempt carries local provider (${JSON.stringify(attemptEnv)})`);
		// Evidence rows for this run identify their environment inline, and
		// the graph nodes carry it under metadata.executionEnvironment.
		const evRes = await fetch(`${BASE}/api/v1/findings/${target.id}/validation`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null);
		const afterEv = (evRes?.latest?.evidence?.after ?? evRes?.run?.evidence?.after ?? []);
		ok(Array.isArray(afterEv) && afterEv.length > 0, `after-evidence recorded (${afterEv.length})`);
		const withEnv = afterEv.filter(e => e.executionEnvironment || e.environment).length;
		ok(withEnv > 0, `evidence rows identify their environment (${withEnv}/${afterEv.length})`);
	}
}

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
