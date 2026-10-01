# UI Fix Phase 2 port review (ticket #13973) — PASS with WARNs (re-reviewed after honesty fix)

Context differs from spec: teammate merged PUSHKAR into NIHARIKA (611d41c) bringing all four modules + wiring wholesale; coding agent only fixed a duplicated trailing block in index.html (8 lines: memory-dialog tail + 3 script tags + </body></html>). Modules byte-identical to PUSHKAR (`git diff PUSHKAR HEAD` empty for all 8 module/test files).

## Round 2 (honesty fix re-review) — tester's S1 REAL-claim finding is fixed
- activeTestEnvironment.js:35 executionType now `env.executionLevelRequested ?? env.runtimeAttestedLevel ?? null` (was isRealDevice → REAL_DEVICE). Verified: isRealDevice-only env → null (→ VIRTUAL DEVICE via executionTypeText); runtimeAttestedLevel=REAL_DEVICE → REAL; requested overrides attested.
- Other REAL-inference paths audited, all honest (no display badge from isRealDevice alone):
  - devicePicker.js rankEnvironments:35-37 uses isRealDevice for SORTING only; chip lists render envChipLabel (device—os—browser) with no badge.
  - app.js:4054 'real device' tooltip is env-catalog metadata in the environments admin table (pre-existing, not the picker path).
  - app.js:444/981, deviceRuntimeUi.js use board maximumLevel/recorded run facts (attested/recorded), not isRealDevice.
  - deviceDrawer.js:154 maps isRealDevice→VIRTUAL_DEVICE (under-claim, honest); pre-existing, not part of this fix's scope.
- Tests after fix: npm test 820 → 811 pass/9 skip/0 fail; node --test public/*.test.js → 80/80. (Transient DrytisTransportError seen in one npm test run's tail did not reproduce — final tally 0 fail.)
- Regression: renderTestOn (app.js:590) still shows 'SELECT A DEVICE' + data-empty when store empty; runtime probe of store confirms null → prompt path.
- Browser re-test (tester, 5/5 PASS): TEST ON + picker footer show '● VIRTUAL DEVICE', right panel makes no REAL claim, 'REAL' appears 0 times page-wide, console clean.

## Round 1 verified PASS (unchanged)
- One picker instance app.js:4567; all entry points route to it: QA :3281, SQA :3450, Founder :3613, quick action :4472, device-chip-change via deviceDrawer onOpenPicker (deviceDrawer.js:566, app.js:4647), ldv-change/choose-device :4642, chip lists via setPickerHost at app.js:4916-4918 (tc/bulk/rt).
- Zero leftovers of #qa/#sqa/#founder-environment-select or populateEnvironmentSelect in public/.
- selectedEnvironmentForRun (app.js:623) = store envId at submit; QA :3312, SQA :3525, Founder :3715. onSelect guards state.session (spec item 5).
- cardBadge/executionTypeText never claim REAL when unknown.
- index.html: 14/14 dialog tags, 3 script tags once, single </body></html>, no dup ids. Preview serves fixed version.
- Security: no hardcoded creds/URLs in merge diff; picker DOM is createElement/textContent only; added innerHTML uses are static constants.
- Prior dx-phase1 WARN #1 (Change opened old drawer) and dx-phase3 WARN #1 (dialogs not rendering own TEST ON at open) resolved by this merge.

## Open WARNs
1. BOTH fixes (index.html dedup + activeTestEnvironment.js honesty) are UNCOMMITTED — working tree only; must be committed.
2. cardBadge defaults unknown availability to 'AVAILABLE' — slight over-promise (spec only banned claiming REAL).
3. SQA/Founder submit `environmentId: selectedEnvironmentForRun() || undefined` — undefined lets the server pick; if backend seeds a default env, that's a silent server-side default.
4. startRunForTestCase (app.js:4152) silently switches store selection to first assigned env when current isn't assigned — documented DX Phase 3 decision, not a picker regression.
5. (minor) deviceDrawer.js:154 device-chip-exec derives VIRTUAL_DEVICE from isRealDevice — under-claim, honest; not part of this fix.