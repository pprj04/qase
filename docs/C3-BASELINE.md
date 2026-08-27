# C3 — Baseline (Phase 0, read-only)

Repo state at baseline: branch `main`, HEAD = `1766bec` (C2, == origin/main), clean tree. C2 suites green at baseline (c2 contract 18/18, close-out failure-modes 10/10; live proofs re-verified this session: live-decision-proof 4/4). C2 final report: `docs/C2-FINAL-REPORT.md`.

---

## 1. Current behavior (verified against source, not docs)

### 1.1 Target classification — where new.drytis.com became "CRM"

- **Classifier:** `inferAppPurpose(inventory, session)` — `server/featureGap.js:510-671`. Scores keyword signals from `PURPOSE_CATALOG` (`server/featureGap.js:356-…`, e.g. `crm` at :359-368 with signals `['crm','lead','pipeline','deal','contact','prospect','opportunity','sales funnel','customer']` :360) against `allText = summary + pages + activities + todos` (:511-516). Per-purpose confidence `min(1.0, matchCount/3)` (:586). Marketing-site override exists (:598-643). No signals → `generic`, confidence 0.3 (:648-659).
- **Final purpose confidence** = `best.confidence × inventory.explorationConfidence` (`featureGap.js:665`), where explorationConfidence has tiers (:295-306): ≥40 steps+6 pages → 1.0 … <5 steps → 0.2.
- **Expected-feature expectations:** `generateExpectedFeatures` (`featureGap.js:686-798`) — per-purpose loop :740-757 emits catalog features with `pf.severity` (:754) and `conf(0.6)` (:755) where `conf = base × purpose.confidence × explorationConfidence` (:698). CRM catalog marks `Contact/company management` **critical** (:363).
- **The failing case (C2 benchmark):** new.drytis.com — shallow exploration (explorationConfidence 0.2-0.4) × weak keyword match (purpose confidence ~0.5) → feature-gap findings at confidence **0.06**, severity **critical**, which flowed into `criticalCount` and drove the (formally correct) STOP_FAIL.

**Classification uncertainty IS computed today** (purpose.confidence, model.confidence.purpose in `appUnderstanding.js` :792-917 via `computeConfidence`, merged by `mergePurposeSources` :694-755) **but nothing downstream gates feature-gap generation on it.** `generateExpectedFeatures` uses whatever purpose was inferred, at any confidence.

### 1.2 Finding creation, confidence, severity

Feature-gap/missing-feature findings (all heuristic paths in `server/featureGap.js`):

| Creation site | Severity | Confidence |
|---|---|---|
| Purpose-catalog features :740-757 | catalog `pf.severity` (CRM contact mgmt = critical) | `conf(0.6)` |
| Auth expectations :703-735 | high (hardcoded) | conf(0.8)/0.75/0.7 |
| Generic expectations :762-794 | medium | conf(0.55)/0.5/0.45 |
| Context-derived (`deriveContextFeatures` :1041-1076) | map-declared | **1.0** ("ground truth — stated intent") |
| Workflow gaps (`analyzeWorkflowGaps` :1482-1554) | template severity | (0.8\|0.6) × purpose × exploration |
| LLM-enhanced (`enhanceGapsWithLLM` :1206-1287) | medium (default :1264) | 0.6 (default :1265) |

- Gap→finding: `gapsToFindings` `featureGap.js:1293-1317` — `severity: gap.severity`, `confidence: gap.confidence`, `reproducibility:'confirmed'` (:1313 — questionable for absence claims), tags `['feature_gap', …]`, sets `sessionId`/`projectId` (:1297-1298) — **no missionId**.
- Confidence halved when an existing finding matches (`detectFeatureGaps` :847).
- Post-hoc fill (only when null): `scoreFindingQuality` `server/devIntelligence.js:214-253` (evidence-richness: +0.3 expected+actual, +0.25 steps≥2, +0.25 evidence, +0.1 observed, +0.1 recommendation). Called at `capabilities.js:517`, `index.js:3774`.
- `addFinding` (`findings.js:234-303`) ignores caller confidence at write (:267) but `syncSessionFinding` re-applies it on update/create (:655/:687). Severity defaults 'medium' (:241).

**Low-confidence findings are NOT distinguishable today** — `confidence` is a bare number on every finding; nothing marks decision-grade vs informational.

### 1.3 Finding persistence & linkage (the C2-discovered gap)

