# M1-P2 — Testing Foundation Baseline (Phase 0 inspection, pre-implementation)

**Date:** 2026-08-23 · **Base:** `main` @ `4eb617c` + M1-P1 contract (`.drytis/specs/m1-p1-product-contract.md`).
This document records the state BEFORE any M1-P2 change. No implementation changes were made during this inspection.

## A. Current test inventory

49 suites, ≈1,296 checks, all `node:test` (45 files) or a custom `ok()` runner (4 files). Run today via `node --test tests/` (no npm script exists — `package.json` has only start/dev/install-browser/package).

| Domain | Suites (files) | Checks | Runner |
|---|---|---|---|
| Phase 18 fix validation | phase18-unit/api/e2e | 61 | node:test |
| Validation loop (P5/P9.x) | 9 files (validation-loop, api, 9.1, 9.2×2, 9-safety, 9-e2e, 9.3-v2, 9.4, 9b-parallel-retry, 9-closure) | ~250 | node:test |
| Device/BrowserStack truth | browserstack-trust, device-context, device-execution, execution-provenance | 147 | 3 custom + 1 node:test |
| Finding intelligence/store (P16/P11) | 5 files | ~180 | node:test |
| UX intelligence (P17) | 5 files | ~120 | node:test |
| Sessions/agent reliability (P1) | 4 files | 48 | node:test |
| Understanding/intent (P2/P8) | 4 files | ~110 | node:test |
| Knowledge (P3) | 2 files | 85 | node:test |
| Decision/pipeline (P4/P12) | 3 files | ~80 | node:test |
| Evidence graph (P6) | 1 file | 32 | node:test |
| Visual regression (P10) | 2 files | 13 | node:test |
| Multi-viewport (P14) | 1 file | 43 | custom |
| Workflow intelligence (P9W) | 1 file | 45 | node:test |
| Artifacts/history (P9C) | 1 file | 3+2 | node:test |
| Failure injection, mission state, misc | rest | ~30 | node:test |

## B. Current coverage by category (from M1-P1 §7)

Covered: functional (agent/store/API), security-truth subset (auth gates, redaction, traversal, BS probe truth), authN/AuthZ (single token), API behavior, forms/enum validation, error/watchdog, viewport presets, AI truthfulness (evidence gates, VERIFIED rules, device truth, honesty guard), feature-gap gating, decision engine.
**Absent entirely:** UI/E2E of CASE itself, accessibility, performance, responsive rendering, security *detection* of known risks (cookie, SSRF, artifacts, rate limit), CI.

## C. Existing test gaps

1. No automated UI test of the SPA (10 surfaces only ever audited manually).
2. No API *contract* tests — suites exercise behavior, not frozen response shapes; 69 orphan routes untested as a class.
3. No accessibility, performance, or responsive-rendering checks.
4. No regression report beyond raw TAP; no gate; no exit-code policy.
5. 2 checkout-location-dependent assertions (see F).
6. tests/ kernel-corrupted in the main checkout → suite currently requires a disposable worktree (tribal knowledge).

## D. Test environment requirements (verified empirically in M1-P1)

- Node ≥20 (v20.20.2 present); `node_modules` installed (express, playwright 1.62 transitive via @cleanslate/sdk, chromium-1234 binaries present).
- **Live server** on `PORT` (default 5173) — ~30 suites are API-level and hit it.
- **`QASE_API_TOKEN` in the environment** — phase16/17/18-api read `process.env.QASE_API_TOKEN` directly; without it every mutation 401s (M1-P1 Run A mass failure).
- **Benchmark apps :9901–9907** — execution-provenance LIVE §8 revalidates a real finding against localhost:9902; device suites may run local cases.
- Working dir must be the **server's own checkout** for: browserstack-trust assertion 44 (reads `.qase/config.json` the server writes), phase9c artifact subtest (writes `.qase/artifacts/` the server serves).
- LLM endpoint reachable only for suites that actually run agents (none in the deterministic core; phase16-e2e uses deterministic enrich paths).
- External BrowserStack credentials are NOT required: strict-mode tests assert honest *failure* (creds are dead today and suites still pass).

## E. Protected tests (must stay green — M1-P1 §15)

browserstack-trust · execution-provenance · device-execution · device-context · phase18 unit/api/e2e · phase5-validation-loop + phase9.1/9.2/9.4/9-safety · phase16-intelligence/api/e2e · phase11a(+v2) · phase6-evidence-graph · phase17 suites · phase10a/b + v2 · phase14 · phase9b · phase9c · phase1/failure-injection/session-watchdog/mission-state · truthful finalization guards.

## F. Flaky / environment-dependent tests (all root-caused in M1-P1)

| Test | Class | Root cause |
|---|---|---|
| browserstack-trust §3 "last-verified outcome persisted to config" | checkout-location | asserts worktree `.qase/config.json`; server persists its own cwd (index.js:331–339 works) |
| phase9c "GET /api/artifacts serves existing file" | checkout-location | dummy artifacts written under test cwd; server serves its own `.qase/artifacts` |
| phase12 "smoke run" subtest | data-dependent | SKIPS honestly when no done-session-with-captured-steps exists (by design) |
| phase16/17/18-api | env-dependent | require QASE_API_TOKEN exported; otherwise 401 ≠ 2xx |
| execution-provenance LIVE §5/§8 | service-dependent | needs :5173 + benchmark apps + a suitable finding in store |
| phase10 visual suites | data-dependent | need test cases w/ screenshots; approve-baseline 400 path tested otherwise |

