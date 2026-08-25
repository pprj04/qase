/**
 * BUILD B0.1 — BrowserStack Trustworthiness
 * Targeted tests: real connection probe (auth + CDP), config authority
 * (Settings values survive restart; env only seeds), auth protection on the
 * new endpoint, and secret redaction.
 *
 * Run: node tests/browserstack-trust.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0;
let fail = 0;
function ok(cond, label) {
	if (cond) { pass += 1; console.log(`  ok ${pass} — ${label}`); }
	else { fail += 1; console.log(`  FAIL — ${label}`); }
}

/** Stub WebSocket-ish object: stubWs('open') | stubWs('error') | stubWs('close') */
function stubWs(outcome) {
	const bus = new EventEmitter();
	bus.close = () => {};
	setTimeout(() => bus.emit(outcome, new Error('stub error')), 0).unref?.();
	return bus;
}

// ── 1. browserstackTest.js — REAL probe behavior (injected transports) ──
console.log('\n[1] browserstackTest — real probe semantics');
{
	const mod = await import(path.join(ROOT, 'server', 'browserstackTest.js'));

	// 1a. Valid credentials / connectivity
	{
		const result = await mod.testBrowserstackConnection({
			user: 'valid_user',
			key: 'valid_key_xyz',
			fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ automate_plan: 'Automate Pro' }) }),
			wsFactory: () => stubWs('open')
		});
		ok(result.ok === true, 'valid creds + reachable CDP → ok:true');
		ok(result.code === 'connected', 'valid → code "connected"');
		ok(result.auth?.code === 'authenticated', 'auth stage ran and passed');
		ok(result.cdp?.ok === true, 'cdp stage ran and passed');
		ok(result.maskedUser === 'val****er', `maskedUser redacted (${result.maskedUser})`);
		ok(!JSON.stringify(result).includes('valid_key_xyz'), 'access key never appears in result');
	}

	// 1b. Invalid credentials (401)
	{
		const result = await mod.testBrowserstackConnection({
			user: 'wrong_user',
			key: 'wrong_key_secret',
			fetchImpl: async () => ({ status: 401, json: async () => ({}) }),
			wsFactory: () => stubWs('open')
		});
		ok(result.ok === false, 'invalid creds → ok:false');
		ok(result.code === 'invalid_credentials', `invalid → code "invalid_credentials" (${result.code})`);
		ok(/rejected/i.test(result.message), 'clear actionable message');
		ok(!JSON.stringify(result).includes('wrong_key_secret'), 'secret not echoed on failure');
	}

	// 1c. Missing credentials
	{
		const result = await mod.testBrowserstackConnection({ user: '', key: '' });
		ok(result.ok === false, 'empty creds → ok:false');
		ok(result.code === 'missing_credentials', 'empty → code "missing_credentials"');
		ok(/Settings/i.test(result.message), 'actionable message pointing at Settings');
	}

	// 1d. Timeout / network failure during auth
	{
		const result = await mod.testBrowserstackConnection({
			user: 'valid_user',
			key: 'valid_key',
			fetchImpl: async () => { throw new Error('ETIMEDOUT after 8000ms'); },
			wsFactory: () => stubWs('open')
		});
		ok(result.ok === false, 'auth network failure → ok:false');
		ok(result.code === 'network_error', `network failure → code "network_error" (${result.code})`);
		ok(/reach BrowserStack/i.test(result.message), 'message explains unreachable');
	}

	// 1e. Auth OK but CDP handshake fails → NOT connected
	{
		const result = await mod.testBrowserstackConnection({
			user: 'valid_user',
			key: 'valid_key',
			fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }),
			wsFactory: () => stubWs('error')
		});
		ok(result.ok === false, 'CDP failure → ok:false (execution path unproven)');
		ok(result.code === 'cdp_unreachable', `CDP failure → code "cdp_unreachable" (${result.code})`);
		ok(result.auth?.ok === true, 'auth stage still reported as passed');
	}

	// 1f. Real network probe with garbage creds must NOT report connected
	{
		const result = await mod.testBrowserstackConnection({ user: 'garbage_user_zzz', key: 'garbage_key_zzz' });
		ok(result.ok === false, 'real network: garbage creds never report connected');
		ok(['invalid_credentials', 'network_error', 'timeout', 'cdp_unreachable', 'cdp_rejected', 'cdp_timeout'].includes(result.code), `real-network failure classified (${result.code})`);
		ok(!JSON.stringify(result).includes('garbage_key_zzz'), 'real-network failure does not echo the key');
	}

	// 1f-2. REVIEW FIX: the default ws factory must actually run in ESM.
	// require('ws') via createRequire — if this ever silently returns null the
	// CDP stage becomes dead code (the exact bug the reviewer caught).
	{
		const modFresh = await import(`file://${path.join(ROOT, 'server', 'browserstackTest.js')}?fresh=${Date.now()}`);
		const result = await modFresh.testBrowserstackConnection({
			user: 'probe_user', key: 'probe_key',
			fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) })
			// NOTE: no wsFactory injected — the DEFAULT factory path.
		});
		const cdpCode = result.cdp?.code;
		ok(cdpCode !== 'not_probed', `default CDP factory executes in ESM runtime (cdp.code=${cdpCode})`);
		ok(typeof cdpCode === 'string' && cdpCode.length > 0, 'default CDP probe produced a real outcome (reachable, rejected, or timeout)');
	}

	// 1g. Latency measured
	{
		const result = await mod.testBrowserstackConnection({
			user: 'u1', key: 'k1',
			fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }),
			wsFactory: () => stubWs('open')
		});
		ok(typeof result.latencyMs === 'number' && result.latencyMs >= 0, 'latencyMs reported');
		ok(typeof result.lastVerifiedTs === 'number', 'lastVerifiedTs present');
	}
}

