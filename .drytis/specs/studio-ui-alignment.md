# QASE UI Alignment with Drytis AI Studio

Goal: make QASE look and feel part of the Drytis ecosystem (reference https://studio.drytis.ai/) — typography, theme, controls, spacing, token display — while preserving ALL existing functionality, the standalone integration preview host contract, and responsive behavior.

## Extracted Studio design language (from studio.drytis.ai CSS chunks)

- **Stack**: Next.js + Tailwind v4 + shadcn-style tokens; fonts self-hosted — `Geist` (sans, 100–900) and `Geist Mono` (100–900); fallbacks `ui-sans-serif, system-ui`.
- **Base font size**: 14px; secondary 11–13px; `body { background: var(--background); color: var(--foreground) }`.
- **Dark theme tokens** (Studio's active theme):
  - `--background #1a1a1a`, `--theme-bg-secondary #27272a`, `--theme-bg-tertiary #3f3f46`
  - `--border #3f3f46`, `--theme-border-light #52525b`, `--ring #737373`
  - `--text #fafafa`, `--theme-text-secondary #e4e4e7`, `--theme-text-muted #a1a1aa`
  - brand/accent blue `#2f5bea` (hover tint shadows `0 6px 18px #2f5bea59`), secondary `#60a5fa`, `#1d4ed8`
  - chart colors `#1447e6 #00bb7f #f99c00 #ac4bff #ff2357`; destructive `#ff6568`
- **Radius**: `--radius .625rem` (10px); xs 2px; md 8px; lg 10px; 2xl 16px.
- Neutrals are zinc-based; QASE's current navy-dark palette (`#07090d` + indigo `#6877ff`) shifts to Studio zinc + blue.

## QASE current state (MANOJ @ 8113cc7)

- `public/styles.css` (7,756 lines): token blocks at `:root` L3–42 + CLI-theme override L4448; fonts Inter-first (Geist already 2nd); radius 7/11/15/20.
- Layout: left runs sidebar (+perf, feedback panels) / middle chat panel (timer, status chip, transcript, composer) / right viewer (urlbar, stage, tabs Activity/Plan/Findings/Report).
- **No Files section, no token UI on MANOJ.** DEV (16 commits ahead, clean merge) has: `#token-chip` context %, `.run-summary` collapsible with `.token-summary` (✦ `~2.4k in · 15k out · 17k total`), `.run-badge--tokens` sidebar badges, live SSE `tokenUsage` — introduced by 4eb0a18/f6c8f24.
- Standalone preview host contract: iframe embed, `QASE_DRYTIS_EMBED_ORIGIN` exact HTTPS origin → CSP `frame-ancestors`, XFO dropped when set; no postMessage; Drytis-owned instance access (`instanceAccess.js`), `/internal/v1/drytis` HMAC data plane; launch URL `/?run={id}` off `publicOrigin`.

## Phases

### Phase 0 — Sync MANOJ with DEV
Merge origin/DEV into MANOJ (fast-forward in content; no public/ conflicts expected since MANOJ made no public/ changes since merge-base 8113cc7). Brings token-usage UI, run-summary, Bug Tracker, etc. Run full suite on merged tree. This is the base the alignment work builds on.

### Phase 1 — Design tokens & typography
- Add Studio-mapped custom properties alongside existing QASE tokens (map, don't replace wholesale): background `#1a1a1a`, panel `#27272a`, surface `#3f3f46`, border `#3f3f46`/`#52525b`, text `#fafafa`/`#e4e4e7`/`#a1a1aa`, accent `#2f5bea` (+hover `#60a5fa`), destructive `#ff6568`, radius base 10px (remap --radius-sm 6 / --radius-md 8 / --radius-lg 10 / --radius-xl 16).
- Self-host Geist + Geist Mono woff2 (OFL-licensed) under `public/fonts/` with `@font-face`; body stack becomes `Geist, Geist Mono (mono contexts), Inter, ui-sans-serif, system-ui`. CSP already allows 'self' assets.
- Typography hierarchy pass: page titles, section headings, labels, body, helper, button, input, table, status text — consistent sizes/weights per Studio (base 14px, muted 12–13px).
- Update CLI-theme override block to stay coherent.

### Phase 2 — Controls alignment
Buttons (primary = accent blue #2f5bea, ghost, danger, sm variants), inputs/selects/textareas, checkboxes/radios, tabs, modals/dialogs, chips/meta-chips, filter controls, action menus: consistent height (Studio-style ~36–40px), padding, 8–10px radius, hover/focus (ring)/active/disabled states, icon placement. Keep semantic status colors (success/warn/danger) tuned to Studio chart/destructive hues. No markup redesign — CSS-first where possible.

### Phase 3 — Layout organization above Files + Files section
- Verify order in middle/right panels: Run/Project info → Execution controls → Status/Performance → Token info → other metadata → **Files** (new, last).
- Add a **Files section** listing real per-run artifacts only (no fabricated data): QA report (PDF export), fixes export, transcript/log — whatever the run actually produces, with download affordances reusing existing handlers. Rendered only when a run is selected/artifacts exist; accessible on mobile.
- Do not move/remove existing functionality; no redesign of unrelated pages.

### Phase 4 — Token display Studio alignment
Align DEV's token UI (chip, summary row, sidebar badges) to new tokens/typography; verify values and calculations unchanged; verify context-window chip; responsive (numbers stay readable, no overflow); live updates continue via SSE.

### Phase 5 — Standalone preview host contract verification
Confirm `QASE_DRYTIS_EMBED_ORIGIN` frame-ancestors behavior unchanged (embed works, XFO dropped only when set, exact-origin enforcement, cross-origin API rejected); direct URL access + refresh + `/?run={id}` flows work; no new CSP violations (self-hosted fonts must load).

### Phase 6 — QA matrix + publish
Full test matrix: page load, new/existing QA run, execution, performance panel, token display, Files section, all controls, forms/filters, responsive desktop/laptop/tablet/mobile, standalone preview, direct URL, refresh, auth/session, reports, automation; zero console errors / broken API calls / CSS conflicts / layout regressions. Suite green. Publish to origin/MANOJ.

## Assumptions
- "Files section" is new (none existed anywhere) and lists only real run artifacts.
- Merging DEV→MANOJ first is acceptable/required to avoid duplicating DEV's token UI.
- Push to DEV stays a separate user request, as established.
- Light theme is out of scope; Studio's active dark theme is the target.
