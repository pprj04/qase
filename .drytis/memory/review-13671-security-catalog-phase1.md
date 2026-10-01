# Review — #13671 Phase 1 security catalog (2026-09-29)

Verdict: PASS on all 7 criteria; 1 WARN.

- Catalog: 14 tests (8 standard + 6 security), version 2026.10.1, verbatim MITM/DoS unavailability reasons, honest framing in focus texts (absence of evidence ≠ pass; not-tested-with-reason for missing login systems). Verified in server/qaTestCatalog.data.js.
- Validation: appQaSelection.js — unavailable ids rejected before dup/unknown checks (mixed arrays rejected, message carries the catalog reason verbatim); securityAuthorization shape-checked (boolean confirmed, string notes trimmed + 2000-char cap, arrays rejected). Enforced in POST /api/sessions handler before services.runs.create; CSRF middleware (app.js:186-192) covers mutations upstream.
- Persistence: migration 019 adds security_authorization jsonb + CHECK (confirmed must be boolean when present); runRepository INSERT (write-once, same slot pattern as selected_tests), SELECT in loadAll/get, hydrateRun maps to session.securityAuthorization. store.js + postgresServices.js clone it into the session shape. save() UPDATE intentionally does not touch it (write-once, consistent with selected_tests).
- Tests: securityCatalog.test.js (new), app.test.js route matrix incl. GET round-trip + mixed-array rejection, qaTestSelection.test.js contract update (payload keys exactly id/title/description/focus/category/availability; selectable = available only), migrations.test.js expects 19. Specified suite: 142 pass / 0 fail.

WARN: runRepository.test.js asserts security_authorization only as a null trailing INSERT param; there is no fake-pool test hydrating a *populated* security_authorization jsonb back onto the session (spec edge case "Postgres round-trip … nullable, absent for standard runs"). Code path looks correct (hydrateRun:490), just under-asserted.

Notes for later phases: prompt.js buildQaTestSelectionContext fullCoverage now equals all 14 ids, so a select-all-available (12) run names MITM/DoS in the do-not-test exclusion list — acceptable. UI gate is Phase 3 (spec security-authorization.md); server gate cannot be bypassed by the UI.
