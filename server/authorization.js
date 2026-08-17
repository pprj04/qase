/**
 * Phase 10 — Authorization
 *
 * Answers: "What is this authenticated caller allowed to access?"
 *
 * Trust model:
 *   Authentication (integrationAuth.js) establishes WHO the caller is.
 *   Authorization checks whether that caller may access a specific resource.
 *
 * Rules:
 *   1. A caller may only access resources within their workspace.
 *   2. A caller may only access resources within their project (if projectId is scoped).
 *   3. Cross-workspace and cross-project access is rejected.
 *   4. Ownership is resolved SERVER-SIDE — client-supplied IDs are validated
 *      against the authenticated identity, never trusted directly.
 *   5. Requests authenticated via the legacy API token (no integration context)
 *      are treated as "internal/admin" — full access for backward compatibility.
 */

/**
 * Determines whether an integration context has access to a workspace.
 *
 * @param {object} integrationCtx — from req.integration (may be null for legacy)
 * @param {string} workspaceId — target workspace
 * @returns {boolean}
 */
export function authorizeWorkspace(integrationCtx, workspaceId) {
	// No integration context = legacy/API token auth = full access
	if (!integrationCtx || !integrationCtx.identity) {
		return true;
	}

	// No workspaceId on resource = treat as internal/shared = allow
	if (!workspaceId) {
		return true;
	}

	// Caller's workspace must match
	return integrationCtx.identity.workspaceId === workspaceId;
}

/**
 * Determines whether an integration context has access to a project.
 *
 * @param {object} integrationCtx
 * @param {object} project — { id, workspaceId }
 * @returns {boolean}
 */
export function authorizeProject(integrationCtx, project) {
	if (!integrationCtx || !integrationCtx.identity) {
		return true;
	}

	if (!project) {
		return false;
	}

	// Check workspace match first
	if (project.workspaceId && !authorizeWorkspace(integrationCtx, project.workspaceId)) {
		return false;
	}

	// If caller is scoped to a specific project, check that too
	if (integrationCtx.identity.projectId && project.id !== integrationCtx.identity.projectId) {
		return false;
	}

	return true;
}

/**
 * Determines whether an integration context may access a mission.
 * Resolves ownership through the mission's project chain.
 *
 * @param {object} integrationCtx
 * @param {object} mission — { id, projectId, workspaceId }
 * @param {object} [project] — optional pre-resolved project (avoid extra lookup)
 * @returns {boolean}
 */
export function authorizeMission(integrationCtx, mission, project) {
	if (!integrationCtx || !integrationCtx.identity) {
		return true;
	}

	if (!mission) {
		return false;
	}

	// If mission has workspaceId directly (Phase 10+), check it
	if (mission.workspaceId) {
		if (!authorizeWorkspace(integrationCtx, mission.workspaceId)) {
			return false;
		}
	}

	// Check via project if provided
	if (project) {
		return authorizeProject(integrationCtx, project);
	}

	// If no project info available, allow (defense-in-depth via project lookup in caller)
	return true;
}

/**
 * Determines whether an integration context may access a session.
 *
 * @param {object} integrationCtx
 * @param {object} session — { id, projectId }
 * @param {object} [project]
 * @returns {boolean}
 */
export function authorizeSession(integrationCtx, session, project) {
	// Sessions follow the same rules as missions
	return authorizeMission(integrationCtx, session, project);
}

/**
 * Determines whether an integration context may access a finding.
 *
 * @param {object} integrationCtx
 * @param {object} finding — { id, projectId, sessionId }
 * @param {object} [project]
 * @returns {boolean}
 */
export function authorizeFinding(integrationCtx, finding, project) {
	return authorizeMission(integrationCtx, finding, project);
}

/**
 * Determines whether an integration context may access evidence.
 * Evidence belongs to a mission → session → project chain.
 *
 * @param {object} integrationCtx
 * @param {object} evidence — { missionId, sessionId }
 * @param {object} [mission] — optional resolved mission
 * @param {object} [project]
 * @returns {boolean}
 */
export function authorizeEvidence(integrationCtx, evidence, mission, project) {
	if (!integrationCtx || !integrationCtx.identity) {
		return true;
	}

	// If we have the mission, check through it
	if (mission) {
		return authorizeMission(integrationCtx, mission, project);
	}

	// No mission info — allow (caller should resolve before calling)
	return true;
}

/**
 * Determines whether an integration context may access an artifact.
 * Artifacts belong to a session → project chain.
 *
 * @param {object} integrationCtx
 * @param {object} session — { id, projectId }
 * @param {object} [project]
 * @returns {boolean}
 */
export function authorizeArtifact(integrationCtx, session, project) {
	return authorizeSession(integrationCtx, session, project);
}

/**
 * Express middleware factory: guards a route by requiring workspace-level access.
 * Attaches the resolved workspaceId to req.integration.workspace for downstream use.
 *
 * Usage: app.get('/api/v1/missions', requireIntegrationAuth, requireWorkspaceAccess, handler)
 *
 * @param {object} request
 * @param {object} response
 * @param {function} next
 */
export function requireWorkspaceAccess(request, response, next) {
	// Legacy auth (no integration context) — allow all
	if (!request.integration) {
		next();
		return;
	}

	const workspaceId = request.integration.identity.workspaceId;
	if (!workspaceId) {
		// JWT without workspaceId claim — reject (workspace scope is mandatory for integration)
		return response.status(403).json({
			error: 'Forbidden',
			detail: 'Integration token must include a workspaceId claim.',
		});
	}

	next();
}

/**
 * Checks if the caller can create a mission in the given project.
 * The projectId is resolved server-side from the integration context,
 * not trusted from the request body alone.
 *
 * @param {object} integrationCtx
 * @param {string} requestedProjectId — from request body (may be null)
 * @param {function} getProjectFn — (id) => project object
 * @returns {{ allowed: boolean, projectId: string|null, reason?: string }}
 */
export function resolveCreatableProject(integrationCtx, requestedProjectId, getProjectFn) {
	// Legacy auth — allow any project
	if (!integrationCtx || !integrationCtx.identity) {
		return { allowed: true, projectId: requestedProjectId };
	}

	// If caller is scoped to a project, that overrides any body-provided projectId
	if (integrationCtx.identity.projectId) {
		const project = getProjectFn(integrationCtx.identity.projectId);
		if (!project) {
			return { allowed: false, projectId: null, reason: 'Project not found' };
		}
		if (!authorizeProject(integrationCtx, project)) {
			return { allowed: false, projectId: null, reason: 'Not authorized for this project' };
		}
		return { allowed: true, projectId: project.id };
	}

	// Caller has workspace scope — can create in any project within their workspace
	if (requestedProjectId) {
		const project = getProjectFn(requestedProjectId);
		if (!project) {
			return { allowed: false, projectId: null, reason: 'Project not found' };
		}
		if (!authorizeProject(integrationCtx, project)) {
			return { allowed: false, projectId: null, reason: 'Not authorized for this project' };
		}
		return { allowed: true, projectId: project.id };
	}

	// No specific project requested — allow (will use default)
	return { allowed: true, projectId: null };
}

/**
 * Express error handler for authorization failures.
 */
export function denyAccess(response, detail = 'Access denied') {
	return response.status(403).json({
		error: 'Forbidden',
		detail,
	});
}
