# C3 — Finding Quality + Mid-Session Autonomy (build contract)

Baseline: C2 @ `1766bec` (main, published). Baseline analysis: `docs/C3-BASELINE.md`.

## Goals

A. **Target quality** — an uncertain application classification must not mass-produce decision-grade missing-feature findings.
B. **Finding quality** — decision-grade evidence vs informational evidence must be distinguishable at the decision boundary, without hiding uncertain findings.
C. **Mission/finding linkage** — every mission-iteration finding retrievable via `missionId`; v2 filter correct for new findings.
D. **Mid-session autonomy** — a bounded, deterministic decision probe DURING an active mission, additive to the settle gate.

## Invariants (all builds must preserve — violating any = STOP and report)

1. Budget authority stays external: autonomy may REQUEST iterations, never GRANT budget. No autonomy path may set/increase `maxTurns`. The 500-turn ceiling is absolute.
2. Every dispatch consumes only the remaining authorized mission pool; guarded handler (iteration limit, no-improvement, turn-pool debit) remains the ONLY dispatch path.
3. targetGuard/SSRF validation untouched and still mandatory for every navigation target.
4. Authentication boundaries untouched (public = `/api/health`, `/api/v2/health`, `/openapi.json`; everything else 401s).
5. STOP_FAIL conservatism: a **confirmed** critical (decision-grade, per Phase-3 definition) must still STOP_FAIL. Filtering exists to keep UNCONFIRMED evidence from manufacturing verdicts — never to soften real ones.
6. No evidence is ever deleted/hidden to improve numbers. Uncertain findings stay visible, tagged informational where appropriate.
7. Decision traces keep the 13-field schema; `signals_used` stays KEYS-ONLY; no chain-of-thought, prompts, secrets, credentials, or auth headers ever enter a trace.
8. Existing APIs, C1 handoff package, and C2 traces remain compatible (additive fields only).
9. No LLM may make a safety-critical filtering decision where a deterministic rule suffices. All C3 gates are deterministic.
10. Do not modify benchmark semantics to flatter C3; the C2 measurement bug (v2 mission filter) is fixed at the data level (Phase 4), not by changing the benchmark.

## Phase contracts

### P2 — Target-type/input-quality gate (featureGap.js)

- Gate **purpose-catalog expected features** on `purpose.confidence` (existing computation). Deterministic floor: catalog expected features are generated only when `purpose.confidence ≥ 0.5` (i.e., inferred type is at least as strong as a 1.5/3 keyword match at full exploration depth). Below floor → skip catalog-derived expectations entirely; record `excludedByUncertainty: true` + the excluded count in the gap analysis (structured, auditable).
- Exploration-depth already multiplies every gap confidence (`conf()` :698) — unchanged.
- Context-derived features (stated intent, conf 1.0) and workflow gaps keep current behavior (their confidence math already scales with purpose confidence).
- Agent-filed findings, console errors, broken links — untouched (different creation paths).
- Classification uncertainty surfaces in structured data: gap analysis carries `purposeId`, `purposeConfidence`, `explorationConfidence`, `gated`.

### P3 — Confidence-quality policy (decisionEngine.js)

- New deterministic concept in `collectDecisionInput`: **decision-grade finding** = non-duplicate finding whose severity ∈ {critical, high} AND (confidence is a number ≥ 0.7 OR confidence is null/unknown — legacy/agent-filed findings without scores keep legacy weight, precedent: existing 0.5 default + RULE-5 0.7 threshold).
- `criticalCount`/`highCount` as consumed by DECISION rules (STOP_FAIL paths, Safety Rule 3) switch to decision-grade counts. Raw counts remain in the input as separate signals (`rawCriticalCount`, `rawHighCount`, `lowConfidenceCriticalCount`) — traces show which gate mattered via `signals_used` keys.
- A low-confidence critical can NO LONGER single-handedly produce STOP_FAIL or Safety-Rule-3 pass-blocking. It CAN still drive INVESTIGATE (verification iteration) — visible, bounded, honest.
- findStatusEngine/fix-validation paths unchanged.

### P4 — missionId linkage (findings.js, store boot)

- Write-time: `syncSessionFinding` stamps `missionId: session.missionId` when absent (both create and update branches).
- Boot-time guarded backfill (idempotent): store findings with null missionId + non-null sessionId that resolve to exactly one mission via `sessionId` (the same resolution index.js:1941 already trusts) get missionId stamped once. No match → untouched forever. Mission documents are NOT rewritten.
- v2 `/findings?mission_id=` then returns new findings correctly; historical unlinked records remain readable.

### P5 — Mid-session decision probe (agent.js + index.js wiring)

- Probe point: per-turn boundary in `agent.js` (`assistant_turn_start` case), fire every K=4 turns (deterministic), only when `session.missionId` exists and the session is running. Read-only on the session.
- Probe mechanics: injected async hook `onTurnBoundary(session, turnCount)` → in index.js builds engine input from live state, calls `makeDecisionSafe` (same engine/vocabulary), guards: one in-flight, cooldown (no probe while previous probe < 5s old), input-signature anti-churn (identical signature + no new findings ⇒ suppressed).
- Probe outcomes:
  - CONTINUE / INVESTIGATE / REPLAN / REVALIDATE → record trace (`state: 'session:running:probe'`), set `session._probeHint` consumed by the SETTLE gate (the settle decision remains authoritative; REPLAN focus payload passed through), NO mid-run agent steering, NO dispatch from the probe.
  - ESCALATE / STOP_FAIL **with decision-grade critical evidence** → early settle: stop the turn stream via the EXISTING AbortController seam (same mechanics as budget abort), status → done, normal finalize path runs the authoritative decision. Never fabricated, never silent.
  - STOP_BUDGET / STOP_BLOCKED from a running session → ignored at probe time (settle gate owns them).
- Probe NEVER: touches maxTurns, dispatches iterations, mutates findings, writes non-trace state, runs an LLM, blocks the stream.

### P6 — Trace schema

- No new fields. Probe traces use existing `state` (`session:running:probe`), `iteration`, budget columns. Settle traces unchanged (`session:done|idle|error`).

## Tests (TDD — write first)

- `tests-real/c3-finding-quality.test.js` (P8): classification correct/uncertain/unsupported × feature-gating; high-conf critical / low-conf critical / high-conf non-critical / duplicate / contradictory / none; decision-grade consumption; linkage (create→missionId, multi-iteration grouping, cross-mission isolation, historical null-missionId preservation, v2 filter); backfill idempotency.
- `tests-real/c3-mid-session-autonomy.test.js` (P7): probe fires at K-turn boundaries before pool exhaustion; different live states → different probe decisions; INVESTIGATE hint consumed at settle; REPLAN changes next focus; CONTINUE no-op; STOP_FAIL early-settle path; REVALIDATE still guarded (no dispatch from probe); budget never exceeded by probe paths; no autonomy path can assign maxTurns; trace written & complete; execution linked to mission/iteration.

## Live benchmark (P9) — reuse C2 harness unchanged

A (autonomy off) × B (autonomy on) × 4 targets (9901, 9902, 9903, new.drytis.com). Measure: findings, confidence distribution, criticals, outcome, decision count/types, iterations, turns, budget requested/granted, re-plans/investigations, stops, low-confidence patterns, missionId retrieval correctness (assert ≥1 non-zero retrieval; distinguish "no findings" from "filter failed"). No favorable tuning; deltas reported as measured.

## Acceptance = Phase-11 checklist in the build order. Publish gate: all suites green + gates pass + final report written. Do not publish until the operator says so.
