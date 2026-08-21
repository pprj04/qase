# Qase — Next Build Plan (post Phase-17/18 publish)

**Date:** 2026-08-17 · **Basis:** continued audit (BrowserStack/device/evidence/UI) + final checks below.
**Code state:** commit `7b85f85` on main · regression 46 suites / 1075 pass / 0 fail.

---

## Audit close-out (the remaining items — findings only, nothing implemented)

| Item | Verdict |
|---|---|
| **Performance** | API endpoints healthy (health 35–50ms, missions 68ms, findings 36ms, grouped 47ms, markdown export 90ms). Real risk is **boot + memory**: evidence-graph.json **63MB unbounded** (no pruning, loads at boot), missions.json **4.9MB / 1,842 records**, sessions.json 11MB (50 kept by prune). Not urgent; P1/P2. |
| **uxSweep** | Deterministic and bounded (12 pages × 3 viewports, 10s/page, 120s wall clock). **Local Chromium only**: no BrowserStack, no device emulation — "mobile" in sweep results is a 375×667 **viewport resize**, not a device context (no UA/DPR/touch). Feeds UX/quality scores that therefore cannot claim device coverage. |
| **Benchmarking** | Exists and works: 12+ benchmark apps (`.drytis/benchmarks/`), fix-validation-benchmark (10 scenarios, all targets met), ux-benchmark (recall/precision 1.0), serve-benchmarks.py on 9901–9907. Do NOT expand now (per instruction). |
| **Regression** | Full loop green after publish (46/46 suites clean). regression-runs.json 112KB, bounded. |
| **OpenAPI** | **Does not exist.** Only markdown contracts (`.drytis/phase-11-integration-contract.md`, `phase-16-integration-contract.md`). No openapi.json/swagger spec, no schema validation of the 151 routes. |
| **Dead code** | 49 strictly-unused exports (worst: entire `authorization.js` helper family — 10 fns never called; `integrationAuth.js` 4 fns; various singletons). UI: **19 dead ids** in index.html from the corruption rebuild (`overlay`, `tabs`, `tab-*`, `exec-stats-steps/pages/findings/dur` — replaced by `bar.innerHTML`, `page-runs`, `testcases-toolbar`, `tests-sidebar`, `dev-intel-actions-bar`), **duplicate `id="mission-stage-strip"`** (line 153 hidden + line 200 live), and `uxq-filters` wired via delegation but the container id itself unused. |
| BrowserStack | Confirmed: wired ONLY into `replay.js launchBrowser()` (test-case replay/suites/scheduler/fix-validation). Agent missions (`agent.js`), uxSweep, and mobile live view NEVER touch BrowserStack. `launchBrowser` **silently falls back** to local Chromium on CDP failure (`console.warn` only) — a run configured "BrowserStack" can execute locally and report nothing. Cred validation: `/api/config/test` probes the **LLM** only; no BrowserStack probe exists (dead creds today cause the auth loop seen in logs). |
| Device/mobile | Mission path is real (`deviceContext.js` → Playwright registry, UA/DPR/touch applied, `session.device` persisted, engine honesty via `engineEmulated`). Replay path (`runTestCase`) sets **viewport only** — no device descriptor. uxSweep viewport-only (above). Live-view "MOBILE" badge comes from `classifyViewport()` on frame dimensions — a desktop page resized to 375px shows as MOBILE with no device identity. |
| Environment metadata | `addFinding()` accepts NO device/browser/provider/engine fields; `createEvidence()` has a free-form `metadata` but nothing stamps execution environment; `runTestCase` result has `browser:'chromium'` hard-coded regardless of actual provider; `computeEnvironmentDeltas` compares `finding.device` — a field that is never populated. Evidence/findings cannot answer "where did this run?" |

---

## 1. P0 — MUST FIX NOW (make the current product trustworthy)

Ordered by dependency:

