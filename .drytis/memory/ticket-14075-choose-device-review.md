# Ticket #14075 review (code review round, 2026-10-01) — after re-test of the 2 known browser-test FAILs

Prior browser-test writeup (ticket-14075-choose-device-form-test.md) found F-C (OS discarded on browser change) and F-F (select clipping @1024x768). Re-verified on the current uncommitted tree after #14074 changes — BOTH STILL FAIL:

## F-C — Browser change discards OS selection (FAIL, confirmed live)
iPhone 11 → OS=17.0 → Browser="Chrome 139" ⇒ selection silently becomes "iPhone 11 · iOS 26.0 · Chrome 141" (OS AND browser both discarded).
Root cause: `cdFormOverrideChange` (public/app.js ~:878) calls `resolveDeviceEnvironment(cdEnvironments(), { device, ...overrides })` — it does NOT carry the user's current osVersion/browser when only one is overridden. rankEnvironments' newest-OS/browser preference wins (devicePicker.js:33-58). Spec AC: "selecting any of them updates preview… immediately" — it updates, but to the WRONG env; combo invents nothing (falls back to an existing env) but ignores user intent.

## F-F — .cd-form selects clipped at 1024x768 (FAIL, confirmed live)
`.cd-form` is `repeat(auto-fit, minmax(180px, 1fr))` (styles.css ~:8808). At 1024 the viewer panel is 300px wide but the form container resolves 2×266px columns reaching x=1222 — outside the viewer (663..963) and the 1024 viewport. cd-os and cd-exec rects: l=956 r=1222 clipped=true. No page scroll (viewer overflow hidden masks it) — controls unreachable. The `minmax(180px,1fr)` min is too big for a 272px content box; needs max() with panel-relative sizing or 1-col stacking below a container query/breakpoint.

## Other verified-good items (see full review report in transcript)
- Single source of truth PASS (all writes via activeTestEnvStore.setSelection; no parallel state).
- Execution-select honesty PASS (levels from runtimeAttestedLevel ?? executionLevelRequested, never name-inferred; single-option selects disabled).
- resolveDeviceEnvironment executionLevel back-compat PASS (optional param; existing callers devicePicker.js:371/505 unaffected; unit tests 95/95).
- Dead code: only orphaned `.cd-secondary` CSS block remains (styles.css:8884-8903) — no HTML/JS refs.
- #cd-refresh gap: inline Choose Device section does NOT refetch the catalog when expanded; data only arrives via dialog-picker open/close (refreshDevicePickerData wired only to onOpen/onClose, app.js:4843-4844). A stale error state persists in the inline form until the dialog is opened. WARN.
- Suites: npm test 826 pass/0 fail/9 skip; node --test public 95/95; acceptance T16f-T16i PASS (iPhone 11 re-resolve works); responsive suite PASS — but the responsive suite NEVER expands choose-device, so it cannot catch F-F.

Verdict: FAIL (F-C, F-F carried from prior round, unresolved).
