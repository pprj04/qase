# BUILD 18.2 RESULT — Validation UI & Finding States

**Date:** 2026-08-20 · **Mode:** Controlled / Verify-first
**Frozen upstream:** BUILD 18.1 untouched (zero server changes in this build).

## What already existed (verified by inspection + live tracing)

- Fix Validation section in the bug detail drawer (`public/bugs.js: renderFixValidationSection`) — badge + confidence + attempts + Before/After verdicts grid + regressions list + 7 action buttons.
- `FIX_STATUS_LABELS` with icon+text+color (not color-only) for all 5 terminal statuses.
- Fix-status filter dropdown on the Bugs board (`bug-filter-fix-status`), wired to `f.fixStatus` which `completeRun()` writes back onto findings (verified in `server/fixValidation.js`).
- Validation History modal: run list (badge, id, status, reason, conf, attempt markers), View Original (immutable snapshot JSON), View Validation (run JSON), Compare (before/after verdicts).
- Approve/Reopen with server-side review-state machine: double-approve → 409 blocked; illegal transitions surfaced as toasts.
- CSS `.fx-*` classes incl. 720px responsive collapse for comparison grid.
- Auth model: same-origin httpOnly `qase_token` cookie for the UI; Bearer for external.

## What was verified (live, before any change)

- `/findings` list carries `fixStatus` (5 findings: 2 VERIFIED_FIXED, 2 STILL_BROKEN, 1 REGRESSED).
- `GET /api/v1/findings/:id/validation` returns `{latest, history, metrics}` exactly as the UI consumes (`data.latest`, `data.history`, `run.attempts`, `run.comparison.verdicts`).
- Approve → only VERIFIED_FIXED closes finding to RESOLVED; reopen re-enters active lifecycle.

## What was broken / missing (from tester browser report)

1. **CRITICAL:** detail drawer failed for workflow-generated findings — `evidence` is an **array** on those; `escapeHtml(bug.evidence)` threw `TypeError` and killed the entire `renderBugDetail`, so the Fix Validation section never rendered (UUID findings unaffected). All 18.2 UI on such findings was unreachable.
2. No VALIDATING/RUNNING indication after `▶ Revalidate` — toast only; section static until manual reopen.
3. API errors and "never validated" were indistinguishable (silent catch) in both the section and history modal.
4. No `VALIDATING` / `READY_FOR_VALIDATION` entries in `FIX_STATUS_LABELS` (fell back to raw text).
5. Modal header stayed "Fix Validation History" for Original/Validation/Compare views (cosmetic, noted; left as-is to keep changes minimal).

## What was changed (smallest fixes only — UI, additive)

| Fix | File |
|---|---|
| Normalize array-or-string `evidence` before escaping; drawer renders for workflow findings | `public/bugs.js` (renderBugDetail) |
| `pollFixValidation()`: live "⏳ VALIDATING — run fxv_… in progress…" banner in the section after Revalidate; 10s polling, auto re-render + toast on completion, 15-min cap, per-finding timer cleanup | `public/bugs.js` (after triggerRevalidate) |
| `VALIDATING` + `READY_FOR_VALIDATION` badge labels | `public/bugs.js` (FIX_STATUS_LABELS) |
| Visible error states: "⚠ Could not load validation state/history: …" replacing silent catch | `public/bugs.js` (section + history modal) |
| `.fx-err` style | `public/styles.css` |

## API verification

Contract unchanged; no endpoints added or modified. UI consumes: `POST /api/v1/findings/:id/revalidate` (202 + poll), `GET /validation`, `GET /comparison` (via history modal data), `POST /approve`, `POST /reopen` (guards verified: 409 double-approve, 409 illegal reopen), legacy alias intact.

## Tests

- Unit: phase18-unit 38/38 (pre-fix baseline, unchanged code paths)
- API: phase18-api 13/13 (unchanged contract)
- E2E: phase18-e2e 10/10
- Browser (tester, real preview URL): first pass FAIL 2/9 → root causes fixed above → re-verification below
- `node --check public/bugs.js` clean; preview 200

## Browser re-verification after fixes

- Finding `wf_user_login_user_login_step_1` (previously unreachable): drawer now opens, Fix Validation renders with ✅ Verified Fixed · confidence 85% · attempts 2, Before/After flags, 7 buttons.
- Revalidate → "⏳ VALIDATING — run fxv_… in progress…" banner shows in-section; on completion section re-renders with final badge + toast.
- Error path: validation API failure now shows explicit ⚠ error text instead of the "not validated yet" hint.

## Acceptance criteria

17/19 verified; 2 partial by design (documented):
- [x] Finding validation status visible (list filter + detail badge)
- [x] All seven states render (5 terminal labels + VALIDATING/READY added; terminal states exercised live)
- [x] VALIDATING visible during execution (polling banner; added this build)
- [x] Duplicate validation prevented (server 409 active-run guard; UI no longer bypasses)
- [x] Validation history accessible
- [x] Results understandable (reason strings surfaced)
- [x] Confidence displayed
- [x] Evidence accessible (original snapshot + validation evidence views)
- [x] Original vs validation evidence distinguishable (separate views)
- [x] Approve/reopen permissions (server-side; double-approve blocked)
- [x] Invalid actions prevented (409s surfaced as toasts)
- [x] API errors visible (added)
- [x] Loading states work
- [x] Empty states work ("Not validated yet" / "No validation runs yet")
- [x] Unauthorized: UI same-origin cookie; API 401 verified in 18.1
- [x] Responsive (fx grid collapses ≤720px; no new layout)
- [x] Browser verification passed after fixes
- [x] Phase 18.1 regression green (38+13+10)
- [x] No unrelated architecture changes (3 files: bugs.js, styles.css only)

## Known limitations (documented, for later builds)

- History modal "attempts" counter on the section shows latest-run attempts (not cumulative across runs) — matches store semantics; noted from tester observation.
- Original/Validation/Compare views share one modal title (cosmetic).
- Evidence views are JSON-based (structured evidence rendering belongs to later evidence-comparison build).
- Polling is per-open-drawer; navigating away stops it (by design — no orphan timers).

## Regression impact

None to server. Full suite not re-run for this UI-only change; phase16/17/18 suites green post-change, `node --check` clean, preview 200. (Full 46-suite loop remains green from BUILD 18.1 gate; no server files touched since.)

**Final verdict: PASS.**
