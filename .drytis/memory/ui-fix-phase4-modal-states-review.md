# Review: ticket #13977 — UI Fix Phase 4 (modals, tables, empty states, dead UI)

**Overall: PASS** — 5 WARNs, none blocking. Tester browser-verified 5 dialogs fit + Escape at 1024×768, environments dialog gone (13 dialogs), empty states live (after one re-test round), table ellipsis/scroll, bulk/test-case chips.

## Verified
- Dead #environments dialog removed: index.html 13/13 dialogs balanced, no dup ids, single </body></html>; app.js ~131-line controller block removed cleanly (node --check OK, file tail clean — prior syntax error fixed); bulk-envs-field hidden wrapper removed, DEVICES label always visible; CSS #env-filters/.env-detail/.env-availability removed while .env-table/.env-table-wrap/.env-summary kept (latter re-added for #dm-env-summary).
- Escape safety-net at app.js:4682-4688: closes topmost dialog[open] only when NOT :modal (no double-cancel).
- Empty-state copy: all 5 strings present as static literals (app.js 1903/1982/2016/2215, index.html:213 bugs). 'Nothing yet' gone.
- Table: deviceMatrixView.js td.title tooltip added; .env-table td max-width:220px + ellipsis; wrap overflow-x:auto.
- Tests: npm test 835 total / 826 pass / 9 skip / 0 fail; node --test public 95/95 (was 89 — +6 runtimeStatusVocabulary.test.js, behavioral).
- Security: no new dynamic innerHTML; no secrets/URLs.

## WARNs (not fixed)
1. Dead CSS remains: #environments + #environments::backdrop + .modal-head/h2/p rules (styles.css:8077–8082) orphaned — dialog id gone.
2. Stale copy: test-cases dialog description (index.html:821) still says "assign them to one or more Apple environments" — outdated (devices now) and the only remaining 'Apple environments' text.
3. Spec item 6 loading states ('Loading device catalog...', etc.) NOT implemented — no loading/error state in devicePicker.js; catalog loads at boot with silent .catch(() => null). Tester round: INCONCLUSIVE (cache masks). DEVICE UNAVAILABLE error path exists (pre-existing).
4. Everything still uncommitted (8 modified + 3 untracked test files on HEAD 611d41c). sidebar-cards.png deletion is good cleanup, also uncommitted.
5. Accessibility AC (tab-through QA dialog, focus ring) only partially verifiable statically; tab arrow-nav exists (app.js:4725).

Test expectations shifted: npm suite now 835 total (new public tests picked up by server harness). Known drytisTransport nonce flake can reproduce; re-run confirms.
