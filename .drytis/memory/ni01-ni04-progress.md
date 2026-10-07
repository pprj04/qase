# NI01–NI04 progress (QASE-2.1, project 3542, branch NIHARIKA)

Tickets (board list repeatedly wipes to stale legacy list — platform bug; tickets exist server-side, move_ticket on 'missing' ids succeeds):
- #14631/#14647 NI01 Phase 1 catalog: DONE (reviewer PASS r3)
- #14648 NI01 Phase 2 browser resolution: DONE (reviewer+tester PASS)
- #14649 NI02 Phase 1 matrix run engine: DONE (reviewer r4 + infra PASS)
- #14650 NI02 Phase 2 per-profile execution + defect fixtures: implemented (defectFixtureRunner, /demo/defects pages, hooks wired in orchestrator+app); reviewer/tester round still pending — NEXT STEP
- #14651 NI03 browser matrix execution: DONE (reviewer r2 + tester PASS)
- #14652 NI04 coverage gap report + findings context: DONE (see below)
- #14653 NI04 validation script: NOT STARTED — remaining work

## #14652 round 2+3 (closed Done)
- report.js buildMatrixSectionMarkdown + app.js attachMatrixCoverage injection on report.md route (session.matrixRunId → computeMatrixCoverage([run])). Reviewer verified live: matrix-linked sessions exist, section renders, non-matrix sessions unchanged.
- CoverageService wiring tests added (payload.matrix embed/absence). reportMatrixSection.test.js (3 tests).
- matrixCoverage gaps now include PENDING rows + durationMs/updatedAt (execution time column in UI).
- deviceMatrixView renderMatrixGap: lazy <details> per-profile tables (built on toggle, 50-row cap per run).
- CRITICAL PERF FIX (found by tester, 2 dead browser sessions): Coverage tab was unrenderable since NI01 — /api/coverage payload contains 38,762 environments; renderCoverage built a column per env × 476 rows ≈ 18M cells. Fixed: grid renders only envs linked to cases/runs (cap 200) + 'Showing N of 38762' note. Existing structure preserved. /api/coverage is 7MB / ~1.6s — a future optimization could trim environments server-side, out of scope.
- Tester attempt 3: PASS 7/8 (50-row cap unobserved, no run >50 profiles). '198 vs 99 ERROR' note was a tester miscount — live reconciliation: item sums = gap sums = execution summary exactly (2696 requested: 1869 PENDING / 502 NOT_SUPPORTED / 216 NOT_RUN / 99 ERROR / 10 BLOCKED, 0 executed — honest).
- Suite: 1257 tests / 0 fail / 20 skipped. Preview 200.

## Standing warnings
- ALL NI work UNCOMMITTED (or 5+ commits ahead) on NIHARIKA — publish before any redeploy.
- Browser MCP for tester died twice mid-session at Coverage tab click before the perf fix; fresh sessions since are stable.
- postgres-mode artifact collection returns [] silently (services.artifacts local-only) — verify in #14650.

## RT1 (#14680) — DONE (reviewer PASS round 2, infra PASS)
Local browser runtime registry shipped: localBrowserRegistry.js probes chrome/brave/opera/edge binaries (version-only fallback on hot path — launch probes only at boot/TTL), browserSupportResolution.js branded upgrade only when launch-verified, DuckDuckGo hard NOT_SUPPORTED. Live: Chrome 151 / Brave 154 / Opera 136 launch-verified; Edge absent (MS repo 403).
- Fixed REAL prod bug: attachBrowserBridge became async → agent.js ensureRuntime made async; ALL call sites awaited (app.js×2, distributedExecution.js, drytisIntegrationApi.js, index.js wrapper). Reviewer round-1 caught 4 floating sites, fixed, round-2 PASS.
- Fixed 39 test regressions from async-contract fallout across 10 files (await on resolveBrowserSupport/availabilityReport/resolveExecution/expandMatrixItems/attachBrowserBridge/makeBridge/service.availability).
- WebKit libgstreamer deps lost on container replacement: `sudo npx playwright install-deps webkit` — MUST re-run after any container replacement (2nd time this happened).
- matrixOrchestrator.test.js primes probeLocalBrowsers once at import (cold probe ~0.5s vs 100ms test waits).
- Infra WARN (open): QASE_BROWSER_ALLOWED_PRIVATE_HOSTS still lists old preview host qase-2-1-jywqe4.drytis.dev instead of current qase-2-1-cvtryq.
- Reviewer WARNs (documented, non-blocking): isExecutableLocalBrand presumed-present path; worker.js lacks snapshot wiring (dormant without postgres); legacy DDG wording in stored coverage items.
- RT2–RT6 tickets still NOT created (first bulk create failed review_brief validation; only #14680 exists).
