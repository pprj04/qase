# Task: Feature Gap Intelligence

## Goal
Qase can find bugs. It cannot find what's *missing*. Thomas repeatedly asks: "Can it find what AI forgot to build?" This capability makes the agent reason about what features an application *should* have, compare against what it *does* have, and report gaps with implementation recommendations.

This is NOT bug detection. Bugs = "this exists but is broken." Feature gaps = "this should exist but doesn't at all."

## What to Build

### Feature Gap Analysis (server/featureGap.js)
A capability module that:
1. Takes the agent's exploration data (workflow, pages, interactions, findings)
2. Infers the application's purpose from what it observed
3. Generates expected feature set based on app type/purpose
4. Compares expected vs actual features discovered
5. Returns missing feature reports with implementation prompts

Output per gap:
```
{
  feature: "Password reset",
  category: "authentication",
  whyExpected: "Every login system needs a recovery path for forgotten passwords",
  impact: "Users who forget their password cannot regain access",
  evidence: "Login page exists with no 'forgot password' link. No /reset route found.",
  recommendation: "Add password reset flow: /forgot-password → email verification → /reset",
  fixPrompt: "Implement password reset: add /forgot-password route, email verification, /reset route with token expiry",
  confidence: 0.85,
  severity: "high"
}
```

### Integration
- New mission type behavior: `feature_gap` missions run feature gap analysis as part of their pipeline
- Full audit missions optionally include feature gap analysis
- Feature gaps are filed as findings with category "missing_feature"
- Pipeline integration: runs after dev_intelligence, before mission_finalize

## Acceptance Criteria

- [ ] `analyzeFeatureGaps(explorationData)` returns structured missing feature reports
- [ ] Each gap has: feature, whyExpected, impact, recommendation, fixPrompt, confidence, severity
- [ ] Gaps are filed as findings with category "missing_feature" in the existing findings store
- [ ] Feature gap analysis runs as a pipeline stage for feature_gap missions
- [ ] Full audit missions optionally include it (config flag)
- [ ] Gaps integrate with the existing quality scoring (high-severity gaps lower the score)
- [ ] Gaps appear in the AI Studio improvement prompt

## Edge Cases
- Agent didn't explore deeply enough → lower confidence on gaps
- App is a marketing page (no auth, no forms) → fewer expected features
- App explicitly says "coming soon" for a feature → lower severity
