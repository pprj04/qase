# QASE Phase 1 — authentication and user isolation review

Status: implemented for review; not committed. Validation date: 2026-09-11.

## Architecture inspected before implementation

See AUTH-PHASE1-AUDIT.md for the pre-change file inventory, resource map and security gaps.
The existing system is email/password authentication backed by users.json. Each user has
a UUID, normalized email, role, salted scrypt password hash and account timestamps.
Passwords use scrypt N=16384, r=8, p=1 with a random salt. There is no JWT: the existing
random-token, HttpOnly, SameSite=Strict qase_session cookie is preserved. Only a SHA-256
token hash is persisted in auth-sessions.json; sessions survive restart and normally
expire after seven days. Logout revokes the server-side session. Admin/operator/viewer
roles remain in place. Machine bearer and HMAC integration authentication remain separate.

Previously, login was embedded inside the run console. The application now has a dedicated
/login document; unauthenticated shell/deep-link requests redirect before app content is
served. The SPA checks identity before fetching application data and redirects on API 401.
Public auth endpoints are bootstrap, one-time register-admin, signup, login, logout and
the identity probe. Ordinary application APIs remain authenticated. Health remains public.

## Security defects addressed

- Embedded login exposed authenticated application chrome and treated failed config fetches as login state.
- No normal-user signup flow; now validation, confirmation and duplicate protection use the existing user store.
- Missing owners and unscoped legacy/v2 workflow, test-case, suite, schedule and regression routes.
- Unowned legacy records were shared; admins were not stamped as owners on creation.
- Legacy screenshot retrieval authenticated the caller but did not authorize the parent run.
- Aggregate counts, tags, related findings and graph collections could expose other users' data.
- Caller-supplied references, mission IDs and shared idempotency keys could cross ownership boundaries.
- Malformed cookie encoding could throw; an open event stream was not rechecking session validity.
- Last-admin protection mutated the live user and revoked sessions before rejecting the change.
- Session persistence failures could be reported as successful operations.

## Ownership and compatibility policy

ownerUserId is the authoritative field. New human-created records include it, including
admin-created records. Normal users can access only their records; missing and foreign
resource IDs receive 404. Admins retain workspace-wide administration. Viewer writes are denied.

When ownerUserId is absent, the resolver may inherit one unambiguous owner through an
existing sessionId, missionId, workflowId, testCaseId, scheduleId or findingId relationship.
Conflicting, cyclic or unresolved legacy relationships remain administrator-only.
This policy performs no owner backfill, destructive migration or first-login claiming.
Reports and replay artifacts use their authorized parent. Related resource references
are checked before writes or execution. Scheduled execution also checks stored test-case owners.
Request identity uses AsyncLocalStorage, with a concurrency test proving request separation.

Projects have ownership too. The built-in Default project is the sole shared infrastructure
reference: normal users receive only its ID, fixed display name and empty URL, not its
administrator-configured URL/workspace metadata. This never grants access to its contents.
Other project records are owner-filtered. Existing unowned non-default projects are admin-only.

Workspace-global knowledge, validation telemetry, graph diagnostics and system statistics
cannot be safely attributed to one owner and are restricted to administrators. Normal-user
dashboard resource totals are calculated from visible records; global telemetry is omitted.
No Bugs/Test Cases UI or provider/execution-engine redesign was performed.

## Files changed

All paths below are relative to C:/Users/potda/Documents/New project/qase.

| Area | Files |
| --- | --- |
| HTTP auth and authorization | server/index.js, server/userStore.js, server/ownership.js, server/requestAccess.js |
| Additional API surfaces | server/phaseRouter.js, server/pulseV2Router.js |
| Ownership persistence and scoped aggregates | server/workflows.js, server/testCases.js, server/suites.js, server/scheduler.js, server/regressionStore.js, server/findings.js, server/evidenceGraph.js, server/metrics.js, server/projects.js |
| Dedicated auth UI and session handling | public/login.html, public/login.js, public/index.html, public/app.js, public/shared.js |
| New focused tests | tests-real/auth-phase1.test.js, tests-real/auth-ownership-policy.test.js |
| Documentation | docs/AUTH-PHASE1-AUDIT.md, docs/AUTH-PHASE1-REPORT.md |

The earlier apiRaw import fix was preserved. No provider, BrowserStack, authentication
configuration, production configuration, dependency or lockfile changes were made.

## Validation results

Final automated counts: **90 PASS / 0 FAIL** (Node counts the HTTP suite's parent test).

- `node --test tests-real/auth-phase1.test.js tests-real/auth-ownership-policy.test.js`: 85 PASS.
- Five existing user-auth tests D2-17 through D2-21, run from an isolated source copy: 5 PASS.
  These cover scrypt-only storage, restart durability, login lockout, secret-free audit logs and expiry.
- `node --check` on all 18 changed JavaScript source files: 18 PASS.
- Application startup and GET /api/health: PASS, HTTP 200.
- Browser: dedicated login with no application content, signup, login, session restoration after
  reload, logout, rejected post-logout /runs navigation, and console inspection: all PASS.
  Final successful browser flow reported zero console error entries.

The HTTP suite creates A, B and Admin in isolated storage. It covers own mission reads;
foreign list/direct-ID/update/delete/start denial; findings/evidence/report/artifact isolation;
workflow/test-case/suite/schedule/project/regression access; legacy policy; admin-only endpoints;
last-admin safety; malformed/expired sessions; duplicate signup and non-admin role assignment;
logout revocation; reference injection; and caller-supplied mission-ID overwrite prevention.
The policy suite additionally covers conflicting/cyclic parents and concurrent request identities.

Test isolation is a full server/public source copy because several legacy stores ignore
QASE_DATA_DIR. Final test copy: artifacts/auth-phase1-xibllP. Tests did not use the existing
application .qase or production data. Browser validation used the isolated copy on port 5198,
not the original application on 5173. Test copies are retained as local validation artifacts.

## Review boundaries

- No remaining blocker for this phase's focused checks.
- The original process on port 5173 was not restarted or used for security fixtures.
  Review the source before restarting that application with the new code.
- No BrowserStack or model-provider tests were attempted. Connectivity is not required here.
- The entire repository suite was not run: some existing suites target the live .qase or
  require providers. The focused tests above are the reported pass counts, not a full-product certification.
- An empty isolated fix-validation store emits an existing startup warning; health and auth
  still work. That unrelated store behavior was not changed.
- No commit was created.
