# D1 — Golden E2E Loop: session artifacts & final state (2026-08-30)

## Golden chain (v5 — the authoritative LIVE proof)
- Mission `24d1b0fe-fd6c-48e9-832a-5f8b51a49dec` "D1 Golden E2E v5 — budget-aware tool-seam normal completion" (target :9901 CRM, context.maxTurns 45)
- Session `85ce0ffd-9fe2-4a56-bc1f-428b34c64df8` — done, model-authored report (verdict fail, deterministicCloseOut absent), 38 captured steps
- Workflow `36e72916-2658-43c9-96f8-7fc0c69edabd` — 38 steps, sessionId linked
- Test cases (LLM-generated from the workflow): `bb3a57d0` (invalid email), `8fcddaf4` (static KPI), `034fee9a` (Sign In → blank #login)
- Replays: bb3a57d0 → run b4436b02 **fail** (honest: click timeout, screenshot captured); 8fcddaf4 → 007877a3 **pass** (3/3 assertions, incl. honest bug characterization of static $45,000 KPI); 034fee9a → 2e52280d **fail** (url_contains '#login' failed, trace+screenshot persisted). No fake passes.

## Companion runs
- RUN A (clean :9907): mission `ea9e4031` — 5 findings, all heuristic missing_feature, NO browser-verified critical
- RUN B (known defect :9906): mission `75b5a948` — 9 findings incl. the real defect "Add Contact form accepts invalid email addresses without validation" (medium) + duplicate-email (low); verdict pass_with_issues, quality 64
- D1.6 (dead target 9930): mission `06a77ddd` / session `39ce073d` — target killed mid-run; agent asked ask_question ("target down — how to proceed?"), answered honestly → mission failed STOP_FAIL, session done with model-authored **blocked** verdict, 1 legitimate critical availability finding, 8 linked evidence rows, 0 fabricated test cases
- D1.8 restart: procmgr restart of service-bg-service-3962 → health 200 → entire chain re-verified intact

## D1 defects found & fixed
1. Evidence loss on STOP_FAIL + honesty-guard paths (index.js) — extracted collectEvidenceForSession(), now runs on EVERY terminal path. Proof: d52f255d STOP_FAIL mission → 250 linked rows.
2. Workflow→test-case provenance broken (testGen.js + testCases.js): generateTestCasesFromWorkflow dropped sessionId/missionId; createTestCases stamped source:'workflow' unconditionally. Fixed: sessionId+missionId passed through and stamped at creation; source:'mission' when missionId present.
3. testGen max_tokens 4096 truncation → 16384 + truncation-tolerant salvage parser (finish_reason 'length' errors carry partialContent; complete objects salvaged).
4. Capability timeout 180s hard-coded → QASE_CAPABILITY_TIMEOUT_MS env, test_generation ≥300s, per-attempt timeout.
5. Turn-budget awareness: prompt.js "# Turn budget" block + agent.js tool-seam [BUDGET] annotation (annotates copy, never mutates SDK objects) — the agent now wraps up + calls finish_qa_report before the wall instead of hitting deterministic close-out.
6. replay.js self-heal branch unreachable: isSelectorFailure({ ...stepResult, action: step.action }).

## Test suite
- tests-real/d1-golden-e2e.test.js — 15 named cases, all green with LIVE IDs (env: D1_GOLDEN_MISSION/SESSION/WORKFLOW, D1_RUNA_MISSION, D1_RUNB_MISSION, D1_D16_MISSION). Suite handles Phase 9.3 session-shell pruning (falls back to mission evidence graph when the session 404s).

## Key architectural facts (re-learned, keep)
- Session shells are PRUNED (50 count / 12MB pretty-printed byte budget, server/store.js pruneOldSessions). Agent missions ~1MB each → regression sweeps evict old golden shells. Findings/evidence/workflow/test cases retain linkage — that's the documented contract.
- v1 mission start: POST /api/v1/missions/:id/start. Mission list: /api/missions (non-v1). Findings by session: /api/findings?sessionId=… (missionId filter NOT supported — only projectId/severity/status/category/assignee/sessionId/q).
- /api/v1/missions/:id embeds finding copies WITHOUT linkage fields — read the persisted findings store for provenance.
- maxTurns: body.context.maxTurns ?? body.maxTurns (constraints ignored), clamp 1–500.
- targetGuard: QASE_ALLOWED_LOCAL_TARGETS env extension (already includes 9930/9931) — sanctioned way to add throwaway targets.
- phase17-e2e needs ~900s (SWEEP_SECONDS) — run with timeout ≥ 900 and NO other live missions running, else it collides and b1-live-retry-turns flakes.
