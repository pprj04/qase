# Ticket #14077 — Exec Panel Phase 3: Device-shaped preview, one source & full-screen audit (DONE)

Branch NIHARIKA @ 6918e67 + uncommitted Phases 1–3 (#14074/#14075/#14077). Reviewer + tester PASS after 3 rounds.

## What was built
- `viewForSelection(selection)` in public/activeRuntimeEnvironment.js:135 — builds a runtime-env view from the activeTestEnvironment store selection (shape parity with resolveActiveRuntimeEnvironment; source:'selection'; executionTypeAttested always false; runtimeStatus 'queued' but never read by renderers). Unit tests: public/activeRuntimeEnvironment.test.js (15/15).
- app.js renderLiveDeviceViewHeader: active-run predicate (running/connected/connecting/reserving) → session view; else store selection via viewForSelection; else EMPTY state (—/○ NO DEVICE/○ IDLE, card empty, chrome hidden, frame cleared). Header exec label now follows headerView (was session view — bug). renderBrowserChrome/applyDeviceFrame/renderUnavailableState null-guarded.
- Acceptance T17a–T17d (phone/tablet/desktop kinds, one-source reload).

## Bugs found & fixed (rounds 2–3)
1. Stale device name on header/stage after emptying the store — line 1049 fallback `?? view` resurrected the stale session; replaced with explicit empty-state branch.
2. `renderBrowserChrome` null guard was LOST after a failed edit_file attempt earlier in the session (edit reported "not found" on whitespace mismatch; I believed it had landed) — caused boot TypeError on empty-store+existing-session. LESSON: re-grep after every edit that errored; verify edits with grep before delegating.
3. header exec badge always read session view.exec map — now headerView.

## Verified (tester, 3 rounds)
- Frames: iPhone→phone (notch bezel), iPad Pro 11"→tablet, Windows Desktop→desktop flat, Pixel 9 Pro→phone. Header title 4-part format. Reload + tab-switch persistence. Re-select after empty state doesn't wedge.
- Audit 1920/1366/1024: pageScroll 0, no panel overlaps, 7 dialogs fit + Escape-close (Device Matrix stacks behind Settings — expected), console clean.
- #chrome-brand running-session path UNTESTABLE: no attested device in catalog (all SIMULATED), no live stream. Stale-brand-text issue fixed via empty-state branch.

## Known cosmetic (not fixed)
- Header title appends session exec label ("· NO DEVICE") for idle sessions — formatting quirk only.
- Empty-store path to reach clear state: Remove saved env → reload (boot hydrate clears). #dd-clear-selection only clears the drawer's bulk-create cart.

Suites: npm test 839/830 pass/9 skip/0 fail (keepalive test is flaky on first run — passes on rerun), public 95+15 tests green, test:ui PASS 6 resolutions, test:acceptance PASS incl T17a–d. Phases 1–3 remain UNCOMMITTED (standing reviewer WARN).