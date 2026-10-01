# Frontend audit (2026, pre-redesign scoping) — /workspace/public

Read-only audit of QASE-2.1 UI for a Drytis Studio design-language redesign.

## Structure
- index.html (572 lines) holds ALL screens: #auth-gate (16–56), .app grid (60–231: runs sidebar / chat / viewer+tabs / feature-dock outside panels), dialogs #settings/#qa-start/#sqa-start/#founder-start, #toasts, #profile-dialog. 3 module scripts (entry.js, entry-motion.js, app.js), no inline JS.
- styles.css = 7,737 lines, ONE file, layered: :root tokens #1 (lines 3–41, indigo theme, DEAD) overridden by :root #2 (4486–4523, active green "cli-theme" terminal theme; body.cli-theme forces Cascadia Code mono 13px). Sections only by banner comments. App grid: line 151 base 3-col; line 2829 adds 58px 4th dock column.
- app.js 3,694 lines: 100% imperative createElement (230 calls, 0 insertAdjacentHTML, innerHTML only via safe markdown). el map of ~75 getElementById at lines 19–93. ~138 distinct className values + ~163 static classes in HTML; state classes is-open/is-selected/is-visible/is-firing/is-leaving/is-active/is-live.
- Dynamically built (not in HTML): follow-ups panel (renderFollowUps app.js:1261), Drytis board #drytis-board (renderDrytisBoard :1347), pilot-banner (renderPilotBanner :3636), welcome checklist (:2628), run feedback (:1621).

## TEST SEAMS a redesign must not break (static regex-on-source tests in server/)
- engineTitleAndAllowlist.test.js:34-37 pins CSS text `.run-title .run-engine-pill` and `.chat-title .run-engine-pill`; app.js must set className 'run-engine-pill' near title assignments (app.js:244, 288, 491).
- drytisBoardUi.test.js pins ids #drytis-board, #drytis-accept-all, #drytis-push-btn, classes drytis-board-done/busy/failed, CSS blocks `.drytis-board {`, `.drytis-board-rows {`, `.drytis-board-acceptall {`.
- founderUi.test.js:11 pins literal `<nav class="feature-dock" aria-label="Qase features">`; dock after .panel.viewer in source order; grid columns 58px@≥1281 / 56px@1101-1280 / fixed bottom dock @≤1100 (bottom:9px).
- finalUiPolish.test.js pins unique ids (run-list, transcript, composer, stage, tabs, new-run/sqa/founder, device-select, settings), "CREATED FOR DRYTIS", .auth-gate CSS, and exact CSS fragments: "Final workspace fit and finish" comment, .cli-theme .panel-foot grid-template-columns: auto minmax(0,1fr) auto auto, chat grid-row:3 / viewer grid-row:4 @≤720px, .feature-tooltip display:none @≤520px, toast bottom calc(82px + env(safe-area-inset-bottom)).
- sqaUi.test.js: no innerHTML in renderSqa* block; CSS .sqa-modal, .sqa-verdict[data-status="blocked"], .sqa-technical-summary, .sqa-unresolved-group. founderUi: .founder-evidence-grid, .founder-boundary.
- customerJourneyUi.test.js: #qa-demo-fill, #empty-demo, #resume-run, renderWelcomeChecklist, markOnboarded, ensureModelConfigured ×3.
- modelSelectorUi.test.js: #cfg-model select + #cfg-model-custom hidden, NO datalist#cfg-model-list.
- founderReportCompletion.test.js vm-extracts `function showCompletedFounderReport()` from app.js source — name/shape load-bearing.
- uiPrimitives.test.js: app.js must import (not define) escapeHtml/markdown/hostOf/relativeTime/truncate/section/paragraph/list from uiPrimitives.js.
- drytisUi.test.js: boot block must keep RUN_ID_PATTERN + ?run= param handling.

## Other
- Fonts: system stacks only (Inter/Geist sans stack unused under cli-theme mono). Icons: inline SVG + unicode glyphs. entry-terminal.css = separate auth-gate skin (--terminal-green #83efb3).
- Frontend-exercising test files: customerJourneyUi, founderUi, engineTitleAndAllowlist, drytisBoardUi, finalUiPolish, sqaUi, modelSelectorUi, drytisUi, entryUi, uiPrimitives, founderReportCompletion (all static/VM, no browser). qualificationArtifacts + pilotFlow do NOT touch public/ DOM.
