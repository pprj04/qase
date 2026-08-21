# Demo Day Build — Final Report

**Date:** 2026-08-14
**Scope:** UI, evidence & stability polish on the existing QASE product. No architecture changes, no Drytis integration, no second execution engine, no fake data. Phases 15/16 remain PASS/FROZEN.

---

## What Was Already Working (verified, not changed)

- **Runs page shell** — 3-pane layout, run list, SSE live updates, thinking strip, browser viewer.
- **Finding cards** — `renderFinding()` already renders title, severity badge, category, URL, timestamp, steps-to-reproduce, Expected/Actual/Observed/Recommendation/Impact, Confidence/Reproducibility badges, evidence text, Copy-as-ticket.
- **Report tab** — verdict banner, severity stats, Summary/Covered/Recommendations, mission summary bar (TYPE/QUALITY/RELEASE/CONFIDENCE/ANOMALIES/GAPS) restoring from persisted pipeline summary (Phase 15 work).
- **Application Analysis tab** — knowledge signals, stop decision, validation loop, evidence-graph stats, app understanding, workflow sections (Phase 13/14 data).
- **Workflows page** — captured browser-action timeline with step icons, per-workflow expansion, Gen Tests.
- **Bugs page** — rich detail modal with evidence text, dev intelligence, comments, status workflow.
- **Settings** — all fields verified working in Phase 15 Step 10; secrets never sent to browser (`hasApiKey`/`hasApiToken`/`hasBrowserstackKey` placeholders). BrowserStack: endpoint reachable, invalid creds rejected with graceful local-Chromium fallback (Phase 15 Step 11).
- **Evidence graph** — 27,773 evidence items / 1,360 observations / 9,611 links; types: `step_outcome` (26,968), `finding_detail` (755), `console` (50). v1 integration API (`/api/v1/missions/:id/findings/:fid/evidence-chain`) already returns typed evidence + verification status + assessment.

## Root-Cause Findings (audit before changes)

1. **Session findings were INVISIBLE on the Runs page.** `renderFindings()` rendered rich cards into `#findings-list`, a permanently `hidden` container (index.html — legacy from when tabs moved to dedicated pages). Findings appeared only as live toasts and as REPORT-tab aggregates. This was the single biggest demo-day gap.
2. **Dashboard tier had NO evidence API.** All evidence endpoints were v1/integration-only (Bearer/JWT). The dashboard UI could never show typed evidence.
3. **`/api/sessions/:id/workflow` returned HTTP 500** for sessions whose saved workflows lacked a `steps` array (`TypeError: Cannot read properties of undefined (reading 'length')` at workflows.js:366) — surfaced as console errors when switching runs.
4. **Settings API-token input lost its `<label>`** (unclosed tag upstream) — rendered orphaned.
5. **`maxTurns=500` / `concurrentRuns=20`** had drifted from the documented baseline (30/3), making missions run 6–10 minutes and the phase9.2 E2E test time out while leaving orphan missions running.

## What Was Changed Today

### Backend (smallest compatible fixes — connects existing APIs, no duplicate storage)

| Change | File | Why |
|---|---|---|
| `GET /api/findings/:id/evidence` — typed evidence for one finding via the SAME evidence graph the v1 API uses (`getFindingEvidence`) | server/index.js | Lets the dashboard show typed evidence without a new storage layer |
| `GET /api/sessions/:id/mission` — latest mission linked to a session (mission→session is one-directional) | server/index.js | Dashboard reaches mission context (Revalidate) from a session |
| `stepCount: (wf.steps ?? []).length` | server/workflows.js | Fixes the 500 on sessions with legacy workflow records |

### Frontend

| Change | File | Why |
|---|---|---|
| New FINDINGS tab between EVIDENCE and REPORT; findings render into visible `#findings-tab-list` | public/index.html, public/shared.js | Fixes invisible session findings |
| `[View Evidence]` toggle on each finding card → lazy-loads typed evidence rows (type chips: Browser action / Step outcome / Console / Network / Finding detail / Screenshot, observation text, payload, target, timestamp) with loading / retry / "No typed evidence" states | public/app.js, public/styles.css | Evidence visibility (Step 1) — only evidence QASE actually produced; no fabricated screenshots |
| `[Revalidate]` button on finding cards when a mission is linked → `POST /api/v1/missions/:id/revalidate` (same-origin cookie auth) | public/app.js | Demo-safe re-run of the existing validation loop |
| `RUN COMPLETED` / `RUN FAILED` states in the exec stats bar (done / error / interrupted) | public/app.js, public/styles.css | Obvious terminal state (Step 4) |
| Settings API-token section restored with proper `<label class="field">` + section title | public/index.html | Fix orphaned input |
| Config baseline restored: `maxTurns=30`, `concurrentRuns=3` | via PUT /api/config | Missions back to ~4 min; test suite stable |

