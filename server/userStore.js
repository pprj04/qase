/**
 * D2 — User accounts + durable authentication sessions.
 *
 * Replaces the D0.5 access-code identity model with real accounts:
 *   - email + password (scrypt, per-user salt — same KDF discipline as
 *     server/secretStore.js: N=16384, r=8, p=1)
 *   - role: admin | operator | viewer (capability matrix reused from D0.5)
 *   - durable sessions whose token is random 32 bytes delivered in an
 *     HttpOnly cookie; ONLY the SHA-256 of the token is stored on disk, so
 *     the store is useless to an attacker who copies the file.
 *   - restart-safe: users + sessions reload from disk on boot
 *   - append-only audit log (logins, lockouts, user admin actions)
 *
 * Storage convention (as in config.js): QASE_DATA_DIR redirects the whole
 * tree for tests; files live directly in that dir, written via atomicWrite
 * with mode 0600.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolved lazily on every access so tests (and any QASE_DATA_DIR change)
// redirect the whole tree without re-importing the module.
function qaseDir() {
	return process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');
}
function usersFile() {
	return join(qaseDir(), 'users.json');
}
function sessionsFile() {
	return join(qaseDir(), 'auth-sessions.json');
}
function auditFile() {
	return join(qaseDir(), 'auth-audit.log');
}

// ── scrypt hashing ──────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

export function hashPassword(password) {
	const salt = randomBytes(16);
	const hash = scryptSync(String(password), salt, KEY_LEN, SCRYPT);
	return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
	try {
		const [scheme, saltB64, hashB64] = String(stored ?? '').split(':');
		if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
		const expected = Buffer.from(hashB64, 'base64url');
		const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64url'), expected.length, SCRYPT);
		return timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}

function hashToken(token) {
	return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

// ── state ───────────────────────────────────────────────────────────────────

let users = [];            // [{ id, email, name, role, passwordHash, createdAt, createdBy, lastLoginAt, disabledAt }]
let sessions = [];         // [{ tokenHash, userId, createdAt, expiresAt, lastSeenAt }]
let loaded = false;
let saveDebounce = null;

function loadSync() {
	if (loaded) return;
	try {
		if (existsSync(usersFile())) users = JSON.parse(readFileSync(usersFile(), 'utf8'));
	} catch { /* unreadable → start empty; register-admin re-bootstraps */ }
	try {
		if (existsSync(sessionsFile())) sessions = JSON.parse(readFileSync(sessionsFile(), 'utf8'));
	} catch { /* unreadable → everyone re-logs-in (safe degradation) */ }
	users = Array.isArray(users) ? users : [];
	sessions = Array.isArray(sessions) ? sessions : [];
	loaded = true;
}

function persistUsers() {
	if (saveDebounce) clearTimeout(saveDebounce);
	saveDebounce = setTimeout(() => {
		saveDebounce = null;
		try {
			atomicWrite(usersFile(), JSON.stringify(users, null, 2) + '\n', { mode: 0o600 });
		} catch (error) {
			console.error('[userStore] failed to persist users:', error?.message ?? error);
		}
	}, 120);
}

function persistSessions() {
	try {
		// Sessions churn; write immediately so a crash never loses a fresh login.
		atomicWrite(sessionsFile(), JSON.stringify(sessions, null, 2) + '\n', mode600());
	} catch (error) {
		console.error('[userStore] failed to persist sessions:', error?.message ?? error);
	}
}

function mode600() {
	return { mode: 0o600 };
}

function audit(event, detail = {}) {
	// Appends only; never contains passwords or tokens.
	const line = JSON.stringify({ ts: Date.now(), event, ...detail }) + '\n';
	try {
		appendFileSync(auditFile(), line, { mode: 0o600 });
	} catch { /* audit is best-effort; never block auth on it */ }
}

export function getAuditTrail(limit = 200) {
	try {
		if (!existsSync(auditFile())) return [];
		return readFileSync(auditFile(), 'utf8')
			.trim().split('\n').filter(Boolean)
			.slice(-limit)
			.map(l => { try { return JSON.parse(l); } catch { return null; } })
			.filter(Boolean);
	} catch {
		return [];
	}
}

// ── users ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 10;
export const VALID_ROLES = new Set(['admin', 'operator', 'viewer']);

export function hasUsers() {
	loadSync();
	return users.length > 0;
}

export function listUsers() {
	loadSync();
	return users.map(({ passwordHash, ...rest }) => rest); // never expose hashes
}

export function findUserByEmail(email) {
	loadSync();
	const needle = String(email ?? '').trim().toLowerCase();
	return users.find(u => u.email === needle) ?? null;
}

export function findUserById(id) {
	loadSync();
	return users.find(u => u.id === id) ?? null;
}

