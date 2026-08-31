# QASE — Build History

Verified against git 2026-08-29 (`main`; `GIT_CONFIG_GLOBAL=/dev/null` required in this container). Full phase history (Phases 1–18, M1 hardening) exists below these builds — see `git log --oneline` and `docs/` per-phase reports.

| Build | Commit (verified) | Date | Purpose / major changes | Status |
|---|---|---|---|---|
| **B0** | `0525ba7` | 2026-08-25 | Baseline, hygiene & operational safety: export `/api` prefix 404 fix, tests-page config bypass fix, B0 regression tests + baseline report | ✅ shipped; in prod lineage |
| **B1** | `2ae4888` | 2026-08-25 | Integration contract + security boundary: instance API-token gate (Bearer/cookie/query), HMAC integration auth with scopes+workspaces, correlation IDs, production webhook delivery (signatures, retries), crash-restore, security-negative tests. This made every `/api` route authenticated (single-tenant posture) | ✅ shipped; in prod lineage |
| **B2** | `9023a42` | 2026-08-26 | Autonomous control loop: decision engine wired end-to-end, `session.testContext` producer, turn-pool budget debit, deterministic close-out, 13-field decision traces, A/B benchmark harness | ✅ shipped; in prod lineage |
| **C1** | `e7b0cb3` | 2026-08-26 | Dev-team usage/traffic API: `/api/v2` read surface (32 GETs), live OpenAPI document, usage-summary aggregation, bounded API telemetry, dev-team playbook + reference client | ✅ shipped; in prod lineage |
| **C2** | `1766bec` | 2026-08-27 | Production autonomy: INVESTIGATE/REPLAN/CONTINUE decision rules, turn-budget-aware + breadth-aware decision inputs, guarded resolveAction mapping, live decision proofs, A/B benchmark, final report | ✅ shipped — **this is what production runs today** |
| **C3** | `2a22a74` | 2026-08-27 | Finding quality + mid-session autonomy: purpose-confidence gate on feature-gap expectations, decision-grade finding counts for STOP_FAIL, missionId write-time stamp + backfill (closes v2 findings-by-mission gap), deterministic K=4 mid-session probe with auditable traces, live A/B benchmark | ✅ shipped — current HEAD; preview runs it |
| **C4** | — (never committed) | planned 2026-08-27 | BrowserStack productionization: encrypted secret store, agent-runtime BrowserStack attach with provenance, five-state settings UX, strict no-fallback | ❌ **NOT BUILT.** The working-tree implementation was destroyed by a container restart on 2026-08-27 (uncommitted). Spec survives at `.drytis/specs/C4-browserstack-production.md`. Nothing in the repo implements it — verified (no `secretStore.js`, no agent attach code). |

**Key lesson (recorded in `.drytis/notes/restart-wipes-uncommitted-work.md`):** this platform's container restarts reset `/workspace` to the last pushed commit. All post-C3 work — C4 AND an OpenAPI guide-audit patch (envelopes for `/api/v2/projects` + `/regression/trend`, filters, name joins; spec at `.drytis/specs/pulse-openapi-audit-fixes.md`) — was lost. Commit before restarting; publish before handing off.

**Checkpoint quick-reference:** B0=`0525ba7` · B1=`2ae4888` · B2=`9023a42` · C1=`e7b0cb3` · C2=`1766bec` · C3=`2a22a74` · HEAD=`2a22a74` on `main`, clean. C5 (LLM role separation / model governor / regression learning) is roadmap only — no code exists.
