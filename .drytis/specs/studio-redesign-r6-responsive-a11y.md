# Studio Redesign R6 · Responsive + accessibility + full verification

Ticket: #13961. Final phase of the Studio redesign (R1–R5 done).

## Goal
Verify and fix the Studio theme at mobile/narrow widths, check accessibility basics (contrast, focus rings, reduced motion), and run the full verification battery (unit suite, seam tests, headless multi-viewport screenshots, live-browser suite where available).

## Scope
- Responsive: 390×844 (phone), 768×1024 (tablet), 1024×768, 1440×900 — no clipped/overlapping text, dock/tablet bottom bar functional, dialogs scrollable.
- A11y: focus-visible rings on interactive elements, prefers-reduced-motion honored, no below-WCAG-AA text contrast in primary reading surfaces (both themes).
- Full verification: `npm run verify` 849+/0 fail; headless screenshots all viewports × themes; preview 200.

## Acceptance criteria
- [ ] 390/768/1024/1440 light + dark: zero clipped elements (DOM measurement), dialogs scroll.
- [ ] Focus rings visible on tab/keyboard focus (buttons, inputs, checkboxes).
- [ ] reduced-motion: tooltips/animations disabled (existing rule preserved).
- [ ] Full suite green; live-browser suite green if runnable.
- [ ] Any fixes committed and pushed to PUSHKAR.
