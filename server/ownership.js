/**
 * P0-F4 — resource ownership & workspace isolation.
 *
 * ONE choke point for every read/write of missions, sessions, findings and
 * evidence. The model reuses the existing QASE auth identity — no second
 * identity system:
 *
 *   request.auth.kind = 'open'    (QASE_AUTH_MODE=disabled / no token set)
 *       → single-tenant dev mode: no isolation (unchanged behavior).
 *   request.auth.kind = 'master'  (bearer/cookie master token)
 *       → the machine credential; full access to every resource (unchanged).
 *   request.auth.kind = 'user'    (qase_session cookie, role admin/operator/viewer)
 *       → USER ISOLATION. Resources the user created are theirs; another
 *         user's resources are invisible (404, never a leak). Admin users see
 *         everything (documented admin capability).
 *   request.integration           (HMAC integration principals)
 *       → workspace semantics UNCHANGED (workspaceMatches). This module
 *         never touches integration requests — the existing
 *         requireMissionForIntegration / requireIntegrationAuth surface keeps
 *         enforcing its own boundary, including admin-'*' principals.
 *
 * Legacy records created before this field existed carry ownerUserId == null.
 * They remain visible to every authenticated user (they predate ownership;
 * hiding them would orphan the shared single-tenant history the product was
 * built on). New records created by a user-kind principal are stamped with
 * that user's id and are invisible to other users from then on.
 *
 * Never rely on the frontend for any of this — the checks below are the
 * enforcement point; UI filtering is cosmetic.
 */

const LEGACY_OWNER = null;

/** True when the request carries a user identity that must be isolated. */
export function isUserScoped(request) {
	return request?.auth?.kind === 'user' && request.auth.role !== 'admin';
}

/** The principal that newly created records are stamped with (or LEGACY_OWNER). */
export function ownerOfRequest(request) {
	if (isUserScoped(request)) {
		return request.auth.userId;
	}
	return LEGACY_OWNER;
}

/** True when the authenticated user may access the given resource record. */
export function canAccessResource(request, resource) {
	// Integration principals are authenticated by requireIntegrationAuth and
	// checked against the mission's workspace there. Requests that arrive
	// without integration identity fall through to the rules below.
	const auth = request?.auth ?? {};
	if (!auth.kind) {
		// No principal attached (e.g. a surface that bypassed requireApiToken
		// tagging): treat as the existing single-tenant open posture rather
		// than denying — the auth middleware is the gate, not this helper.
		return true;
	}
	if (auth.kind === 'open' || auth.kind === 'master') {
		return true; // dev mode / machine credential — unchanged
	}
	if (auth.kind === 'user' && auth.role === 'admin') {
		return true; // documented admin capability — workspace-level access
	}
	if (auth.kind === 'user') {
		const owner = resource?.ownerUserId ?? LEGACY_OWNER;
		if (owner === LEGACY_OWNER) {
			return true; // legacy pre-ownership record: shared history
		}
		return owner === auth.userId;
	}
	return false; // unrecognized principal → deny
}

/**
 * Express helper — resolves the record, enforcing ownership. Returns the
 * record when access is allowed; undefined (after writing a 404 that does NOT
 * leak whether the resource exists) when denied. Mirrors the existing
 * requireSession() pattern so routes read the same.
 */
export function requireOwnedResource(request, response, kind, id, resolver) {
	const resource = resolver(id);
	if (!resource) {
		response.status(404).json({ error: `${kind[0].toUpperCase()}${kind.slice(1)} not found.` });
		return undefined;
	}
	if (!canAccessResource(request, resource)) {
		// Same body for "missing" and "exists but not yours" — a cross-user
		// probe must not learn the resource exists.
		response.status(404).json({ error: `${kind[0].toUpperCase()}${kind.slice(1)} not found.` });
		return undefined;
	}
	return resource;
}

/** List filter — keep only records the authenticated user may see. */
export function scopeList(request, records) {
	if (!isUserScoped(request)) {
		return records;
	}
	return records.filter(record => canAccessResource(request, record));
}
