/**
 * C4 — Secret store: versioned, authenticated encryption for secrets at rest.
 *
 * Storage location is `.qase/config.json` (approved C4 decision 1) — the
 * envelope is stored as the `browserstackKeyEnc` field next to the (masked)
 * `browserstackUser`. No separate `.qase/secrets/` tree: the audit proved it
 * unnecessary (`.qase/` is wholly gitignored and `config.json` is already
 * written 0600 via atomicWrite).
 *
 * Envelope format (single string, base64url, colon-separated):
 *
 *     enc1:v1:<saltB64url>:<ivB64url>:<tagB64url>:<ctB64url>
 *
 * - KDF: scrypt(masterKey, salt, 32, { N: 16384, r: 8, p: 1 })
 * - Cipher: AES-256-GCM, 12-byte random IV, AAD = 'qase:secretstore:v1'
 * - Master key: process.env.QASE_SECRET_KEY (never logged, never stored).
 *
 * Security properties relied on by C4 acceptance tests:
 *   - The ciphertext and envelope never contain the plaintext.
 *   - A wrong master key fails with `wrong_master_key` — GCM tag mismatch —
 *     without ever revealing plaintext or key material.
 *   - Tampered ciphertext/IV fails with `wrong_master_key` (GCM cannot
 *     distinguish tampering from a wrong key — the two codes are synonyms
 *     in v1; callers treat both as needs-re-entry).
 *   - Error paths carry no secret material whatsoever.
 *
 * Orphan-handling (approved decision 2): an envelope written by a different
 * (lost) build decrypts to `wrong_master_key`/`corrupt_envelope`; config.js
 * maps that to the operator-facing `browserstackNeedsReentry` state. This
 * module never guesses recovery logic.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const PREFIX = 'enc1';
const VERSION = 'v1';
const AAD = 'qase:secretstore:v1';
const KEY_LEN = 32; // AES-256
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const MAX_SECRET_LEN = 64 * 1024;

/** env source is injectable so tests exercise the real code paths offline. */
function masterKeyFrom(env = process.env) {
	const raw = env.QASE_SECRET_KEY;
	if (typeof raw !== 'string') return '';
	return raw.trim();
}

/** True when an encryption master key is configured in the environment. */
export function hasMasterKey(env = process.env) {
	return masterKeyFrom(env).length > 0;
}

function b64url(buf) {
	return Buffer.from(buf).toString('base64url');
}

function fromB64url(str) {
	return Buffer.from(String(str), 'base64url');
}

function deriveKey(masterKey, salt) {
	return scryptSync(masterKey, salt, KEY_LEN, SCRYPT_PARAMS);
}

/**
 * Encrypt a secret into an `enc1:` envelope string.
 * @throws Error('secretstore: master key missing …') when QASE_SECRET_KEY is unset
 * @throws Error('secretstore: plaintext required') when plaintext is empty
 */
export function encryptSecret(plaintext, { env = process.env } = {}) {
	const masterKey = masterKeyFrom(env);
	if (!masterKey) {
		throw new Error('secretstore: master key missing — set QASE_SECRET_KEY to store secrets at rest');
	}
	const value = String(plaintext ?? '');
	if (!value) {
		throw new Error('secretstore: plaintext required');
	}
	if (value.length > MAX_SECRET_LEN) {
		throw new Error('secretstore: secret too long');
	}
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = deriveKey(masterKey, salt);
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
	cipher.setAAD(Buffer.from(AAD, 'utf8'));
	const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [PREFIX, VERSION, b64url(salt), b64url(iv), b64url(tag), b64url(ct)].join(':');
}

/**
 * Decrypt an `enc1:` envelope.
 * @returns {{ ok: true, value: string } | { ok: false, code: 'missing_master_key'|'invalid_envelope'|'corrupt_envelope'|'wrong_master_key'|'empty', message?: string }}
 * Never throws for envelope-level problems; never includes plaintext or key
 * material in any failure message.
 */
export function decryptSecret(envelope, { env = process.env } = {}) {
	if (typeof envelope !== 'string' || !envelope) {
		return { ok: false, code: 'empty' };
	}
	const parts = envelope.split(':');
	if (parts[0] !== PREFIX || parts.length !== 6) {
		return { ok: false, code: 'invalid_envelope' };
	}
	const [, version, saltB64, ivB64, tagB64, ctB64] = parts;
	if (version !== VERSION) {
		return { ok: false, code: 'invalid_envelope' };
	}
	const masterKey = masterKeyFrom(env);
	if (!masterKey) {
		return { ok: false, code: 'missing_master_key' };
	}
	let salt, iv, tag, ct;
	try {
		salt = fromB64url(saltB64);
		iv = fromB64url(ivB64);
		tag = fromB64url(tagB64);
		ct = fromB64url(ctB64);
	} catch {
		return { ok: false, code: 'invalid_envelope' };
	}
	if (salt.length === 0 || iv.length === 0 || tag.length === 0 || ct.length === 0) {
		return { ok: false, code: 'invalid_envelope' };
	}
	if (tag.length !== 16 || iv.length !== 12) {
		// Not produced by this format (e.g. an orphan from another build).
		return { ok: false, code: 'invalid_envelope' };
	}
	const key = deriveKey(masterKey, salt);
	const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
	decipher.setAAD(Buffer.from(AAD, 'utf8'));
	decipher.setAuthTag(tag);
	let plain;
	try {
		plain = Buffer.concat([decipher.update(ct), decipher.final()]);
	} catch {
		// GCM tag mismatch: wrong master key OR tampered ciphertext/IV.
		// Never attempt recovery, never echo material.
		return { ok: false, code: 'wrong_master_key' };
	}
	const value = plain.toString('utf8');
	if (!value) {
		return { ok: false, code: 'empty' };
	}
	return { ok: true, value };
}

/** Safe-to-log envelope descriptor. Reveals version only — no material. */
export function describeEnvelope(envelope) {
	if (typeof envelope !== 'string' || !envelope.startsWith(PREFIX + ':')) {
		return { ok: false, version: null };
	}
	const version = envelope.split(':')[1] ?? null;
	return { ok: version === VERSION, version };
}
