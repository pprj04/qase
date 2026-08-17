# Phase 18: validationExecutor.js corrupted by container pause

## What happened
During the third re-run of tests/phase17-e2e.test.js (terminal session p17e2e3,
~09:43), the container paused and resumed with a NEW hostname
(pulse-review-workspa-6grhjr → pulse-review-workspa-6grhjr-7glkg → back). /tmp
was wiped and server/validationExecutor.js (282 lines, 19,896 bytes) was
OVERWRITTEN mid-write with a fragment of findings-store JSON
(".qase/findings.json" content: `"entDefault without setting location.hash =
'#login'..."` followed by finding records) — the same kernel-corruption class
documented in phase16-env-corruption-incident.md.

State at detection: procmgr showed service-bg-service-3546 STOPPED;
`node server/index.js` crashed at boot with
`SyntaxError: Unexpected identifier 'without'` from validationExecutor.js:1.
The server cannot boot without this file (index.js imports it directly).

## What is intact
- server/fixStatusEngine.js — syntax OK (13,911 bytes)
- server/fixValidation.js — syntax OK (9,906 bytes)
- .qase/fix-validations.json — 99 runs intact (grew from 67 — benchmark +
  e2e runs kept writing until the crash)
- The file was NEVER committed/published (git status: ?? untracked), so there
  is no git copy to restore from.
- md5 at corruption: 685e59e5b20597efb527c57c2e0e0f3c

## Recovery
Rebuild server/validationExecutor.js from the Phase 18 spec + surviving
evidence (all 99 runs carry the structure the executor writes: attempts,
evidence before/after, environmentDeltas, regressions, timings). Key contract
points documented in docs/AUTONOMOUS_FIX_VALIDATION.md and
docs/VALIDATION_EVIDENCE_MODEL.md; the engine + store sides are intact and
encode the interface (appendAttempt, completeRun, failRun, transitionRun,
buildValidationTestCase, executeValidation(runId, {getFinding}), recordEvidence
via createEvidence with observation/payload fields, redactString on capture,
selectRegressionSet ≤6/budget 2, VALIDATION_ATTEMPTS from env default 2,
viewports via VIEWPORT_PRESETS).

## Lesson (repeat of phase16 incident)
The pause/resume fs-corruption hits LARGE JSON + source files being written at
pause time. Mitigation for future phases: publish phase work BEFORE starting
long benchmark/e2e runs so git has a pristine copy; keep scratch output in
/workspace/.drytis (persistent volume) not /tmp.
