# Phase 4 final layout re-test (ticket #14026) — PASS with 1 responsive caveat

Fix verified: nested `minmax()` removed. Served CSS now computes `grid-template-columns: 256px 483px 480px 61px` (sidebar | conversation | viewer | mode rail side-by-side). Transcript = 571px tall (was 48px), 72/72 non-empty bodies, markdown rendered (`<p>/<code>/<strong>`).

## Responsive @850px — viewer overlay partially obscures transcript (judged acceptable-with-caveat)
- At 850px the grid drops to 3 columns (`256px 533px 61px`); the viewer switches to `position:absolute; z-index:20; background rgb(255,255,255); opacity:1` overlay at x=378–798.
- Agent messages span x=272–773 → the opaque viewer covers the right ~75% of every agent body; user messages (right-aligned, x=458–773) are 100% covered. Only ~106px of the agent message column is legible. No horizontal scrollbar. Screenshots: `phase4-final-850-overlap.png`, `phase4-final-responsive-850.png`.
- The task brief said overlay is "the documented responsive behavior", but the legibility criterion ("nothing overlaps the transcript illegibly") is only partially met — user bubbles are fully hidden at 850px until the viewer is collapsed. Recommend narrowing viewport or auto-collapsing viewer below ~900px.
