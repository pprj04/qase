# QASE — Full Build Plan

**Version:** 1.0 · 2026-08-20
**Source of truth:** repository audit (Aug 17–20), `.drytis/next-build-plan.md`, team meetings Aug 17 (Thomas Eide directives), regression baseline 46 suites / 1,075 tests / 0 failures at commit `7b85f85`.
**Scope discipline:** each build has a hard stop rule. No build starts the next build's features.

---

## 0. Current State Baseline (verified, not assumed)

| Area | Status | Evidence |
|---|---|---|
| Phases 1–18 | ✅ Implemented & published | commit `7b85f85`, prod deployment 129 (`qase.drytis.com`, healthy) |
| Regression | ✅ 46 suites / 1,075 pass / 0 fail | fresh full run Aug 20 |
| Phase 16/17/18 engines | ✅ Green, **frozen** | fixStatusEngine, fixValidation, findingIntelligence, uxSweep/uxAssessment suites all pass |
| API | ✅ Fast, ~151 routes | health ~40ms, missions ~68ms |
| Frontend | 🟡 functional, product-quality gaps | 19 dead ids, duplicate `mission-stage-strip`, orphaned `renderFindings()`, silent `.catch(() => [])` |
| BrowserStack | 🔴 not trustworthy | only wired in `replay.js`; no credential validation; silent fallback to local Chromium |
| Real device execution | 🔴 not real | device never reaches `createSession()`; viewport resize displayed as MOBILE |
| Evidence/findings environment metadata | 🔴 incomplete | `computeEnvironmentDeltas` exists but findings never populate `device`/environment |
| Storage | 🟡 growing | evidence-graph 26MB, sessions 11MB, missions 4.9MB |
| OpenAPI / A–Z checklist / Founder Mode / multi-LLM benchmark / MCP | 🔴 not started (deliberately deferred) | audit-confirmed |
| Known risk | config flip-flop | `.qase/config.json` re-initialized from `.env` on every procmgr restart (re-triggered BrowserStack CDP auth loop twice) |
| Known junk | dead server modules | `authorization.js`, `expectedVsObserved.js`, `integrationAuth.js`, `preUnderstanding.js` — zero importers (~1,570 lines) |

---

## 1. Guiding Principles (all builds)

1. **Extend the existing architecture — never redesign.** Every P0/P1 need has an identified extension point.
2. **Frozen invariants — do not touch unless a regression is proven:**
   - `server/fixStatusEngine.js`, `server/fixValidation.js` (Phase 18 lifecycle & store)
   - `server/findingIntelligence.js`, `server/findingEnrichment.js` (Phase 16 classification/enrichment)
   - `server/phaseRouter.js` **route contract** (additive routes only)
   - Deterministic functions in `server/validationExecutorCore.js` (populating fields elsewhere is fine)
   - Auth model (JWT + QASE_API_TOKEN), workspace isolation, existing Drytis API contract
   - JSON store pattern in `.qase/` (additive fields only, no migrations)
3. **Truthfulness before features.** Never report an execution environment that didn't happen. A missing capability is acceptable; a fabricated one is a product-killing bug.
4. **Small changes, tested continuously.** Unit test → wire → targeted suite → re-run affected phase suites → full regression at build end.
5. **Commit hygiene.** Functional changes and dead-code deletion in **separate commits**. Nothing deployed to prod with unpushed commits.
6. **Secrets never in chat, prompts, or source.** BrowserStack credentials enter via Settings UI → runtime config store (backend-managed), never `.env` edits from shell.

---

## 2. BUILD 0 (P0) — Trustworthiness

**Goal:** every execution result in Qase is verifiably true. BrowserStack works or fails loudly. Device claims match reality. UI shows real state.

**Stop rule:** stop after the 46-suite regression is 0-fail + full verification gate. No P1 features.

### WS-0.1 BrowserStack credential validation & config authority  *(first — everything depends on it)*
- `server/config.js`: new `testBrowserStackConnection()` doing a real CDP probe (`wss://cdp.browserstack.com/playwright` auth handshake), returning `{ ok, account, browsersAvailable, error }` — never a guess.
- New route: `POST /api/config/test-browserstack` (same auth as existing config routes).
- **Config authority fix:** decide single source of truth for BrowserStack settings (runtime `.qase/config.json` wins when user set it in Settings; `.env` only seeds first boot). Stop the restart re-initialization flip-flop. Acceptance: change creds in Settings → restart container → creds persist; CDP auth loop cannot silently re-enable.
- Settings UI: "Test BrowserStack Connection" button, connected/error badge with account name, last-verified timestamp.
- Tests: `tests/browserstack-truth.test.js` — validation success/failure/timeout/malformed-key; config persistence across simulated restart.

