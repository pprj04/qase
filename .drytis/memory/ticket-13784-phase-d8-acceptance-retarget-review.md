# Review — Ticket #13784 "Phase D8 · Acceptance Validation & Regression" (PASS)

Scope: retarget scripts/test-acceptance.mjs from M7-removed legacy selectors (#dp-cards .dp-card, .dp-select-btn, .dp-select) to the matrix UI. No production code changed.

## Verified
- Diff is exactly the described retargeting (51+/34−): openPicker → `#mx-sidebar .mx-device` (20s timeout, ~38k env catalog); T7 sidebar device → `#mx-columns .mx-version` click → #dp-summary OS assertion; T8 → `.mx-col` aria-labels; pickDevice/pickFor → `.mx-version:not([aria-disabled])`. `:not([aria-disabled])` is semantically correct — matrixColumns.js:81 sets aria-disabled=true on unavailable rows.
- node --check clean; zero remaining dp-card/dp-select refs in the script.
- Live run (localhost:5173, QASE_TEST_PASSWORD from cred.json accounts[0]): RESULT: PASS — all 24 checks (T1–T18 incl. T16b/T17a–d) green; T7 summary "iPhone 17 Pro Max · iOS 26.0 · Chrome 156 · VIRTUAL DEVICE · AVAILABLE"; T8 all 7 brand columns; T17d reload persistence.
- npm test: 1156/1136/0/20 — exact expected.
- Spec claim "deeper D8 items covered elsewhere" spot-checked and holds:
  - REAL/VIRTUAL honesty: qaTools.test.js:190 "execution level from recorded facts, never the request" (SIMULATED rendered despite REAL_DEVICE requested); runtimeIntegrity checks deviceIdentityVerified = att?.device_id && att.capabilities_verified (qaTools.js:64-70).
  - Attestation failure → BLOCKED not PASS: qaTools.test.js:128-136.
  - Unsupported combo NOT SUPPORTED: deviceDrawer.js:312 + deviceDrawer.test.js:75 "never claims real hardware or unsupported capabilities".
  - Busy → BUSY no silent switch: deviceRuntimeUi.test.js "busy real device offers queue first, then downgrades" (reason includes 'busy').
  - Bulk per-execution sessions: rightPanelContract/bulkWizardContract tests (see #13778/#13782 reviews).

## WARNs (all minor, mostly pre-existing)
1. T7 assertion regex `/iOS|Android|Windows|macOS|OS/i` — bare "OS" matches almost anything; weak. Pre-existing (was cardText+summary, now deviceText+summary).
2. T17c has no else branch if no Windows device found (test silently skipped); T17b does have one. Pre-existing.
3. Acceptance script is manual-only (not wired into npm test) — as before.
4. Carried: uncommitted working tree stacked across M1–M7 + D-series tickets; commit-split before landing.

#13785 confirmed as literal duplicate of this ticket → close as dup.
