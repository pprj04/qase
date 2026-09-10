# R2-B-H — Reliability Test Isolation Fix

## Goal
`tests-real/session-timeout.test.js` (and the RL-2 check in `tests-real/phase9.3-resource-lifecycle-v2.test.js`) must never read or write the live dev store at `/workspace/.qase/`. All reliability tests own a temporary QASE data directory that is removed afterwards. Zero production-code changes. Zero weakened assertions.

## Verified root cause (do not re-derive; proven 2026-09-03 with stack-trace instrumentation)
- `session-timeout.test.js` dynamically imports `../server/agent.js` with cache-busting query strings (`resolveWith`, `agentModule`).
- Each cache-busted import instantiates a FRESH `server/store.js` whose module-scope `STATE_DIR = path.join(process.cwd(), '.qase')` / `STATE_FILE = sessions.json` resolves against the test-runner cwd = `/workspace` (store.js does NOT honor `QASE_DATA_DIR`).
- The fresh store's in-memory map is EMPTY (nothing in the agent import graph calls `loadSessions()` at import time).
- Test D2.1-4 calls `finalizeTurnLimitedRun(session)` on a synthetic session → `addMessage` → `emit` → `persistSoon()` → 250 ms debounce (`setTimeout(...).unref()`) → `atomicWrite(STATE_FILE, JSON.stringify([...emptyMap]))` → the real `/workspace/.qase/sessions.json` is overwritten with `[]`.
- Proven pre-existing: reproduced against a clean `f18049a` (pre-R2-B) git archive with an explicit 600 ms hold — canary wiped to `[]` with zero R2-B code present.
- The wipe is deterministic when the process outlives the 250 ms debounce (always true for this ~13 s suite in /workspace).

## Baseline (verify before touching anything)
```
cd /workspace; export GIT_CONFIG_GLOBAL=/dev/null
git rev-parse HEAD          # expect e0ad149 (R2-B)
git status --short          # expect: corrupt tests/* + docs/phase-3-knowledge-audit.md "Structure needs cleaning" noise (NEVER stage), possibly modified artifacts/e2e-shots/* runtime artifacts (never stage)
git fsck --no-reflogs --full
git log --oneline -5        # e0ad149 / f18049a / 47be723 / 50c94a1 / 53e0fa3 expected in order
```

## Fix 1 — session-timeout.test.js (the mandated isolation)
- At the very top of the file (before ANY dynamic import executes — imports run lazily inside tests, so module-top is sufficient): `mkdtempSync(join(tmpdir(), 'qase-st-'))` then `process.chdir(tmp)`; keep `const ORIGINAL_CWD = process.cwd()` captured BEFORE chdir.
- Register an `after()` hook: `process.chdir(ORIGINAL_CWD)` then `rmSync(tmp, { recursive: true, force: true })`.
- Add a hermeticity guard in the style of `b1-crash-restore.test.js`: snapshot the REAL `/workspace/.qase/sessions.json` (byte hash + existence) at suite start (before chdir); in `after()`, assert it is byte-identical (or still absent if it was absent). Never create it.
- All 12 tests keep their exact assertions, wording, and order. Do not delete/weaken any test. `resolveWith` and `agentModule` need no path changes — relative specifiers resolve from the FILE's location, not cwd; only the store's cwd-derived `STATE_DIR` moves to the temp dir.
- The temp `.qase/sessions.json` (written by the fresh store's debounce) is the proof the test used its own store — assert in `after()` that `<tmp>/.qase/sessions.json` EXISTS (the empty-map write landed there, not in /workspace).

## Fix 2 — phase9.3-resource-lifecycle-v2.test.js RL-2 (must PASS honestly, not be excused)
Current RL-1/RL-2 statically read `process.cwd()/.qase/sessions.json` — from /workspace that is the LIVE dev store, which the isolation bug already wiped to `[]` (33 shells lost; findings/missions/evidence intact). RL-2's `assert.ok(data.length > 0)` therefore fails on legitimately-empty dev data.
- Do NOT special-case empty as pass-and-forget and do NOT relax the bound — that weakens the test.
- Make the suite hermetic the same way (temp cwd) and give RL-1/RL-2 real inputs to bound: inside the temp cwd, drive the REAL store module — `createSession()` × ~80 (varying payload sizes, distinct `updatedAt`), then `pruneOldSessions()` — then keep the existing on-disk assertions (file exists, < byte bound, `0 < count <= 50`), plus assert the pruned file content actually shrank to the keep-count. This preserves the assertion's intent (pruning bounds the store) and makes it deterministic instead of dev-data-dependent.
- Preserve every other test in that file unchanged unless it also touches the live store — if so, apply the same temp-cwd treatment minimally.
- If inspection shows the file has structure that conflicts with chdir (e.g. it spawns a child server with its own cwd already), adapt with the established child-spawn pattern from `reliability-resource-lifecycle.test.js` instead — the invariant (never touch `/workspace/.qase`) is the requirement, chdir is just the mechanism.

## Proof protocol (exact commands, mandated)
1. `cp /workspace/.qase/sessions.json /tmp/qase-sessions-before.json` (it is currently `[]`; that is the honest current state).
2. Run the isolated session-timeout suite.
3. `cmp /workspace/.qase/sessions.json /tmp/qase-sessions-before.json` → MUST be identical.
4. Prove temp-store usage (see Fix 1 after() assertions + log the temp path in suite output).

## Regression gate (run exactly these; report exact pass/fail/skip per suite)
session-timeout · reliability-resource-lifecycle · reliability-awaiting-input · reliability-lifecycle · reliability-runtime-kick · mission-governor · m1-p4.3-state · phase9.3-resource-lifecycle-v2 · phase9-closure-browser-recovery · b1-crash-restore · phase1-session-watchdog
- Zero new failures; RL-2 passes.
- After the FULL battery: `cmp /workspace/.qase/sessions.json /tmp/qase-sessions-before.json` → identical (proves the whole battery is now clean, not just the one suite).
- Known live-server caveat: the dev server (booted 08:12, holds the pre-wipe 33 sessions in memory) can legitimately rewrite sessions.json on session mutation. The battery must not trigger it (no missions are running). If cmp fails, determine the writer FIRST (mtime + instrumented atomicWrite stack trace) before concluding anything — do not retry-blind.

## Git safety
- NEVER `git add -A`. Stage ONLY: `tests-real/session-timeout.test.js` and (if changed) `tests-real/phase9.3-resource-lifecycle-v2.test.js`.
- Never touch: corrupt `tests/` tree, `docs/phase-3-knowledge-audit.md`, `.qase/` runtime data, both ui-redesign stashes, artifacts/e2e-shots.
- Review `git diff --stat` + `git diff -- tests-real/session-timeout.test.js` — diff must be narrowly isolation-scoped.
- Commit exactly: `Test isolation — prevent reliability tests from touching live QASE data`
- Verify commit SHA, `git log --oneline -3`, and expected working tree (only the known noise above).

## Scope guard
IN: the two test files above; nothing else. OUT: production code (store.js/agent.js/index.js), R3 persistence work, new architecture, QASE_DATA_DIR support in store.js (that is R3 territory), unrelated tests, UI.

## Stop conditions
Isolation implemented · real sessions.json proven untouched (single suite AND full battery) · all 11 suites green with exact counts · RL-2 passes · separate commit created + verified · ticket left In Progress (board has no In Review column; never Done — user accepts) · STOP — do NOT begin R3.
