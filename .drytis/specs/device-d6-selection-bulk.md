# Phase D6 — Selection & Bulk Run UX

## Goal
Non-technical multi-device selection; no Ctrl/Cmd-click.

## Changes
- Test cases UI (`testCaseView.js`): replace ctrl/cmd multi-select hint with checkbox device selector ("Select devices": ☐ iPhone 17 Pro …) + [Select all] [Clear all] + "Selected: N devices".
- Bulk run wizard (`bulkRunView.js`): explicit 3 steps — WHAT TO TEST (Login, Registration, Meeting link, Camera, Microphone, Screen sharing, Chat, Custom test cases), WHERE TO TEST (checkbox devices), SUMMARY (Tests / Devices / Total executions counts, Execution: <type>, availability shown per device before launch) + [Run tests].
- Bulk executions: each device×test gets its own runtime session + device metadata (verify per-execution attestation).

## Files
public/testCaseView.js, public/bulkRunView.js, public/bulkProgress.js, server bulk endpoints (app.js).

## Acceptance
- [ ] No "Ctrl/Cmd-click" hint anywhere; devices chosen by checkboxes with Select all/Clear all and "Selected: N devices" counter
- [ ] Bulk wizard has the three labeled steps with live summary counts and per-device availability before launch
- [ ] A bulk run across 2+ devices yields one runtime session + attestation per execution

## Tests
E2E: select 2 tests × 2 devices → summary shows 4 executions → run → 4 runtime sessions in results.
