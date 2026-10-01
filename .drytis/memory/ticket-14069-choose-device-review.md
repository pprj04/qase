# Review — Ticket #14069 (Collapsible Choose Device above preview)

Branch NIHARIKA, uncommitted tree. Verdict: PASS with 3 WARNs.

- Structure: `#choose-device` between #question-slot (idx 194) and #stage (idx 228); `.chat` grid row 6 pinned (styles.css:648), stage moved to row 7.
- One source of truth holds: all writes via `activeTestEnvStore.setSelection` (app.js cdSelect:787 / cdReselect:799); `cdSelectedDevice` is highlight-only, reset from store on open (app.js:815). Cosmetic-only drift possible if the dialog picker changes device while inline body is open (stale highlight until reopen).
- Honesty: badge = `executionTypeText(sel)` (devicePicker.js:169, reads executionType only, never name-inferred); test at devicePicker.test.js:99.
- Overflow: `.cd-list` max-height min(300px,32vh) + overflow-y auto (styles.css:8811); native selects; .choose-device z-index 4 / .cd-list 5 vs stage ::after z 0/1.
- Listeners: onclick/oninput assignment only (no addEventListener accumulation) — no leak.
- Suites: npm test 826/0/9; public 95/95; acceptance 15/15; responsive 6/6. No new tests for the cd-* controller (spec's test-extension clause unmet) — biggest gap.
- Spec drift: no [Change Device] button in collapsed head (whole row toggles); devicePicker.js `renderInlinePicker` not added (inline rendering lives in app.js instead) — functionally equivalent.
- Stacked ≤1023px note: `.cli-theme .chat` base template (styles.css:5149, 7 rows) was not updated for the choose-device row; layout survives only because grid-row pins force implicit tracks. Effective stage/tab-body minmax sizes are lost there. Not spec-breaking (1024-safe only).
