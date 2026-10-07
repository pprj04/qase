# Ticket #13778 (dup of #13776, Phase D2) — review 2026-10

Verdict: PASS. No production code changed in this ticket; work = 2 source-contract tests in public/rightPanelContract.test.js pinning the two Phase-23 WARN gaps as closed, plus ticket description update.

## Gap 1 (queue→run) — CLOSED, verified in code
- app.js applyFallback (~L1333): 'queue' action POSTs /device-runtime/sessions {allowQueue:true}, on result.session → trackQueuePanel(result.session, {env, targetUrl}).
- trackQueuePanel (~L1364): shows #run-queue-panel, starts 4s setInterval(pollQueuePanel).
- pollQueuePanel (~L1379): on status==='running' && !queuePanelState.launched → sets launched=true once, hideQueuePanel(), createQaRun({targetUrl, environmentId: env.envId}) if ctx.env. Exactly-once guard present.
- Queue panel UI exists: index.html L217–221 (#run-queue-panel/label/detail/cancel).

## Gap 2 (duplicate idle runs) — CLOSED, verified in code
- app.js startEnvironmentRun (~L1217): before createQaRun, GET /sessions?limit=20, find run with environmentId===env.envId && status==='idle' → selectSession(recent.id) + "already waiting" toast + return; guard precedes createQaRun (L1231 return < L1233 createQaRun).

## Contract tests
- Slices are properly scoped: test 1 spans `async function startEnvironmentRun` → `function openExecFallback`; test 2 spans `async function pollQueuePanel` → `function hideQueuePanel` plus applyFallback → `/* Queue panel`. Not grep-anywhere. node --test: 8/8 pass.
- Minor: `body.indexOf('return;') < indexOf('createQaRun')` is a weak order check alone, but the specific regexes (selectSession(recent.id), sessions?limit=20, status==='running' && !queuePanelState.launched) make it adequately pinned.

## Suites
- node --test public/rightPanelContract.test.js → 8/8.
- npm test → 1151/1131 pass/0 fail/20 skip (exact expected).

## Carried WARN
- Everything remains uncommitted working-tree changes alongside M1–M7 and other tickets (commit-split still advised — same note as #14474 review).
