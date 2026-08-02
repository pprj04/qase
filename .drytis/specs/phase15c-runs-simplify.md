# Phase 15C — Runs Page Simplification

## Goal
Reduce the right panel from 7 tabs to 3 (Activity | Plan | Report). Move test case management content to the Tests nav page. Remove Findings, Workflows, Regression tabs from the session view — they're accessible from dedicated pages.

## Files Changed
- `public/index.html` — right panel tabs reduced to Activity/Plan/Report. Test case toolbar + suite tree + test pane moved into `#page-tests`. Hidden containers added for findings-list, workflow-pane, regression-pane, count spans (JS still renders into them).
- `public/styles.css` — grid height adjusted for topnav (calc(100vh - 52px)), responsive column ratio tweaked.

## Acceptance Criteria
- [ ] Right panel shows only 3 tabs: Activity, Plan, Report
- [ ] Browser screenshot + URL bar still visible above tabs
- [ ] Tests nav page shows test case toolbar + suite tree + test case list (not placeholder)
- [ ] No JavaScript errors (all element refs still resolve)
- [ ] Tab switching between Activity/Plan/Report works
- [ ] Test case export buttons (JSON/CSV) work from Tests page
- [ ] Bug export buttons work from Bugs page
- [ ] Session detail loads without crashing
