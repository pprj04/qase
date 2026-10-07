# Start QA dialog — crash-fix retest (2026-10-06)

Leader's fix (bulk localStorage writes for family checkbox) VERIFIED — 6 family-checkbox clicks (Firefox ×2, Opera ×4 incl. mixed 366/8096 state) with ZERO tab crashes. Summary math exact each time. Persistence across dialog close/reopen confirmed.

## Leftover state RESTORED
Opera partial selection (366/8096) from the earlier crashed session was cleared: Opera re-checked to 8096/8096. Firefox also re-checked. Final state: 28,642 of 28,642 selected, all available families checked.

## IMPORTANT environment-dependent behavior
The dialog probes local browser binaries on open. Under host thread pressure (EAGAIN), Chrome/Edge/Opera/Brave render DISABLED with reason "Binary present but failed to launch: ... EAGAIN" — only Firefox/Safari selectable. On a healthier host, more binaries pass. Probe results vary BETWEEN dialog opens in the same session. Do not report this as an app bug when the host is resource-constrained.

## Console (pre-login only)
4 × 401 Unauthorized on /api/environments, /api/device-runtime/devices, /api/auth/me fired before login on initial page load — no JS runtime errors during dialog interactions.