- Finding schema (`findings.js:234-303`): id, ts, sessionId, projectId, title, severity, category, url, status, steps, expected/actual/evidence, tags, observed/impact/recommendation/fixPrompt, confidence, isDuplicate/duplicateOf, reproducibility, finding_status (`DETECTED`), review_status, primary/secondary categories, priority, **missionId (:286, only if caller passed it)**, workflowId, featureId, evidenceRefs, intelligence, device/environment.
- **Iteration findings persist in BOTH places:** global findings store via `syncSessionFinding` (keyed by sessionId — `qaTools.js:98` for agent findings, `capabilities.js:461` for gap findings; neither carries missionId) AND the mission document via `recordIteration` (`missions.js:380-421`, `mission.findings = iteration.findings` :411).
- Consequence: `/api/v2/findings?mission_id=…` (`pulseV2Router.js:202` → `listFindings({missionId})` `findings.js:329` `f.missionId !== missionId → filter out`) returns **0** for mission-run findings. The mission document's own `findingsCount` is truthful — the filter is what's broken.
- **Backfill is deterministic:** `session.missionId` is stamped at creation (`store.js:106`) by every mission start path (index.js :1737, :2458, :2809, :2977, :4188 + `startMissionExecution` :395-411), and the codebase ALREADY resolves ownership this way in two places (`index.js:1941-1945`, `:1981-1984`: `finding.missionId ? … : listMissions.find(m => m.sessionId === finding.sessionId)`). A dormant `enrichSessionFindings` hook can set missionId (`findingEnrichment.js:111`) but has **no production caller**.

### 1.4 Decision-engine consumption of findings

`collectDecisionInput` (`decisionEngine.js:513-673`):
- `:519-524`: uniqueFindings (non-duplicate), `criticalCount = findings.filter(severity==='critical' && !isDuplicate)` — **no confidence filter**.
- `:527-529`: `findingConfidence` = mean confidence of unique findings (default 0.5 each).
- STOP_FAIL paths that consume criticalCount: budget-exhausted + criticals (:811-823), criticals on completed session (:848-862). Safety Rule 3 (applySafetyOverride :389-400) converts STOP_PASS→STOP_FAIL on any criticalCount>0.
- The ONLY confidence-gated critical rule is RULE 5 (running session, ESCALATE) which requires mean findingConfidence ≥ 0.7 (:1067).
- **So today a single 0.06-confidence "critical" (feature-gap from an uncertain classification) can produce STOP_FAIL.** That is the Phase-3 target.

### 1.5 Where decisions trigger today

- **Settle path only.** `finalizeMissionFromSession` (`index.js:3715-3839`) → autonomy gate `:3746-3750` → `attemptAutonomyBeforeFinalize` (:3667) → `runAutonomyDecision` (`autonomyController.js:90`) — fires when the session reaches `done/idle/error/interrupted`.
- Settle triggers: agent natural completion, turn-limit abort (`finalizeTurnLimitedRun` `agent.js:766-833`), governor onStuck (>90s settled-but-not-finalized, `missionGovernor.js:206-222`, sweep every 30s :247), lazy GET settle (`index.js:2674-2681`), wall-clock onTimeout (:192-205).
- **No decision opportunity exists while the agent is mid-run.** The turn loop (`agent.js:540` stream loop; `assistant_turn_start` :567-589 counts turns and enforces the hard abort) has no checkpoint hook. The natural seam: **the per-turn boundary** (turnCount increment at :575) — deterministic, cheap, already where budget is enforced.

### 1.6 Mid-mission probing surfaces available

| Surface | Mechanics | Suitability |
|---|---|---|
| Per-turn boundary in agent turn loop | `assistant_turn_start` case, `emit(session,'turn')` :571, turnCount :575, budget abort :577-588 | **Chosen probe point** — deterministic, no LLM cost, exactly where budget enforcement already lives |
| Session event bus | `emit()` (`store.js:241-247`) broadcasts on `bus` per sessionId; 'turn' is EPHEMERAL (:235) — no disk write | Delivery mechanism for probe wiring without persisting churn |
| Governor sweep | 30s interval (`missionGovernor.js:247`), already probes sessions (`probeSession` :44-51, wired `index.js:4319-4333`) | Already exists; could host a probe but 30s wall-clock is not turn-aligned; keep for stuck/timeout only |
| Store watchdog | 60s (`store.js:338`) — marks stuck running sessions interrupted | Keep as-is |

### 1.7 Existing tests (baseline state)

- c2-autonomy-contract 18/18, c2-closeout-failure-modes 10/10, c2-live-decision-proof 4/4 (live), b2-golden-loop + wiring 11/11, b1 suites 51/51 (17 sec-negative + 4 linkage + 2 retry-turns + 28 auth/webhook/start-path), m1-p4.4 28/28 (with token), phase4/5 120/120, phase9.2 64/64, c1 20/20, b0 1+6.
- No tests exist for: classification-confidence gating, confidence-tiered decision consumption, missionId backfill, v2 mission filtering of new findings, mid-session probes.

## 2. Current limitations (exact)

