# Ticket #14077 — regression re-test (R1 stale-clear / R2 null-guards / R3 re-select)

Preview https://qase-2-1-cvtryq.drytis.dev/, accounts[0]. 2026-10-01.

## R1 — stale device name after clear: PASS (empty state now resets all surfaces)
- **Path caveat**: `#dd-clear-selection` lives in `#device-drawer` (NOT the picker), and its handler only clears the drawer's bulk-create cart (`state.selection.clear()`, deviceDrawer.js:588) — it never touches `activeTestEnvStore`. It is `hidden` while the cart is empty, so the leader's prescribed steps ("picker's Clear") cannot clear the active selection at all. The prior tester's P-E clear was actually the cart-Clear misread OR an older build.
- Genuine empty-store path exercised: Remove the selected saved env in the drawer (DELETE /environments/:id) → reload → boot hydrate fails → `activeTestEnvStore.clear()` (app.js:4922). Result: #ldv-device='—', exec='○ NO DEVICE', live='○ IDLE', header title='Live device view — no device selected', card='—', #cd-summary='No device selected — click to choose', #stage data-device-kind/label both removed. The round-1 stale-name bug is fixed.

## R2 — null-guards in renderers: **FAIL**
- With empty store + existing session, boot throws 2× `TypeError: Cannot read properties of null (reading 'source')` at `renderBrowserChrome` app.js:1155, via renderLiveDeviceViewHeader:1060 → applySessionSnapshot:1297 → selectSession/bootWorkspace. The empty-state path calls `renderBrowserChrome(null)` and the function starts with `if (view.source ...)` — NO null guard. Verified identical in the workspace tree (app.js:1152-1155) and the deployed /app.js — the fix was never written (not a deploy gap).
- Note: `if (!bar) return` guards the missing ELEMENT, not the null view. `applyDeviceFrame(null)` / `renderUnavailableState(null,...)` are also skipped after the throw (lines 1161-1162 never run in this path) — harmless-looking because the fresh DOM has no attrs and the unavailable panel is `hidden` by default, but it's luck, not guards.
- Positive part: #browser-chrome stays hidden at idle with a selection; after the empty state + re-select, brand text = neutral "Browser" (stale "Chrome" text from round 1 appears gone — brand not painted with stale browser).
- Note: the exception aborts renderLiveDeviceViewHeader AFTER the header text/title/card are set (lines 1053-1059) but BEFORE applyDeviceFrame(null)/renderUnavailableState — worth guarding when fixing.

## R3 — re-select after empty state: PASS
iPad Pro 11-inch via #cd-device after empty store: header/card/summary all "iPad Pro 11-inch · iPadOS 26.0 · Chrome 138", #stage data-device-kind=tablet, label set. Picker not wedged.

RESULT: FAIL (1 of 3) — R2 null-guard fix absent.
