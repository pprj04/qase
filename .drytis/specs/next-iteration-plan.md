# QASE — Next Iteration Plan
## August 7, 2026 — Post-Architecture-Freeze

---

## WHERE WE ARE — Honest State Assessment

### Built and Working (172/172 unit tests pass)
| Capability | Status | Evidence |
|---|---|---|
| Agent runtime + 21 browser/QA tools | ✅ Production | Live sessions, 92 findings on studio.drytis.ai |
| Capability Registry + Orchestrator | ✅ Built | 8 registered capabilities, topological sort, dependency resolution |
| Application Understanding | 🟡 Partial | 43% purpose detection accuracy, 11-type catalog |
| Feature Gap Analysis | 🟡 Partial | Heuristic-based, no LLM enhancement active |
| Knowledge Layer (Phase 1) | ✅ Built | PatternStore, query/write/match, confidence model |
| Mission Context Input | ✅ Built | Context-derived features with confidence=1.0 |
| Interactive Exploration Bridge | ✅ Built | captureStep with outcomes, finalizeStepOutcome |
| Interactive Intelligence | ✅ Built | Verified auth/features/broken signals feed inventory |
| Root Cause Analysis | ✅ Built | devIntelligence.js, fix prompts per finding |
| Quality Scoring | ✅ Built | calculateMissionQuality, severity-weighted |
| Session/Mission API | ✅ Built | CRUD, SSE streaming, replay, scheduler |
| UI — Developer IDE Aesthetic | ✅ Built | JetBrains Mono, GitHub Dark, 4-tab right panel, conversation-first |
| UI — Mission Progress + Activity Log | ✅ Built | Stage strip in REASONING_LOG, grouped findings, release assessment |

### NOT Built (per frozen architecture docs)
| Capability | Status | Impact |
|---|---|---|
| **Decision Engine** | 🔴 Missing | Merged into mission_finalize — needs separation (assess vs decide) |
| **Knowledge Query as formal capability** | 🟡 Partial | Runs inline in feature_gap, not as its own registered capability |
| **Evidence Graph** | 🔴 Missing | Evidence is flat (raw→normalized), no graph structure |
| **Continuous Validation Loop** | 🔴 Missing | No regenerate→revalidate cycle |
| **AI Studio Contract** | 🔴 Missing | No live generate→validate→improve loop |
| **LLM-Enhanced Analysis** | 🔴 Missing | enhanceGapsWithLLM exists but no API key wired |
| **Real App Validation** | 🔴 Missing | No test apps, no measured metrics beyond purpose detection |
| **UI — Live streaming reasoning** | 🔴 Missing | Agent messages inject after completion, not token-by-token |
| **UI — AI Collaboration follow-ups** | 🔴 Missing | No conversational steering mid-mission |

---

## ARCHITECTURE FLOW — Current vs Required

### Current Flow
```
User submits URL
  → Agent explores (browser tools, LLM-driven)
  → Orchestrator runs capabilities:
      workflow_save → test_generation → smoke_run
      → dev_intelligence → feature_gap (+ knowledge query inline)
      → mission_finalize (quality score + release verdict)
      → knowledge_write
  → Results surface in UI (post-completion)
```

### Required Flow (per ARCHITECTURE.md + MISSION.md)
```
User submits URL (or AI Studio triggers mission)
  → Orchestrator plans (based on mission type, context, knowledge)
  → Knowledge Query (formal capability) surfaces known patterns
  → Agent explores + Application Understanding builds
  → Capabilities execute in dependency order:
      App Understanding → Bug Detection → Feature Gap
  → Evidence Graph builds (Raw → Normalized → Graph)
  → Quality Assessment: what happened? (score, coverage)
  → Decision Engine: what to do? (approve/regenerate/escalate/stop)
  → IF regenerate: emit improvement prompt → wait for new version → revalidate
  → IF approve/stop: Knowledge Write → Final Report
```

### Gaps in the Flow
1. **No planning phase** — Orchestrator runs all capabilities in fixed order. Should adapt based on mission type + knowledge hints.
2. **No Decision Engine** — mission_finalize both scores AND decides. These are separate concerns.
3. **No evidence structure** — Results are flat objects. No graph linking findings to evidence to capabilities.
4. **No loop** — One-shot execution. No regenerate/revalidate cycle.
5. **No streaming** — Everything appears post-completion. No real-time reasoning.

---

