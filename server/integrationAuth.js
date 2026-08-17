/**
 * Phase 10 — Integration Authentication
 *
 * Authenticates external integration requests (from Drytis / AI Studio)
 * without duplicating Drytis's user authentication system.
 *
 * Trust model:
 *   Drytis issues a short-lived HS256 JWT containing the caller's identity
 *   (userId, workspaceId, projectId, roles). QASE verifies the signature
 *   using a shared secret (QASE_INTEGRATION_SECRET) and trusts the claims.
 *
 * Backward compatibility:
 *   The existing QASE_API_TOKEN bearer/cookie auth continues to work for
 *   the dashboard UI and single-user local usage. Integration auth is an
 *   additional layer that takes precedence when a JWT is present.
 *
 * Security:
 *   - Tokens are never logged.
 *   - Identity cannot be spoofed via request body — it comes from the
 *     verified JWT claims only.
 *   - Expired tokens are rejected.
 *   - Malformed tokens are rejected without leaking why.
 */

import { jwtVerify, SignJWT } from 'jose';
import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

/** Default token lifetime in seconds (15 minutes). */
const DEFAULT_TOKEN_TTL_S = 15 * 60;

/** Maximum clock skew in seconds when verifying expiry. */
const CLOCK_TOLERANCE_S = 30;

/**
 * Returns the shared HMAC secret for JWT verification.
 * Falls back to the API token if no dedicated integration secret is set
 * (single-secret deployments).
 */
function getIntegrationSecret() {
	const secret = process.env.QASE_INTEGRATION_SECRET;
	if (secret && secret.length >= 16) {
		return encoder.encode(secret);
	}
	// Fall back to API token (still HMAC, just shared with the auth gate).
	const apiToken = process.env.QASE_API_TOKEN || '';
	return encoder.encode(apiToken || 'qase-fallback-secret');
}

/**
 * Verifies a Drytis-issued integration JWT.
 *
 * @param {string} token — raw JWT string from Authorization header
 * @returns {Promise<object|null>} — identity claims or null if invalid
 */
export async function verifyIntegrationToken(token) {
	if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
		return null;
	}

	try {
		const { payload } = await jwtVerify(token, getIntegrationSecret(), {
			algorithms: ['HS256'],
			clockTolerance: CLOCK_TOLERANCE_S,
		});

		// Minimum required claim: userId
		if (!payload.sub && !payload.userId) {
			return null;
		}

		return {
			userId: payload.sub || payload.userId,
			workspaceId: payload.workspaceId || payload.workspace_id || null,
			projectId: payload.projectId || payload.project_id || null,
			roles: Array.isArray(payload.roles) ? payload.roles : [],
			email: payload.email || null,
			iat: payload.iat || null,
			exp: payload.exp || null,
		};
	} catch {
		// Expired, bad signature, malformed — all return null.
		// We intentionally do NOT log the error to avoid leaking token info.
		return null;
	}
}

/**
 * Creates an integration JWT for testing / Drytis simulation.
 * In production, Drytis issues these — QASE only verifies.
 *
 * @param {object} claims — { userId, workspaceId, projectId, roles, email }
 * @param {number} [ttlSeconds=900] — token lifetime
 * @returns {Promise<string>} — signed JWT
 */
export async function createIntegrationToken(claims, ttlSeconds = DEFAULT_TOKEN_TTL_S) {
	const secret = getIntegrationSecret();
	const now = Math.floor(Date.now() / 1000);

	return new SignJWT({
		workspaceId: claims.workspaceId,
		projectId: claims.projectId,
		roles: claims.roles || [],
		email: claims.email,
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(claims.userId)
		.setIssuedAt(now)
		.setExpirationTime(now + ttlSeconds)
		.setIssuer('drytis')
		.setAudience('qase')
		.sign(secret);
}

/**
 * Extracts the bearer token from an Express request.
 * Does NOT distinguish between integration JWT and API token — that's
 * determined by the caller.
 *
 * @param {object} request — Express request
 * @returns {string|null}
 */
export function extractBearerToken(request) {
	const auth = request.headers.authorization ?? '';
	if (auth.startsWith('Bearer ')) {
		return auth.slice(7).trim() || null;
	}
	return null;
}

/**
 * Builds the integration context object attached to req.integration.
 * This is the single source of truth for identity in downstream handlers.
 *
 * @param {object} identity — result from verifyIntegrationToken
 * @param {object} request — Express request (for correlation ID)
 * @returns {object}
 */
export function buildIntegrationContext(identity, request) {
	const correlationId =
		request.headers['x-correlation-id'] ||
		request.headers['x-request-id'] ||
		null;

	return {
		identity: {
			userId: identity.userId,
			workspaceId: identity.workspaceId,
			projectId: identity.projectId,
			roles: identity.roles,
			email: identity.email,
		},
		workspace: identity.workspaceId,
		project: identity.projectId,
		correlationId,
		// How this request was authenticated
		authMethod: 'jwt',
	};
}

/**
 * Express middleware: authenticates integration requests.
 *
 * Accepts either:
 *   1. A Drytis-issued JWT (Authorization: Bearer <jwt>) → sets req.integration
 *   2. The existing API token (Authorization: Bearer <token> or cookie)
 *
 * If neither is valid AND an integration secret is configured,
 * returns 401.
 *
 * The existing requireApiToken middleware continues to handle the
 * single-user/dashboard auth path. This middleware adds JWT support
 * on top.
 */
export function requireIntegrationAuth(request, response, next) {
	const bearer = extractBearerToken(request);

	if (bearer) {
		// Try JWT verification first
		verifyIntegrationToken(bearer)
			.then(identity => {
				if (identity) {
					request.integration = buildIntegrationContext(identity, request);
					next();
					return;
				}
				// Not a valid JWT — fall through to API token check
				tryLegacyApiToken(request, response, next);
			})
			.catch(() => {
				tryLegacyApiToken(request, response, next);
			});
		return;
	}

	// No bearer token — try cookie / legacy path
	tryLegacyApiToken(request, response, next);
}

/**
 * The legacy API token path (existing requireApiToken logic, refactored
 * for reuse). If QASE_API_TOKEN is not set, allows open access (local mode).
 */
function tryLegacyApiToken(request, response, next) {
	const token = getApiToken();

	if (!token) {
		// No token configured — open access (single-user local mode)
		next();
		return;
	}

	const bearer = extractBearerToken(request);
	if (bearer && safeEqualStr(bearer, token)) {
		next();
		return;
	}

	// Cookie check
	const cookieMatch = /(?:^|;\s*)qase_token=([^;]+)/.exec(request.headers.cookie ?? '');
	if (cookieMatch && safeEqualStr(cookieMatch[1], token)) {
		next();
		return;
	}

	response.status(401).json({
		error: 'Authentication required',
		detail: 'Provide a valid Drytis integration token or QASE API token.',
	});
}

function safeEqualStr(a, b) {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

// Lazy-loaded to avoid circular dependency with config.js
let _cachedApiToken = undefined;
function getApiToken() {
	if (_cachedApiToken === undefined) {
		// Direct env read — config.js does the same thing
		_cachedApiToken = process.env.QASE_API_TOKEN || '';
	}
	return _cachedApiToken;
}
