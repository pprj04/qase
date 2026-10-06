# RT5 · Session/evidence isolation, video & findings context

## Goal
Every execution is fully isolated — own session, evidence, logs, environment metadata — and evidence proves which environment executed. Findings carry the exact environment. Coverage/gap reporting distinguishes all required states.

## Work
1. **Video evidence**: context-level video recording (Playwright `recordVideo`) per session where supported; artifact linked to the execution session; disabled-by-default profiles stay screenshot-only — never fabricated.
2. **Evidence provenance hardening**: every artifact (screenshot/video/log) stamps the runtime facts (real browser brand/version/engine, execution level, session id) captured at record time; artifact listing per session filtered strictly by session.
3. **Findings context** (existing Findings UI structure kept): each finding shows Device / OS / OS version / Browser / Browser version (runtime-detected) / Execution type / Result — drawn from the session's runtime facts, never the catalog label.
4. **Coverage state vocabulary** (`matrixCoverage.js`, coverage UI): explicit distinct states: Passed / Failed / Environment Unavailable / Browser Unavailable / Execution Failed / Device Offline / Not Selected / Not Supported (+ Not Run/Pending). Mapping from matrix item statuses; never collapsed.
5. **Bulk isolation audit**: the bulk wizard + matrix orchestrator verified to give each environment its own session, sequential or bounded-parallel, one failure never affecting another; progress shown as Queued → Preparing → Running → Passed/Failed / Environment Failed per item.

## Tests
- Evidence stamping: two runs on different envs produce disjoint artifact sets with correct stamps.
- Coverage mapping tests: each distinct item status renders its distinct label.
- Bulk: simulated mid-bulk failure of one env does not alter others' results.

## Edge cases
- Video unsupported for an engine → absent, noted, never substituted.
- Interrupted session → partial evidence preserved with honest session status.
- Findings from shared workflow runs tagged per-profile (matrix item link).

## Acceptance criteria (running app)
- [ ] Two environments running the same workflow yield two isolated sessions with disjoint evidence, each stamped with its own runtime-detected browser identity.
- [ ] Findings display the exact environment (device/OS/browser/version/execution type) they occurred on.
- [ ] The coverage report lists each state distinctly; unrun browsers/devices never appear as Passed.
