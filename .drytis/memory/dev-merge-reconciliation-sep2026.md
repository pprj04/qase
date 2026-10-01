# Reconciling DEV with teammates (Feedback v2/v3, phases 3-12, Studio UI)

2026-09-30: Published local QA test-selection + security-authorization work to DEV after
two rounds of reconciliation. Ticket #13955 (Done).

## What was merged and how
1. **Round 1** — 7 incoming commits (Manoj: Feedback v2/v3; Pushkar: QASE phases 3-12)
   conflicted in 7 files. Resolution:
   - Kept remote's relaxed `017_run_feedback.sql` (comments 0-4000, DEFAULT '').
   - Renumbered local migrations `018_qa_test_selection` → **021**, `019_security_authorization`
     → **022** (after remote's 018_run_engine_device / 019_run_cohort / 020_run_feedback_column).
     Don't forget the internal `-- Qase PostgreSQL migration NNN` comments — migrations.test.js
     parses them for the order assertion.
   - runRepository INSERT/SELECT combine engine/device/device_landscape/cohort AND
     selected_tests/security_authorization. Hydration is by column name, order-free.
   - QA launcher dialog holds BOTH the engine/scope fieldsets (remote) and the tests-catalog
     fieldset with the security authorization gate (local). Submit loops per-engine with the
     same selectedTests/securityAuthorization.
   - Two payload-regex tests (qaUiSelection.test.js, securityGateUi.test.js) had to be
     rewritten for the new multi-line createQaRun body.
2. **Round 2** — Studio UI alignment (fonts/tokens/selectors, e034c73) auto-merged cleanly;
   the keepalive.test.js failure seen in one full-suite run was a **timing flake**
   (passes in isolation and on re-run).

## Latent bug found & fixed (see runRepository-insert-off-by-one.md)
insertAggregate had 31 columns / 30 expressions / 29 params — security_authorization had no
placeholder. Introduced in 3f0d437 (both sides' ancestor), so EVERY parent carried it.
Fixed with $29 + a structural guard in runRepository.test.js (placeholder count vs params).
Beware global `sed '$28'→'$28,$29)'` — it also mangled `COALESCE(report_ended_at, $28)`
in save(); reverted in ef8e925.

## Lesson
The reviewer's fake-pool tests never parse SQL — column/placeholder imbalance passes silently.
When merging two branches that each appended columns to the same INSERT, always recount
columns vs expressions vs params mechanically (a small script beats eyeballing).