1. **BrowserStack credential validation** — `POST /api/config/test-browserstack` (or extend `/api/config/test` with `target:'browserstack'`): attempt a CDP handshake with the stored user/key, return ok/latency/error. Settings UI shows the probe result; saving creds runs it. *(config.js + index.js + app.js settings section)*
2. **Execution truthfulness** — `launchBrowser()` returns `{ browser, provider }`; `runTestCase`/`runTestSuite` stamp `result.executedOn: { provider: 'browserstack'|'local', browser, os }` and the run record surfaces it in UI + exports. No more claiming cloud execution that didn't happen.
3. **Remove silent fallback** — when `browserstackEnabled` and CDP fails: fail the run with a clear error (config → "strict mode" default ON), not local Chromium. Optional explicit `fallback: 'local'` opt-in.
4. **Real device path for replay/test-cases** — thread `device` through `runTestCase` → build context via `deviceContext.contextOptionsFor()` (exists, unused) so test-case replay and fix-validation execute with real UA/DPR/touch, not viewport-only. Missions already do this.
5. **Correct device metadata** — stamp `environment { provider, device, engine, engineEmulated, viewport, browser, os }` on every evidence item (`createEvidence` metadata) and finding (`addFinding` additive field — same pattern as Phase 16). Populate `finding.device` so `computeEnvironmentDeltas` finally has something to compare. Fix-validation `plan.device` from original finding.
6. **Evidence visibility** — UI: environment badge on evidence items and finding cards (e.g. "BrowserStack · Chrome · OS X Sonoma" / "Local · Pixel 8 emulated"); executedOn on test-run rows.
7. **UI/settings cleanup** — delete the 19 dead ids, fix duplicate `mission-stage-strip`, wire or remove `uxq-filters` container, remove `exec-stats-*` orphan spans, dedupe settings fields.
8. **Reload/data synchronization** — replace silent `.catch(() => [])` on `/api/sessions/:id/detail` fetches with visible error + retry state (root cause of "old data after reload"); re-sync on `visibilitychange`.
9. **Error/loading states** — skeleton/error states for session detail, bugs board, UX panel; surface provider failures (from #2/#3) as toasts, not console.warn.

Explicitly NOT in P0: benchmarking expansion, Founder Mode, MCP, public deployment, OpenAPI generation, dead-code purge beyond UI orphans, store pruning.

## 2. P1 — NEXT BUILD

- **OpenAPI 3.1 spec** generated from the 151 routes + phase-16 contract; served at `/api/openapi.json` with a docs viewer. (External integrations keep drifting from markdown contracts.)
- **uxSweep device honesty** — either apply real device contexts in the sweep (deviceContext per viewport) or rename sweep dimensions to "viewport:*" so quality scores stop implying device coverage.
- **Store hygiene** — prune/compact evidence-graph.json (63MB), cap missions history, atomic writes for missions.json (raw writeFileSync today).
- **Dead-code purge** — remove the 49 unused exports in one pass with tests as the safety net (authorization.js family first — largest, fully unreferenced).
- **BrowserStack coverage for missions (optional tier)** — after P0 truthfulness, decide whether autonomous missions should run on BrowserStack; requires agent-runtime CDP support (bigger; separate decision).
- **Mobile live-view label honesty** — device badge driven by `session.device` when present; classifyViewport only as fallback labeled "viewport".

## 3. P2 — LATER

- Session deep-linking (`#/bugs/:id`), mid-run device switching, orientation signal.
- Webhook persistence (in-memory today), missions `findingsCount` write bug.
- concurrentRuns guard by available RAM (safe=3 on 6GB).
- Public deployment hardening, Founder Mode, MCP server.

## 4. Architecture changes actually required

**None structural.** P0 is extension at existing seams:

- `config.js` — add `testBrowserStackConnection()` beside `testConnection()`; `describeProblem` gains BS-cred checks.
- `replay.js` — `launchBrowser()` returns `{browser, provider}`; strict mode; `runTestCase`/`runTestSuite` accept + stamp `device`/`environment`.
- `deviceContext.js` — `contextOptionsFor()` (already exported, currently unused) becomes the single device→context mapper for replay + sweep.
- `evidenceGraph.createEvidence` / `findings.addFinding` — additive `environment` block (identical backward-compatible pattern used by Phase 16 fields).
- `agent.js` — one `buildExecutionEnvironment(session)` helper reused by all three executors.
- `public/app.js` + `index.html` — error states, env badges, orphan cleanup. No router/page-structure changes.

## 5. Architecture that must remain unchanged

- JSON-file stores in `.qase/` (no DB migration in P0).
- Phase 16 finding lifecycle/intelligence pipeline; Phase 18 fix-validation engine (deterministic status engine untouched — only receives richer `environmentDeltas`).
- `phaseRouter.js` route surface + `/api/v1` integration contract (additive fields only).
- Agent runtime (@cleanslate/sdk) and the mission execution loop.
- Auth model (requireApiToken / requireIntegrationAuth).

## 6. Files/modules to modify (P0)

`server/config.js` · `server/replay.js` · `server/deviceContext.js` · `server/evidenceGraph.js` (metadata stamp) · `server/findings.js` (additive env field) · `server/agent.js` (env helper) · `server/validationExecutorCore.js` (plan.device → finding.device) · `server/index.js` (BS test endpoint) · `public/index.html` (orphans, badges) · `public/app.js` (settings probe, error states, badges) · `public/styles.css` (badge/error styles) · `public/bugs.js` (env display) · new `tests/browserstack-truth.test.js` + `tests/environment-metadata.test.js`.

## 7. Files/modules NOT to touch

`server/fixStatusEngine.js` · `server/fixValidation.js` (store shape) · `server/findingIntelligence.js` · `server/knowledge.js` · `server/uxModel.js`/`uxChecks.js`/`qualityAssessment.js` (P1 only) · `server/phaseRouter.js` (except additive BS-test route) · `server/missions.js` core loop · `server/store.js` · `public/router.js` · all Phase 16/17/18 docs (frozen).

---

## Architecture decision

**YES — P0 is implementable by extending the existing architecture.** Every hook point already exists: `launchBrowser()` is the single browser-factory seam (provider truthfulness), `deviceContext.contextOptionsFor()` is already exported for exactly this purpose, `createEvidence().metadata` and `addFinding()`'s additive-field pattern were designed for extension, and the settings UI already round-trips BrowserStack fields. **No redesign, no new services, no schema migration** — additive fields only, exactly like Phase 16 did.
