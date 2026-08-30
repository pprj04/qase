/**
 * C4.1 — Connection-probe truthfulness + masked-key diagnostics.
 *
 * Root cause pinned here: BrowserStack's CDP endpoint completes the WS
 * handshake (101 upgrade) for ANY credentials and only then closes with
 * code 1001 "Invalid username or password". The pre-C4.1 probe resolved
 * success on the handshake alone, producing false "connected" verdicts.
 *
 * Offline probe tests (fake transport, no network):
 *   P1 handshake-only (open, no frame, no close) -> NOT ok
 *   P2 open + close "Invalid username or password" -> invalid_credentials
 *   P3 REST 200 + CDP invalid_credentials -> invalid_credentials overall
 *   P4 open + first app-level frame -> cdp_reachable, ok
 *   P5 close-without-open -> rejected, never ok
 *
 * Config subprocess tests (isolated QASE_DATA_DIR):
 *   C1 browserstackKeyLength reports effective key length (hint only)
 *   C2 public config carries no raw key material
 *   C3 failed verification retains stored credentials
 *   C4 master-key loss -> needsReentry, no auto keygen, unrelated config kept
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const CONFIG_URL = new URL('../server/config.js', import.meta.url).href;
const BS_TEST_URL = new URL('../server/browserstackTest.js', import.meta.url).href;
const SECRET_KEY = 'c41-master-key-abcdef0123456789abcdef0123456789';

// Fake WS bus shaped like makeDefaultWsFactory's EventEmitter bus.
function fakeWs(script) {
	return () => {
		const bus = new EventEmitter();
		bus.close = () => {};
		queueMicrotask(() => {
			if (script.open) bus.emit('open');
			if (script.frame !== undefined) bus.emit('message', JSON.stringify(script.frame));
			if (script.err !== undefined) bus.emit('error', new Error(script.err));
			if (script.closeCode !== undefined) bus.emit('close', script.closeCode, script.closeReason ?? '');
		});
		return bus;
	};
}

async function runProbe({ authOk = true, wsScript }) {
	const { testBrowserstackConnection } = await import(BS_TEST_URL);
	return testBrowserstackConnection({
		user: 'probe_user',
		key: 'probe_key',
		fetchImpl: async () => ({ ok: authOk, status: authOk ? 200 : 401, json: async () => ({}) }),
		wsFactory: fakeWs(wsScript),
		timeoutMs: 800
	});
}

test('C4.1-P1: handshake-only (open, no frame, no close) is NOT reported as success', async () => {
	const r = await runProbe({ wsScript: { open: true } });
	assert.equal(r.ok, false);
});

test('C4.1-P2: open + close "Invalid username or password" -> invalid_credentials', async () => {
	const r = await runProbe({ wsScript: { open: true, closeCode: 1001, closeReason: 'Invalid username or password' } });
	assert.equal(r.ok, false);
	assert.equal(r.code, 'invalid_credentials');
	assert.equal(r.cdp?.code, 'invalid_credentials');
});

test('C4.1-P3: REST 200 + CDP invalid_credentials -> invalid_credentials overall (REST cannot launder CDP rejection)', async () => {
	const r = await runProbe({ authOk: true, wsScript: { open: true, closeCode: 1001, closeReason: 'Invalid username or password' } });
	assert.equal(r.ok, false);
	assert.equal(r.code, 'invalid_credentials');
	assert.equal(r.auth?.ok, true, 'REST stage must still be reported as authenticated');
	assert.equal(r.cdp?.code, 'invalid_credentials');
	assert.match(r.message, /CDP execution endpoint rejected/, 'message should explain the REST-vs-CDP divergence');
});

test('C4.1-P4: open + first app-level frame -> cdp_reachable, ok', async () => {
	const r = await runProbe({ wsScript: { open: 1, frame: { method: 'Target.getBrowserContexts' } } });
	assert.equal(r.ok, true);
	assert.equal(r.cdp?.code, 'cdp_reachable');
});

test('C4.1-P5: close-without-open -> rejected, never ok', async () => {
	const r = await runProbe({ wsScript: { closeCode: 1006 } });
	assert.equal(r.ok, false);
	assert.notEqual(r.code, 'connected');
});

// ---------------------------------------------------------------------------
// Config subprocess tests (isolated QASE_DATA_DIR, like c4-config-encryption)
// ---------------------------------------------------------------------------

/**
 * Run a subprocess config script. Seeds pass { json: false } — they print
 * nothing by design; every asserting script must console.log one JSON line.
 */
function runConfigScript(script, { env = {}, dataDir, json = true } = {}) {
	const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: dataDir ?? ROOT,
		env: {
			...process.env,
			QASE_DATA_DIR: dataDir,
			QASE_SECRET_KEY: SECRET_KEY,
			QASE_BROWSERSTACK_USER: '',
			QASE_BROWSERSTACK_KEY: '',
			QASE_BROWSERSTACK_ENABLED: '',
			...env
		},
		encoding: 'utf8'
	});

	if (proc.status !== 0) {
		throw new Error(
			`subprocess failed (status=${proc.status}, signal=${proc.signal}): ${proc.stderr}` +
			`\n---stdout---\n${proc.stdout}` +
			`\n---script---\n${script.slice(0, 400)}`
		);
	}
	if (!json) return proc.stdout;
	const lastLine = proc.stdout.trim().split('\n').pop();
	if (!lastLine) throw new Error('subprocess produced no JSON line');
	return JSON.parse(lastLine);
}

