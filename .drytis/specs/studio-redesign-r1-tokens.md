# Studio Redesign R1 — Design Token Foundation

Ticket: #13956 (phase R1 of the Studio redesign plan)
Source demands: Thomas Eide (transcript) — "QASE styling matching Drytis theme".
Audit: `.drytis/memory/drytis-studio-design-tokens.md` (studio.drytis.ai CSS bundles).

## Goal

Swap the token foundation from the green-terminal `cli-theme` layer (second `:root`
at styles.css ~line 5003, the one that wins the cascade) and the dead indigo
` :root` (line 3) to a **light-first Drytis Studio** palette, while keeping
every id / class / DOM structure / JS behavior intact.

## Constraint that shapes the whole approach

`body.cli-theme` + hundreds of terminal-layer rules below line ~5000 hardcode
dark hex colors (~436 hex occurrences). Rewriting all of them is R2–R5 work.
R1 therefore does the **token-level inversion**:

1. Replace the second `:root` block (terminal tokens) with Studio light tokens
   under the SAME custom property names.
2. Remove the dead indigo `:root` at the top (line 3) so there is exactly one
   live token layer.
3. Make the terminal presentation layer itself light-safe in R1 only where it
   would otherwise be unreadable (backgrounds + text colors of the shell),
   leaving fine component reskinning to R2–R5.

## Studio tokens (from audit)

- bg `#ffffff`, canvas/surface `#fafafa`, sidebar surface `#fafafa`
- near-black primary `#171717` (primary buttons, headings)
- zinc borders `#e5e5e5` (regular), `#d4d4d8` (strong)
- brand accent `#2F5BEA`, hover `#1E56F5`,
  glow `0 6px 18px rgba(47, 91, 234, 0.35)`
- radii: sm 8px / md 10px / lg 14px / xl 20px (pills 999px stay)
- font stacks: UI = `"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  mono = `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`
- status colors (alpha-tinted soft variants):
  success `#0f9d58` / warning `#b45309` / danger `#dc2626` / critical `#be123c` /
  info `#2563eb`
- dark variant (prefers-color-scheme: dark): zinc `#1a1a1a` / `#18181b` panels,
  `#27272a` borders, text `#fafafa`, accent stays `#2F5BEA` (lightened `#5b7bef`).

## Acceptance criteria

- [ ] styles.css has exactly one live `:root` token layer = Studio light palette
- [ ] Dead indigo `:root` removed
- [ ] Terminal-layer page background / body text / panel borders resolve to
      Studio surfaces (no black page in light mode)
- [ ] The 26 static CSS seam assertions still pass UNCHANGED (they assert
      structure, not colors — verify, don't touch)
- [ ] Full `npm run verify` green (869+ tests)
- [ ] Headless browser boot of preview: zero page errors, interactive,
      computed body background is light (#fff family), primary button near-black
- [ ] Dark-mode users get a sane zinc dark variant via `prefers-color-scheme`

## Out of scope

- Component-level reskin (R2 shell, R3 dialogs, R4 workspace, R5 panels)
- Production deploy
- Any DOM/JS change
