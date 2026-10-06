# Merge MANOJ → DEV, ticket #13996 (2026-ish session)

- origin/MANOJ pushed: 0a97f6f → 7e95b62 ("Feedback v4: auto-open modal on QA completion and embed user feedback in downloaded reports", files: public/app.js, server/app.js, server/report.js, server/reportPdf.js).
- Before merging, local DEV was 7 commits behind origin/DEV (badec7f — team added security testing suite, QA test selection, browser bridge changes). Fast-forwarded DEV to badec7f first.
- Merge commit: **921883e** on DEV (`git merge --no-ff 7e95b62`), no conflicts — ort auto-merge handled public/app.js and server/app.js cleanly.
- Verified both sides coexist: DEV tokenUsage rendering (public/app.js), securityPayloadBudget imports (server/app.js) + MANOJ feedback sections (server/report.js feedbackSectionHtml, server/reportPdf.js userFeedback).
- Tests on merged tree: node --test server/*.test.js → 649 tests, 631 pass, 0 fail, 18 skipped. (Count is now ~649, not the older ~601 — DEV's new test files raised it.)
- Pushed origin/DEV badec7f..921883e. MANOJ checked back out, clean, 0/0 vs origin. keepalive flake did not occur this run.
