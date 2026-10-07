# #14074/#14075 — Exec panel relocation + Choose Device form (gotchas)

## Root cause worth remembering: grid item min-width:auto
The #14075 "selects clipped at 1024×768" bug was NOT the form CSS — the whole
`#choose-device` section (573px) overflowed the 300px viewer track because grid
items default to `min-width:auto` and the .cd-head's intrinsic content couldn't
shrink. Fix: `min-width:0` on `.viewer > *` children + `.cd-head` +
`.cd-form { repeat(2, minmax(0,1fr)) }`. Rule: ANY grid/flex child that can hold
long text needs min-width:0 or it will silently overflow a narrow track.

## Multi-select override changes must carry sibling selections
`resolveDeviceEnvironment({device, browser})` without osVersion lets
rankEnvironments' newest-version tiebreak silently discard the user's OS pick.
cdFormOverrideChange now builds `current` from the store (osVersion/browser/
executionLevel, minus the field being changed) and spreads `{device, ...current,
...overrides}`. Store `executionType` = executionLevelRequested ?? runtimeAttestedLevel
matches the resolver's filter key exactly.

## resolveDeviceEnvironment gained executionLevel param (back-compat)
Filter `(runtimeAttestedLevel ?? executionLevelRequested) === level`; fallback now
triggers on browser OR executionLevel miss.

## Login throttle burns fast during test loops
In-memory 10-attempts/15-min throttle lives in service-bg-service-4182.
`procmgr restart service-bg-service-4182` + ~8s wait clears it. The responsive +
acceptance suites each do one login per run — running both plus manual Playwright
probes in quick succession trips it.

## Known pre-existing WARNs (open)
- Browser select options share value=browser-name (four "Chrome 13x" → value
  "Chrome") — data-level; picking "Chrome 139" resolves to first Chrome env on
  that OS. Not fixed; needs env-level value (browser+version).
- Pre-login /api/* 401 console noise (benign, flagged by 2 testers).
- "An invalid form control name='targetUrl' is not focusable" console error on
  the Start QA run dialog submit path — separate bug, not this work.

## Suites as of close
npm test 826/0/9 (keepalive + outbound-client tests are FLAKY — both passed on
rerun; don't chase them as regressions without a repeat), public 95/95,
acceptance 24/24 (T16–T16j), test:ui PASS 6 resolutions + cd-form-expanded
checks (closes the "suite never expands the section" gap).
