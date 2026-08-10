# Phase 2 — Application Understanding Audit

## 1. Executive Summary

QASE's application understanding is **entirely post-hoc and heuristic**. The agent captures browser interactions (clicks, fills, navigations, step outcomes) during exploration. After the agent finishes, `featureGap.js` runs a keyword-matching pipeline that derives purpose, expected features, and gaps from text content. **Purpose detection is 100% heuristic with zero LLM involvement**. The LLM is used only optionally to enrich gap results and analyze findings.

**Measured baseline accuracy: ~43%** (Phase 0 measurement).

## 2. Existing Component Inventory

### What Exists and Works

| Component | File | Lines | Type | Connected |
|-----------|------|-------|------|-----------|
| Purpose detection | featureGap.js:503-664 | 161 | Heuristic | ✅ to feature_gap capability |
| App inventory | featureGap.js:220-335 | 115 | Heuristic | ✅ to purpose detection |
| Interactive signals | featureGap.js:61-210 | 149 | Heuristic | ✅ to inventory |
| Purpose catalog | featureGap.js:349-491 | 142 | Static data | ✅ to detection |
| Context features | featureGap.js:891-1126 | 235 | Heuristic | ✅ to gap analysis |
| Workflow templates | featureGap.js:1338-1543 | 205 | Static data | ✅ to workflow gaps |
| Feature gap detection | featureGap.js:799-849 | 50 | Heuristic | ✅ to findings |
| Knowledge metadata | knowledge.js:89-123 | 34 | Heuristic | ✅ to knowledge query |
| LLM gap enrichment | featureGap.js:1199-1280 | 81 | LLM (optional) | ✅ gated on config |
| Dev intelligence (LLM) | devIntelligence.js:33-127 | 94 | LLM | ✅ to findings |
| Quality scoring | devIntelligence.js:265-352 | 87 | Heuristic | ✅ to mission finalize |
| Frontend display | pipeline.js + app.js | ~400 | UI | ✅ via SSE events |

### What Exists but Is Disconnected

| Data | Captured In | Why Unused |
|------|------------|------------|
| Page titles (titleAfter) | workflows.js:210 | Never fed to inventory or purpose |
| ElementsFound count | workflows.js:213 | Only a count, actual elements discarded |
| Screenshot frames | browserBridge.js:400 | Ephemeral JPEG for UI only |
| Knowledge hints | knowledge.js:236 | Stored in result, not fed to purpose |
| Framework/auth detection | knowledge.js:89 | Used for knowledge match, not purpose |
| Context discrepancies | featureGap.js:1099 | Computed but never surfaced in UI |
| Console error content | agent.js | Only counted, messages not stored |
| Agent reasoning | agent.js | Ephemeral, not persisted |

### What Does NOT Exist

| Missing | Impact |
|---------|--------|
| Structured Application Model | Understanding is local variables, not composable |
| LLM-based purpose detection | 43% accuracy ceiling |
| Static DOM analysis | No headings, nav, forms, links extracted |
| Content text extraction | No page text captured |
| Navigation graph | Pages are flat list |
| Confidence with explainable basis | `matchCount / 3` formula |
| Intent/observation/inference/unknown separation | All mixed together |
| Evidence lineage | Conclusions have no back-references |
| Conflict resolution | Marketing override is simplistic |
| Separate app_understanding capability | Embedded in feature_gap |

## 3. Current Execution Flow

```
Agent explores (interactive)
    ↓ captures steps, activities, findings, todos, report
Session finishes (status: done)
    ↓
Pipeline runs (capabilities.js)
    ↓
feature_gap capability
    ↓
analyzeFeatureGaps(session, missionContext)
    ├── extractAppInventory(session)
    │     ├── pages: ["/", "/login", "/dashboard"]
    │     ├── formFields: ["email", "password"]
    │     ├── auth: { hasLogin, hasLogout, hasRegister }
    │     ├── capabilities: { search, dashboard, settings, payment, ... }
    │     ├── appType: { ecommerce, saas, marketing, social }
    │     └── interactions: { verifiedAuth, verifiedFeatures, brokenFeatures }
    ├── inferAppPurpose(inventory, session)
    │     ├── Keyword count across all text
    │     ├── Structural bonuses
    │     ├── Marketing override (pricing+about+contact → marketing)
    │     └── confidence = matchCount/3 × explorationConfidence
    ├── generateExpectedFeatures(inventory, purpose, session)
    ├── deriveContextFeatures(missionContext) → reconcile
    ├── detectFeatureGaps(expected, inventory)
    ├── analyzeWorkflowGaps(inventory, session, purpose)
    └── (optional) enhanceGapsWithLLM
```

