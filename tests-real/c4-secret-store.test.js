/**
 * C4 — secret store unit tests.
 *
 * Covers the secretStore.js envelope: round-trip, tamper detection, wrong
 * master key, invalid envelopes, missing master key, and the hard guarantee
 * that no failure path ever exposes plaintext or key material.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
	encryptSecret, decryptSecret, hasMasterKey, describeEnvelope
} = await import('../server/secretStore.js');

const ENV = { QASE_SECRET_KEY: 'test-master-key-c4-0123456789abcdef' };
const SECRET = 'bs-access-key-XyZ9mQ2w';

test('C4-S1: hasMasterKey reflects env only', () => {
	assert.equal(hasMasterKey(ENV), true);
	assert.equal(hasMasterKey({}), false);
	assert.equal(hasMasterKey({ QASE_SECRET_KEY: '   ' }), false);
});

test('C4-S2: encrypt/decrypt round-trip', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	assert.ok(typeof envelope === 'string');
	assert.match(envelope, /^enc1:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
	assert.ok(!envelope.includes(SECRET), 'envelope must not contain plaintext');
	const out = decryptSecret(envelope, { env: ENV });
	assert.equal(out.ok, true);
	assert.equal(out.value, SECRET);
});

test('C4-S3: fresh envelope each time (random salt + IV)', () => {
	const a = encryptSecret(SECRET, { env: ENV });
	const b = encryptSecret(SECRET, { env: ENV });
	assert.notEqual(a, b);
});

test('C4-S4: wrong master key → wrong_master_key, no material leaked', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	const out = decryptSecret(envelope, { env: { QASE_SECRET_KEY: 'attacker-different-key' } });
	assert.equal(out.ok, false);
	assert.equal(out.code, 'wrong_master_key');
	assert.ok(!JSON.stringify(out).includes(SECRET));
});

test('C4-S5: tampered ciphertext → wrong_master_key (GCM auth failure)', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	const parts = envelope.split(':');
	// flip a ciphertext byte
	const ct = Buffer.from(parts[5], 'base64url');
	ct[0] ^= 0xff;
	parts[5] = ct.toString('base64url');
	const out = decryptSecret(parts.join(':'), { env: ENV });
	assert.equal(out.ok, false);
	assert.ok(out.code === 'wrong_master_key' || out.code === 'corrupt_envelope');
});

test('C4-S6: tampered tag → auth failure, no plaintext', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	const parts = envelope.split(':');
	const tag = Buffer.from(parts[4], 'base64url');
	tag[0] ^= 0xff;
	parts[4] = tag.toString('base64url');
	const out = decryptSecret(parts.join(':'), { env: ENV });
	assert.equal(out.ok, false);
	assert.ok(!JSON.stringify(out).includes(SECRET));
});

test('C4-S7: garbage envelope → invalid_envelope', () => {
	for (const bad of ['', null, undefined, 'enc1', 'enc2:v1:a:b:c:d', 'plainsecret', 'enc1:v2:a:b:c:d']) {
		const out = decryptSecret(bad, { env: ENV });
		assert.equal(out.ok, false, `expected failure for ${JSON.stringify(bad)}`);
		assert.ok(['invalid_envelope', 'empty'].includes(out.code), `code ${out.code}`);
	}
});

test('C4-S8: missing master key → missing_master_key (no throw)', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	const out = decryptSecret(envelope, { env: {} });
	assert.equal(out.ok, false);
	assert.equal(out.code, 'missing_master_key');
});

test('C4-S9: encrypt requires master key / plaintext', () => {
	assert.throws(() => encryptSecret(SECRET, { env: {} }), /master key missing/);
	assert.throws(() => encryptSecret('', { env: ENV }), /plaintext required/);
});

test('C4-S10: describeEnvelope is safe for logging', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	const d = describeEnvelope(envelope);
	assert.equal(d.ok, true);
	assert.equal(d.version, 'v1');
	assert.ok(!JSON.stringify(d).includes(SECRET));
	assert.equal(describeEnvelope('not-an-envelope').ok, false);
	assert.equal(describeEnvelope('not-an-envelope').version, null);
});

test('C4-S11: envelope carries no key material', () => {
	const envelope = encryptSecret(SECRET, { env: ENV });
	assert.ok(!envelope.includes(ENV.QASE_SECRET_KEY), 'master key must not leak');
	const out = decryptSecret(envelope + 'x', { env: ENV });
	assert.equal(out.ok, false);
	assert.ok(!JSON.stringify(out).includes(ENV.QASE_SECRET_KEY));
});
