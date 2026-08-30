/**
 * D0.5 — Scoped UI access codes + server-side sessions.
 *
 * Lets teammates use the UI without the master API token:
 *   - access codes (viewer | operator), scrypt-HASHED at rest in
 *     .qase/ui-access.json (plaintext never persisted)
 *   - random 32-byte session ids held in memory only; cookie carries just the id
 *   - per-IP failed-attempt rate limiting
 *   - revoking a code invalidates its sessions on the very next request
 *
 * Reuses repo conventions: atomicWrite persistence, debounced mirror,
 * corrupt-file forensics (integrationAuth.js pattern), scrypt params from
 * secretStore.js (N=16384, r=8, p=1) — but one-way (no encryption envelope):
 * codes must NOT be recoverable.
 *
 * The master API token is NOT involved here; uiAccess is purely additive to
 * requireApiToken in index.js.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
// QASE_DATA_DIR lets tests redirect the whole .qase tree to a temp dir —
// same convention as config.js / findings.js. Unset in production.
const QASE_DIR = process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');
const FILE = join(QASE_DIR, 'ui-access.json');

export const UI_ROLES = ['viewer', 'operator'];
export const SESSION_COOKIE = 'qase_session';

/** Sliding session TTL (ms). Default 7 days; QASE_UI_SESSION_TTL_HOURS override. */
function sessionTtlMs() {
	const hours = Number(process.env.QASE_UI_SESSION_TTL_HOURS ?? 0);
	return hours > 0 ? hours * 3600_000 : 7 * 24 * 3600_000;
}

/* ── Code hashing (one-way) ───────────────────────────────────────── */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

/** `scrypt1:<saltB64>:<hashB64>` — deterministic per code, not decryptable. */
export function hashCode(code) {
	const salt = randomBytes(16);
	const hash = scryptSync(String(code), salt, KEY_LEN, SCRYPT_PARAMS);
	return `scrypt1:${salt.toString('base64')}:${hash.toString('base64')}`;
}

/** Constant-time verify of a candidate against a stored scrypt1 hash. */
export function verifyCode(candidate, stored) {
	if (typeof candidate !== 'string' || typeof stored !== 'string') return false;
	const parts = stored.split(':');
	if (parts.length !== 3 || parts[0] !== 'scrypt1') return false;
	let salt, hash;
	try {
		salt = Buffer.from(parts[1], 'base64');
		hash = Buffer.from(parts[2], 'base64');
	} catch {
		return false;
	}
	if (salt.length === 0 || hash.length === 0) return false;
	const candidateHash = scryptSync(candidate, salt, hash.length, SCRYPT_PARAMS);
	return candidateHash.length === hash.length && timingSafeEqual(candidateHash, hash);
}

/** Random URL-safe access code. Returned to the admin exactly once. */
export function generateCode() {
	const raw = randomBytes(16).toString('base64url'); // 22 chars
	return `qase-team-${raw}`;
}

/* ── Store: codes (persisted) ─────────────────────────────────────── */

const codes = new Map(); // id -> record
let saveTimer = null;

function load() {
	try {
		if (!existsSync(FILE)) return;
		const arr = JSON.parse(readFileSync(FILE, 'utf8'));
		if (Array.isArray(arr)) {
			for (const row of arr) {
				if (row && typeof row.id === 'string' && typeof row.codeHash === 'string') {
					codes.set(row.id, row);
				}
			}
		}
	} catch (err) {
		// M1-P4.4 pattern — preserve the damaged file for forensics, start empty.
		try { renameSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch { /* best effort */ }
		console.error('[ui-access] STORE CORRUPT:', err.message, '— starting EMPTY.');
	}
}
load();

function scheduleSave() {
	if (saveTimer) return;
	saveTimer = setTimeout(flush, 1_000);
	saveTimer.unref?.();
}

export function flush() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	try {
		atomicWrite(FILE, JSON.stringify([...codes.values()], undefined, '\t'), { mode: 0o600 });
	} catch (err) {
		console.error('[ui-access] persist failed:', err.message);
	}
}

