# Review — Phase 5 partial (QA launcher + ViewerPanel + stage collapse), #14027, uncommitted on b7ca58f

RESULT: PASS 5/5, with WARNs. Suite 794 tests / 774 pass / 0 fail / 20 skipped; build+preview hash match (index-react-C4xg6iPv.js).

Verified faithful: URL http/https gate, scope builder (qaKickoff.ts = byte-port of public/qaKickoff.js), security gate conditionality + exact error strings, chromium-first engine ordering, non-chromium "Focus:" kickoff suffix, demo fill, stage-collapse transitions (running→expanded, running→terminal→collapsed unless manualExpand, new run restores+clears; same terminal set as legacy), tab ARIA, report.md fetch + markdown render, viewerOpen fully removed from App.tsx, server/ untouched beyond tests.

WARNs to track before Phase 5 closes:
1. ensureModelConfigured('QA launcher') NOT ported — React can submit with no model configured.
2. Stage manual override is component-global, NOT per-session (legacy keys by sessionId via state.stageExpanded) — override leaks across selected runs with same terminal status.
3. "Run complete — live view collapsed" note missing; aria-expanded split across two buttons.
4. Spec Phase 5 remainder unbuilt: cursor overlay (target box/ripple/label), Activity/Plan tabs, report verdict banner/severity grid/actions/feedback, ?run= deep link, ⌘N.
5. Phase 4's <1000px viewer auto-collapse was REMOVED with viewerOpen — viewer again opaquely overlays transcript at ≤900px (shell.css 1532+). Regression of tester's Phase 4 finding; fix in Phase 6 responsive.
6. Device/landscape localStorage persistence not ported; per-engine message errors swallowed (.catch(()=>undefined)).
7. ReportView uses raw fetch, not shared apiText client (bypasses 401-reload convention; read-only so no CSRF issue).
8. Cutover (vite outDir → public/) not attempted — still /app-react/ alongside legacy.
9. Standing: entire Phase 2–5 surface uncommitted (HEAD b7ca58f = Phase 4 only).