/**
 * Create a user. Returns the user (without hash). Throws Error with
 * .status/.code for API mapping.
 */
export function createUser({ email, name, password, role, createdBy = 'bootstrap' }) {
	loadSync();
	const cleanEmail = String(email ?? '').trim().toLowerCase();
	if (!EMAIL_RE.test(cleanEmail)) throw badRequest(400, 'invalid_email', 'Enter a valid email address.');
	if (String(password ?? '').length < MIN_PASSWORD_LENGTH)
		throw badRequest(400, 'weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	if (!VALID_ROLES.has(role)) throw badRequest(400, 'invalid_role', 'Role must be admin, operator or viewer.');
	const existing = users.find(u => u.email === cleanEmail);
	if (existing) throw badRequest(409, 'email_taken', 'An account with that email already exists.');
	const user = {
		id: randomUUID(),
		email: cleanEmail,
		name: String(name ?? '').trim() || cleanEmail.split('@')[0],
		role,
		passwordHash: hashPassword(password),
		createdAt: Date.now(),
		createdBy,
		lastLoginAt: null,
		disabledAt: null
	};
	users.push(user);
	persistUsers();
	audit('user_created', { userId: user.id, email: user.email, role: user.role, createdBy });
	return { ...user, passwordHash: undefined };
}

export function updateUser(id, patch, actor = {}) {
	loadSync();
	const user = users.find(u => u.id === id);
	if (!user) throw badRequest(404, 'no_user', 'No such user.');
	if (patch.role !== undefined) {
		if (!VALID_ROLES.has(patch.role)) throw badRequest(400, 'invalid_role', 'Role must be admin, operator or viewer.');
		user.role = patch.role;
	}
	if (patch.name !== undefined) user.name = String(patch.name ?? '').trim() || user.name;
	if (patch.disabled === true) {
		user.disabledAt = Date.now();
		revokeUserSessions(id);
	} else if (patch.disabled === false) {
		user.disabledAt = null;
	}
	// Last-admin guard: never let the workspace end with zero ENABLED admins
	// (self-demotion / self-disable would lock everyone out of user admin).
	const enabledAdmins = users.filter(u => u.role === 'admin' && !u.disabledAt).length;
	if (enabledAdmins === 0) {
		// Roll this patch back before persisting.
		if (patch.role !== undefined) user.role = 'admin';
		if (patch.name !== undefined) user.name = String(patch.name ?? '').trim() || user.name;
		if (patch.disabled === true) { user.disabledAt = null; }
		throw badRequest(409, 'last_admin', 'At least one enabled admin account must remain.');
	}
	persistUsers();
	audit('user_updated', { userId: id, fields: Object.keys(patch).sort().join(','), actorId: actor.id ?? null });
	return { ...user, passwordHash: undefined };
}

export function setPassword(id, newPassword, actor = {}) {
	loadSync();
	const user = users.find(u => u.id === id);
	if (!user) throw badRequest(404, 'no_user', 'No such user.');
	if (String(newPassword ?? '').length < MIN_PASSWORD_LENGTH)
		throw badRequest(400, 'weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	user.passwordHash = hashPassword(newPassword);
	persistUsers();
	revokeUserSessions(id); // reset revokes the user's other sessions
	audit('password_reset', { userId: id, actorId: actor.id ?? null });
	return { ...user, passwordHash: undefined };
}

// ── sessions ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_HOURS = Number(process.env.QASE_UI_SESSION_TTL_HOURS ?? 168) || 168;

export function createSession(userId, { ttlHours = DEFAULT_TTL_HOURS } = {}) {
	loadSync();
	const token = randomBytes(32).toString('base64url');
	const now = Date.now();
	sessions.push({
		tokenHash: hashToken(token),
		userId,
		createdAt: now,
		expiresAt: now + ttlHours * 3600_000,
		lastSeenAt: now
	});
	persistSessions();
	return token; // plaintext returned ONCE to the caller (cookie value)
}

export function resolveSession(token) {
	loadSync();
	if (!token) return null;
	const tokenHash = hashToken(token);
	const idx = sessions.findIndex(s => s.tokenHash === tokenHash && s.expiresAt > Date.now());
	if (idx === -1) return null;
	const session = sessions[idx];
	const user = users.find(u => u.id === session.userId);
	if (!user || user.disabledAt) {
		// user deleted/disabled → session invalid
		sessions.splice(idx, 1);
		persistSessions();
		return null;
	}
	session.lastSeenAt = Date.now();
	// Touch lastSeenAt on disk lazily (at most every 10 min) to avoid churn.
	if (session.lastSeenAt - (session.lastPersistedSeen ?? 0) > 600_000) {
		session.lastPersistedSeen = session.lastSeenAt;
		persistSessions();
	}
	return { user, session };
}

export function revokeSession(token) {
	loadSync();
	if (!token) return false;
	const tokenHash = hashToken(token);
	const idx = sessions.findIndex(s => s.tokenHash === tokenHash);
	if (idx === -1) return false;
	const session = sessions[idx];
	sessions.splice(idx, 1);
	persistSessions();
	const user = users.find(u => u.id === session.userId);
	audit('logout', { userId: session.userId, email: user?.email ?? null });
	return true;
}

export function revokeUserSessions(userId) {
	loadSync();
	const before = sessions.length;
	sessions = sessions.filter(s => s.userId !== userId);
	if (sessions.length !== before) persistSessions();
	return before - sessions.length;
}

export function pruneSessions() {
	loadSync();
	const now = Date.now();
	const before = sessions.length;
	sessions = sessions.filter(s => s.expiresAt > now);
	if (sessions.length !== before) persistSessions();
	return before - sessions.length;
}

// ── login ───────────────────────────────────────────────────────────────────

// Constant-cost dummy hash for the unknown-email path (timing uniformity).
const DUMMY_HASH = (() => {
	let value = null;
	return () => {
		if (!value) value = hashPassword('qase-timing-dummy-password');
		return value;
	};
})();

export const LOCKOUT = { maxFails: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

const loginFails = new Map(); // key -> { count, firstAt, lockedUntil }

export function loginRateLimited(key) {
	const entry = loginFails.get(key);
	if (!entry) return false;
	if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true;
	return false;
}

function recordLoginFailure(key) {
	const now = Date.now();
	let entry = loginFails.get(key);
	if (!entry || now - entry.firstAt > LOCKOUT.windowMs) entry = { count: 0, firstAt: now, lockedUntil: 0 };
	entry.count += 1;
	if (entry.count >= LOCKOUT.maxFails) {
		entry.lockedUntil = now + LOCKOUT.lockMs;
		audit('login_lockout', { key: maskKey(key) });
	}
	loginFails.set(key, entry);
}

export function resetLoginFails(key) {
	loginFails.delete(key);
}

function maskKey(key) {
	// IP addresses / emails are not secrets but keep the audit lean.
	const s = String(key);
	return s.length <= 4 ? s : `${s.slice(0, 2)}…${s.slice(-2)}`;
}

/**
 * email + password → { user, token } or throws with .status/.code.
 * Generic failure message (no user enumeration).
 */
export function login(email, password, ip = 'local') {
	loadSync();
	const key = `acct:${String(email ?? '').trim().toLowerCase()}`;
	if (loginRateLimited(key) || loginRateLimited(`ip:${ip}`)) {
		audit('login_denied_locked', { key: maskKey(key), ip: maskKey(ip) });
		throw badRequest(429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
	}
	const user = findUserByEmail(email);
	// Timing: burn the same scrypt cost on the unknown-email path so
	// response time does not reveal which accounts exist (D2 review WARN).
	const storedHash = user ? user.passwordHash : DUMMY_HASH();
	const passwordOk = verifyPassword(password ?? '', storedHash);
	if (!user || !passwordOk || user.disabledAt) {
		recordLoginFailure(key);
		recordLoginFailure(`ip:${ip}`);
		audit('login_failed', { key: maskKey(key), ip: maskKey(ip) });
		throw badRequest(401, 'invalid_credentials', 'Invalid email or password.');
	}
	resetLoginFails(key);
	resetLoginFails(`ip:${ip}`);
	user.lastLoginAt = Date.now();
	persistUsers();
	const token = createSession(user.id);
	audit('login_ok', { userId: user.id, ip: maskKey(ip) });
	return { user: { ...user, passwordHash: undefined }, token };
}

function badRequest(status, code, message) {
	const error = new Error(message);
	error.status = status;
	error.code = code;
	return error;
}

// ── test hooks ──────────────────────────────────────────────────────────────

/** Redirect storage + reset state (used by the D2 test suite). */
export function __resetForTests({ dataDir } = {}) {
	if (saveDebounce) clearTimeout(saveDebounce);
	users = [];
	sessions = [];
	loginFails.clear();
	loaded = false;
	// Re-resolve paths for the redirected dir on next loadSync().
	if (dataDir) {
		process.env.QASE_DATA_DIR = dataDir;
	}
	// Paths are module-level consts; tests run in a child process per file,
	// so re-import is clean. When dataDir is omitted we simply clear state.
}

export function __stateForTests() {
	loadSync();
	return {
		userCount: users.length,
		sessionCount: sessions.length,
		storesRaw: { users: users.map(u => ({ ...u })), sessions: sessions.map(s => ({ ...s })) }
	};
}