/** Mint a code. Returns metadata + the ONE-TIME plaintext code. */
export function mintCode({ label, role }) {
	if (!UI_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
	const id = `ac_${randomBytes(8).toString('hex')}`;
	const code = generateCode();
	const record = {
		id,
		label: String(label ?? '').trim().slice(0, 60) || `code-${id.slice(3, 9)}`,
		role,
		codeHash: hashCode(code),
		createdAt: Date.now(),
		revokedAt: null,
		lastUsedAt: null
	};
	codes.set(id, record);
	scheduleSave();
	return { ...record, codeHash: undefined, code }; // plaintext once, hash never leaves
}

/** Safe metadata for the admin list — never includes the hash or code. */
export function listCodes() {
	return [...codes.values()]
		.map(({ codeHash, ...meta }) => meta)
		.sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeCode(id) {
	const record = codes.get(id);
	if (!record) return null;
	record.revokedAt = record.revokedAt ?? Date.now();
	scheduleSave();
	return { ...record, codeHash: undefined };
}

export function restoreCode(id) {
	const record = codes.get(id);
	if (!record) return null;
	record.revokedAt = null;
	scheduleSave();
	return { ...record, codeHash: undefined };
}

/** Find the active code record matching a candidate plaintext. */
function findActiveCode(candidate) {
	for (const record of codes.values()) {
		if (record.revokedAt) continue;
		if (verifyCode(candidate, record.codeHash)) return record;
	}
	return null;
}

/* ── Sessions (in-memory only) ────────────────────────────────────── */

const sessions = new Map(); // sessionId -> { id, codeId, role, label, createdAt, expiresAt }

function newSessionId() {
	return randomBytes(32).toString('base64url');
}

/** Validate a code; on success create a session. Returns session or error code. */
export function loginWithCode(candidate, { now = Date.now() } = {}) {
	const code = typeof candidate === 'string' ? candidate.trim() : '';
	if (!code) return { ok: false, code: 'invalid' };
	const record = findActiveCode(code);
	if (!record) return { ok: false, code: 'invalid' };
	const id = newSessionId();
	const session = {
		id,
		codeId: record.id,
		role: record.role,
		label: record.label,
		createdAt: now,
		expiresAt: now + sessionTtlMs()
	};
	sessions.set(id, session);
	record.lastUsedAt = now;
	scheduleSave();
	pruneSessions(now);
	return { ok: true, session };
}

/** Resolve a session id → live session (sliding expiry, code still active). */
export function resolveSession(sessionId, { now = Date.now() } = {}) {
	if (typeof sessionId !== 'string' || !sessionId) return null;
	const session = sessions.get(sessionId);
	if (!session) return null;
	if (session.expiresAt <= now) {
		sessions.delete(sessionId);
		return null;
	}
	const record = codes.get(session.codeId);
	if (!record || record.revokedAt) {
		sessions.delete(sessionId);
		return null;
	}
	session.expiresAt = now + sessionTtlMs(); // sliding
	return session;
}

export function destroySession(sessionId) {
	if (typeof sessionId === 'string') sessions.delete(sessionId);
}

function pruneSessions(now = Date.now()) {
	for (const [id, s] of sessions) {
		if (s.expiresAt <= now) sessions.delete(id);
	}
}

export function sessionCount() {
	return sessions.size;
}

/** Test hook: clear in-memory sessions (restart simulation). */
export function _clearSessionsForTests() {
	sessions.clear();
}

/* ── Rate limiting: 5 failed logins / 15 min / source IP ──────────── */

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 5;
const failuresByIp = new Map(); // ip -> { count, windowStart }

export function loginRateLimited(ip, { now = Date.now() } = {}) {
	const entry = failuresByIp.get(ip);
	if (!entry) return false;
	if (now - entry.windowStart >= RATE_WINDOW_MS) {
		failuresByIp.delete(ip);
		return false;
	}
	return entry.count >= RATE_MAX_FAILURES;
}

export function recordLoginFailure(ip, { now = Date.now() } = {}) {
	const entry = failuresByIp.get(ip);
	if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
		failuresByIp.set(ip, { count: 1, windowStart: now });
		return;
	}
	entry.count += 1;
}

export function recordLoginSuccess(ip) {
	failuresByIp.delete(ip);
}

/** Admin/ops hook: clear the failed-login limiter (unlocks a locked-out IP). */
export function resetLoginLimiter() {
	failuresByIp.clear();
}

/** Parse `qase_session` out of a raw cookie header (no cookie-parser dep). */
export function sessionFromCookieHeader(cookieHeader) {
	const match = /(?:^|;\s*)qase_session=([^;]+)/.exec(cookieHeader ?? '');
	return match ? decodeURIComponent(match[1]) : null;
}
