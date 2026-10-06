# #14386 Theme validation (T4) — DONE, all 7 validations PASS

Validation report (also satisfies the ticket's deliverable):
1. Instant switch: scripts/theme-validation.mjs — 6/6 sampled surfaces (body/.runs/.composer/.chat/.viewer/.stage) flip synchronously on data-theme change.
2. Dark identical: reviewer verified dark token values byte-identical across T3 rounds; live probes show established dark design + Geist fonts.
3. Light readable: audit-theme-light.mjs 0 non-intentional offenders + browser walkthrough PASS (round-2 8/8).
4. Persistence: reload with stored dark/light keeps theme (validated programmatically + browser).
5. System follows OS: stored=system flips live dark↔light (emulateMedia), sub-second. NOTE: spec default with NO stored value is 'dark' which intentionally ignores OS — a validation script that forgets to store 'system' will "fail" wrongly.
6. Functionality: suite 1123/1103/0/20; npm run verify PASS; test-ui-responsive PASS (needs QASE_TEST_PASSWORD env from cred.json).
7. Layout: theme-layout-parity.mjs byte-identical geometry across themes.

New tool: scripts/theme-validation.mjs (the 7-point check harness, logs in via cred.json).
Theme feature COMPLETE: #14383 foundation, #14384 toggle, #14385 coverage, #14386 validation all Done.
Out-of-scope tester notes (pre-existing, not theming): feedback-modal pointer interception after run completion, #perf-panel overlay on sidebar-nav, run-list "undefined undefined" device meta.