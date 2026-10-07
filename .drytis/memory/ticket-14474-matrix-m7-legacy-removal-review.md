# Ticket #14474 — Matrix M7 (remove legacy picker chips + card list) — Review: PASS

Scope confirmed exactly as ticketed: index.html chip rows + #dp-cards hidden, devicePicker.js renderCards gutted (loading/error/empty only), app.js tabs/types config dropped, styles.css dp-chip/dp-card*/dp-group/dp-select rules removed. buildDeviceCards/filterDeviceCards/cardBadge/browsersForOS exports untouched. Stylesheet bump ?v=20261002-5→-6 correct.

## Verification evidence
- Suite: 1148/1128/0/20 exact match.
- Live browser (logged in, real entry: #new-run → openQaStart → TEST ON change → devicePicker.open): 0 chip rows/buttons, #dp-cards hidden+display:none+0px, sidebar 174 devices/502 OS chips, device click → summary six-part format + columns unhide, version click → reselect + recents written to qase.recentEnvironments. Zero pageerrors.
- matrixSidebar.js:156–179 renders its own loading/error/empty states (dp-cards hidden is fine; visible failure surface preserved in the sidebar).

## Probes gotchas (reusable)
- `#qa-start [data-test-on-change]` onclick is assigned INSIDE openQaStart() — clicking it after a raw `showModal()` on #qa-start does nothing. Use #new-run (el.newRun.onclick = openQaStart) as the real entry.
- Playwright scripts must run from /workspace (known: ERR_MODULE_NOT_FOUND from /tmp).
- cred.json accounts[0] email/password; login selector is #auth-email/#auth-password.
- Boot-time fetches 401 before login — normal, don't mistake for a regression.

## Minor notes (non-blocking)
- devicePicker.js `tabs`/`types` are still destructured from elements (undefined now) — dead, harmless.
- setFilter still invoked on every dp-search input (inert renderCards call per keystroke on 174-device catalog — no measurable cost observed).
- scripts/test-acceptance.mjs T7/T8 (npm run test:acceptance, NOT in npm test) still waits for `#dp-cards .dp-card` which never renders post-M7 → those checks will fail/record false when that manual suite is next run. Not yet updated; flag for follow-up.
- M1–M7 all still uncommitted on NIHARIKA alongside unrelated tickets (carried process concern).