// ── 2. config.js — authority & persistence semantics (isolated child process) ──
console.log('\n[2] config authority — Settings values survive restart');
{
	// config.js resolves .qase from process.cwd() — so run in a temp cwd via a
	// child process so the REAL .qase/config.json is never touched.
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-bs-auth-'));
	const configUrl = 'file://' + JSON.stringify(path.join(ROOT, 'server', 'config.js')).slice(1, -1);
	const script = `
		const { getConfig, saveConfig, getPublicConfig } = await import('${configUrl}');
		const out = [];
		// env seeds when nothing stored
		let c = getConfig();
		out.push(['seed', c.browserstackUser]);
		// Settings save wins over env
		saveConfig({ browserstackUser: 'saved_user', browserstackKey: 'saved_key' });
		c = getConfig();
		out.push(['saved', c.browserstackUser, c.browserstackKey]);
		// simulated restart: fresh module instance, same data dir
		const fresh = await import('${configUrl}?restart=1');
		out.push(['restart', fresh.getConfig().browserstackUser, fresh.getConfig().browserstackKey]);
		// explicit clear
		fresh.saveConfig({ browserstackUser: '', browserstackKey: '' });
		const after = fresh.getConfig();
		out.push(['cleared', after.browserstackUser, after.browserstackKey]);
		// lastVerified round-trip + redaction
		fresh.saveConfig({ browserstackLastVerified: { ts: 12345, ok: true, code: 'connected', message: 'x' } });
		const pub = fresh.getPublicConfig();
		out.push(['lv', pub.browserstackLastVerified?.ok, JSON.stringify(pub).includes('saved_key')]);
		console.log(JSON.stringify(out));
	`;
	const env = {
		...process.env,
		QASE_BROWSERSTACK_USER: 'env_seeded_user',
		QASE_BROWSERSTACK_KEY: 'env_seeded_key'
	};
	const raw = execFileSync('node', ['--input-type=module', '-e', script], { cwd: tmp, env, encoding: 'utf8' });
	const out = JSON.parse(raw.trim().split('\n').pop());
	ok(out[0][1] === 'env_seeded_user', 'env seeds BS user when nothing stored');
	ok(out[1][1] === 'saved_user' && out[1][2] === 'saved_key', 'stored BS creds beat env after save');
	ok(out[2][1] === 'saved_user' && out[2][2] === 'saved_key', 'after simulated restart, stored creds still win over env');
	ok(out[3][1] !== 'saved_user' && out[3][2] !== 'saved_key', 'explicit clear removes stored BS creds');
	ok(out[4][1] === true, 'browserstackLastVerified exposed (redacted) to the UI');
	ok(out[4][2] === false, 'public config never contains the raw key');
	fs.rmSync(tmp, { recursive: true, force: true });

	const src = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
	ok(/B0\.1 — BrowserStack credential authority/i.test(src), 'B0.1 authority block present in config.js');
	ok(src.includes('browserstackLastVerified'), 'browserstackLastVerified persisted by saveConfig');
}

