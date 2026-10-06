# Ticket #13782 review — Phase D6 selection & bulk run UX (dup-closure ticket)

Spec: `.drytis/specs/device-d6-selection-bulk.md`. Round 1 verdict: **PASS** (4 WARNs). Round 2 re-review: both code-defect WARNs verified FIXED — verdict stands **PASS**.

## Verified (round 1)
- Ctrl/Cmd hint fully gone from user-facing markup; only explanatory comments + contract-test assertions remain. Legacy `#bulk-cases` multi-select replaced by `#bulk-case-list` (role=group) + Select all/Clear all + `#bulk-cases-count` (aria-live).
- `renderCases` checkboxes bound to `state.chosenCases` Set; `casesForWhat()` 'selected' reads the Set; All/None re-render + preview.
- `renderAvailability` honest: `board?.status ?? 'UNKNOWN'`, Busy→"Busy — will queue", Unknown→"Status unknown", OFFLINE passes through raw, level `maximumLevel ?? env.runtimeAttestedLevel` underscore→space lowercase, per-device run counts aggregate.
- `refreshBoard()` runs on every advance-to-step-3 via `[data-bulk-next]` handler; board fetch failure swallowed → honest unknown rows. `setRuntimeBoardFetch(fetchRuntimeBoard)` wired at app.js.
- No dangling refs to `casesSelect`/`id="bulk-cases"` in prod or scripts.
- Acceptance 3 (session + attestation per execution): `launchPairs` → `createQaRunWithCase` → POST /api/sessions per pair; server stores environmentSnapshot + testCaseSnapshot per session. Pre-existing, confirmed.
- Suites: bulkWizardContract 3/3; npm test 1154/1134/0/20 exact.

## Round 2 — WARN fixes verified (bulkRunView.js only)
1. WARN 1 fixed: dot class now derived from raw status — `bulk-avail-dot is-${String(row.status).toLowerCase()}` (L213); rows carry `status` in the map (L205). UNKNOWN→is-unknown, AVAILABLE→is-available, BUSY→is-busy, OFFLINE→is-offline. All four classes have CSS rules (styles.css:10662–10665; previously is-unknown was dead).
2. WARN 2 fixed: `renderPreview()` zero-pairs branch calls `renderAvailability(pairs)` (empty array) before returning (L167) — `availabilityEl.textContent = ''` (L192) clears stale rows alongside "Nothing to run yet".
- `node --check public/bulkRunView.js` clean; bulkWizardContract 3/3; npm test 1154/1134/0/20 exact (unchanged).

## Remaining WARNs (accepted)
3. Spec-text deviation (documented in ticket context, accepted): spec says checkbox *device* selector + "Selected: N devices"; devices use the DX Phase 4 chip-list, checkbox treatment applies to test cases, counter reads "Selected: N cases".
4. Carried process concern: everything still uncommitted working-tree on this branch alongside M1–M7 and other tickets. Commit-split before landing advised.
