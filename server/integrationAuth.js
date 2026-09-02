/**
 * B1 W1 — Integration authentication boundary.
 *
 * QASE's external API surface (/api/v1/integration/* plus workspace-scoped
 * mission operations) authenticates with HMAC-SHA256 signed requests using a
 * shared secret held ONLY in env (QASE_INTEGRATION_SECRET).
 *
 * Why HMAC-signed requests (decision record): the existing architecture has
 * exactly one static bearer token and no user/session store. A signature
 * scheme (Authorization: QASE-HMAC-SHA256 keyId:timestamp:nonce:signature)
 * needs no new secret storage, is verifiable with timing-safe compares, and
 * binds the request body + method + path so a captured signature cannot be
 * replayed against a different endpoint. A JWT would add header bloat and an
 * expiry/refresh dance with no additional security for a single-server API.
 *
 * Identity model (minimum two principals):
 *   principal admin       → workspaceId '*' (full access, all workspaces)
 *   principal integration → one workspaceId (mission create/status/result/
 *                            findings/evidence/revalidate within that workspace)
 *
 * Principals live in .qase/integrations.json (persisted, P4.4-compatible) as
 * { keyId, principal, workspaceId, label, createdAt, lastUsedAt }. The shared
 * secret NEVER leaves env and is never echoed by any API or log line.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// R1 — store path honors QASE_DATA_DIR (same contract as config.js /
// findings.js). See missions.js for rationale.
const FILE = join(process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase'), 'integrations.json');

/** Replay window: signatures older/newer than this are rejected. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Nonces remembered per keyId (bounded LRU-ish) to block same-key replay. */
const MAX_NONCES = 5_000;
const seenNonces = new Map(); // keyId -> Set(nonce)
const nonceInsertion = [];   // bounded FIFO for eviction

/* ── Store (same pattern as missions.js: in-memory + debounced mirror) ── */

const integrations = new Map(); // keyId -> { keyId, principal, workspaceId, label, createdAt, lastUsedAt }
let saveTimer = null;

function load() {
	try {
		if (!existsSync(FILE)) return;
		const arr = JSON.parse(readFileSync(FILE, 'utf8'));
		if (Array.isArray(arr)) for (const row of arr) integrations.set(row.keyId, row);
	} catch (err) {
		// M1-P4.4 pattern — preserve the damaged file for forensics, start empty.
		try {
			renameSync(FILE, `${FILE}.corrupt-${Date.now()}`);
		} catch (renameErr) {
			console.error(`[integrations] preserve failed: ${renameErr.message}`);
		}
		console.error(`[integrations] STORE CORRUPT: ${err.message} — starting EMPTY.`);
	}
}


function scheduleSave() {
	if (saveTimer) return;
	saveTimer = setTimeout(flushIntegrations, 1_000);
	saveTimer.unref?.();
}

export function flushIntegrations() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	try {
		mkdirSync(dirname(FILE), { recursive: true });
		atomicWrite(FILE, JSON.stringify([...integrations.values()], null, 2));
	} catch (err) {
		console.error(`[integrations] save failed: ${err.message}`);
	}
}

/* ── Principal management ─────────────────────────────────────────── */

/**
 * Registers (or replaces) an integration principal.
 * Only ever called from the operator bootstrap path — never from an
 * anonymous route.
 */
export function upsertIntegration({ keyId, principal, workspaceId, label }) {
	if (!keyId || typeof keyId !== 'string') throw new Error('keyId required');
	if (!['admin', 'integration'].includes(principal)) throw new Error('principal must be admin|integration');
	if (principal === 'integration' && !workspaceId) throw new Error('integration principal requires workspaceId');
	integrations.set(keyId, {
		keyId,
		principal,
		workspaceId: principal === 'admin' ? '*' : workspaceId,
		label: label ?? principal,
		createdAt: integrations.get(keyId)?.createdAt ?? Date.now(),
		lastUsedAt: integrations.get(keyId)?.lastUsedAt ?? null
	});
	scheduleSave();
	return integrations.get(keyId);
}

export function getIntegration(keyId) {
	return integrations.get(keyId) ?? null;
}

export function listIntegrations() {
	return [...integrations.values()].map(({ keyId, principal, workspaceId, label, createdAt, lastUsedAt }) => ({
		keyId, principal, workspaceId, label, createdAt, lastUsedAt
	}));
}

/* ── Signature verification ───────────────────────────────────────── */

function getSecret() {
	const secret = process.env.QASE_INTEGRATION_SECRET?.trim();
	if (!secret || secret.length < 16) return null;
	return secret;
}

/**
 * Canonical string that is signed: METHOD\nPATH\ntimestamp\nnonce\nsha256(body)
 * Body hash of empty/absent body is the hash of the empty string.
 */
