# RT6 · Automatic matrix execution & validation with published gap report

## Goal
One shared workflow executes automatically across the agreed default profile matrix (phone/tablet/desktop, all locally-executable browsers), each environment producing an independent, honest result; a scripted validation proves end-to-end execution; every demo-blocking gap is published from real data.

## Work
1. **Default automatic execution**: on run, the default profile matrix executes automatically (already largely built in NI02 orchestrator + DEFAULT_PROFILE_RULES); ensure each default profile's browser is the REAL local binary (RT1) and health-gated (RT2). No manual per-device selection or prompt.
2. **Representative application & fixtures verification**: the same representative workflows (incl. media workflows RT4, gesture fixture RT3, known-defect fixtures) run across desktop/phone/tablet/browser environments; results compared per environment — proving execution, not profile-display. Cross-device divergences surface as per-profile findings.
3. **Validation script** (`scripts/rt-validation.mjs`): automated end-to-end assertions covering the request's final acceptance list: real execution per executable env; honest unavailable states; automatic mobile/tablet/desktop execution; browser set default + deselection; never-Passed-for-unrun (both directions); execution-type labeling (no simulated labeled physical); session isolation; bulk independence; coverage state distinctions; DuckDuckGo resolution; media capabilities honest.
4. **Demo-blocking gap publication**: from actual execution data, generate the gap list (device-in-UI-but-not-executable, unverifiable OS/browser version, DuckDuckGo, physical hardware, camera/mic/screen where unsupported, evidence gaps, mislabeling, any unrun-as-passed violation) — persisted (e.g. `/api/coverage` matrix + a generated report artifact), never hardcoded.
5. **Regression**: existing single-run flows, SQA/Founder sessions, bugs CRUD, coverage tab, bulk wizard unchanged in structure; performance preserved (payload trimming where the matrix is huge).

## Tests
- Validation script runs green against a live instance with a seeded fixture case; failures reported honestly.
- Gap report content equals actual data (no literals).
- Regression suite green.

## Edge cases
- Zero executable browsers (broken env) → everything Unavailable with reasons; validation script expects and asserts that state.
- Container restart mid-matrix → resumeRecovery marks interrupted items ERROR, never passed.

## Acceptance criteria (running app)
- [ ] Running the representative workflow yields per-environment results across phone/tablet/desktop/browser profiles with zero manual device prompts.
- [ ] The validation script's report and the coverage gap report agree on every environment's state, with unrun/unavailable never counted as Passed.
- [ ] A non-technical user can pick device+browser+cases and run; environments that can't execute show exactly why.
