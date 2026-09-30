# Product UX completion — #12956 (Phase 4)

Transcript-driven UX work. All changes in `public/` (frontend) + minimal `server/` support. Gate: every item demoable on the preview URL.

## 12956a — Token counter + run timer in the run header

Server already delivers `session.contextUsage = {percentage, used, window}` via the `context` SSE event and the session GET payload; `handleEvent()` (app.js:1827-2015) drops it.

Changes:
- index.html `.head-actions`: add `#token-chip` (context %) + `#timer-chip` (elapsed mm:ss), styled after `.status-chip` (styles.css:595-654).
- app.js: `case 'context'` in handleEvent → update chip; timer starts on `status:'running'` event, ticks 1s while running, freezes at terminal status; both persisted per-session in state so switching runs restores values (seed from session GET `contextUsage` + compute elapsed from activity ts).
- Store `startedAt` on session when run starts (server: set in runTurn start commit) so elapsed = now - startedAt is server-truth, not client guess.

Tests (server): session GET includes contextUsage + startedAt; run start commits startedAt.

## 12956b — Post-run layout: collapse the live browser stage

- When session status becomes terminal (`done`/`error`/`idle` after run), the stage area shrinks to a compact strip (thumbnail + "Run complete — tap to expand"); findings/report pane grows.
- CSS: add `body[data-run-state="done"] .viewer { grid-template-rows: ... }` variant shrinking stage row; keep a manual expand toggle (`#stage-expand` button in stage head) that restores full size; remember preference per session view.
- Founder mode already auto-switches to Report tab (app.js:1240-1248) — keep, add stage collapse to it.
- No server changes.

Tests: frontend logic is CSS+JS; verified via browser test (tester agent) — stage collapsed class present on done.

## 12956c — Select-all launcher (QA)

Replace long QA launcher with checkbox-first flow (Thomas: "it's already checked. They aren't gonna read it"):
- Keep: target URL (required), device select.
- Add pre-checked checkbox group "What to test": [✓] Desktop layout, [✓] Mobile layout (auto-runs device profile), [✓] Forms & validation, [✓] Console & network errors, [✓] Navigation & links, [✓] Accessibility basics. Plus [Select all / Deselect all] toggle.
- Checked items become the run instruction message content (structured prompt), sent as the kickoff message. All checked by default; developers can deselect.
- Keep landscape checkbox inside device group.

Tests: unit test on the message-builder function (all/preselected/subset); server unchanged.

## 12956d — "Test these next" follow-ups

After a completed QA run, the report's `notCovered` + `recommendations` items render as checkboxes (default: all checked) with a "Run selected follow-ups" button:
- Renders in report pane below recommendations.
- Button starts a NEW session (same device) with a kickoff message scoped to the selected items, referencing the prior run's URL.
- Also shows after `blocked` verdicts (notCovered is required there).

Tests: unit test on follow-up message builder + selection gathering; server unchanged.

## 12956e — Founder form cleanup

Remove free-text fields the AI can infer from the URL (Thomas: "AI already knows"): targetCustomer, competitors, stage, businessModel.
- Keep: target name (required), target URL (required), environment (optional, useful), primary goal (optional — focus, not inference), constraints (optional), authorization (required).
- Removed fields are simply dropped from the form; payload unchanged in shape (server accepts absence already via founderOptional).

Tests: existing founderUi tests must pass unchanged payload expectations; adjust fixtures for removed fields.

## 12956f — Feedback (👍/👎) + minimal analytics

- `POST /api/sessions/:id/feedback` {rating: 'up'|'down', note?} — auth-gated, owner-only, idempotent (last rating wins), stored on session record (`session.feedback`).
- Report pane footer: 👍/👎 buttons; after vote, show "Thanks" state; restore state on session GET.
- Analytics: server increments a counters file (`.qase/analytics.json`, atomic write) on: run_started (mode), run_finished (status, duration bucket), feedback (rating), launcher options chosen (from kickoff message flags where present). GET /api/analytics/summary (admin? keep simple: authenticated) returns totals. Minimal — no PII.

Tests: feedback endpoint contract (auth, idempotent, unknown rating rejected); analytics counter persistence.

## Acceptance criteria
- [ ] Token % + elapsed timer visible during and after run, correct on run switch
- [ ] Completed run auto-collapses stage; manual toggle restores; preference remembered
- [ ] QA launcher shows pre-checked "what to test" group with select-all; kickoff message reflects choices
- [ ] Completed QA report shows "test these next" checkboxes + one-click follow-up run
- [ ] Founder launcher reduced (no competitors/targetCustomer/stage/businessModel)
- [ ] 👍/👎 works, persists; analytics summary endpoint returns counts
- [ ] Full `npm run verify` green; tester agent browser-verifies all items

## Out of scope
- Multi-browser (Phase 8), Studio theming (Phase 9), board push (Phase 9).
