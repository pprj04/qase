# DX Phase 3 · Start QA / SQA / Founder dialogs on the current selection

## Goal
The three run-start flows show the current selection — no per-dialog device/environment selects.

1. QA dialog (#qa-start): remove #qa-device-select / #qa-environment-select as primary controls → 'TEST ON' block (summary line + [Change device] → picker + browser dropdown + orientation dropdown). URL unchanged. Submit reads store envId at submit time (AC14). Test-case prefill: when the current selection isn't in the case's assigned envs, prompt via picker (no disabled select).
2. SQA dialog: 'TEST ON' summary + Change (replace #sqa-device-select/#sqa-environment-select).
3. Founder dialog: 'REVIEW ON' summary + Change (replace #founder-environment-select).
4. All submit paths post the store's environmentId; no divergent per-dialog state.

## Files
public/app.js, public/index.html, public/styles.css.

## Acceptance criteria
- [ ] Open QA/SQA/Founder with prior selection → current device already shown (AC4/5/6).
- [ ] Picker change updates all three dialogs.
- [ ] Run starts on exactly the displayed environment (AC14).
- [ ] Existing suite green.
