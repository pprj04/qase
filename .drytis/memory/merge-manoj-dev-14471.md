# Merge MANOJ → DEV, ticket #14471

- Merge commit: **9bd01a0** (`Merge MANOJ into DEV: SQA feedback phases 1+2 ... (#14471)`), pushed to origin/DEV (c670429..9bd01a0).
- Base: MANOJ da088ef branched from 6208c87; DEV was still at c670429 (merge #14244), so only one conflict.
- Conflict: `server/app.js` import block — DEV side added `createCatalogRoutes`/`createTestCaseRoutes`/`createBugRoutes` imports (from #14244), MANOJ side added `buildFeedbackSectionMarkdown` from `./report.js`. Resolution: keep BOTH (purely additive). No logic conflicts; `public/app.js` and `server/reportPdf.js` auto-merged.
- Tests on merged tree: 833 tests, 815 pass, 0 fail, 18 skipped (targetReachability split-horizon test passed this run).
- Workspace left on MANOJ @ da088ef, clean, up to date with origin/MANOJ.
- Next MANOJ work should branch from/merge 9bd01a0 to include DEV's catalog/testCase/bug API routes.
