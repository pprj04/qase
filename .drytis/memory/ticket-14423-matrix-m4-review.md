# Ticket #14423 "Matrix M4 · Top bar + browser columns + selection flow" — review (round 1, post-fixes)

Verdict: PASS on all M4 acceptance criteria. 2 WARNs (one process, one latent-mirror).

Verified:
- browserChannels.js client mirror cross-checked programmatically against server/environmentCatalog.js (all 6 version arrays + channel ladders + channelForVersion vs channelFor on every major): IN SYNC at catalog 2027.02.0. Tests 2/2.
- matrixColumns.js: rows derive from buildBrowserColumns (M2) over active envs only — probed live: 153 rows for Surface Pro 11 + MacBook Air (M1), 0 unbacked; Safari absent from Surface Pro 11 columns; OFFLINE board status → available:false + aria-disabled + click-guarded (ENV-WIN-11-CHR-140-SURFPRO11 verified false).
- onSelectVersion routes through devicePicker.selectEnvironment → reselect (add-mode honored, verified in M3 r2) + matrixRecents.record. recents.record ONLY on version-row selection (not sidebar browse, not render).
- No render loops: sidebar setSelection and columns setColumns/setSelectedEnvId only re-render, never re-select; tester saw 0 console errors over 2 rounds.
- Top bar: input prefilled from state.session.targetUrl at boot; openQaStart() applies #mx-target-url AFTER form.reset() (app.js:5038) — canonical prefill, tester r2 PASS twice. Refresh reloads picker data + mirrors URL into qa-target-url. No decorative buttons.
- Icons: createElementNS SVG, static innerHTML brand glyph strings only — no external fetch, CSP-safe.
- Cache-bust: styles.css?v=20261001-3 (HEAD) → 20261002-3 (working tree); 30 new mx-* rules shipped; served 200 with mx-topbar present. Note: bump already covered M3+M4 CSS together (M3 r1 noted the same bump); current value is correct per spec rule "every styles.css change bumps" — cumulative, acceptable.

WARNs:
1. (process) Single cumulative bump 20261002-3 spans M3's and M4's CSS changes; spec says every styles.css change bumps. Harmless (each change has been >bumped< once), but if M3 and M4 land as separate commits, the bump doesn't map 1:1 to commits.
2. (latent) browserChannels.js is a manual client mirror of server ladders. Comment + validate-matrix 7b (server-side) mitigate, but 7b does NOT import public/browserChannels.js — nothing mechanical fails if the mirror drifts on a future catalog bump. Suggested follow-up: add validate-matrix check importing the client module and diffing against the server (comment in browserChannels.js already proposes serving via /api/catalog/meta).

Full suite: 1148 tests / 1128 pass / 0 fail / 20 skipped. One run of `runTiming.test.js` failed in a full-suite run but passes 13/13 standalone ×3 — pre-existing timing flake, unrelated to M4 diff.

Security: no new inputs beyond mx-target-url (type=url, maxlength 2048); openQaStart reads it into qaUi.targetUrl.value (assignment, not HTML); all rendering via createElement/textContent. Icons are static strings — no interpolation. No secrets.
