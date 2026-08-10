# Phase 4 — Decision Engine Specification

## Overview
Build a real Decision Engine that reasons over multiple signals (quality score, severity, finding confidence, evidence completeness, coverage, app understanding, knowledge confidence, validation results, budget, mission state) and produces an explicit, explainable decision.

## Files Changed
- `server/decisionEngine.js` — NEW. Core engine (contract, policy, confidence, budget, safety, history, idempotency)
- `server/capabilities.js` — Register `decision_engine` capability between `mission_finalize` and `knowledge_write`
- `server/index.js` — 3 new API endpoints: GET /api/sessions/:id/decision, /decisions, /missions/:id/decisions
- `public/pipeline.js` — Decision Engine UI panel (decision badge, reason, factors, history)
- `public/index.html` — `<div id="decision-section">` container
- `public/styles.css` — Decision Engine CSS (badges, panels, factors grid)
- `public/app.js` — decision_engine stage messages

## Test Files
- `tests/phase4-decision-engine.test.js` — 61 unit tests
- `tests/phase4-integration.test.js` — 13 integration tests
- `tests/test-capability-registry.js` — Updated for 10-stage pipeline

## Acceptance Criteria

### Engine
- [x] Decision Engine exists as a distinct component (server/decisionEngine.js)
- [x] Decision contract is defined (createDecision factory with 7 types)
- [x] Decision policy is explicit (deterministic rule cascade in evaluatePolicy)
- [x] Decision types are validated (VALID_DECISION_TYPES Set allowlist)
- [x] Evidence is separated from decisions (no mutation of session.findings or quality)
- [x] Decisions are explainable (reason ≥10 chars, factors, confidence basis)
- [x] Decision history exists (bounded at MAX_DECISION_HISTORY=100)
- [x] Decision evaluation is deterministic (no LLM, no randomness)
- [x] LLM usage: NONE — fully deterministic policy logic
- [x] Budget awareness works (4 dimensions: time, actions, browser, LLM)
- [x] Safety fallback works (4 hard safety override rules)
- [x] Mission lifecycle integration works (capability in pipeline)
- [x] API works (3 read-only endpoints)
- [x] UI exposes decision state (panel in Analysis tab)

### Tests
- [x] Unit tests pass (61/61)
- [x] Integration tests pass (13/13)
- [x] Phase 1 regression passes
- [x] Phase 2 regression passes
- [x] Phase 3 regression passes
- [x] No Phase 5 work started
- [x] No AI Studio/Drytis integration started
- [x] No unrelated architecture redesign occurred
