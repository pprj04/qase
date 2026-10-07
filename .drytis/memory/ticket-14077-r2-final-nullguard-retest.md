# Ticket #14077 — R2-FINAL re-test: renderBrowserChrome null guard

Date: 2026-10-01. Preview https://qase-2-1-cvtryq.drytis.dev/, accounts[0].

Scenario exercised naturally on first login (no removal needed — store was already empty):
empty device store + existing session (TARGET "iPhone 17 Pro · iOS 26.0 · Chrome 138", session "New test run" auto-selected).

Results:
- ZERO TypeErrors from renderBrowserChrome on boot (round-2 threw `Cannot read properties of null (reading 'source')` at app.js:1155 via renderLiveDeviceViewHeader:1060). Only the 5 known pre-auth 401s, all pre-login. Reload boot: 0 errors.
- Empty state correct: #ldv-device '—', badges '○ NO DEVICE' + '○ IDLE', header title 'Live device view — no device selected', empty-state card (CURRENT TEST DEVICE — — — ○), #stage data-device-kind=null, data-device-label=null, stage shows "No browser yet" prompt, summary 'No device selected'.
- After reload, boot hydrate restored the previously-saved env (iPad Pro 11-inch, tablet frame) — empty state does not wedge the store.

Minor observed oddity (not in scope, leader FYI): after reload with selection restored but no active run, header title reads "Live device view — iPad Pro 11-inch · iPadOS 26.0 · Chrome 138 · NO DEVICE" — the session-driven exec badge label ('NO DEVICE') is appended as the execution segment of the title. Cosmetic title-format quirk, not a crash.

Verdict: R2-FINAL PASS — null-guard fix is live in the deployed build.
