# DEV→NIHARIKA merge #14189 — RESOLVED and PUSHED

Merge commit **d5d9d57** on NIHARIKA (= origin/NIHARIKA), parents ae6bfc6 (checkpoint) + 66d7f85 (origin/DEV). Suite: 823 tests, 0 fail.

## Late fixes found while resolving (beyond earlier session notes)
1. **localServices.js auth injection** — DEV's `createLocalApplicationServices` ends with `auth: options.auth ?? auth` so test-injected fake auth wins; our resolution had plain `auth` which silently replaced it → feedbackApi/drytisTickets/pilotFlow 401s. Restored DEV form.
2. **store.js STATE_DIR frozen at import** — `const STATE_DIR = path.join(process.cwd(), '.qase')` captured /workspace; tests that chdir after import then read/wrote the ambient workspace state (localServices.test.js setFindingStatus 2!==1 root cause). Replaced with `statePaths()` resolved lazily at call time in `persistNow`/`loadSessions`. Reproduction confirmed pure DEV fails the same way with /workspace/.qase/sessions.json present.
3. **styles.css rules lost in the earlier rebuild** — restored DEV's standalone feature rules: `.run-title .run-engine-pill, .chat-title .run-engine-pill` (near .run-meta), `.sqa-option.is-unavailable` ×2, and `.viewer.stage-collapsed` blocks adapted to HEAD's auto-track grid (base + cli-theme + no media-query variants needed). All inserted as new blocks, HEAD theme untouched.
4. **stageCollapseUi.test.js regex** — DEV asserted `minmax(\d+px, \d+%)` units which contradict HEAD's #14074/#14102 grid (`1.2fr`, `40dvh`). Loosened to `[\d.]+(%|fr|dvh|vh)` with comment; HEAD layout kept per ruling (c).
5. **postgresServices.js line 520** — `options.deviceRuntime` → destructure-level ReferenceError; now uses destructured `deviceRuntime`.
6. **contracts.js** — `environments` was made required by NIHARIKA, breaking DEV-only fixtures; removed from REQUIRED_METHODS (app.js guards with `services.environments?.list`), and noop feedback stubs added to catalogApi/environmentApi/testCaseApi fixtures.

## Push
Plain `git push origin NIHARIKA` worked despite the earlier token issue; plain fetch of NIHARIKA also fine now (the protocol.version=2 single-ref workaround was only needed for DEV). Branch in sync: 0/0. Stray screenshot userDocs/image_df7e81c0.png intentionally left untracked.