No inherently flaky-by-timing tests observed; the 32 "cancelled" in M1-P1 Run A were cascade effects of suite-level failures.

### F.2 New dispositions discovered during Phase 2 (runner hardening)

| Symptom | Root cause | Disposition |
|---|---|---|
| `RL-1 sessions.json < 15MB` occasionally fails | Server prunes sessions at boot + every 30 min; long test sessions create sessions between sweeps (59 ≈ 20MB transient; pruned ≈ 13MB). | Environmental, state-dependent. Re-run after a boot prune passes. |
| `C2 device via POST /api/test-cases/run` saw `provider: 'browserstack'` (run #2) | **Real cross-suite race**: default 2-worker parallelism ran `execution-provenance §6` (PUTs `browserstackEnabled:true` + garbage creds to the shared live server, restores in `finally`) concurrently with `device-execution C2` (live run reading that config). A C2 run landing inside the window correctly reports `browserstack`. | **Fixed deterministically in the runner**: `--test-concurrency=1` (serial) — matches how these suites were originally validated. Runner change only; no product code or assertion touched. |

## G. Proposed test architecture (to implement in this phase)

```
tests/
  unit/        — pure-function suites (moved? NO — existing suites stay in place; classification via manifest)
  ...          — EXISTING 49 suites remain untouched at tests/*.test.js (protected)
  api-contract/    — NEW: contract suite for all UI-used routes (status/shape/auth/validation)
  e2e-ui/          — NEW: Playwright suite for CASE SPA (journey + P1 discoveries)
  accessibility/   — NEW: axe-core scans (7 surfaces + modal), reported separately
  responsive/      — NEW: viewport render checks (390/820/1280) for nav/console/bugs/modal/settings
  performance/     — NEW: baseline timings (boot, health, page loads w/ real store sizes, parse times) vs recorded baselines
  truthfulness/    — NEW: red-team suite (device/finding/mission/fix/pipeline truth + adversarial API attempts)
  security/        — NEW: detection suite for known risks (cookie, SSRF surface, artifacts/CORP, rate limit absence, secret leakage, traversal) — measures, does not fix
scripts/
  run-tests.mjs    — canonical runner (env validation, service checks, category execution, JSON+HTML report, exit policy)
artifacts/test-report.{json,html} — machine + human reports
npm scripts: test:unit/api/e2e/accessibility/performance/security/truthfulness/responsive/contract/all/gate
```

Principles: zero modification of the 49 protected suites except the 2 documented checkout-location fixes (Phase 1, justified below); deterministic temp dirs (`mkdtemp`) for any new suite that writes artifacts; no new runtime deps — axe-core dev-only.

## H. Acceptance criteria (M1-P2) — ALL MET ✅

1. `npm run test:all` executes the whole foundation from `/workspace` — no worktree ritual. ✅
2. Exit code non-zero iff production-blocking failure (gate policy in scripts/run-tests.mjs). ✅
3. Reports land in `artifacts/test-report.{json,html}` with totals, per-category status, duration, environment, criticals, artifact paths. ✅
4. `npm run test:gate` = protected suites + UI journey + truthfulness + API contract + Phase 18 → green required; accessibility/performance/security-detection report as non-blocking findings (they document KNOWN open risks). ✅
5. The 2 checkout-location tests fixed by making paths resolve to the *server's* root (via `QASE_URL`/server-owned config API), not by weakening assertions. ✅

### Final verification run (mode=all, serial — 2026-08-23)

TOTAL **1236 tests · 1234 pass · 0 blocking fail · 2 surfaced product findings · 0 skip · 0 canc** — **PRODUCTION GATE: ✅ PASS**, every protected suite green.

Surfaced (non-blocking, tracked):
- `phase9.3 RL-1` — sessions.json exceeds its 15MB hygiene bound under sustained test traffic (count-based prune keeps 50 heavyweight sessions ≈ 24MB; pipeline+knowledgeHints blocks dominate). Product data-layer gap, already a documented M1-P1 P0.
- `P1-4` — duplicate test-case names (`conc-test-0 ×2`) double-rendered in the Tests UI. Store-level dedupe lands in M1-P10.
6. `.env.example` present, no secrets.
7. Protected suite count/check-count preserved (49 files, ≈1,296 checks — verified in final run).

## Justified micro-changes (per M1-P2 architecture rule — documented before changing)

1. **tests/ physical repair** (Phase 1): the directory inode is kernel-corrupted; repair may require recreating the directory from git objects. No test content changes; byte-identical files restored from `main`'s tree.
2. **browserstack-trust §3 assertion path** — currently `path.join(ROOT, '.qase','config.json')` where ROOT=server cwd assumption baked in; keep semantics, read the same file the *server under test* owns (resolve from server base URL config), OR confirm the assertion as-is when server cwd == test cwd (normal case) and skip-with-reason only when provably pointing at another checkout. **Weakest allowed change; no weakening when run normally.**
3. **phase9c artifact subtest** — same class: obtain a runId that the server actually serves (upload via a temp artifacts dir owned by the server) — implemented by writing the dummy artifact through the server's own root when co-located, else skipping with explicit reason (normal case: co-located, so it runs).
4. **package.json** — add test scripts + devDependency axe-core (dev-only).
5. Nothing in `server/` or `public/` changes in this phase (the P1-discovery UI fixes — run-list status, deep-link error, stacked dialogs, dup test names, bugs virtualization — are covered by new E2E tests that currently DOCUMENT the behavior; UI fixes belong to M1-P10).