### WS-0.2 Execution truthfulness (provider stamping)
- `server/replay.js` `launchBrowser()` — **backward-compatible return shape** (existing callers keep working): add `provider: 'browserstack' | 'local'`, `sessionId`, `sessionUrl`, `osVersion`, `device`, `executionMode`.
- Stamp `executedOn` on: replay runs, test-case results, fix-validation runs (`validationExecutorCore` consumers read it; engine math unchanged).
- **Strict mode:** when BrowserStack explicitly enabled and connection fails → hard failure with clear error surfaced to UI. No silent local Chromium. (Local Chromium remains fine when BrowserStack is disabled/absent.)
- Re-run phase16/17/18 suites after any `launchBrowser()` signature change — this is the one frozen-adjacent risk; the return shape must stay additive.

### WS-0.3 Real device execution path
- Wire `deviceContext.contextOptionsFor()` (already built, zero callers) into `replay.js` + fix-validation executor.
- Mission path: device selection in request → `createSession()` → agent browser launch. Session API returns device; SSE emits device event correctly.
- Extend `BROWSERSTACK_OS_MAP` beyond chrome/firefox/safari-on-macOS to real devices (iPhone, Pixel/Galaxy profiles, Windows 10/11).
- `executionMode` taxonomy everywhere: `VIEWPORT_RESIZE` | `EMULATION` | `REAL_DEVICE` — UI must display which one ran. 375×812 viewport may **never** render as "MOBILE device".
- Tests: `tests/device-execution.test.js` — device reaches session; mode classification; BrowserStack device vs emulation vs viewport mapping; UI label correctness (unit-level on the classifier).

### WS-0.4 Environment metadata → evidence & findings
- `server/agent.js`: one `buildExecutionEnvironment()` helper (single source).
- `evidenceGraph.createEvidence()` → `metadata.environment` (additive).
- `findings.addFinding()` → populate `device`, `environment` (additive; `validationExecutorCore.computeEnvironmentDeltas` already compares these fields — it starts working for free).
- Tests: `tests/environment-metadata.test.js` — evidence carries env; finding carries device; deltas fire on mismatch.

### WS-0.5 Evidence visibility
- Finding → execution → evidence chain in UI: environment badge (provider/device/mode/viewport/OS) on evidence cards and finding cards.
- Fix-validation before/after view shows each side's environment; environment mismatch is visually flagged (drives `UNABLE_TO_VERIFY` honesty).

### WS-0.6 UI cleanup (no redesign)
- Delete the 19 dead ids; fix duplicate `mission-stage-strip`; wire-or-remove `uxq-filters`.
- **Decision needed (user):** restore session FINDINGS tab (re-add tab, reuse hidden pane + `renderFindings()`) OR delete the orphan. Default if unanswerable: restore — data already fetched.
- Live view: show `executionMode` truthfully.
- Loading/error/empty/retry states replace silent `.catch(() => [])` in: session detail, bugs board, UX panel, dev-intel.
- Tests: UI smoke suite (existing E2E harness); console-error-free requirement.

### WS-0.7 Controlled dead-code deletion (separate commit)
- Delete the 4 zero-importer modules, `tests_old/`, root PNG debris. One commit, nothing else in it. Full regression immediately after.

### WS-0.8 Public deployment on `case.pritus.com`
- After regression green: `redeploy_production` with user-provided domain (meeting Aug 17: Thomas agreed this domain; he maps the subdomain once we hand him the IP from `get_production_status`).
- Note: production domain is user-owned input — confirm exact domain string + admin email before invoking.

### Build 0 exit gate
1. `procmgr` green; preview 200; infra_verifier **all PASS**.
2. Reviewer PASS on spec `.drytis/specs/build0-trustworthiness.md` (write spec before coding).
3. Tester browser PASS on: Settings BS test button, device-mode labels, evidence badges, error/retry states.
4. Full regression: **46 suites, 0 failures** (plus new suites).
5. Performance: no route > 2× baseline; boot time measured before/after.
6. Publish only when user confirms.

---

## 3. BUILD 1 (P1) — Product Completeness

**Goal:** Qase becomes the comprehensive, integrable QA platform the Aug 17 meeting requires. **Stop rule:** no P2 items.

