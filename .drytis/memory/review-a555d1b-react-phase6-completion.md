# Review a555d1b — React UI Phase 6 completion (viewer tabs, pointer overlay, stage note, device persistence)

Commit is presentation-only (src/ + 3 server test files only); 815 tests / 0 fail; tsc clean; targetReachability now environment-aware and 8/8 green in this pod (DNS resolves public 147.135.77.206).

## Open items for next phase
1. **truncate(34) cursor-label cap DROPPED** (author asked to verify): `src/components/ViewerPanel.tsx:287` renders `cursor.label` raw; legacy `public/app.js:2113` does `truncate(String(cursor.label), 34)`. CSS `.cursor-label` (shell.css:485-495) has max-width:180px + ellipsis as a visual-only mitigation, but character-cap parity is lost. Also `String()` coercion lost. Not pinned by any test.
2. Minor cursor-overlay drifts vs legacy applyCursor: no ripple element on `:done` (legacy re-fires `ripple.is-firing`); overlay fully hides while frame width unmeasured (legacy keeps last position); viewport memory is per-event fallback only (legacy persists `state.viewport`) — backend always sends viewport (browserBridge.js:820) so low practical risk.
3. QaLauncher device restore drift: legacy validates saved id against the device list (app.js:600-601), React uses `localStorage.getItem('qase.device') ?? 'desktop'` unconditionally (QaLauncher.tsx:50) — stale id would submit a nonexistent device.
4. **Working tree (NOT in HEAD) has unstaged cutover edits to `server/app.js` + `server/app.test.js`**: `/` and `/login` now serve the React index. That is Phase 7 cutover work in progress — backend change outside this presentation-only commit. If publishing HEAD only, it stays local; do not lose it, but it must get its own review/commit.

## Verified PASS
- ActivityFeed parity incl. `a.error ?? a.summary ?? a.detail` precedence, icons ◉/✕/●, exact time format, "Nothing yet", scrollFeed (ViewerPanel.tsx:297-330 vs app.js:2140-2207).
- PlanList parity: ✓/◉/○ marks, exact empty string, done/total count (ViewerPanel.tsx:339-355 vs app.js:2209-2231).
- Stage note exact string + Expand/Collapse + per-session overrides (ViewerPanel.tsx:161-198, 186).
- LiveCursor interface + frame viewport passthrough (liveSession.tsx:38-41,109-119,359-361); frame dispatch cast is TS-only, full object preserved.
- Device/landscape persistence with exact legacy keys/values '1'/'0' (QaLauncher.tsx:50-51,258,265 vs app.js:581,595-609).
- Kickoff-failure toast 'bad' replaces `.catch(() => undefined)` (QaLauncher.tsx:197-206), loop continues.
- WelcomeChecklist profile contract matches server: GET /api/auth/me → authService.profile (app.js:337-344), PUT /api/profile validates boolean onboardingComplete (auth.js:172-174); legacy uses same PUT payload (app.js:4154).
- Security: no dangerouslySetInnerHTML outside the 3 pre-existing renderMarkdown sinks (Transcript.tsx:86,137; ViewerPanel.tsx:412); no hardcoded secrets (demo creds text is the intentional public demo-site hint, legacy parity).
- reactPhase6ViewerPins.test.js: 7 genuine source-level pins (exact collapse string, legacy SVG path, 1500 timer, ':done' endsWith, localStorage keys, absence of silent catch). Source-regex pins, not runtime — acceptable given tester does browser verification.

Full report delivered in review round; no fixes applied.
