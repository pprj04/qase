# Ticket #14074 review — exec panel phase 1 relocate (HEAD 6918e67 + uncommitted)

Spec: .drytis/specs/exec-panel-phase-1-relocate.md. Verdict: PASS on all criteria.

- Move is pure markup relocation: #choose-device, #stage, #tabs, .tab-body now in
  aside.panel.viewer after its panel-head; quick-actions + composer restored to
  main.panel.chat. No JS changed. app.js uses id-based lookups only; the single
  structural selector `document.querySelectorAll('#tabs .tab')` is containment-free.
- CSS: .chat 7 rows / .viewer 5 rows consistent across base, .cli-theme,
  ≤1023, ≤520 (incl. cli-theme stacked). All pins explicit; no orphaned
  .chat > .choose-device/.stage/.tabs/.tab-body selectors remain.
- Scroll ownership: .viewer > .stage and .viewer > .tab-body min-height:0;
  .tab-pane overflow:auto; .viewer overflow:hidden. T6 confirms pane-only scroll.
- Cache-bust bumped to styles.css?v=20261001-1.
- Tests at review time: npm test 826 pass/9 skip; node --test public/*.test.js 95
  pass; test:ui PASS at all 6 resolutions (exec-order inViewer=true, no page
  scroll); test:acceptance PASS T1–T16e; localhost:5173 → 200.
- Note: test:ui/test:acceptance require QASE_TEST_PASSWORD env (from
  .drytis/cred.json accounts[0]) or they abort with a setup FAIL by design.