### WS-1.1 Universal security checks in every normal run
- Session-token-in-localStorage, mixed content, missing security headers, exposed secrets, http-only cookie flags, CORS posture — run in the standard mission loop, not only the compliance module (Thomas's explicit directive).
- Findings flow through existing Phase 16 classification (category `security`) — no new pipeline.

### WS-1.2 A–Z testing checklist
- Master checklist doc → capability registry entries → checklist coverage surfaced per mission ("checked 41 of 68 categories").
- Explicitly counters the "current checklist = 4–5% of what it should be" finding. Sourced from OWASP, WCAG, common web-app heuristics + existing 20-category taxonomy.

### WS-1.3 Configurable regression (WHAT / WHEN / WHERE)
- **WHAT:** login / payment / API / workflow / feature (any test case or workflow as regression set member).
- **WHEN:** 5min / 15min / hourly / daily / after-deploy / on-demand.
- **WHERE:** browser / device / environment.
- Reuse: existing `scheduler.js`, `regressionStore.js`, `workflows.js`, replay engine. No new execution engine.
- UI: regression set builder + schedule editor + history.

### WS-1.4 OpenAPI 3.1 specification
- Machine-readable spec for all ~151 routes: auth schemes (JWT + QASE_API_TOKEN), schemas, error envelopes, examples.
- Served at `/api/openapi.json`; Postman-importable collection generated; `/docs/api` viewer.
- Foundation for Studio integration, external consumers, MCP readiness.
- Additive route contract check in CI so spec can't drift.

### WS-1.5 Store pruning & performance
- Retention policy for evidence-graph (26MB), sessions (11MB), missions: compact-on-write or scheduled prune (keep N recent + all finding-referenced evidence).
- Acceptance: stores bounded; no evidence referenced by a finding or fix-validation ever pruned; boot time under budget.

### WS-1.6 CASE → Studio data contract
- Decide payload (checklists / Trello-style cards / columns) — needs team/user decision, then implement read endpoints (`/api/v1/integration/...`) documented in the OpenAPI spec.

### Build 1 exit gate
Same full gate as Build 0. Additionally: OpenAPI spec validates, Postman import works, regression schedules survive restart.

---

## 4. BUILD 2 (P2) — Expansion (only after B0+B1 verified stable)

| Feature | Shape |
|---|---|
| Multi-LLM benchmark | Same public PRD → builds from GLM/Kimi/Grok/Llama/Codex/Cursor/Lovable/Replit → Qase evaluates each (bugs, confirmed, FP, security, UX, a11y, perf, coverage, time, cost). Publishable benchmark table. Reuses Phase 16/17 scoring engines. |
| Founder Mode | Separate output stream (not QA findings): marketing, SEO, competitors/comps, pricing comparison, backlink opportunities. Uses existing recommendation engine pattern. |
| Load/performance testing | Bounded load profiles against target apps; results as findings in existing pipeline. |
| MCP readiness → server | OpenAPI (B1) makes this tractable; MCP server exposing Qase capabilities as tools. |
| UX sweep on real devices | Extend uxSweep beyond local-Chromium viewports once BS device path is proven in B0 — honest device-level UX/quality scores. |

---

## 5. Sequencing & Dependencies

```
B0.WS-0.1 (BS validation + config authority)
   └─► WS-0.2 (provider stamping, strict mode)
         └─► WS-0.3 (real device path)  ──┐
               └─► WS-0.4 (env metadata) ─┼─► WS-0.5 (evidence visibility)
                                           │
WS-0.6 (UI cleanup)  ── independent, can interleave after WS-0.2
WS-0.7 (dead-code commit) ── any time after WS-0.2, standalone
WS-0.8 (case.pritus.com deploy) ── last, after full gate
```
- Every change to `replay.js` or the mission loop → re-run phase16/17/18 suites immediately.
- B1 WS-1.1 (universal security) can start only after B0 exit gate.
- B1 WS-1.3 depends on nothing in B0 except truthful execution stamps (WS-0.2).

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `launchBrowser()` return-shape change breaks Phase 18 executor | Additive-only shape; immediate phase18 suite re-run; keep old fields |
| Config flip-flop resurfaces | WS-0.1 acceptance test: restart-persistence test is mandatory |
| Real BrowserStack credentials still junk (`tRuEje` placeholders) | User enters real creds via Settings; strict mode means junk creds = visible failure, never fake success |
| Container-pause fs corruption (3 incidents so far) | Commit after every workstream; publish at build end; keep `.drytis/backup-*` habit |
| Scope creep into P1 during P0 | Stop rule enforced; every PR-sized change gets its own test first |
| Session-loop instability from device wiring | Device wiring behind feature flag until E2E green; mission loop untouched when flag off |
| OpenAPI drift after B1 | Contract test in regression loop |

---

## 7. Definition of Done (per build)

1. Spec written first at `.drytis/specs/<build>.md` with checkbox acceptance criteria.
2. Unit + integration tests written before/with implementation; new suites added to regression loop.
3. Infra gate: procmgr green, preview 200, env keys via backend only, no dev processes, Caddy root proxy, **infra_verifier all-PASS**.
4. Reviewer PASS; Tester browser PASS (visible changes).
5. Full regression **46+ suites, 0 failures**.
6. Performance measured and within budget.
7. Report doc (`docs/<BUILD>_REPORT.md`) with objective evidence.
8. User confirmation before publish and before any production deploy.
