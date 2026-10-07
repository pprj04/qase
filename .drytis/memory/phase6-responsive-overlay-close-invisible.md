# Responsive test — CSS cascade bug hides viewer-overlay-close (found 2026-10-01)

At 768px the viewer correctly becomes an overlay, and `viewer-overlay-close` (aria-label
"Hide browser panel") exists and its click handler works (pane gets `is-overlay-hidden`
→ display:none, overlay fully hidden). BUT the button is invisible:

In the served bundle `index-react-BLILI9VS.css` the rule order is:
- rule 313: `@media (max-width: 900px) { .viewer-overlay-close { display: inline-flex; } }`
- rule 314: `.viewer-overlay-close { display: none; }`  ← BASE rule comes AFTER the media block

Same specificity, base rule later → base wins at every width → computed `display: none`
at 768px AND 360px. Users cannot click the overlay close button at any narrow width
(Playwright confirms "element is not visible"). Cascade bug only — handler + CSS class
(`.viewer-pane.is-overlay-hidden { display: none; }` in the same media block) are correct.
Fix: move the base `display:none` BEFORE the media block, or raise specificity
(e.g. `.viewer-pane .viewer-overlay-close { display:none }` … whatever shell.css source
produces — the compiled order is the problem).

Downstream at 360px: because the overlay can't be dismissed, it intercepts pointer events
over the center column (Playwright click on run rows intercepted by `.stage-url`). Also
the mode rail at 360px is positioned at x=360 (width 44) — exactly at the viewport edge,
0px visible (off-screen; scrollWidth stays 360 so no scrollbar, but rail is unusable).
Transcript/composer at 360px work (72 msgs render, textarea 262px wide, typed+cleared,
Send disabled when empty, zero POSTs). No horizontal page scrollbar at any width.