1. `generateExpectedFeatures` trusts any inferred purpose regardless of confidence → critical-severity noise at 0.05-0.06 confidence on shallow scans of non-app sites.
2. `reproducibility:'confirmed'` on absence-based findings (gapsToFindings :1313) overstates evidence quality.
3. `criticalCount` has no confidence floor → low-confidence criticals can drive STOP_FAIL and Safety-Rule-3 pass-blocking.
4. Iteration findings lack missionId in the global store → v2 mission filter returns 0 (C2 §6b).
5. Decision opportunities only at settle → full-pool iterations leave the engine nothing to decide (C2 §10.1).
6. Mean `findingConfidence` dilutes single-critical signal (one 0.9-confidence critical among 20 medium findings ≈ 0.5 mean).

## 3. Proposed smallest changes (per phase)

- **P2 (target quality):** In `featureGap.js`, gate purpose-catalog EXPECTED-FEATURE generation on `purpose.confidence` (and explorationConfidence) — below a deterministic floor derived from the existing `conf()` math, expected features from the catalog are skipped (uncertain classification ⇒ no invented expectations). Record the gate outcome in structured data (gap analysis carries `purposeConfidence`, `excludedByUncertainty` + count). Context-derived features (confidence 1.0, stated intent) and workflow gaps already carry purpose-confidence multiplication — verify unaffected. Genuine non-classification findings (agent-filed, console errors, broken links) are untouched — different creation path entirely.
- **P3 (confidence quality):** In `collectDecisionInput`, compute `decisionGradeFindings` (severity critical/high require per-finding confidence ≥ a deterministic floor — existing precedent: RULE 5 uses 0.7; quality-weighting uses confidence) and feed `criticalCount`/`highCount` for DECISION purposes from that set, while keeping raw counts as separate signals. STOP_FAIL on criticals requires ≥1 decision-grade critical; otherwise the finding remains visible (unchanged severity/confidence on the record) and the engine falls through to INVESTIGATE (verify-before-conclude) rather than STOP_FAIL. Safety Rule 3 consumes the decision-grade count. **Invariant kept:** confirmed criticals (confidence ≥ floor) still STOP_FAIL exactly as before; low-confidence criticals surface via INVESTIGATE (bounded verification) — never hidden, never independently fatal.
- **P4 (linkage):** (a) At write time: `syncSessionFinding` stamps `missionId: session.missionId` when the finding has none and the session carries one (session already persists it — `store.js:106`). (b) One-time guarded backfill at boot: for store findings with null missionId, resolve via `listMissions.find(m => m.sessionId === f.sessionId)` — same resolution the codebase already trusts at `index.js:1941`; never fabricate when no session/mission match; historical records without a resolvable session stay untouched. (c) v2 filter then returns the correct set for new findings.
- **P5 (mid-session probe):** At the per-turn boundary (`assistant_turn_start`, after turnCount++), every K turns (deterministic K, default 4) and only while a mission-linked session is running, run the SAME engine (`makeDecisionSafe`) on live session state via an injected async hook (never blocks the stream — fire-and-forget with in-flight guard + cooldown). Probe outcomes: CONTINUE → no-op (trace only when something interesting: not every probe); INVESTIGATE/REVALIDATE/REPLAN → recorded as trace + **deferred to the settle gate** (the current mission continues; the decision informs the NEXT iteration's focus) — no mid-run agent steering in C3; ESCALATE/STOP_FAIL with decision-grade evidence → allow early settle (stop the turn stream via the existing AbortController seam, then the normal finalize path runs the authoritative decision). Budget authority unchanged: probes never touch maxTurns; iteration dispatch still goes through the guarded handler with pool debit. Anti-churn: probe hash = inputSignature (already computed by the engine); identical consecutive signatures with no new findings ⇒ suppress duplicate trace/action.
- **P6 (traces):** Reuse the 13-field schema. The probe adds no new fields; `state` value distinguishes probe decisions (`session:running:probe`) from settle decisions (`session:done`), `iteration` already exists, budget fields already exist. No schema change needed.
- **P7/P8:** New test files as specified in the build order.

## 4. Risks / interactions to watch

- phase4-decision-engine tests (120) assert current criticalCount semantics — Phase 3 must not break their assertions (they construct findings WITHOUT confidence → default 0.5 mean; check per-finding default treatment: findings with null confidence are "unknown", not "low" — treat unknown as NOT decision-grade for criticals? **No — treat unknown as 0.5 (the existing default) and require ≥ floor only of *numeric* confidence; null-confidence criticals keep legacy behavior to avoid regressing confirmed agent-filed criticals that never got scored.** This keeps existing tests and real agent findings intact.)
- `session.findings` grows during run; probe must be read-only on the session object.
- AbortController seam for early-stop must reuse the existing budget-abort mechanics (no new abort paths).
- Backfill boot pass must be idempotent and cheap (one scan, store-level).
