# #14069 — Choose Device collapsible section (exec layout)

## What shipped
- `#choose-device` in center `main.panel.chat` between `#question-slot` and `#stage` (grid row 6 of 11).
- Collapsed: label · summary "device · OS · browser" · honest exec badge · [Change Device] btn · chevron. 47px.
- Expanded: search + platform/type chips + `#cd-list` (reuses `.dp-card` classes) + secondary OS/browser selects. List scrolls internally (max-height min(300px,32vh)); page never grows.
- Controller lives in app.js after `renderAllTestOnBlocks`: `chooseDeviceUi`, `renderChooseDeviceSummary`, `cdBadgeText`, `cdEnvironments/cdBoardFor`, `renderCdList`, `renderCdSecondary`, `cdSelect/cdReselect` → all writes through `activeTestEnvStore.setSelection`. `cdSelectedDevice` is highlight-only, resynced from store on open + via `cdSyncSelectedHighlight` (wired into picker `onSelect` and `cdRenderOnData`).
- Acceptance T16–T16e added to scripts/test-acceptance.mjs.

## Gotchas that cost debug cycles
1. **NEVER nest a `<button>` inside a `<button>`** — the browser ejects the inner one and it renders as a second row (collapsed head measured 77px). Fixed by making `.cd-head` a `div role=button tabindex=0` + manual Enter/Space keydown handler.
2. **`.btn` has `min-height:40px`, `.btn-sm` 34px** — a compact 26px in-row button needs `min-height:0` to actually shrink.
3. **cardBadge (from runtime board `maximumLevel`) can disagree with `executionTypeText(store)`** — the header badge must derive from the SAME card model the user clicked (`cdBadgeText` → buildDeviceCards+cardBadge), else VIRTUAL vs SIMULATED mismatch. Catalog in this deployment only attests SIMULATED; multi-level agreement untestable until a REAL/VIRTUAL device is on the board.
4. Grid rows: base .chat, .cli-theme .chat, stacked ≤1023 .cli-theme, ≤520 all updated to 11 rows (choose-device between question and stage). Grid-row pins make missing rows implicit but sizing intent is lost — keep templates explicit.
5. Badge options sharing browser names (Chrome 138/139/140/141 all value="Chrome") — env-level data quirk, not UI.

## Review findings (all addressed)
- Reviewer WARNs fixed: direct cd coverage (T16* in acceptance suite), stacked-breakpoint templates, cdSelectedHighlight sync. Spec drift (renderInlinePicker named ext point; auto-collapse after Select not implemented — deliberate, body stays open with "Selected ✓").
- Reviewer note saved: .drytis/memory/ticket-14069-choose-device-review.md
- Work uncommitted on NIHARIKA (carried WARN across all exec-layout tickets).