export function canonicalString(method, path, timestamp, nonce, body) {
	const bodyText = body === undefined || body === null ? '' : String(body);
	const bodyHash = createHmac('sha256', '').update(bodyText).digest('hex');
	return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function computeSignature(secret, method, path, timestamp, nonce, body) {
	return createHmac('sha256', secret).update(canonicalString(method, path, timestamp, nonce, body)).digest('hex');
}

/** Timing-safe hex compare (lengths must match). */
function safeHexEqual(a, b) {
	const bufA = Buffer.from(String(a), 'utf8');
	const bufB = Buffer.from(String(b), 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

function rememberNonce(keyId, nonce) {
	let set = seenNonces.get(keyId);
	if (!set) { set = new Set(); seenNonces.set(keyId, set); }
	set.add(nonce);
	nonceInsertion.push(`${keyId}:${nonce}`);
	if (nonceInsertion.length > MAX_NONCES) {
		const evict = nonceInsertion.splice(0, nonceInsertion.length - MAX_NONCES);
		for (const e of evict) {
			const [k, n] = e.split(':');
			seenNonces.get(k)?.delete(n);
		}
	}
}

/**
 * Verifies an HMAC-signed integration request.
 * Returns { ok: true, identity } or { ok: false, status, code, message }.
 *
 * Never logs or returns the secret or the signature.
 */
export function verifySignedRequest({ method, path, rawBody, authorization }) {
	const secret = getSecret();
	if (!secret) {
		return { ok: false, status: 503, code: 'integration_auth_not_configured',
			message: 'Integration auth is not configured on this server (QASE_INTEGRATION_SECRET missing).' };
	}
	const header = String(authorization ?? '');
	const match = /^QASE-HMAC-SHA256 ([A-Za-z0-9_-]+):(\d+):([A-Za-z0-9_-]+):([0-9a-f]{64})$/.exec(header);
	if (!match) {
		return { ok: false, status: 401, code: 'invalid_auth_header',
			message: 'Expected Authorization: QASE-HMAC-SHA256 keyId:timestamp:nonce:signature.' };
	}
	const [, keyId, tsText, nonce, signature] = match;
	const record = integrations.get(keyId);
	if (!record) {
		return { ok: false, status: 401, code: 'unknown_key', message: 'Unknown keyId.' };
	}
	const timestamp = Number(tsText);
	const now = Date.now();
	if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
		return { ok: false, status: 401, code: 'stale_signature', message: 'Signature timestamp outside the 5-minute window.' };
	}
	if (seenNonces.get(keyId)?.has(nonce)) {
		return { ok: false, status: 401, code: 'replayed_nonce', message: 'Nonce already used.' };
	}
	const expected = computeSignature(secret, method, path, tsText, nonce, rawBody ?? '');
	if (!safeHexEqual(expected, signature)) {
		return { ok: false, status: 401, code: 'bad_signature', message: 'Signature verification failed.' };
	}
	rememberNonce(keyId, nonce);
	record.lastUsedAt = Date.now();
	scheduleSave();
	return { ok: true, identity: { keyId, principal: record.principal, workspaceId: record.workspaceId, label: record.label } };
}

/* ── Express middleware ───────────────────────────────────────────── */

/** Stable 401/403 error envelope for the integration surface. */
export function integrationError(status, code, message, res) {
	res.status(status).json({ error: { code, message } });
}

/**
 * requireIntegrationAuth — B1 W1 boundary for the external integration API.
 *
 * Attaches `request.integration = identity` on success. Rejects with the
 * stable envelope on failure. Does NOT touch the legacy UI bearer-token
 * path (requireApiToken stays as-is for /api/v1 legacy routes and the SPA).
 */
export function requireIntegrationAuth(req, res, next) {
	const result = verifySignedRequest({
		method: req.method,
		path: req.path,
		rawBody: req.rawIntegrationBody ?? '',
		authorization: req.headers.authorization
	});
	if (!result.ok) {
		return integrationError(result.status, result.code, result.message, res);
	}
	req.integration = result.identity;
	next();
}

/** Scope check helper: does the identity allow this scope? */
export function hasScope(identity, scope) {
	if (!identity) return false;
	if (identity.principal === 'admin') return true;
	const integrationScopes = [
		'mission:create', 'mission:read', 'mission:stop',
		'findings:read', 'evidence:read', 'revalidate'
	];
	return integrationScopes.includes(scope);
}

/** Ownership check: identity workspace vs entity workspace (admin passes). */
export function workspaceMatches(identity, entityWorkspaceId) {
	if (!identity) return false;
	if (identity.principal === 'admin') return true;
	if (identity.workspaceId === '*') return true;
	return identity.workspaceId === entityWorkspaceId;
}

/** Generates a fresh keyId (operators derive their own signing setup). */
export function newKeyId() {
	return `qk_${randomBytes(12).toString('base64url')}`;
}

/* Boot */
load();
