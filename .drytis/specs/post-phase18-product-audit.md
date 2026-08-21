# BUILD 18.5 — POST-PHASE-18 COMPLETE PRODUCT AUDIT & REMAINING WORK MAP

Audit date: 2026-08-20 · Mode: AUDIT ONLY (no feature changes) · Baseline: Phases 1–18 verified; builds 18.1–18.4 PASS; regression baseline 46 suites / 1,075 pass / 0 fail.

> Method note: every claim below was verified in code (`server/`, `public/`, `tests/`, `scripts/`, `.qase/`) and, where applicable, against the running application (`http://localhost:5173` + live API calls). No claim rests on documentation alone. No credential values are printed — only SET/EMPTY/VALID/INVALID status. No source files were modified in this build.

---

## 1. Executive summary

The Qase platform is **functionally deep and internally consistent**: an autonomous QA agent (mission architecture, real-browser execution, evidence graph, finding intelligence, fix validation with a deterministic status engine, UX/quality assessment, scheduled regression) with 152 routes, 46 test suites / 1,075 passing tests, and a live UI that has survived three major restructures without losing backend capability.

The product's **core honesty gap** is concentrated in exactly two areas, both already known and both unimplemented by explicit scope discipline:

1. **BrowserStack** — wired for replay/test-case execution only, never credential-validated, silently falls back to local Chromium, and stamps no `executedOn` metadata. A user can believe they tested Safari-on-BrowserStack while local headless Chromium ran.
2. **Mobile** — a *real* emulation engine exists (UA/DPR/isMobile/hasTouch from Playwright device descriptors via `applyDeviceContext`) but **no entry point passes a device into a session**: mission create ignores `device`, all 4 `createSession()` call sites pass no options. What users actually get from "mobile" today is `set_viewport` (375×667 CSS resize on desktop Chromium) and the UX sweep's 3-viewport pass.

Everything else — the 50+ capability inventory below — is complete, partial in honest ways, or deliberately deferred. Dead code (~1,570 lines of server modules + 14 dead UI ids + `tests_old/`) is confirmed unused and safe to remove in a cleanup commit. Data hygiene is the other real debt: 210MB of stores with 83% orphaned fix-validation runs, 1,742 zombie `created` missions, 109MB artifacts, and 3 corrupt JSON files from past container-pause corruption incidents.

**Recommended next build: B0 Trustworthiness (BrowserStack truth + device wiring)** — it converts the two dishonest paths into honest ones and unblocks the Aug-17 meeting mandates (149-browser-version testing was done manually on BrowserStack that Friday; Qase should do it autonomously).

---

## 2. Current architecture (verified)

```
server/index.js        ~4,700 lines, 118 routes — sessions, missions, findings, workflows,
                       test-cases, suites, schedules, regression, config, artifacts, SSE
server/phaseRouter.js  36 additive Phase 16/17/18 routes (mounted before legacy /:id routes)
Engines:  agent.js (mission loop, LLM @cleanslate/sdk) · replay.js (test-case execution, only
          BrowserStack call site) · validationExecutorCore.js (fix validation) ·
          fixStatusEngine.js (deterministic status) · findingIntelligence.js (20-category
          classification) · uxSweep/uxChecks/uxModel/qualityAssessment/featureGapValidation ·
          scheduler.js (cron, 60s tick) · evidenceGraph.js · knowledge.js (123 entries)
Stores:   .qase/*.json — 17 files, 210MB total; artifacts/ 109MB (2,141 run dirs, 1,541 traces,
          1,396 screenshots; NO video recording)
UI:      public/ — hash router (5 pages: runs/tests/workflows/schedules/bugs) + settings modal
Tests:   tests/ 46 suites · scripts/ 7 (regression loop, benchmarks, bench servers 9901–9907)
Auth:    QASE_API_TOKEN bearer OR same-origin HttpOnly qase_token cookie; mutation routes
         behind requireApiToken; no per-route role/workspace model (single-tenant effective)
```

Frozen invariants (verified intact): fixStatusEngine determinism (LLM never picks final status), immutable `originalFinding` snapshots, Phase 16 classification/lifecycle transitions, phaseRouter contract, mission loop shape.

