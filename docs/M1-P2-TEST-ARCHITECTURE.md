# M1-P2 — TEST ARCHITECTURE (delivered state)

## Canonical entrypoints (package.json)

```
npm test                → node scripts/run-tests.mjs all
npm run test:all        → everything + gate verdict
npm run test:gate       → core + contract + truthfulness + e2e (blocking) — exit 1 on blocking failure
npm run test:core       → protected regression suites (49 files)
npm run test:unit       → same as core (node:test umbrella)
npm run test:api / test:contract → API contract baseline
npm run test:truthfulness → AI red team
npm run test:security   → security detection (documents known risks — never gates)
npm run test:e2e        → CASE UI end-to-end (Playwright)
npm run test:accessibility → axe-core scan (advisory)
npm run test:responsive → 390/820/1280 viewport checks (advisory)
npm run test:performance → baseline timings (advisory)
```

## Directory layout

```
tests-real/                 ← canonical home (tests/ path is kernel-corrupted on this host)
  *.test.js                 ← the 49 protected regression suites (byte-identical to git @ 4eb617c)
  api-contract/             ← contract-baseline.test.js (31 checks over UI-used routes)
  truthfulness/             ← redteam-truth.test.js (18 checks)
  security/                 ← security-detection.test.js (14 checks, documents S1/S7…)
  e2e-ui/                   ← journey.spec.mjs (31 checks incl. 5 P1-discovery guards)
  accessibility/            ← axe-scan.spec.mjs (7 surfaces + keyboard smoke)
  responsive/               ← viewports.spec.mjs (21 checks × 3 viewports)
  performance/              ← perf-baseline.test.js (9 baseline measures)
artifacts/
  test-report.json / .html  ← canonical report (Phase 10)
  test-<cat>.tap.log        ← full TAP for node:test categories
  test-<cat>-<script>.log   ← stdout for script-style suites
  e2e-shots/ responsive-shots/ accessibility-report.json
```

## Runner mechanics (scripts/run-tests.mjs)

- Environment check: node ≥20, QASE_API_TOKEN present (skippable via QASE_SKIP_ENV_CHECK=1).
- Service check: /api/health + benchmarks 9901–9903.
- Two suite styles:
  - `node-test` (core/contract/truthfulness/security/performance): `node --test … --test-reporter=tap`, summary parsed from `# tests/# pass/# fail/# skipped/# cancelled`.
  - `script` (e2e/accessibility/responsive): standalone Playwright drivers printing a standardized `TESTS n / PASS n / FAIL n [/ KNOWN n]` block; non-zero exit with `FAIL 0` = crash → blocking.
- **Vacuous-pass protection**: a blocking category that matches 0 test files is recorded as a failure — the gate can never pass because a glob broke.
- **Known-open-bug channel**: a suite may print `KNOWN n` + `KNOWN-ISSUE <text>` lines. These are surfaced in console, JSON, and HTML reports (marked "tracked, not hidden") but do not block the gate. Current entry: `P1-4 duplicate test-case names (conc-test-0 ×2)` — store-level duplicate, dedupe lands in M1-P10.
- Gate = core + contract + truthfulness + e2e. Advisory = security, accessibility, responsive, performance.
- Exit code 1 only when a blocking category has real failures.

## Protected suites (never rewritten, must stay green)

browserstack-trust (46), execution-provenance (65), device-context (9), device-execution (27),
phase18 unit/api/e2e (61), phase16/17 intelligence + ux suites, validation loop suites,
phase10 visual regression, phase14 multi-viewport — all under `tests-real/*.test.js`.
Two documented micro-fixes to make them location-independent (see docs/M1-P2-TESTING-BASELINE.md §G):
browserstack-trust now reads the server's redacted config via API (was test-cwd), and
phase9c artifacts writes go through QASE_ROOT.

## Environment requirements

- Node ≥ 20, `npm ci` done, playwright chromium installed (`npx playwright install chromium`).
- `.env` with QASE_API_TOKEN (see `.env.example` — no secrets in the repo).
- Server running (`npm start`) unless mode=core with QASE_SKIP_ENV_CHECK.
- Benchmarks up for mission-dependent suites (`python3 scripts/serve-benchmarks.py` / bench-servers.sh).
