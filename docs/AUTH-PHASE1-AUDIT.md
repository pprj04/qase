# Phase 1 authentication audit (before implementation)

Authentication files: server/index.js (HTTP middleware, cookies, role checks,
login/logout/bootstrap/user management), server/userStore.js (users, password
hashing, durable sessions, lockouts), server/ownership.js (resource policy),
server/phaseRouter.js and server/pulseV2Router.js (additional API authorization),
public/app.js, public/shared.js, public/index.html (embedded login and auth state).
server/config.js holds the separate machine API credential. integrationAuth.js
implements a separate existing HMAC machine boundary and is outside this phase.

Users are stored in users.json with UUID, normalized email, name, role,
passwordHash, createdBy, timestamps and disabledAt. Passwords use salted scrypt
(N=16384, r=8, p=1). Login sets a random 32-byte HttpOnly SameSite=Strict cookie;
only its SHA-256 hash is stored in auth-sessions.json. Sessions last seven days
by default, survive restart, and are revoked on logout. There is no JWT.
Roles are admin/operator/viewer. Admin and machine bearer credentials have
workspace-wide privileges. Frontend uses same-origin cookies and /api/auth/me.
Login currently appears inside the run console; other application chrome is
visible before authentication. No normal self-signup route exists.

## Resource map and gaps

| Resource | Current ownership | Gaps |
| --- | --- | --- |
| Missions | ownerUserId | null owner shared; admin creations unstamped |
| Sessions/runs | ownerUserId | null owner shared |
| Workflows | sessionId | legacy and v2 lists/ID/mutations lack owner checks |
| Test cases | workflowId, suiteId | manual cases have no owner; list/ID/execute/export gaps |
| Findings | ownerUserId, sessionId, missionId | null owner shared; relation validation needs audit |
| Evidence | ownerUserId, sessionId, missionId | parent retrieval and mixed graph checks need audit |
| Artifacts | canonical ownerUserId/sessionId/missionId | legacy runId/filename route only authenticates |
| Reports | generated from session/mission | inherit parent authorization; cross-links need audit |
| Suites/schedules | parentId/testCaseIds | missing ownership and route checks |
| Projects/knowledge/metrics | workspace scope | shared aggregates and references can expose other users |

Legacy /api, /api/v1 (phase router), and /api/v2 all require review; authentication
alone does not enforce ownership. Most routes use requireApiToken; health,
login/logout/bootstrap are public. Admin settings/user management are separately
guarded. Unknown principals currently pass canAccessResource. Malformed cookie
percent-encoding can throw. Frontend treats config-fetch failures as login
failures and logs expected unauthenticated errors.

## Compatibility policy

Keep existing IDs and data unchanged. Explicit ownerUserId is authoritative.
Where ownership is absent, only an unambiguous existing parent relationship may
establish ownership; otherwise the record remains available to administrators
and machine administrators only. Never assign legacy data to the first login.
Public signup always creates an operator. Preserve the separate one-time admin
bootstrap operation and durable cookie session architecture.

## Test isolation

Several legacy stores hardcode application-relative .qase paths. Tests must run
in a separate application copy with fresh .qase and QASE_DATA_DIR; merely setting
QASE_DATA_DIR against the working application does not isolate all stores.
