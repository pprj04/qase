# Push workspace changes to DEV branch

Ticket: (to be created) · Date: 2026-09-30 · Repo: git.drytis.dev /qase-2-1-3542.git

## Current state (verified read-only)

- Working branch `PUSHKAR` @ a8b271b, clean vs origin/PUSHKAR (LIVE also @ a8b271b).
- **All phase work (Phases 3–12 + fixes) is uncommitted**: 43 modified files
  (+2762/−191) plus ~70 untracked source files (analytics.js, browserEngines.js,
  invites.js, securityChecks.js, targetReachability.js, followUp.js,
  qaKickoff.js, migrations 013–015, 20+ tests, docs, specs).
- `origin/DEV` (3f0d437) is a **fast-forward descendant of a8b271b** — no
  divergence. DEV carries MANOJ's User Feedback feature (rating modal,
  `qa_run_feedback` table as migration 017, feedback CRUD APIs, admin review
  panel) + DEV-only migrations 013–016 (run_timing, token_usage,
  finding_status, run_pause).

## Conflicts to reconcile

1. **Migration numbering 013/014/015 collides** with DEV's 013–017.
2. **Feedback design conflict (the real decision)**: our Phase 4+6 work uses
   `qa_runs.feedback` jsonb column (migration 013, hydrated in runRepository);
   DEV's MANOJ feature uses a standalone `qa_run_feedback` table (017) with
   feedbackRepository. Both would coexist post-merge.
3. **21 shared file paths** collide textually; highest friction:
   server/app.js (both added routes), server/store.js, public/app.js,
   runRepository.js (both extended the same INSERT/SELECT lists),
   migrations.test.js (both pin name lists).
4. **Junk in the tree** that must NOT be committed: 976K
   libgstreamer-*.deb at root, engine-tag-verify.png (128K) at root,
   userDocs/image_73eed07c.png (288K) — and note DEV already added
   userDocs/image_aeb01276.png, so that one is an add/add binary collision
   (keep DEV's copy, drop ours from the commit set).

## Plan (single ticket, ordered steps)

1. **Clean the commit set**: remove the .deb from the tree (move to /tmp),
   gitignore root-level *.png; add `.qase.corrupt-*` file-pattern fix; do
   NOT commit engine-tag-verify.png / image_73eed07c.png (keep local, ignored).
   Keep `.drytis/memory` + `.drytis/specs` tracked (existing convention).
2. **Renumber our migrations**: 013_run_feedback → decision (step 3),
   014_run_engine_device → **018_run_engine_device**, 015_run_cohort →
   **019_run_cohort**. Update migrations.test.js expectations.
3. **Feedback reconciliation decision (needed from user/Thomas)**:
   - Option A (recommended): **adopt DEV's table model** — drop our 013
     jsonb-column migration and the runRepository feedback column
     read/write; map our thumbs up/down + note onto DEV's qa_run_feedback
     via feedbackRepository; keep our /api/sessions/:id/feedback endpoint
     shape but back it with the table. Single feedback source of truth.
   - Option B: keep the jsonb column (cheap hydration) and leave MANOJ's
     table dormant. Two feedback systems coexist — confusing, not
     recommended.
4. **Commit workspace work on PUSHKAR** (logical commits: reliability+run
   dependability; product UX + customer journey; security suite; engines;
   pilot; ops/launch; verification fixes) — or one consolidation commit
   `chore: consolidate phases 3–12 verified workspace changes` matching the
   repo's existing convention (ea5200a).
5. **Push PUSHKAR to origin/PUSHKAR** (keeps prod branch current).
6. **Merge PUSHKAR → DEV**: `git checkout DEV; git merge --no-ff PUSHKAR`
   resolving the 21 collision files (union columns in runRepository INSERTs;
   union routes in app.js; combine migrations.test.js lists; binary PNG:
   keep DEV's). Resolve conflicts using the DESIGN decision from step 3.
7. **Run full `npm run verify` + QASE_RUN_BROWSER_TESTS=1 test:browser on
   the merged DEV** — must be green (that's the whole point of DEV).
8. **Push origin/DEV**. Report merge commit + test totals.
9. Update memory (prod-deploy-flow.md: DEV now carries phases 3–12).

## Rollback
- Nothing is rewritten on the remote: PUSHKAR gets a new commit on top,
  DEV gets a merge commit on top. Both revertable by pushing prior SHAs'
  forward commits; no force-push anywhere.

## Acceptance criteria
- [ ] origin/DEV contains all phase work, tests green on merged tree.
- [ ] No binaries >100K accidentally committed (no .deb, no stray PNGs).
- [ ] Migration sequence on DEV is unique-numbered, forward-only.
- [ ] origin/PUSHKAR updated and in sync with the workspace commit.
- [ ] prod (a8b271b via PUSHKAR) untouched — deployment is a later decision.

## Open question for the user (blocks step 3)
Feedback model: adopt DEV's `qa_run_feedback` table (Option A, recommended)
or keep the jsonb column (Option B)?