## 3. Master feature inventory (50+ capabilities)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Authentication (token + cookie) | ✅ COMPLETE & VERIFIED | `requireApiToken`, `qase_token` HttpOnly SameSite=Strict; 401s verified across phase18-api |
| 2 | Projects (multi-target) | ✅ COMPLETE & VERIFIED | projects.js, 2 projects, projectId scoping on list endpoints |
| 3 | Missions (create/iterate/stop/loop) | ✅ COMPLETE & VERIFIED | 1,884 missions; v1 lifecycle routes + loop-status in pipeline.js UI |
| 4 | Test generation (workflow→tests) | ✅ COMPLETE & VERIFIED | `/api/workflows/:id/generate-tests`; auto-gen setting |
| 5 | Test cases (CRUD/clone/tags/suites) | ✅ COMPLETE & VERIFIED | suites + test-cases stores, editor UI, export |
| 6 | Test execution (replay engine) | ✅ COMPLETE & VERIFIED | replay.js: assertions incl. visual_match, self-heal, traces+screenshots |
| 7 | Autonomous execution (agent loop) | ✅ COMPLETE & VERIFIED | agent.js; 78 completed missions incl. real 8h/12h runs |
| 8 | Browser execution (local Chromium) | ✅ COMPLETE & VERIFIED | browserBridge.js live cursor; frame SSE |
| 9 | **BrowserStack** | 🔴 **PARTIAL / DISHONEST** | See §8 — replay-only, silent fallback, no validation, no metadata |
| 10 | Desktop browser coverage (local) | ✅ COMPLETE & VERIFIED (Chromium only) | Single local engine; cross-browser = BrowserStack gap |
| 11 | **Mobile testing** | 🔴 **NOT REAL MOBILE** | See §9 — engine exists, unreachable; today = viewport resize |
| 12 | Real device execution (cloud) | 🔴 MISSING | No BrowserStack device caps anywhere |
| 13 | Device metadata | 🟡 PARTIAL | deviceContext descriptors complete; findings/evidence carry viewport but `device` rarely populated; no `executedOn` |
| 14 | Live execution view | ✅ COMPLETE & VERIFIED | SSE frames, cursor, device strip (Phase 14/15); stage strip works |
| 15 | Evidence collection | ✅ COMPLETE & VERIFIED | recordEvidence; redactString on everything leaving modules |
| 16 | Evidence graph | ✅ COMPLETE & VERIFIED (growth ⚠️) | 26.4MB / node+link model; Phase 6 + 16 APIs |
| 17 | Screenshots | ✅ COMPLETE & VERIFIED | Failure screenshots persisted + served; 18.4 UI strip/overlay |
| 18 | Video | 🔴 MISSING (traces ✅) | No recordVideo anywhere; 1,541 trace.zip exist; Playwright traces ARE viewable — position as "trace-based replay" |
| 19 | Findings (CRUD/board/filters) | ✅ COMPLETE & VERIFIED | 1,892 findings; bugs page board + severity lanes |
| 20 | Finding intelligence (Phase 16) | ✅ COMPLETE & VERIFIED | 20 categories, lifecycle, dedupe (never auto-merge), quality score, review |
| 21 | Bug classification | ✅ COMPLETE & VERIFIED | primaryCategory distribution: FUNCTIONAL 294, AUTHENTICATION 386, NAVIGATION 205, UX 150… |
| 22 | Severity | ✅ COMPLETE & VERIFIED | critical 694 / high 585 / medium 514 / low 91 / info 8; CRITICAL/HIGH require multi-source evidence |
| 23 | Security testing | 🟡 PARTIAL | No dedicated checks; only SECURITY category classification (3 findings), keyword-driven + mission type 'security' prompt focus. See §11 |
| 24 | Compliance testing | 🟡 PARTIAL | Same as 23 — GDPR/PCI keywords classify; NO executable compliance checks. See §10 |
| 25 | Accessibility | ✅ COMPLETE & VERIFIED | 8 a11y checks (alt, names, lang, tabindex, headings, zoom, landmarks, focus order) + mission type |
| 26 | UX testing | ✅ COMPLETE & VERIFIED | Phase 17: 7 dimensions, friction model, sweep 12pg×3vp deterministic, benchmark recall/precision 1.0 |
| 27 | Feature-gap detection | ✅ COMPLETE & VERIFIED | featureGapValidation + verified/unverified split |
| 28 | Recommendations | ✅ COMPLETE & VERIFIED | recommendationEngine + /recommendations route + UI panel |
| 29 | Fix validation (Phase 18) | ✅ COMPLETE & VERIFIED | deterministic engine, immutable snapshots, 18.1–18.4 all PASS |
| 30 | Before/after comparison | ✅ COMPLETE & VERIFIED | comparison verdicts + 18.4 structured UI |
| 31 | Validation history | ✅ COMPLETE & VERIFIED | history rows + inline expansion; 246 runs |
| 32 | Regression testing (manual/suite) | ✅ COMPLETE & VERIFIED | runTestSuite, retries, concurrency, flaky detection |
| 33 | Scheduled regression | ✅ COMPLETE & VERIFIED | cron scheduler + runs history + webhooks on failure |
| 34 | Continuous/live monitoring | ⏳ DEFERRED | No watch mode; Phase 21 roadmap item |
| 35 | Benchmarking | ✅ COMPLETE & VERIFIED | Phase 7/16/17/18 benchmarks; P18 all 4 targets met (acc 1.0, false-fixed 0.0, regression-detect 1.0, evidence 1.0) |
| 36 | Multi-LLM benchmarking | ⏳ DEFERRED | Aug-17 mandate; needs multi-provider key handling |
| 37 | Founder Mode | ⏳ DEFERRED | Not started (marketing/SEO/pricing) |
| 38 | **API/OpenAPI** | 🔴 **MISSING** | 152 routes, ZERO spec/schemas; only markdown contracts. See §14 |
| 39 | CASE → Studio integration | ⏳ DEFERRED | Only `/api/v1/webhooks` outbound; no inbound Studio contract |
| 40 | MCP readiness | ⏳ DEFERRED | No MCP refs in code; docs say "good enough" — but requires OpenAPI first |
| 41 | Public deployment | 🟡 PARTIAL | Live at qase.drytis.com (deployment 129, healthy); case.pritus.com NOT deployed (needs redeploy + DNS, Thomas waiting for IP) |
| 42 | Settings (LLM, runs, automation, self-heal) | ✅ COMPLETE & VERIFIED | config.js merge env>stored>defaults; UI complete |
| 43 | BrowserStack credential management | 🟡 PARTIAL | Fields exist in Settings UI + config store; secrets never echoed back (placeholder pattern correct). **No Test-Connection for BrowserStack** |
| 44 | Error/loading states | 🟡 PARTIAL | Fix-validation UI has explicit error/empty/loading (18.2/18.4); several list reloads still `.catch(() => [])` silent |
| 45 | UI consistency | 🟡 PARTIAL | 14 dead ids + duplicate `mission-stage-strip` id ×2; leftover FINDINGS-tab orphan (`renderFindings` → hidden `#findings-list`) |
| 46 | Performance | ✅ COMPLETE & VERIFIED | health 1.8ms, sessions 2.0ms, findings 28ms, missions 30ms, grouped 3.9ms — all fast; boot/disk is the pressure (210MB stores) |
| 47 | Data persistence | ✅ COMPLETE & VERIFIED | 17 JSON stores survive restarts (verified across multiple container restarts this session) |
| 48 | Data cleanup/pruning | 🔴 MISSING | sessions capped at 50 via pruneOldSessions; everything else grows unbounded |
| 49 | Reporting | ✅ COMPLETE & VERIFIED | report.md per session, dev-report, dev-intelligence, markdown bulk export |
| 50 | Export/share | 🟡 PARTIAL | findings markdown/json export, test-cases export, report.md; no share links, no PDF |
| 51 | CI/CD webhooks | ✅ COMPLETE & VERIFIED | failure webhooks fire-and-forget from scheduler |
| 52 | Self-healing selectors | ✅ COMPLETE & VERIFIED | threshold-configurable; used by replay + validation executor |
| 53 | Multi-viewport exploration | ✅ COMPLETE & VERIFIED | set_viewport presets + viewportsExplored tracking + responsive checks |
| 54 | Credential vault (session secrets) | ✅ COMPLETE & VERIFIED | secretNames only persisted, values in-memory |

