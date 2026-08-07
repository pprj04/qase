# Task: Continuous Validation Loop + Product-Facing Quality

## Goal
Add the re-validation loop that makes Qase autonomous: validate → improve → validate again → compare → approve. Also restructure quality output to be product-facing (releaseReady, confidence, risk, recommendations) instead of developer-facing (score, verdict).

## What to Build

### 1. Mission Iterations (server/missions.js + server/index.js)
A mission tracks multiple validation runs (iterations). Each iteration:
- Creates a new session, runs the agent
- Stores findings for that iteration
- Compares against previous iteration's findings

Add to mission schema:
```
iterations: [{
  number: 1,
  sessionId: "...",
  findings: [...],
  qualityScore: 76,
  verdict: "fail",
  ranAt: timestamp,
  status: "completed"
}]
currentIteration: 1
```

### 2. Validation Comparison (server/devIntelligence.js)
`compareIterations(prevFindings, currentFindings)` returns:
```
{
  fixed: [...],           // findings resolved since last run (matched by title+url)
  remaining: [...],       // still present
  newRegressions: [...],  // new issues introduced
  scoreDelta: +12,        // current - previous
  trend: "improving" | "declining" | "stable",
  approveRecommended: boolean
}
```

### 3. Product-Facing Quality (server/devIntelligence.js)
Enhance `calculateMissionQuality` to also produce:
```
{
  releaseReady: boolean,
  confidence: 0-1,            // how confident we are in the assessment
  risk: "low" | "medium" | "high",
  criticalIssues: [...],      // list of critical/high findings
  recommendations: [...],     // top actions for the product owner
  missingFeatures: [...]      // identified gaps (from feature_gap missions)
}
```

### 4. API Endpoints (server/index.js)
- `POST /api/v1/missions/:id/iterate` — trigger next validation run
- `GET /api/v1/missions/:id/comparison` — get delta between last two iterations

## Acceptance Criteria

- [ ] Mission can have multiple iterations, each with its own session and findings
- [ ] `compareIterations()` correctly identifies fixed/remaining/new findings
- [ ] Trend is calculated from score delta
- [ ] Product-facing quality output includes releaseReady, confidence, risk, recommendations
- [ ] `POST /api/v1/missions/:id/iterate` starts a new validation run
- [ ] `GET /api/v1/missions/:id/comparison` returns the delta
- [ ] All existing endpoints and functionality unchanged
- [ ] First iteration works the same as current mission start

## Edge Cases
- First iteration has nothing to compare against → comparison returns "baseline"
- App is identical between iterations → trend is "stable", no fixed/new findings
- New critical bug introduced → trend is "declining", approveRecommended is false