### Test fix (real timeout, not weakened assertions)

- `tests/phase9.2-revalidate-e2e.test.js`: describe timeout 120s → 480s, E2E-3 poll budget 90×2s → 210×2s (measured clean mission = 233s at baseline config), and added an `after()` cleanup that stops the mission if the suite fails/cancels — previously it left orphan agents consuming LLM turns and poisoning subsequent runs. **Assertions unchanged.**

## Real E2E Mission Result (Step 8)

Mission `03184531` — ContactVault CRM (`http://localhost:9906`), correlationId `demo-day-e2e`:

- **Duration:** 615s, 58 activities, 45 captured steps, 10 todos (6 completed)
- **Findings:** 5 total — 2 critical (`No login route or authentication exists`, `Created contacts are lost on page reload — no data persistence`), 2 medium (invalid-email accepted, no delete confirmation), 1 low (pluralization) — all with steps, Expected/Actual, evidence text, reproducibility=confirmed
- **Quality:** score 15/100, verdict `fail`, releaseReady `false`
- **Evidence:** 54 graph items for the mission; 5 linked to the login finding (status `partially_verified`), 4 to the persistence finding; assessment confidence 1.0 / risk high

## Refresh Verification (Steps 8/10)

Full page reload → same session re-selected from run list → identical 5 findings in the same 4 category groups; expanded finding detail and `[View Evidence]` (4 typed rows) intact. **Zero console errors** across the whole journey including reload.

## Browser Verification (tester sub-agent, preview URL)

- Round 1 (FINDINGS tab): 6/7 PASS — tab renders grouped cards (24-findings run: AUTHENTICATION/NAVIGATION/CONTENT/LAYOUT/MISSING_FEATURE groups), severity badges, expand-on-click, View Evidence rows with Step-outcome + Finding-detail chips, "No typed evidence" empty message, summary bar values. 1 FAIL found → **fixed** (workflow 500).
- Round 2 (final demo check): **9/9 PASS** — full demo journey verified on the demo mission run: exec stats (`09:56 · 1 page · 45 actions · 5 findings · 2 critical · ✕ RUN FAILED`), 58-entry reasoning log, 6/10 test plan, 5 grouped findings with full detail + all three buttons, typed evidence rows, populated analysis sections (knowledge/decision/loop/evidence-graph/understanding), report metrics, refresh persistence, 0 console errors.

## Regression Result (Step 9)

`node --test tests/` → **780 tests / 212 suites / 779 pass / 1 fail / 0 cancelled**

- The 1 failure = **RL-2** (session count > prune threshold) — pre-existing (RL-1/RL-2 documented in Phase 15 as artifacts of extensive multi-phase mission testing).
- The phase9.2 suite that failed during the first run now passes 8/8 in isolation after the timeout fix + config restore.
- No test assertions were weakened.

## BrowserStack (Step 6 — verified, not rebuilt)

Settings UI unchanged. State remains truthful: cloud endpoint reachable, no credentials stored → runs use local Chromium (graceful fallback verified in Phase 15). No credential exposure in the UI.

## Remaining Known Issues (documented, not demo blockers)

1. **RL-1/RL-2 pre-existing failures** — sessions.json size/count from months of mission testing. Cosmetic for the demo; pruning happens at restart.
2. **`interrupted` demo run** — the demo mission's session shows `interrupted` (finalizer raced a server restart during the session's tail), so its REPORT tab shows `—` values; the DECISION is visible in APPLICATION_ANALYSIS → Stop Decision (STOP_BLOCKED, 64%). Mission-level data (quality 15, verdict fail, 5 findings) is complete.
3. **Run list reorders live** while missions run — re-select by the findings badge if it shifts mid-demo.
4. Evidence types present in production data: `step_outcome`, `finding_detail`, `console` (+ workflow step evidence). Screenshots exist as frame captures in the reasoning log, not as evidence-graph items — the UI only lists types that actually exist.

## Verdict

**Demo-ready.** The complete story — UNDERSTAND → EXPLORE → TEST → EVIDENCE → FINDINGS → QUALITY → DECISION — is presentable with real data, survives refresh, and has zero console errors. All changes were small, additive, and confined to: server/index.js (2 read-only routes), server/workflows.js (1 null-guard), public/index.html, public/app.js, public/shared.js, public/styles.css, and 1 test-file timeout/cleanup fix.