## 4. Purpose Detection Deep Dive

### inferAppPurpose (featureGap.js:503-664)

**Algorithm:**
1. Concatenate all text: report.summary + pages + activities + todos → lowercase
2. For each of 11 purposes: count keyword matches from `signals` array
3. Add structural bonuses based on verified behaviors
4. Confidence = `matchCount / 3` capped at 1.0
5. Marketing override: if ≥2 of {pricing, about, contact, signup} exist but NO auth → override to marketing
6. Final confidence = best.confidence × explorationConfidence

**The 11 purpose categories:**
crm, admin_dashboard, ecommerce, saas_platform, marketing, content, social, cms, project_management, developer_platform, productivity

**Why ~43% accuracy:**
- Keyword matching is brittle (marketing pages mention "payment" without being e-commerce)
- No DOM structure analysis (only URLs and activity text)
- No page content extraction
- Structural bonuses are simplistic
- Marketing override only checks 4 page patterns
- No LLM reasoning
- Unknown/uncertain states not supported (always picks closest match)

## 5. Evidence Sources Available

### From Session (Directly Observed)
- `capturedSteps[].url` — pages visited
- `capturedSteps[].outcome.titleAfter` — page titles (UNUSED)
- `capturedSteps[].action/target/value` — interactions performed
- `capturedSteps[].outcome.status` — success/failed
- `capturedSteps[].outcome.urlAfter` — navigation results
- `capturedSteps[].outcome.consoleErrors` — error counts
- `findings[].title/severity/category/url/steps` — defects found
- `report.summary/covered[]/notCovered[]` — agent's own assessment
- `todos[].text/status` — what agent planned to test

### From Mission Context (User Intent)
- `context.buildPrompt` — what user asked to build
- `context.requirements[]` — explicit requirements
- `context.businessGoals` — stated goals
- `context.testCredentials` — auth info

### From Interactive Signals (Derived)
- `verifiedAuth` — login succeeded/failed
- `verifiedFeatures` — search/payment/forms/media
- `brokenFeatures` — detected but broken
- `pageTransitions` — navigation flow

## 6. Architecture Gap Analysis

### Current Architecture (Post-Hoc Heuristic)
```
Explore → Capture → Finish → Keyword Analysis → Purpose → Features → Gaps
```

### Target Architecture (Phase 2)
```
Mission Context + Static Evidence + Interactive Evidence
    ↓
Application Understanding
    ↓
Structured Application Model
    ↓ (purpose, roles, features, workflows, unknowns, confidence)
Downstream Validation (feature gap, workflow intelligence)
```

### Key Principle
Purpose is an OUTPUT of understanding, not an input to it. The current code treats purpose as a keyword-matching guess. The target treats purpose as a derived conclusion from multiple evidence sources.

## 7. Non-Negotiable Constraints for Implementation

1. Preserve existing heuristic purpose detection as fallback
2. Do NOT rewrite featureGap.js — extend it
3. Phase 1 tests must remain green (299/299)
4. No new browser architecture
5. No orchestrator redesign
6. LLM output must be structured and validated
7. Web content treated as untrusted data
8. Accuracy must be measured, not assumed

## 8. Implementation Strategy

### What to Build
1. **server/appModel.js** — Structured Application Model with schema
2. **server/appUnderstanding.js** — Capability that builds the model from evidence
3. **Evidence collectors** — Aggregate static + interactive evidence into structured input
4. **Confidence model** — Explainable confidence from evidence quality
5. **LLM reasoning** — Structured input → structured output (validated)
6. **Capability registration** — `application_understanding` in pipeline
7. **Integration** — Feature gap + workflow intelligence consume the model
8. **API + UI** — Surface the model in frontend

### What NOT to Build
- New browser tools
- New exploration strategy
- Dynamic orchestration
- Knowledge Layer v2
- Evidence Graph
- Multi-agent system
