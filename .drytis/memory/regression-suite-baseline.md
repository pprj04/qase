# Regression suite baseline — Build 4 (2026-08-21)

Full suite: `QASE_API_TOKEN=… node --test tests/` → **1104 tests, 1103 pass, 1 fail,
0 skipped** (with token exported). Without the token ~27 phase16/17 tests fail —
harness env gap, NOT regressions; most phase files read the token from env only
(phase18 additionally falls back to /workspace/.env).

## The single failure: C2 cross-suite race
`tests/device-execution.test.js` C2 "device via POST /api/test-cases/run { device }
→ EMULATED_DEVICE" expects provider `local` but gets `browserstack` **only when
run concurrently with `tests/execution-provenance.test.js`** (and sometimes other
suites). Root cause: execution-provenance mutates the stored BrowserStack config
mid-run (writes .qase/config.json) while C2's device run resolves its provider.

Evidence it's a harness race, not a product bug:
- `node --test tests/device-execution.test.js` alone → 27/27 pass
- `node --test tests/device-execution.test.js tests/execution-provenance.test.js` → 28/28 pass
- Direct `POST /api/test-cases/run {device}` → provider `local` (correct)

First documented in Build 2. Fix would require serializing the two suites or
per-test config isolation — out of scope for Build 4 (no engine/test changes).

Re-verified during Build 4 (2026-08-21 16:00): same 1104/1103/1 signature;
phase17-ux-checks + phase16-e2e + phase18-e2e 62/62; device-execution 27/27
isolated; browserstack-trust + device-context 32 pass / 5 skip / 0 fail.