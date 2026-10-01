# React UI rebuild progress (tickets #14023–#14029)

Blueprints: .drytis/specs/react-ui-redesign.md + react-ui-phases-1-4.md + react-ui-phases-5-7.md.
React app served at /app-react/ (Vite build → public/app-react/, gitignored). Legacy at / until Phase 7 cutover.

## Phase status
- #14023–#14028 (Phases 1–6) — ALL DONE, verified (reviewer PASS each phase, tester PASS every surface), committed locally on DEV.
- #14029 Phase 7 — IN PROGRESS. Done so far: reviewer WARN fixes committed (ErrorBoundary resetKey on open flags; launcher kickoff failures now toast instead of dead setError; 7 new unit pins in server/reactPhase6Pins.test.js: RUN_ID_PATTERN==legacy, unconditional consumeRunParam, bare-array /feedback contract, feedback catalogues, bugs rollback, resetKey wiring, kickoff-toast). Suite 801/781/0.

## Phase 7 REMAINING (per spec react-ui-phases-5-7.md)
1. SQA view tab + Founder view tab + founder completion report (showCompletedFounderReport equivalent) — NOT BUILT (spec gap flagged by reviewer; must build or descope with user).
2. Drytis board push (accept-all/push) — not built.
3. Activity/Plan viewer tabs, cursor overlay — not built (Phase 5 leftovers).
4. Roving tabindex on tabs; 1920px verification.
5. Cutover: vite outDir → public/, remove legacy files (app.js, entry.js, entry-motion.js, styles.css, bugsView.*, entry-terminal.css, uiPrimitives? — careful: shared client modules qaKickoff.js still imported by tests), rework 21 legacy-pinning tests to React equivalents (single status chip, security gate sequencing, stage collapse, engine pill, no datalist, RUN_ID_PATTERN, showCompletedFounderReport, uiPrimitives import contract, fillModelOptions...). server/finalUiPolish.test.js pins legacy styles.css .viewer rule!
6. E2E both themes, publish to DEV, deploy per .drytis/memory/prod-deploy-ritual.md (restart_production does NOT pull latest — must reset prod to origin/DEV manually).

## Traps learned (accumulated)
- CSP: inline scripts blocked — theme bootstrap is external scripts/theme-bootstrap.js copied by build:react.
- /api/sqa/catalog profiles+sources are KEYED OBJECTS; attributes string[].
- /api/feedback returns a BARE ARRAY (not {records}) — cost one tester round.
- configStore must re-fetch /config on sign-in.
- .qase/auth.json edits are overwritten by running server's persist() — stop service (procmgr stop), edit, restart. Test account bugtracker-test@drytis.example is now role=admin (cred.json updated).
- CSS: base rules must precede @media blocks that override them (cascade) — overlay close button bug.
- git commit occasionally leaves stale .git/index.lock after timeout — rm it, retry with --no-verify.
- npm test flaked once during procmgr restart (port contention) — rerun before diagnosing.
- plain `git fetch` hangs in this clone; use `git fetch origin DEV`.
- Build/verify loop: typecheck → build:react → npm test → procmgr restart service-bg-service-4182 → curl /app-react/ bundle hash → delegate tester with explicit testids.

## Verification status at last save
Preview https://qase-2-1-jywqe4.drytis.dev/app-react/ serving index-react-D4SzSY9l.js. All Phase 6 surfaces browser-tested PASS. Work NOT yet published (git_manager publish pending user approval).
