# Task: Mission Architecture + Evidence Engine + Public API

## Goal
Evolve Qase from Session-only model to Mission-driven architecture. Add Evidence Engine, Quality Scoring, Public API, and AI Studio integration contract. All additive — no existing code broken.

## Files to Create
- `server/missions.js` — Mission store (Map + JSON mirror, same pattern as store.js/findings.js)

## Files to Modify
- `server/findings.js` — add evidence fields (observed, impact, recommendation, fixPrompt, confidence, isDuplicate, reproducibility)
- `server/qaTools.js` — enhance report_finding tool with evidence fields
- `server/devIntelligence.js` — add buildImprovementPrompt (AI Studio contract) + buildQualityScore
- `server/index.js` — add `/api/v1/` routes + mission management routes
- `server/pipeline.js` — add mission_finalize stage

## Acceptance Criteria

### 1. Mission Store
- [ ] `createMission(data)` creates mission with id, projectId, type, objectives, capabilities, successCriteria
- [ ] `getMission(id)`, `listMissions({projectId})`, `updateMission(id, patch)`, `deleteMission(id)`
- [ ] Mission contains `sessionId` reference (not the session itself)
- [ ] Mission has: qualityScore, verdict, improvementPrompt, releaseReady
- [ ] JSON file persistence at `.qase/missions.json`
- [ ] ProjectId backfill/reassign (same pattern as findings.js)

### 2. Evidence Engine
- [ ] `addFinding` accepts new fields: observed, impact, recommendation, fixPrompt, confidence, isDuplicate, reproducibility
- [ ] Existing findings (without new fields) still work — backward compatible
- [ ] `report_finding` tool in qaTools.js accepts and stores new fields

### 3. Quality Scoring
- [ ] `scoreFindingQuality(finding)` returns { confidence, isDuplicate, reproducibility }
- [ ] `calculateMissionQuality(findings)` returns aggregate 0-100 score

### 4. Public API (`/api/v1/`)
- [ ] `POST /api/v1/missions` — create + optionally start a mission
- [ ] `GET /api/v1/missions/:id` — get status + results
- [ ] `POST /api/v1/missions/:id/stop` — abort
- [ ] `GET /api/v1/missions/:id/report` — full report (json | markdown)
- [ ] `POST /api/v1/webhooks` — register callback URL

### 5. AI Studio Integration Contract
- [ ] `buildImprovementPrompt(mission, findings)` returns structured output with fixPrompt per finding + aggregate improvementPrompt
- [ ] Output includes: verdict, qualityScore, findings with fixPrompt, improvementPrompt, regressionReady

## Edge Cases
- Mission created without type defaults to `full_audit`
- Finding without new evidence fields still displays correctly in existing UI
- Public API auth reuses existing `requireApiToken` middleware
- Mission can link to a session that doesn't exist yet (pre-creation)
