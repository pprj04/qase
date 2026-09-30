# Phase D5 — Run Screen, Right Panel & Live View UX

## Goal
Fix layout while keeping left (Recent Sessions) / center (Agent-Run) / right (Live Device) structure.

## Changes
- Right panel: compact readable selected-device card — DEVICE / OS / BROWSER / EXECUTION / STATUS (● Connected) / SESSION RT-XXXXXXXX, buttons [Change] (opens full matrix drawer) and [Device details]. Expandable if narrow; no clipped/overlapping/truncated text.
- Run header: "TARGET DEVICE" block — model, OS, browser, `REAL DEVICE ● CONNECTED`, `Runtime: RT-XXXXXX` — visible during the whole run (replace current one-line "Environment:" pill, app.js renderRunEnvBlock).
- Live preview header: "LIVE DEVICE VIEW" + device/OS/browser + `● REAL DEVICE`/`● VIRTUAL DEVICE`/`● SIMULATED` + `● LIVE`, driven by backend attestation, never by the preview itself.
- CSS pass: panel min-widths, ellipsis only with title tooltips, readable status font sizes.

## Files
public/deviceDrawer.js, public/app.js (renderRunEnvBlock, run pill, preview header), public/styles.css.

## Acceptance
- [ ] Right panel shows all six labeled fields + two buttons, nothing clipped or overlapping at common widths
- [ ] [Change] opens the Device & Environment Matrix drawer
- [ ] Run header shows TARGET DEVICE with execution type + runtime ID for the entire run
- [ ] Live preview header states execution type from backend attestation, matching the run's actual type

## Tests
E2E visual: narrow viewport panel expandable, no truncation; run header persists during execution; virtual run shows ● VIRTUAL DEVICE.
