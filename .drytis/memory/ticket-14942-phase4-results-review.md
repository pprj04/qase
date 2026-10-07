# Review — Ticket #14942 Phase 4 (per-configuration results, evidence & coverage)

Verdict: PASS overall (one WARN: spec's "Reports: extend report matrix section" not implemented; view-test DOM coverage is partial).

Evidence collected 2026-10-07:
- Tests: public/qaMatrixResults.test.js 13/13, public/qaMatrixResultsView.test.js 6/6, server/matrixEvidence.standalone.test.mjs 7/7 (standalone; takes 3-11 min in container due to environment seeding — do NOT conclude hang before ~10 min; my earlier "TIMEOUT" verdicts were premature).
- /tmp/mxA.log = teammate/author session's full matrixApi.test.js run: 7/7 pass (incl. cancel + bounded-retry HTTP tests). Note: teammates run tests concurrently on this box — explains recurring fork exhaustion.
- Live API: GET /api/matrix-runs unauth → 401. Authenticated GET run payload shows per-item defects linked via bugs.list({environmentId}), runtimeFacts, artifactRefs, sessionId, retryCount all survive.

Key findings:
- Honest-pass guard isExecutedPass: PASSED + (verdict||sessionId) only; unit-tested; applied in computeTotals AND toResultRow.
- All 8 required statuses distinct labels + distinct CSS colors (.qmr-st-*) for 12 statuses.
- Evidence per-row: view renders artifacts/defects counts on producing row; defects cached per environmentId server-side; standalone test asserts "defects not merged across items".
- Cancel/retry routes unchanged from Phase 3 (404 unknown run; 409 non-retryable; orchestrator enforces MAX_ITEM_RETRIES=2 — view additionally gates retryCount<2 client-side).
- XSS: view uses createElement/textContent only; no innerHTML in new files. IDs encodeURIComponent'd. No secrets in payloads.
- app.js wiring: qaMatrixResultsView created when #qa-matrix-run-dialog exists; openQaMatrixRunDialog(matrixRun.id) after successful /qa-matrix-runs POST; waitForFirstMatrixSession fully removed (grep 0 matches). Start flow gating (≥1 config, valid URL) intact.
- WARN 1: reportMatrixSection (server/report.js buildMatrixSectionMarkdown) NOT extended to include QA matrix run summary per-configuration rows — spec line "Reports: extend the existing report matrix section" unimplemented. Handoff said "matrixCoverage/report layers predate this ticket and are unchanged" — that covers implementation but not the spec bullet.
- WARN 2 (minor): qaMatrixResultsView.test.js test 6 "view.stop halts polling; a finished run does not schedule more" only asserts stop is a function — the no-reschedule assertion is a stub (no timer fake). Poll-halt is effectively untested.
- Minor data observation: bug seeding across repeated standalone runs accumulates BUG-XXXX rows against the same environmentId in the shared local store, so an item can list many defects (live example showed ~25 on ENV-IOS-IP15PROMAX-17.0-SAF-17.0). Per-environment linkage itself correct.
- Notes: view limits coverage-gaps list to 12 + "… and N more"; board paginates 50 rows with "Show more"; live updates are 2.5s polling (no SSE consumer — same documented limitation as Phase 3).