# Phase specs 1–4 — React UI rebuild

Master plan: react-ui-redesign.md. Reference tokens: drytis-studio-design-tokens.md.
Constraint (every phase): presentation only; server/, /api, agent logic untouched.

## Phase 1 · Foundations: scaffold, tokens, theming, app shell

Goal: React app builds and serves the shell; old UI still primary until Phase 5.

- Add `vite.config.ts`, `tsconfig.json`, `src/` tree, npm scripts (build/dev).
  React served at `/app-react/` path during phased build (not replacing index.html).
- `src/theme/tokens.css`: full light+dark token set (Studio palette, Geist fonts via
  existing public/fonts, spacing/radius scale, alpha badge recipe).
- `src/theme/ThemeProvider.tsx`: default prefers-color-scheme, persisted override,
  no-flash inline script, `<ThemeToggle />`.
- App shell: session sidebar (collapsible), center conversation column (empty state),
  right viewer panel (collapsible), mode rail (QA/SQA/Founder/Bugs + device select +
  tools), status bar. Correct spacing per Studio scale (8px base grid).
- Setup script: `npm run build` after `npm ci` (before playwright install).
- Acceptance: build passes; visiting preview serves legacy UI unchanged; React bundle
  loads at its path with shell + working theme toggle in both modes; suite green.

## Phase 2 · API & state layer; run list

Goal: React app talks to the real backend; sidebar shows live runs.

- `src/api/client.ts`: port apiResponse/api/apiText exactly (CSRF qase_csrf on
  non-GET, same-origin credentials, 401-while-signed-in → reload, {error} parsing).
- `src/api/sse.ts`: EventSource wrapper (session events), open/error → snapshot
  resync with revision guard; handlers for all event types (frame, cursor, message*,
  activity, todos, context, usage, finding, report, sqa, founder.*, question, status,
  browser, session).
- `src/state/sessionStore.ts`: reducer + context; run list fetch (`GET /sessions`),
  delete run (confirm + DELETE), server-authoritative elapsed timers (1s tick,
  skew-corrected), engine pills, mode pill, token usage, device pill, feedback badge,
  conn dot/label from SSE state.
- Acceptance: sidebar lists real sessions with correct badges/timers; selecting a run
  loads it (transcript placeholder still); deleting works; unit tests for client/sse
  modules; suite green.

## Phase 3 · Auth & account surfaces

Goal: complete sign-in → account journey in React styling.

- Auth gate (login/register toggle, show-password, pilot invite-code field when
  `GET /api/pilot-status` says pilot, error states), matches new design (drop the
  terminal look; keep the pause-motion accessibility toggle idea as reduced-motion
  respect).
- Settings dialog (provider, API key, base URL, model select — NO datalist per
  modelSelectorUi constraint, reasoning, max turns, headless, Test connection, Save).
- Profile dialog (display name, timezone, password change, memory entries add/remove).
- Sign-out; toasts system.
- Acceptance: fresh visitor sees login; register w/ invite in pilot; settings save +
  test-connection flow works; profile edits persist; theme toggle reachable in all
  states; suite green.

## Phase 4 · Conversational transcript (QA core)

Goal: the ChatGPT/Grok-style conversation experience.

- Composer (Enter send / Shift+Enter newline, disabled-while-running, running hint,
  demo-fill affordance).
- Message stream with QASE/USER roles, markdown-ish rendering parity with legacy,
  auto-scroll with user-scroll-override, follow-up chips ("test these next").
- Run summary card: token text + LIVE pill, collapsible ↔ mini variant, progress
  steps/pct/findings, progress bar, current-activity line. Status/timer/token chips
  in header; keep exactly ONE status chip (statusChipUi regression).
- Thinking strip (collapsible live reasoning w/ caret animation).
- Blocking question slot incl. credential-question presentation; answer via
  /answer or /credentials.
- Welcome checklist (3 steps, model-ready state) + pilot banner (dismissible).
- Acceptance: full QA conversation journey works against demo site end-to-end in the
  React UI; SSE-driven updates render live; suite green.