## 4–7. Consolidated status lists

**Completed (verified):** items 1–8, 14–22, 25–33, 35, 42, 46–47, 49, 51–54 above — the QA core is production-grade for single-tenant local-Chromium use.

**Partial:** BrowserStack (9), device metadata (13), security testing (23), compliance (24), live deployment domain (41), BS credential mgmt (43), error states (44), UI consistency (45), export/share (50).

**Missing:** real-device execution (12), video (18), OpenAPI (38), Studio integration (39), MCP (40), data pruning (48), continuous monitoring (34), multi-LLM benchmark (36), Founder Mode (37).

**Broken/incorrect (behavioral honesty, not crashes):** BrowserStack silent fallback; viewport-resize presented as mobile-capable; no `executedOn` stamping (requested browser vs executed browser indistinguishable in results).

**Dead/orphaned:** see §20.

## 8. BrowserStack status (STEP 3 — the priority audit)

| Question | Answer | Evidence |
|---|---|---|
| Where are credentials stored | `.qase/config.json` (browserstackUser/Key) with `.env` override; merge = env beats stored when set | config.js:52–130, 122 merge order |
| Credentials configured? | User: **SET but placeholder** (6 chars, matches known garbage value); Key: **SET but placeholder** (11 chars incl. comma/quote — the known corrupt `tRuEje,27,&` shape). `.env` ENABLED flag is doubly-quoted `""false""` → parses **false** | Shape-check only; no values printed |
| Does Settings control them | **YES (WIRED)** — enable checkbox, browsers CSV, user, key (password field, blank-keeps-existing, Clear button); saved via PUT /api/config | index.html:673–695, app.js:2020–2028, config.js updateConfig:213/236 |
| Connection testing exists | **NO** — Settings "Test Connection" calls POST /api/config/test → `testConnection()` probes ONLY the LLM `${baseUrl}/models`. Zero BrowserStack code in it | config.js testConnection |
| Connection validation real | **NO** — no CDP probe, no REST auth check (`/automate/sessions.json`), nothing | grep: 0 hits |
| Does BS execution actually start | **CONDITIONALLY** — `launchBrowser()` (replay.js:78–97) connects `wss://cdp.browserstack.com/playwright?caps=…` when enabled+user+key present. Works when creds valid (Aug-17 transcript: 149 versions/47 bugs tested manually via this path's pattern) | replay.js |
| CDP works | **WAS VALIDATED** in earlier sessions (real CDP sessions ran) then broken creds + ENABLED=false today → currently **FAILED-by-config**, not by code | history |
| Execution metadata identifies BS | **NO** — `launchBrowser()` returns just `browser`; no `executedOn: 'browserstack'` returned, stored, or displayed. Run rows show requested `browser` (chromium/chrome/…) only | replay.js:94 single return |
| Silent fallback to local | **YES — CONFIRMED** — `console.warn('[BrowserStack] CDP connection failed, falling back to local')` then local launch. User sees normal results; nothing in UI/run data says local ran instead | replay.js:96 |
| Strict mode exists | **NO** | — |
| Errors clearly shown | **NO** — server console.warn only | — |
| Scope of wiring | replay/test-case execution + multi-browser loop (`runTestSuite` browsers list) ONLY. Missions/agent (browserBridge), UX sweep, fix-validation viewport context: all local Chromium, zero BS references | grep browserstack: replay.js, config.js only |

**Verdict: BrowserStack = 🟡 WIRED (narrow), NOT VALIDATED, NOT HONEST (silent fallback + no execution provenance).** Fix design already specced in docs/BUILD_PLAN.md WS-0.1/0.2 — not implemented per scope discipline.

## 9. Mobile testing status (STEP 4)

**Direct answer: CASE is currently only resizing a desktop browser. 🔴 NOT REAL MOBILE TESTING (as shipped).**

The nuance the audit establishes:

- A **complete real-emulation engine exists and is tested**: `deviceContext.js` (iPhone 13–15 Pro/Pro Max/SE, Pixel/Nexus profiles → Playwright descriptors) + `agent.js:218–310` `applyDeviceContext()` swaps the SDK's desktop context for the real device context (viewport, **userAgent, deviceScaleFactor, isMobile, hasTouch**), re-navigating to the remembered URL. `tests/device-context.test.js` covers descriptor mapping and `createSession(deviceRequest)`.
- **But it is unreachable from every real entry point**: `POST /api/missions` and `POST /api/v1/missions` never read a `device` field (missions.js createMission has none); all four `createSession(title, projectId)` call sites in index.js (1546/1633/1790/1878) pass **no options** → `deviceRequest` always `undefined`. The SSE `device` event and the UI device strip listen correctly — they just never fire from a mission.
- What users see today: `set_viewport` preset `mobile` (375×667) + UX sweep's mobile viewport + `classifyViewport`-based "MOBILE" badge in the live view. The live-view classifier itself is honest (classifies the REAL frame size, Phase 14 design) — but a desktop page resized to 375px can still earn the MOBILE badge because the underlying execution IS a 375×667 desktop Chromium context, and nothing tells the user "this is emulation class VIEWPORT_RESIZE, not a device".
- No UA/DPR/touch context in mission sessions; findings record `viewport` but `device` is null in practice; evidence has no environment block; BrowserStack mobile devices: zero code.

**Required for honest mobile (per BUILD_PLAN WS-0.3, not implemented):** pass device through mission/session create; taxonomy VIEWPORT_RESIZE / EMULATION / REAL_DEVICE stamped on runs+findings+evidence; live strip shows emulation class; BS device caps for REAL_DEVICE.

## 10. Compliance status (STEP 5)

**COMPLIANCE CURRENTLY COVERED:** classification only — findingIntelligence keywords (gdpr, cookie consent, privacy policy, ToS, hipaa, pci) map to COMPLIANCE category; mission type list has no 'compliance'; uxChecks has `a11y_*` (WCAG-adjacent) but zero compliance checks; no consent-banner detection, no cookie scanning, no policy-link validation, no data-retention checks.

**COMPLIANCE MISSING (proposed gaps, not implemented):** cookie/consent banner presence + mechanism; privacy-policy link discoverability; tracking-script inventory (3rd-party domains); Do-Not-Track/GPC honor check; PII field inventory in forms; data-export/delete affordances (GDPR Art. 15/17 UX); WCAG 2.1 AA consolidated report (currently 8 scattered a11y checks); PCI: no card-field handling checks. All marked PROPOSED — none exist in code.

## 11. Security status (STEP 5)

**SECURITY CURRENTLY COVERED (executable):**
- `form_password_handling` (uxChecks): password-field autocomplete hygiene — the only DOM-level security-adjacent check that runs normally.
- Console/network collectors during every replay/mission → mixed-content, `https` downgrade, exposed-stack findings possible via SECURITY classification.
- Phase 16 SECURITY category rules: evidence gate requires console/network/api_response/dom proof; severity rules can raise security findings.
- Finding redaction (`redactString`) across evidence; secrets vault never persists values; artifact route path-traversal-guarded; HttpOnly SameSite=Strict cookie.

**SECURITY MISSING (proposed gaps):**
- No session-token-in-localStorage check (the exact Aug-17 example) — nothing inspects storage keys for token-shaped values.
- No authz checks (IDOR probing), no auth-flow checks (logout actually invalidates), no sensitive-data exposure scans (PII in DOM/responses), no API security (missing auth on endpoints, verb tampering, mass assignment), no common-web checks (headers: CSP/X-Frame/Referrer/HSTS; clickjacking; open redirects; mixed content as a *targeted* check rather than incidental console observation).
- Security checks do NOT run in every normal run — they exist only as a mission-type focus prompt + classification keywords.
- Qase's OWN API: GET routes (findings, missions, config read) are token/cookie-gated uniformly; no per-route roles (single-tenant OK, multi-tenant gap).

## 12. A-to-Z testing checklist (STEP 6 — capability map, not yet a runtime checklist)

| Cat | Existing capability | Impl? | Tested? | Missing coverage | Priority |
|---|---|---|---|---|---|
| A Functional | Mission-driven exploratory + workflow tests | ✅ | ✅ | — | — |
| B UI | UI/ VISUAL categories, visual_match baselines | ✅ | ✅ | cross-browser rendering | P1 (BS) |
| C UX | Phase 17 7-dimension model + friction | ✅ | ✅ | device-honest UX (sweep is desktop-Chromium viewports only) | P1 |
| D Accessibility | 8 a11y checks + mission type | ✅ | ✅ | consolidated WCAG 2.1 AA report, keyboard-nav depth, contrast | P2 |
| E Authentication | Credential vault, login flows in missions | ✅ | ✅ | logout invalidation, session expiry, password rules | P1 |
| F Authorization | — | 🔴 | — | IDOR, role escalation, tenant isolation | P1 |
| G Security | Classification + incidental console/net | 🟡 | partial | See §11 list (storage tokens, headers, redirects, API) | **P0** (Aug-17 mandate: every normal run) |
| H Privacy | Compliance keywords only | 🟡 | — | cookie/consent/tracker inventory, PII scan | P2 |
| I API | API category + network collectors | 🟡 | ✅ | schema validation, error contracts, auth on every endpoint, rate limits | P1 |
| J Data | data-persistence category, reload checks | ✅ | ✅ | data integrity across workflows, export/round-trip | P2 |
| K Browser compat | Local Chromium only | 🟡 | ✅ | Firefox/Safari/Edge matrices → blocked on BrowserStack P0 | **P0** |
| L Mobile | Viewport resize only | 🟡 | ✅ | real emulation (engine exists, unwired) + real devices | **P0** |
| M Performance | PERF category (incidental) | 🟡 | — | load timing budgets, resource weight, deliberate perf checks | P2 |
| N Reliability | Watchdog, retries, self-heal, closure recovery | ✅ | ✅ | chaos/failure injection breadth (phase1 covers basics) | P2 |
| O Regression | Suites + cron schedules + webhooks | ✅ | ✅ | user-configurable WHAT/WHEN/WHERE scopes | P1 |
| P Compliance | Keywords only | 🟡 | — | §10 list | P2 |
| Q AI/LLM behavior | Model routing, reasoning levels, budget caps | ✅ | ✅ | multi-LLM same-PRD benchmark, cost/variance tracking | P1 (Aug-17) |
| R Error handling | Error categories + error_experience UX check | ✅ | ✅ | — | — |
| S Integration | Outbound webhooks only | 🟡 | — | Studio inbound contract, MCP, Postman/OpenAPI | P1 |
| T Deployment | qase.drytis.com healthy | 🟡 | ✅ | case.pritus.com + DNS + load testing | P1 |
| U Evidence | Evidence graph + artifacts + 18.4 UI | ✅ | ✅ | environment/executedOn stamping | **P0** |
| V Reporting | report.md, dev-report, bulk markdown | ✅ | ✅ | share links, scheduled digests | P2 |

The A-to-Z **runtime checklist product** (Thomas's "checklist covers 4–5%" complaint → full coverage matrix a mission can execute against) does not exist as a feature — this table is the audit's capability mapping toward it. Not implemented per stop rule.

## 13. Regression testing status (STEP 7)

**Exists and verified:** suites CRUD; run-ad-hoc (single or suite, with credentials, concurrency, retries, flaky classification); cron schedules (`validateCron`, 60s tick, nextRun scheduling, enable/disable, lastRun summaries); run history + trend API (`/api/regression/runs`, `/trend`); failure webhooks; run artifacts (traces/screenshots per run); self-heal; UI pages for tests + schedules; persistence across restart (verified).

**"Check login every 5 minutes" — CAN a user configure it today?**
`*/5 * * * *` cron IS expressible and the scheduler WOULD fire it. **But:** (a) the schedule UI surfaces a default-cron text field and the schedule model targets `targetUrl` + `testCaseIds` — there is no WHAT-filter concept ("just the login test"), so the user must manually curate testCaseIds; (b) no WHEN presets (5m/15m/hourly/daily/post-deploy/on-demand); (c) no WHERE dimension (browser/device/env per schedule — schedules run local Chromium always); (d) no "after deploy" trigger (no deploy hook); (e) no failure-notification routing beyond single webhook URL; (f) no live monitoring mode. **Verdict: 🟡 PARTIAL — engine complete, user-facing scoping/frequency UX + trigger types missing** (BUILD_PLAN B1 item 3).

## 14. OpenAPI + integration status (STEP 8)

- **Total routes: 152** (index.js 118 incl. SSE events + demo mount; phaseRouter 36).
- **Documented: ~15** via two markdown contracts (phase-11-integration-contract.md, phase-16 addendum) + scattered phase reports. **Undocumented: ~137.**
- **OpenAPI spec: NONE.** No openapi/swagger files; no request/response schemas anywhere machine-readable; auth documented only in prose (bearer or cookie).
- **Postman usability: NOT READY** without the spec.
- **Studio integration: outbound webhooks only** (`/api/v1/webhooks` registers URLs; scheduler notifies on failure). No inbound contract, no checklists/cards payload, no auth handshake. Aug-17 model (data via endpoints, Trello-style cards) = greenfield.
- **MCP readiness: blocked on OpenAPI** (tools need typed contracts). Docs claim "good enough" — code has zero MCP surface.

## 15–17. Studio / MCP / deployment

Covered in §14 and item 41/39/40 of the inventory. Deployment: healthy at qase.drytis.com (verified 200); case.pritus.com requires user-provided domain redeploy — flagged P1-end.

## 18. UI issues (STEP 9 — verified this session)

1. **Dead ids (14):** overlay, tabs, tab-thinking/analysis/evidence/report, exec-stats-steps/pages/findings/dur, tests-sidebar, testcases-toolbar, dev-intel-actions-bar, uxq-filters — zero JS references each (grep-verified).
2. **Duplicate id:** `mission-stage-strip` ×2 (index.html:153, 200).
3. **Orphaned FINDINGS feature (Phase-15 removal):** `renderFindings()` still fetches session findings into hidden `#findings-list` on every detail load — dead work; open decision restore-tab vs delete (BUILD_PLAN WS-0.6 default: restore).
4. **Silent data failures:** several list loaders `.catch(() => [])` — network error indistinguishable from empty (P0 item).
5. **Settings:** BrowserStack section exists but no credential validation feedback; "Test Connection" only covers LLM — misleading labeling (P0).
6. Backend-without-UI: missions iterate/loop endpoints only surface via pipeline panel; `/api/knowledge` + knowledge-stats have NO UI at all; evidence-graph APIs (v1/evidence/*) UI is the 18.4 finding-adjacent views only; webhooks have no management UI (store only).
7. Empty/loading states: good in fix-validation + bugs pages; runs page relies on spinner-only in places.
8. Mobile-execution UI honesty: device strip exists but shows MOBILE for viewport-resized desktop (§9).

## 19. Data issues

| Issue | Scale | Risk |
|---|---|---|
| Unbounded store growth | evidence-graph 26.4MB, sessions 12.2MB, missions 5.8MB (1,884), findings 5.1MB (1,892), fix-validations 1.7MB (246) | Boot time, memory, pause-resume corruption surface |
| **Orphaned fix-validation runs** | **205/246 (83%)** reference findings that no longer exist | 18.4 UI safe (finding-first entry), store hygiene needed |
| Zombie missions | 1,742 status=created (never run) — benchmark debris | Misleading counters |
| Artifacts | 109MB / 2,141 run dirs; many from deleted runs | Disk pressure |
| Corrupt JSON (container-pause incidents) | `.drytis/benchmark-state.json` (also a zero-byte DIR), `findings-recovered.json`, `phase18-benchmark-results.json` (539B binary garbage; authoritative P18 results live in docs/PHASE_18_REPORT.md) | Cosmetic; regenerate-on-next-run for benchmark files |
| Root debris | 55 PNGs, 2 zips, tar.gz, transcripts at /workspace root (gitignored) | Housekeeping |
| Session cap | 50 (pruneOldSessions) — only bounded store | — |

## 20. Dead code (STEP 10 — delete NOTHING this build)

| Candidate | Verified | Classification |
|---|---|---|
| server/authorization.js (7.7KB) | 0 importers (server/tests/scripts/public) | **SAFE TO DELETE** (after final pre-delete grep) |
| server/expectedVsObserved.js (31KB) | 0 importers (absorbed by featureGapValidation/uxAssessment) | **SAFE TO DELETE** |
| server/integrationAuth.js (7.3KB) | 0 importers (auth lives inline in index.js) | **SAFE TO DELETE** |
| server/preUnderstanding.js (11KB) | 0 importers | **SAFE TO DELETE** |
| tests_old/ (2 files) | superseded; one fs-corrupt | **SAFE TO DELETE** |
| 14 dead UI ids + duplicate id | grep-verified zero refs | **SAFE TO DELETE** (with duplicate-id dedupe) |
| `.qase-old-corrupted/`, `.qase-test-*`, root PNG/zip debris | gitignored snapshots | **SAFE TO DELETE** (disk reclaim ~30MB+) |
| renderFindings()/`#findings-list` | still executed (hidden) | **SAFE ONLY AFTER DECISION** (restore vs remove — user call) |
| Orphaned validation runs / zombie missions / stale artifacts | data, not code | **SAFE ONLY AFTER REFERENCE CHECK** (purge script + backup) |
| playwright-mcp process, .playwright-mcp/ | platform-provided | **DO NOT DELETE** |
| qase-project.zip/tar.gz | user's own exports | **DO NOT DELETE** (ask user) |

## 21. Production blockers (for public/honest deployment)

1. BrowserStack silent fallback (dishonest results possible) — P0.
2. Viewport-resize-as-mobile labeling — P0.
3. No `executedOn` provenance on any run — P0.
4. No BrowserStack credential validation in Settings — P0.
5. Security checks absent from normal runs (Aug-17 mandate) — P0/P1 boundary.
6. OpenAPI absent (blocks Postman/Studio/MCP) — P1.
7. Store growth + 83% orphaned validation runs — P1 hygiene.
8. case.pritus.com not deployed — P1 (needs user domain action).

## 22. Priorities

**P0 — Trustworthiness (BUILD_PLAN BUILD 0, spec-ready):** BS credential validation (real CDP/auth probe in Settings) · config authority + persistence across restart (the `""false""`/restart flip-flop bug) · `executedOn` stamping · strict no-fallback mode · device wiring into missions (engine exists) · VIEWPORT_RESIZE/EMULATION/REAL_DEVICE taxonomy · environment block on findings/evidence · UI cleanup (dead ids, duplicate id, FINDINGS tab decision, loading/error states, silent-catch removal) · dead-code deletion commit · deploy case.pritus.com.

**P1 — Aug-17 mandates:** universal security checks in every run → A-to-Z checklist feature → configurable regression WHAT/WHEN/WHERE → OpenAPI 3.1 (152 routes) + Postman → store pruning/orphan purge → Studio data contract (needs user decision) → multi-LLM benchmark harness.

**P2:** Founder Mode, MCP server, load testing, compliance check suite, consolidated WCAG report, video recording, share links, case.pritus.com if not done in P0.

## 23. Recommended build order (post-audit)

1. **B0 Trustworthiness** (as specced in docs/BUILD_PLAN.md §2, now updated by this audit's confirmations) — including the two audit refinements: BrowserStack config authority must survive procmgr restart (root-caused: restart re-inits config.json from env with stale/garbage env values) and the FIX-A-class literal-value display convention for any future flag UIs.
2. **B1.1 Universal security checks** (smallest Aug-17-mandate win: storage-token scan + headers + mixed-content as always-on checks).
3. **B1.2 A-to-Z checklist** (depends on security checks existing to schedule them).
4. **B1.3 Configurable regression scopes** (engine complete; UX + trigger types).
5. **B1.4 OpenAPI** (mechanical, 152 routes; unblocks Postman/Studio/MCP).
6. **B1.5 Data hygiene + case.pritus.com deploy.**

**Recommended NEXT BUILD: B0 — Trustworthiness (BrowserStack truth + device wiring + metadata + UI cleanup).**

---

## Appendix A — Regression validation (STEP 11)

Full pass completed in two batches (the first loop's bash job was killed by the terminal session after suite [38] — environment failure, not code):

- Batch 1 (`/tmp/regression-b185.txt`): suites [1]–[38], every line `fail=0 cancel=0` (incl. phase16, phase17, phase18 suites).
- Batch 2 (manual, same env exports): [39] revalidate-e2e 8/0 · [40] revalidation-safety 56/0 · [41] resource-lifecycle-v2 19/0 · [42] reliability 37/0 · [43] parallel-retry 11/0 · [44] artifacts-history 8/0 · [45] closure-browser-recovery 9/0 · [46] workflow-intelligence 45/0.

**TOTAL: 46 suites / 1,075 pass / 0 fail / 0 cancel — ALL CLEAN. Matches the Phase 17/18 baseline exactly.** Triage of the only anomaly (loop process death after [38]): TEST-INFRASTRUCTURE/ENVIRONMENT (terminal job termination), not code — proven by batch 2 completing the same suites green.

## Appendix B — Honesty of this audit

- Claims verified against code this session: route counts, BrowserStack call-site exclusivity, deviceRequest dead-ends, dead-module importers, dead UI ids, store sizes/orphan rates, endpoint latencies, corrupt files.
- Claims from prior verified sessions (not re-proven here): Phase 16/17/18 benchmark target metrics (docs reports), CDP connectivity with valid creds (Aug-17 transcript + earlier session evidence).
- Not verified (no capability exists): OpenAPI, Studio inbound, MCP, video.
