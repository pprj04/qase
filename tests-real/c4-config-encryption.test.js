/**
 * C4 — config.js encryption-at-rest integration tests.
 *
 * Runs config.js in a SUBPROCESS (like browserstack-trust.test.js) with an
 * isolated QASE_DATA_DIR and a QASE_SECRET_KEY, exercising:
 *   - saving credentials → browserstackKeyEnc envelope on disk, NO plaintext
 *   - simulated process restart (fresh import, same data dir) preserves creds
 *   - failed connection test does not erase credentials
 *   - explicit Clear removes both plaintext and envelope
 *   - orphaned/undecryptable envelope → browserstackNeedsReentry, no throw
 *   - B0.1 precedence carve-outs still intact (stored beats env)
 *   - raw key never appears in getPublicConfig output
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG_URL = new URL('../server/config.js', import.meta.url).href;

const SECRET_KEY = 'c4-config-test-master-key-abcdef0123456789';

function runConfigScript(script, { env = {}, dataDir } = {}) {
	const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: dataDir ?? ROOT,
		env: {
			...process.env,
			QASE_DATA_DIR: dataDir,
			QASE_SECRET_KEY: SECRET_KEY,
			// scrub env BrowserStack seeds so stored values are authoritative
			QASE_BROWSERSTACK_USER: '',
			QASE_BROWSERSTACK_KEY: '',
			QASE_BROWSERSTACK_ENABLED: '',
			...env
		},
		encoding: 'utf8'
	});
	if (proc.status !== 0) {
		throw new Error(`subprocess failed (${proc.status}): ${proc.stderr}\n${proc.stdout}`);
	}
	return JSON.parse(proc.stdout.trim().split('\n').pop());
}

function tempDataDir() {
	return mkdtempSync(join(tmpdir(), 'c4-config-'));
}

const SAVE_AND_DUMP = `
const cfg = await import(${JSON.stringify(CONFIG_URL)});
const { readFileSync } = await import('node:fs');
await cfg.saveConfig({ browserstackUser: 'audit_user1', browserstackKey: 'PLAINTEXT_KEY_9c8d7e', browserstackEnabled: true });
const onDisk = JSON.parse(readFileSync(process.env.QASE_DATA_DIR + '/config.json', 'utf8'));
const pub = cfg.getPublicConfig();
console.log(JSON.stringify({
	storedHasPlaintextKey: 'browserstackKey' in onDisk,
	storedEnvelope: onDisk.browserstackKeyEnc ?? null,
	publicHasRawKey: JSON.stringify(pub).includes('PLAINTEXT_KEY_9c8d7e'),
	pub: { hasBrowserstackKey: pub.hasBrowserstackKey, browserstackUser: pub.browserstackUser, browserstackKeyEncrypted: pub.browserstackKeyEncrypted, browserstackNeedsReentry: pub.browserstackNeedsReentry, browserstackCredentialSource: pub.browserstackCredentialSource, enabled: pub.browserstackEnabled }
}));
`;

const RESTART_DUMP = `
const cfg = await import(${JSON.stringify(CONFIG_URL + '?restart=' + Date.now())});
const merged = cfg.getConfig();
const pub = cfg.getPublicConfig();
console.log(JSON.stringify({
	mergedHasKey: merged.browserstackKey === 'PLAINTEXT_KEY_9c8d7e',
	mergedUser: merged.browserstackUser,
	pub: { hasBrowserstackKey: pub.hasBrowserstackKey, browserstackKeyEncrypted: pub.browserstackKeyEncrypted, browserstackNeedsReentry: pub.browserstackNeedsReentry, browserstackCredentialSource: pub.browserstackCredentialSource }
}));
`;

const FAILED_TEST_NO_ERASE = `
const cfg = await import(${JSON.stringify(CONFIG_URL)});
// a failed connection test persists ONLY the lastVerified summary
await cfg.saveConfig({ browserstackLastVerified: { ts: 1700000000000, ok: false, code: 'invalid_credentials', message: 'BrowserStack rejected the credentials.', maskedUser: 'aud****r1' } });
const merged = cfg.getConfig();
console.log(JSON.stringify({ keyStillUsable: merged.browserstackKey === 'PLAINTEXT_KEY_9c8d7e' }));
`;

const CLEAR_SCRIPT = `
const cfg = await import(${JSON.stringify(CONFIG_URL)});
const { readFileSync } = await import('node:fs');
await cfg.saveConfig({ browserstackKey: '' });
const onDisk = JSON.parse(readFileSync(process.env.QASE_DATA_DIR + '/config.json', 'utf8'));
const pub = cfg.getPublicConfig();
console.log(JSON.stringify({
	plaintextGone: !('browserstackKey' in onDisk),
	envelopeGone: !('browserstackKeyEnc' in onDisk),
	pub: { hasBrowserstackKey: pub.hasBrowserstackKey, browserstackNeedsReentry: pub.browserstackNeedsReentry, browserstackKeyEncrypted: pub.browserstackKeyEncrypted }
}));
`;

const ORPHAN_SCRIPT = `
const fs = await import('node:fs');
fs.writeFileSync(process.env.QASE_DATA_DIR + '/config.json', JSON.stringify({ browserstackEnabled: true, browserstackUser: 'orphan_user', browserstackKeyEnc: 'enc1:v1:AAAA:BBBB:CCCC:DDDD' }));
const cfg = await import(${JSON.stringify(CONFIG_URL)});
const pub = cfg.getPublicConfig();
const merged = cfg.getConfig();
console.log(JSON.stringify({
	bootOk: true,
	mergedKeyEmpty: !merged.browserstackKey,
	pub: { browserstackNeedsReentry: pub.browserstackNeedsReentry, browserstackCredentialSource: pub.browserstackCredentialSource, browserstackKeyEncrypted: pub.browserstackKeyEncrypted, hasBrowserstackKey: pub.hasBrowserstackKey }
}));
`;

const PRECEDENCE_SCRIPT = `
const cfg = await import(${JSON.stringify(CONFIG_URL)});
// env seeds first boot; stored then wins after save (B0.1).
await cfg.saveConfig({ browserstackUser: 'stored_user', browserstackKey: 'stored_key_value', browserstackEnabled: true });
const merged = cfg.getConfig();
console.log(JSON.stringify({ user: merged.browserstackUser, key: merged.browserstackKey, enabled: merged.browserstackEnabled === true }));
`;

test('C4-C1: save with master key → encrypted envelope, no plaintext on disk', () => {
	const dir = tempDataDir();
	try {
		const out = runConfigScript(SAVE_AND_DUMP, { dataDir: dir });
		assert.equal(out.storedHasPlaintextKey, false, 'plaintext key must not be written');
		assert.match(out.storedEnvelope, /^enc1:v1:/, 'envelope must be on disk');
		assert.equal(out.publicHasRawKey, false, 'raw key must not leak in public config');
		assert.equal(out.pub.hasBrowserstackKey, true);
		assert.equal(out.pub.browserstackUser, 'audit_user1');
		assert.equal(out.pub.browserstackKeyEncrypted, true);
		assert.equal(out.pub.browserstackNeedsReentry, false);
		assert.equal(out.pub.browserstackCredentialSource, 'settings');
		assert.equal(out.pub.enabled, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C2: simulated restart preserves credentials (fresh import, same dir)', () => {
	const dir = tempDataDir();
	try {
		runConfigScript(SAVE_AND_DUMP, { dataDir: dir });
		const out = runConfigScript(RESTART_DUMP, { dataDir: dir });
		assert.equal(out.mergedHasKey, true, 'key must survive restart');
		assert.equal(out.mergedUser, 'audit_user1');
		assert.equal(out.pub.hasBrowserstackKey, true);
		assert.equal(out.pub.browserstackKeyEncrypted, true);
		assert.equal(out.pub.browserstackNeedsReentry, false);
		assert.equal(out.pub.browserstackCredentialSource, 'settings');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C3: failed connection test does not erase credentials', () => {
	const dir = tempDataDir();
	try {
		runConfigScript(SAVE_AND_DUMP, { dataDir: dir });
		const out = runConfigScript(FAILED_TEST_NO_ERASE, { dataDir: dir });
		assert.equal(out.keyStillUsable, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C4: explicit Clear removes plaintext AND envelope', () => {
	const dir = tempDataDir();
	try {
		runConfigScript(SAVE_AND_DUMP, { dataDir: dir });
		const out = runConfigScript(CLEAR_SCRIPT, { dataDir: dir });
		assert.equal(out.plaintextGone, true);
		assert.equal(out.envelopeGone, true);
		assert.equal(out.pub.hasBrowserstackKey, false);
		assert.equal(out.pub.browserstackNeedsReentry, false);
		assert.equal(out.pub.browserstackKeyEncrypted, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C5: orphaned undecryptable envelope → needsReentry, no boot throw', () => {
	const dir = tempDataDir();
	try {
		const out = runConfigScript(ORPHAN_SCRIPT, { dataDir: dir });
		assert.equal(out.bootOk, true);
		assert.equal(out.mergedKeyEmpty, true);
		assert.equal(out.pub.browserstackNeedsReentry, true);
		assert.equal(out.pub.browserstackCredentialSource, 'none');
		assert.equal(out.pub.browserstackKeyEncrypted, true);
		assert.equal(out.pub.hasBrowserstackKey, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C6: B0.1 precedence carve-out intact (stored beats env)', () => {
	const dir = tempDataDir();
	try {
		const out = runConfigScript(PRECEDENCE_SCRIPT, {
			dataDir: dir,
			env: { QASE_BROWSERSTACK_USER: 'env_seeded_user', QASE_BROWSERSTACK_KEY: 'env_seeded_key', QASE_BROWSERSTACK_ENABLED: 'false' }
		});
		assert.equal(out.user, 'stored_user');
		assert.equal(out.key, 'stored_key_value');
		assert.equal(out.enabled, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('C4-C7: source invariants the gate greps survive (B0.1 block, lastVerified)', () => {
	const src = readFileSync(new URL('../server/config.js', import.meta.url), 'utf8');
	assert.match(src, /BUILD B0\.1 — BrowserStack credential authority/i);
	assert.ok(src.includes('storedBs.browserstackUser'));
	assert.ok(src.includes('storedBs.browserstackKey'));
	assert.ok(src.includes('browserstackLastVerified'));
	assert.ok(src.includes('storedBs.browserstackEnabled'));
});
