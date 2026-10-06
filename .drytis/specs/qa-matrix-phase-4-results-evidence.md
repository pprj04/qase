# Phase 4 — Per-configuration results, evidence & coverage reporting

## Goal
Report QA results separately per device, OS, browser and version, with evidence attached to
the configuration that produced it, honest totals including coverage gaps, and a UI view for
the QA matrix run. Reuse the matrix-run records, artifact store and coverage layer.

## Files to change
- `server/matrixService.js` / `matrixApi.js` — ensure per-item payload exposes: status,
  verdict, error/reason, durationMs, executionLevel/provider actual, runtimeFacts
  (launched browser, engine, branded binary, UA), `artifactRefs`, defects/bugs linked via
  existing environment association (BUG-XXX), and session link for drill-in.
- `public/app.js` — QA matrix run view: status board of all configurations
  (device · OS · browser · version · execution type · status), live updates from
  `matrix_item` SSE, drill-in to a configuration's session log/screenshots (existing
  session view), cancel button (Phase 3), per-item retry (Phase 3).
- New `public/qaMatrixResults.js` (+ `.test.js`) — pure model: group/filter results by
  device, OS, browser family, version, execution type, status; totals row:
  planned / completed / passed / failed / blocked / skipped / cancelled + coverage gaps
  (planned − terminal, with reasons).
- Reports: extend the existing report matrix section (`reportMatrixSection.test.js` layer)
  to include the QA matrix run summary — per-configuration rows and totals; evidence
  (screenshots/logs) linked per configuration, never merged.

## Status presentation
- Required set surfaced explicitly: Pending, Queued, Running, Passed, Failed, Blocked,
  Skipped, Cancelled — distinct labels and colors (existing status vocabulary styling).
- An unexecuted configuration can NEVER display as passed (guard in the model layer +
  server honest-status guard already present).

## Acceptance criteria
- [ ] Results are reported separately for each device, OS, browser and version, each with
      its actual execution type from the runner.
- [ ] All eight statuses are represented distinctly.
- [ ] Screenshots, logs and defects attach to the configuration that produced them and are
      viewable from its row.
- [ ] The run view shows planned, completed, failed, blocked and skipped totals, including
      coverage gaps, updating live during execution.
- [ ] No unexecuted configuration is ever shown as passed.

## Tests
- Model tests: grouping, totals, gap computation, honest-pass guard.
- API test: item payload includes runtimeFacts + artifactRefs + session link.
- UI test: board renders from a fixture matrix run; drill-in opens the session view.

## Edge cases
- Item with artifacts but failed early (blocked before launch) → no fabricated
  screenshot; evidence list shows logs only.
- Re-paginated long lists (hundreds of configurations) → virtualized/sectioned rendering.
- Cancelled run reopening → statuses frozen, retry still offered.
