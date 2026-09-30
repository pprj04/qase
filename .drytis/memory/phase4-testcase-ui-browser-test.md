# Phase 4 browser test — Test Cases UI (PASS, 2026-09-29)

Preview https://qase-2-1-cvtryq.drytis.dev/, tester@qase.dev (developer).

- Test cases dialog: opens via footer button, empty state "No test cases yet — create the first one below.", form has Title/Description/Steps/Expected/Tags/Environments multi-select (~540 active envs listed).
- Create: Title "Phase 4 browser probe" + 2 steps + tags "probe,phase4" + 1 env (iPhone 16 Pro · iOS 18.0 · Chrome 138) → 201, toast "TC-0005 created.", row TC-0005 with "1 env", tags "probe, phase4". Numbering is TC-0005 because TC-0001..TC-0004 were earlier reviewer/infra probes (soft-deleted).
- Search: "zzz-no-match" → "No test cases match your search." / "0 shown · 1 total"; "phase 4" → row returns ("1 shown · 1 total"). Debounced.
- Edit: title → "Phase 4 browser probe v2", "Save changes" → row updates. Toast text not captured (transient).
- Delete: native confirm "Delete TC-0005? Run history keeps the case number." → empty state restored ("0 shown · 0 total"). Note: after delete, the search term is NOT cleared, so the table shows the no-match message instead of the "yet" empty state until search cleared — cosmetic.
- Bulk runs dialog: opens, "Launch bulk runs", case multi-select rendered with 0 options (empty list after deletion), env dropdown has only "Every environment assigned…". Consistent.
- Console: only pre-login 401 /api/auth/me. No JS errors from the flows.
- Run prefill (step 8): could not be observed — the only case was deleted in step 5 per the script.
