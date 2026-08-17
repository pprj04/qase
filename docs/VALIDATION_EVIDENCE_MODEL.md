# Validation Evidence Model — Phase 18

How Phase 18 captures, links, compares, and gates on evidence.

## 1. Original finding is immutable

Every validation run stores a **snapshot** of the finding at request time
(`originalFinding`), captured before any execution:

- all original fields: title, severity, priority, categories, url, viewport,
  steps, expected, actual, observed, impact, fixPrompt, workflow/feature
  links, session/mission ids, timestamps
- validation results are recorded **separately** in
  `.qase/fix-validations.json` (`fxv_*` ids) — the finding record itself is
  never rewritten by the engine (only `lifecycle` status may change via the
  documented transitions, e.g. RESOLVED after APPROVED).

E2E T10 proves this: mutate the finding title mid-validation → the stored
`originalFinding.title` in GET `/api/v1/findings/:id/validation` still shows
the original.

## 2. Evidence phases

| Phase | When | Content |
|---|---|---|
| **BEFORE** | run start, from the immutable snapshot | original expected/actual, original evidence digest, original URL/viewport |
| **ATTEMPT n** | each replay attempt | step-level results, assertions, console errors, failed requests, failure screenshots (persisted as artifacts) |
| **REGRESSION** | after attempts | targeted regression test-case outcomes (verify vs verify_regressions) |
| **AFTER** | run complete | derived verdicts + comparison |

## 3. Evidence graph integration

The executor records nodes into the **existing** `evidenceGraph.js` store via
`createEvidence`/`linkEvidenceToFinding` using `observation`/`payload` fields
(no legacy title/description fields), with:

- `source: 'fix_validation'`, `findingId`, `validationId` (fxv_*), phase tags
- `SOURCE_RELIABILITY` weights inherited (network .95, console .90,
  api_response .90, dom .85, screenshot .80)
- `redactString` applied to all captured text (no credentials/tokens in evidence)
- failure screenshots persist as artifacts under
  `<sessionId>/step-N.jpeg` and are linked with `artifactPath`

## 4. Environment fingerprint + deltas

Same-condition validation (spec §5): the run records the environment used for
validation and computes **deltas** against the finding's original environment
across: url, viewport (w×h), browser, device, os, testData, credentials,
feature, state. Any material difference is surfaced in `environmentDeltas`
and feeds the engine's environment-mismatch gate (`UNABLE_TO_VERIFY` when the
validation could not recreate original conditions).

BrowserStack config is preserved for runs that used it — recorded as part of
the environment, never silently dropped.

## 5. Evidence sufficiency (per finding family)

`assessEvidenceSufficiency(status, context, family)` — requirements from
`EVIDENCE_REQUIREMENTS`:

| Family | Required evidence |
|---|---|
| functional UI | steps executed + expected state observed + resulting state captured + evidence recorded |
| api | request sent + response received (status/body) + expected checked |
| ux | same workflow exercised + UI state observed + before/after observation + screenshot |
| mobile | workflow + viewport/device + resulting state + screenshot |
| security | request/response + result + impact observation |
| other | steps + expected + resulting |

Missing requirement keys map 1:1 to `evidenceInsufficiencies[]` in the run.
Insufficient → `UNABLE_TO_VERIFY` regardless of how well the run otherwise
went (decision order gate 6).

## 6. BEFORE/AFTER comparison

`GET /api/v1/findings/:id/comparison` returns a reviewer-comparable,
evidence-linked structure:

```
{ findingId, validationId, before: { …original snapshot digest… },
  after: { …validation outcome digest… },
  verdicts: { behaviorChanged, expectedAchieved,
              originalFailureReproduced, relatedFailuresIntroduced } }
```

- `behaviorChanged` — resulting state differs from original observed state
- `expectedAchieved` — expected state was observed during validation
- `originalFailureReproduced` — reproduction evidence captured
- `relatedFailuresIntroduced` — regression scan found verified failures

Every verdict cites evidence ids (original ↔ validation), so a human reviewer
can open both sides. The comparison view in the UI renders these side-by-side
from real stored evidence — no synthesized data.

## 7. Evidence completeness metric

Benchmark computes completeness as the fraction of scenarios where the
stored run contains every required evidence key for its family
(before-evidence, per-attempt capture, regression result, verdicts).
Target ≥ 95%; Phase 18 measured **100%** across all 10 scenarios.

## 8. Security / redaction

- All evidence text passes through the existing `redactString` (tokens,
  passwords, keys, emails) at capture time.
- `serializeValidationRun` redacts `originalFinding.steps` and free-text on
  every read.
- Credentials used by replay are read from the existing credentials store —
  never echoed into evidence or API responses.
- The engine and store contain no secret material; the executor only sees
  resolved env + store handles.
