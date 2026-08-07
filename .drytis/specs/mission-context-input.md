# Task: Mission Context Input (A1)

## Objective

Allow missions to accept a build prompt + requirements as ground truth, and use
that context to derive expected features BEFORE exploration. This replaces
"infer purpose from whatever data is available" with "confirm purpose against
known intent."

## Files to Change

- `server/missions.js` — Add `context` field to mission schema, accept on create
- `server/index.js` — Wire context into POST /api/v1/missions
- `server/featureGap.js` — Add `deriveContextFeatures(context)` function, integrate into `analyzeFeatureGaps`
- `server/pipeline.js` — Pass mission context into feature_gap stage
- `tests/test-mission-context.js` — New test file

## Acceptance Criteria

- [ ] Mission creation accepts and stores `context.buildPrompt`
- [ ] `deriveContextFeatures(context)` extracts expected features from build prompt text
  - Parse keywords: "auth/login/signup" → expects auth features
  - Parse keywords: "cart/checkout/payment" → expects e-commerce flow
  - Parse keywords: "dashboard/analytics" → expects admin features
  - Parse keywords: "blog/post/article" → expects CMS features
  - Parse keywords: "CRM/lead/pipeline" → expects CRM features
- [ ] Context-derived expectations carry `confidence: 1.0` (ground truth)
- [ ] When context and heuristics disagree, context wins, discrepancy is logged
- [ ] Feature gap analysis compares against context-derived expectations
- [ ] Report shows "expected from context" vs "detected from exploration"
- [ ] Unit tests cover: context parsing, expected feature extraction, reconciliation

## Test Plan

```
1. Create mission with buildPrompt="Build a CRM with leads, deals, and invoicing"
   → deriveContextFeatures returns: [contacts, pipeline/deals, invoicing, data export]
   → All with confidence=1.0

2. Create mission with buildPrompt="Build an e-commerce store with cart and checkout"
   → deriveContextFeatures returns: [product browsing, cart, checkout, payment]
   → All with confidence=1.0

3. Mission with no buildPrompt
   → deriveContextFeatures returns []
   → Falls back to heuristic purpose detection only

4. Context says CRM, heuristics say admin_dashboard
   → Context wins, purpose=crm
   → Discrepancy logged in result
```
