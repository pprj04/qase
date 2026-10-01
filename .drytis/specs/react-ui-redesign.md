# QASE React UI Redesign — master blueprint

User request: rebuild the frontend as a polished React UI inspired by ChatGPT/Grok
(conversational agent layout, clean spacing, modern typography), light + dark mode,
UI/presentation layer ONLY — zero backend or logic changes.

## Architecture decisions

- **Stack**: Vite + React 18 + TypeScript. Build-only (no dev-server dependency);
  `npm run build` outputs `public/` (index.html + hashed assets). Server keeps
  `express.static(public)` and `/login → index.html` untouched.
- **Cutover strategy**: old static UI (`app.js`, `entry.js`, `styles.css`, …) stays in
  place while React phases land; the React app replaces `public/index.html` at the
  Phase 5 cutover; legacy files removed in Phase 7. The 21 source-pinning tests keep
  passing until Phase 7 reworks them.
- **Design language**: Drytis Studio tokens (memory: drytis-studio-design-tokens.md) —
  Geist/Geist Mono (woff2 already in public/fonts), 10px radius scale, near-black
  primary buttons light / #e5e5e5 dark, brand blue #2F5BEA accents, Tailwind-style
  alpha badges for status. ChatGPT/Grok layout: conversational center column with
  generous whitespace; collapsible session sidebar; live browser viewer as a right
  panel that collapses (existing behavior preserved); mode rail.
- **Theming**: CSS custom properties on `:root` (light) + `[data-theme="dark"]`;
  default follows `prefers-color-scheme`; user choice persisted (localStorage),
  toggle in header + settings. No flash-of-wrong-theme (inline pre-hydration script).
- **State**: React context + reducer; dedicated modules ported with identical
  semantics: `apiClient` (CSRF header from qase_csrf cookie on non-GET, 401→reload,
  {error} parsing), `sseClient` (EventSource /api/sessions/:id/events, snapshot
  resync, revision guard), timers from server-authoritative timestamps.
- **Reuse unchanged** (pure-logic modules survive as-is): followUp.js, qaKickoff.js,
  fixPromptBuilder.js, uiPrimitives.js, sqaPresentation.js, questionPresentation.js,
  founderPresentation.js.
- **Setup/deploy**: setup script gains `npm run build` after `npm ci` (Phase 1).

## Phases (each = one board ticket)

1. **Foundations** — Vite scaffold, tokens, light/dark theme system, app shell
   (sidebar / conversation / viewer / mode rail) with placeholder panels, build wired
   into setup script.
2. **API & state layer** — apiClient, sseClient, session store, run list with live
   timers/engine pills/feedback badges; unit tests for client modules.
3. **Auth & account surfaces** — login/register gate (pilot invite), settings dialog,
   profile dialog, theme toggle UX, toasts.
4. **Conversational transcript** — composer, message stream, run summary (progress,
   mini variant), thinking strip, blocking questions incl. credential questions,
   status/timer/token chips, welcome checklist, pilot banner.
5. **QA launcher + browser viewer** — launcher dialog (engines, scope, test catalog,
   security gate), live stage with frame/cursor overlay + auto-collapse, tabs
   (Activity/Plan/Findings/Report incl. report actions + feedback modal), deep links.
   **Cutover: React app becomes the served UI.**
6. **Remaining surfaces** — SQA + Founder launchers/views, Bugs view, admin feedback
   panel, performance panel, Drytis board push, mobile/responsive pass.
7. **Cleanup & verification** — remove legacy files, rework the 21 source-pinning
   tests to target React source, full a11y/responsive polish, browser E2E of every
   journey, suite green, publish + deploy.

## Non-negotiable constraints

- No changes to server/, migrations, or any /api route (exception: none).
- Every existing capability must exist in the React UI (inventory in
  frontend-ui-audit-redesign-seams.md + researcher report).
- Full suite green at every phase boundary.