## NEXT ITERATION — Prioritized Work Plan

### Priority 1: Real-World Validation (Measure Before Optimizing)
> "Measure don't predict" — QASE Principle #8

**Why first:** We have 43% purpose detection accuracy but no measured metrics for gap precision, false positive rate, or workflow coverage. We cannot improve what we don't measure. Thomas said: "don't benchmark first" — but we're past architecture, now we need ground truth.

**Tasks:**
1. **Build 5 test apps** with documented expected features
   - Todo app (CRUD + auth): 8 expected features, 3 workflows
   - Blog/CMS: 12 expected features, 4 workflows
   - E-commerce store: 15 expected features, 5 workflows
   - Admin dashboard: 10 expected features, 3 workflows
   - Marketing landing: 6 expected features, 2 workflows
2. **Validation harness** — run pipeline on each, measure:
   - Purpose detection accuracy (target: 43% → 70%)
   - Feature gap precision (target: unknown → 60%)
   - False positive rate (target: unknown → <15%)
   - Workflow coverage (target: unknown → 50%)
3. **Fix top 3 failure patterns** based on measured data
4. **Re-measure** — show improvement

**Files:** tests/test-apps/*, tests/validate-metrics.js
**No architecture change** — just measurement + heuristic tuning

---

### Priority 2: LLM-Enhanced Intelligence (The Ceiling)
> "Heuristic floor + LLM ceiling" — QASE Principle #6

**Why second:** The heuristic floor is built (43% accuracy). The LLM ceiling is completely absent — `enhanceGapsWithLLM` exists in capabilities.js but no API key is wired. This is the single biggest intelligence improvement available.

**Tasks:**
1. **Wire LLM key** via create_openai_api_key → QASE_LLM_API_KEY + QASE_LLM_BASE_URL
2. **Enhance purpose detection** — send inventory + page content to LLM, get structured purpose classification
3. **Enhance feature gap analysis** — LLM reviews detected vs expected, filters false positives, suggests missed features
4. **Enhance root cause analysis** — LLM generates deeper root cause + fix approach per finding
5. **Generate natural language summaries** — the "AI narrative" in Application Analysis should be LLM-generated, not template-based

**Files:** server/capabilities.js (wire enhanceGapsWithLLM), server/featureGap.js (enhance inferAppPurpose), server/devIntelligence.js (LLM root cause)
**Architecture change:** LLM becomes a first-class capability enhancer, not a separate pipeline stage

---

### Priority 3: Decision Engine Separation
> "Assessment and decision separate" — QASE Principle #7

**Why third:** mission_finalize currently does both scoring (assessment) and verdict (decision). Per the frozen architecture, these must be separate capabilities.

**Tasks:**
1. **Split mission_finalize** into:
   - `quality_assessment` — calculates score, coverage, confidence (pure measurement)
   - `decision_engine` — reads assessment + thresholds, decides: approve / regenerate / escalate / stop
2. **Define decision thresholds:**
   - Score ≥ 80 + 0 critical → approve
   - Score 50-79 or critical > 0 → regenerate (emit improvement prompt)
   - Score < 50 or stuck after 3 iterations → escalate
3. **Wire decision output** to mission status + UI

**Files:** server/capabilities.js (split stage), server/missions.js (decision field)
**Architecture change:** Formal separation per ARCHITECTURE.md

---

### Priority 4: Live Mission Experience (UI)
> Thomas: conversation is 70% of the screen

**Why fourth:** The UI looks right but doesn't *feel* alive. Results appear post-completion. The agent should reason out loud.

**Tasks:**
1. **Stream reasoning** — agent's LLM thinking streams token-by-token into the conversation (like Claude)
2. **Progressive findings** — findings appear in conversation as they're discovered, not batch at end
3. **Live stage updates** — REASONING_LOG updates in real-time as each capability starts/completes
4. **AI collaboration** — user can type follow-ups mid-mission ("focus on authentication", "retest checkout")

**Files:** public/app.js (SSE handlers), server/index.js (streaming endpoint), server/agent.js (emit reasoning events)
**Architecture change:** New SSE event types (reasoning_delta, finding_discovered, decision_made)

---

### Priority 5: AI Studio Contract + Closed Loop
> Thomas's demo vision: generate → validate → improve → regenerate → revalidate

**Why fifth:** This is the product vision — the full autonomous loop. But it depends on Priorities 1-3 being solid first.

**Tasks:**
1. **Formalize API contract** — POST /api/v1/missions with { appUrl, buildPrompt, generationId, testCredentials? }
2. **Improvement prompt generation** — structured output the AI Studio can consume to regenerate
3. **Iteration tracking** — recordIteration already exists, wire it to a live loop
4. **Convergence measurement** — does quality score improve across iterations?
5. **Decision Engine drives the loop** — regenerate/stop/escalate

**Files:** server/missions.js (iteration loop), server/index.js (contract endpoint), server/capabilities.js (decision → regenerate)
**Architecture change:** Continuous Validation becomes a real loop, not one-shot

---

### Priority 6: Knowledge Layer Phase 2
> "Knowledge accumulates" — QASE Principle #5

**Why sixth:** Phase 1 is built (patterns saved/matched). Phase 2 makes it actually useful.

**Tasks:**
1. **Knowledge Query as formal capability** — separate from feature_gap, runs before exploration
2. **Capability hints** — "We've seen Clerk auth before, test it deeper"
3. **Cross-mission correlation** — "This same CORS issue appeared in 3 previous missions"
4. **Knowledge UI** — surface known patterns in APPLICATION_ANALYSIS tab
5. **Confidence decay** — old patterns lose weight if not seen recently

**Files:** server/knowledge.js (Phase 2 features), server/capabilities.js (formal capability), public/pipeline.js (UI)
**Architecture change:** Knowledge Query becomes its own registered capability

---

## EXECUTION ORDER + DEPENDENCIES

```
Priority 1 (Validation)     ──── no deps, start immediately
Priority 2 (LLM Enhancement) ─── after P1 (measure improvement)
Priority 3 (Decision Engine) ─── no deps, can parallel with P1/P2
Priority 4 (Live UI)         ─── after P2 (LLM reasoning to stream)
Priority 5 (AI Studio Loop)  ─── after P3 (decision drives loop)
Priority 6 (Knowledge v2)    ─── after P1 (patterns from real apps)
```

**Recommended parallel tracks:**
- Track A: P1 (Validation) → P2 (LLM) → P4 (Live UI)
- Track B: P3 (Decision Engine) → P5 (AI Studio Loop)
- Track C: P6 (Knowledge v2) — starts after P1

---

## ARCHITECTURE CHANGES REQUIRED

### Change 1: Decision Engine Separation
**Current:** mission_finalize does scoring + verdict
**After:** quality_assessment (measures) → decision_engine (decides)
**Risk:** Low — mechanical refactor, existing tests provide safety net

### Change 2: Knowledge Query as Formal Capability
**Current:** Inline in feature_gap capability
**After:** Separate registered capability that runs before exploration
**Risk:** Low — logic already exists, just needs wrapping

### Change 3: LLM Enhancement Layer
**Current:** Heuristic-only (enhanceGapsWithLLM exists but unwired)
**After:** LLM enhances purpose detection, gap analysis, root cause
**Risk:** Medium — introduces API dependency, needs cost management

### Change 4: Continuous Validation Loop
**Current:** One-shot pipeline
**After:** Decision Engine can trigger regeneration → revalidation
**Risk:** High — changes the fundamental execution model from linear to cyclic
**Mitigation:** Start with manual trigger (user clicks "revalidate"), automate later

### Change 5: Evidence Graph
**Current:** Flat result objects
**After:** Raw → Normalized → Evidence Graph (linked nodes)
**Risk:** Medium — data structure change, but can be additive (keep flat fallback)
**Defer:** Not urgent for P1-P4. Needed when AI Studio loop requires traceability.

---

## WHAT NOT TO DO (Guardrails from ROADMAP.md)

- ❌ No rewrite — evolve the existing codebase
- ❌ No K8s/microservices before product validation
- ❌ No more purpose types beyond the existing 11
- ❌ No public website benchmarks (test on AI-generated apps)
- ❌ No premature optimization — measure first

---

## SUCCESS METRICS (from ROADMAP.md)

| Metric | Current | Target | Priority |
|---|---|---|---|
| Purpose detection accuracy | 43% | 90% | P1 → P2 |
| Feature-gap precision | unknown | 85% | P1 |
| False positive rate | ~9% | <10% | P1 |
| Workflow coverage | unknown | 85% | P1 |
| Bug detection rate | unknown | 90% | P1 |
| End-to-end loop | not running | active | P5 |
| Knowledge carry-over | none | active | P6 |