// ── 3. Endpoint — auth protection & shape (live server) ──
console.log('\n[3] POST /api/config/test-browserstack — auth + shape');
{
	const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
	const probe = async (headers = {}) => {
		try {
			const res = await fetch(`${BASE}/api/config/test-browserstack`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
			let body = null;
			try { body = await res.json(); } catch { /* non-JSON */ }
			return { status: res.status, body };
		} catch (e) {
			return { status: 0, error: e.message };
		}
	};

	const anon = await probe();
	ok(anon.status === 401 || anon.status === 403, `unauthenticated request rejected (${anon.status})`);
	ok(!anon.body?.ok, 'unauthenticated response does not report success');

	const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
	const m = envText.match(/^QASE_API_TOKEN=(.*)$/m);
	const token = m && m[1] ? m[1].trim() : '';
	ok(!!token, 'QASE_API_TOKEN found for authenticated probe');

	if (token) {
		const authd = await probe({ authorization: `Bearer ${token}` });
		ok(authd.status === 200, `authenticated probe returns 200 (${authd.status})`);
		ok(typeof authd.body?.ok === 'boolean', 'response has boolean ok');
		ok(typeof authd.body?.code === 'string', 'response has code');
		ok(authd.body?.code !== 'connected' || authd.body?.ok === true, 'no success without real connectivity');
		ok(!JSON.stringify(authd.body).toLowerCase().includes('browserstackkey'), 'no key field in response');
		// maskedUser must be masked, never raw
		if (authd.body?.maskedUser) {
			const stored = JSON.parse(fs.readFileSync(path.join(ROOT, '.qase', 'config.json'), 'utf8'));
			ok(authd.body.maskedUser !== stored.browserstackUser, 'maskedUser is not the raw username');
		}
		// lastVerified persisted server-side.
		// M1-P2 fix (docs/M1-P2-TESTING-BASELINE.md §G): previously read
		// ROOT/.qase/config.json (test-cwd assumption); the server persists
		// to ITS own cwd. Read the server's redacted config via the API so
		// the assertion holds wherever the server runs. No weakening: the
		// persisted browserstackLastVerified must still exist with a real ts
		// and contain no credential material.
		// B1 W3: anonymous /api/config reads are closed — authenticate.
		const TOKEN = process.env.QASE_API_TOKEN || '';
		const serverCfg = await fetch(`${BASE}/api/config`, { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} }).then(r => r.json()).catch(() => null);
		const persisted = serverCfg?.browserstackLastVerified ?? null;
		ok(persisted && typeof persisted.ts === 'number', 'last-verified outcome persisted to config');
		ok(!JSON.stringify(persisted ?? {}).includes('tRuEje,27,&') && !/key["']?\s*:\s*"/i.test(JSON.stringify(persisted ?? {})), 'persisted record contains no credential material');
	}
}

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