const ROOT = new URL('..', import.meta.url).pathname;

function tempDataDir() {
	return mkdtempSync(join(tmpdir(), 'c41-cfg-'));
}

test('C4.1-C1: browserstackKeyLength reports the effective key length (hint, not material)', () => {
	const dir = tempDataDir();
	try {
		const res = runConfigScript(`
const cfg = await import(${JSON.stringify(CONFIG_URL)});
await cfg.saveConfig({ browserstackUser: 'len_user', browserstackKey: 'X'.repeat(24), browserstackEnabled: true });
const pub = cfg.getPublicConfig();
console.log(JSON.stringify({
	length: pub.browserstackKeyLength,
	hasKey: pub.hasBrowserstackKey,
	source: pub.browserstackCredentialSource,
	encrypted: pub.browserstackKeyEncrypted
}));`, { dataDir: dir });
		assert.equal(res.length, 24);
		assert.equal(res.hasKey, true);
		assert.equal(res.source, 'settings');
		assert.equal(res.encrypted, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4.1-C2: public config carries NO raw key material anywhere', () => {
	const dir = tempDataDir();
	try {
		const res = runConfigScript(`
const cfg = await import(${JSON.stringify(CONFIG_URL)});
await cfg.saveConfig({ browserstackUser: 'rawcheck_user', browserstackKey: 'SECRETRAWVALUE_qz9', browserstackEnabled: true });
const pub = cfg.getPublicConfig();
console.log(JSON.stringify({ leak: JSON.stringify(pub).includes('SECRETRAWVALUE_qz9'), length: pub.browserstackKeyLength }));`, { dataDir: dir });
		assert.equal(res.leak, false);
		assert.equal(res.length, 18);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4.1-C3: failed verification retains stored credentials (user + envelope survive)', () => {
	const dir = tempDataDir();
	try {
		const res = runConfigScript(`
const cfg = await import(${JSON.stringify(CONFIG_URL)});
await cfg.saveConfig({ browserstackUser: 'survivor_user', browserstackKey: 'SURVIVING_KEY_7f3e2d1c', browserstackEnabled: true });
await cfg.saveConfig({ browserstackLastVerified: { ok: false, code: 'invalid_credentials', ts: '2026-09-01T00:00:00Z' } });
const { readFileSync } = await import('node:fs');
const onDisk = JSON.parse(readFileSync(process.env.QASE_DATA_DIR + '/config.json', 'utf8'));
console.log(JSON.stringify({
	userSurvives: onDisk.browserstackUser === 'survivor_user',
	envelopeSurvives: typeof onDisk.browserstackKeyEnc === 'string' && onDisk.browserstackKeyEnc.startsWith('enc1:'),
	plaintextGone: !('browserstackKey' in onDisk)
}));`, { dataDir: dir });
		assert.equal(res.userSurvives, true);
		assert.equal(res.envelopeSurvives, true);
		assert.equal(res.plaintextGone, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4.1-C4: master-key loss -> needsReentry, no auto keygen, unrelated config preserved', () => {
	const dir = tempDataDir();
	try {
		runConfigScript(`
const cfg = await import(${JSON.stringify(CONFIG_URL)});
await cfg.saveConfig({ browserstackUser: 'orphan_user', browserstackKey: 'ORPHAN_KEY_c41_9m2n4p', browserstackEnabled: true });
await cfg.saveConfig({ provider: 'openai', model: 'gpt-test-model', maxTurns: 42 });`, { dataDir: dir, json: false });
		const res2 = runConfigScript(`
const cfg = await import(${JSON.stringify(CONFIG_URL)});
const pub = cfg.getPublicConfig();
const { readFileSync } = await import('node:fs');
const onDisk = JSON.parse(readFileSync(process.env.QASE_DATA_DIR + '/config.json', 'utf8'));
console.log(JSON.stringify({
	needsReentry: pub.browserstackNeedsReentry,
	source: pub.browserstackCredentialSource,
	hasKey: pub.hasBrowserstackKey,
	lengthHint: pub.browserstackKeyLength,
	envelopeStillOnDisk: typeof onDisk.browserstackKeyEnc === 'string' && onDisk.browserstackKeyEnc.startsWith('enc1:'),
	unrelatedModel: onDisk.model,
	unrelatedTurns: onDisk.maxTurns
}));`, { dataDir: dir, env: { QASE_SECRET_KEY: '' } });
		assert.equal(res2.needsReentry, true);
		assert.equal(res2.source, 'none');
		assert.equal(res2.hasKey, false);
		assert.equal(res2.lengthHint, 0);
		assert.equal(res2.envelopeStillOnDisk, true, 'envelope must stay on disk for later re-decryption attempts');
		assert.equal(res2.unrelatedModel, 'gpt-test-model');
		assert.equal(res2.unrelatedTurns, 42);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
