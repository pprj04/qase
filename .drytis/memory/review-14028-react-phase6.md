# Review — ticket #14028 Phase 6 (SQA/Founder launchers, BugsView, feedback/perf panels, responsive)

Reviewed at HEAD ba59462 (all Phase 6 work committed — the long-standing uncommitted-work WARN is resolved).

## Verdict: PASS (7/7 leader criteria), several WARNs

- Launchers: validation strings byte-identical to legacy (app.js:4516/4522/4527, 4668/4673/4678); catalog keyed-object handling correct (sqaValues); core profile locked+required; payload shapes match /sqa/sessions and /founder/sessions exactly; model-config gate re-validates live (Phase 5 bug class fixed).
- BugsView: faithful port of bugsView.js — BUG_STATUS_LABELS identical, optimistic PATCH + rollback, toast parity (straight quotes vs legacy curly — cosmetic).
- Feedback panel: FEEDBACK_CATEGORIES matches server feedbackStore.js exactly (10); review statuses match FEEDBACK_STATUSES (5); bare-array contract handled; 403→hide. NOTE: panel sends `search=` param but server /api/feedback reads `q` (app.js:638) — search filter is a no-op server-side; inherited verbatim from legacy app.js:1608 (same bug). Faithful port, dead param.
- PerfPanel: visibility-only close (no metric mutation), avgSecondsPerItem row present when data exists, target compare only at ≥2 runs.
- runDeepLink.ts RUN_ID_PATTERN identical to app.js:19; invalid-id strip matches legacy 5166–5179.
- Responsive: cascade fix confirmed (base display:none at shell.css:1944 precedes media blocks); ≤700px rail dock works. d0da7ae was not strictly CSS-only (added overlayHidden state in ViewerPanel.tsx) but is presentation-only.
- Suite 794/774/0 verified locally; build exit 0; preview serves identical hash (DP8VS2wK).

## Open WARNs for Phase 7
1. **ErrorBoundary never resets** (src/components/ErrorBoundary.tsx): once a dialog errors, the fallback persists even after the dialog is closed/reopened (boundary holds error state; no reset on open-toggle or key change). Crash a dialog once → permanent "…could not be displayed" until reload. Add resetKeys or reset on close.
2. **Launcher start-failure error invisible**: SqaLauncher/FounderLauncher call onClose() before POSTing the kickoff message; on failure they setError(...) on an unmounted dialog (open=false → null). Legacy keeps the dialog closed too but pre-fills the composer with the URL and calls fail(); React shows nothing. Pre-fill composer or surface a toast.
3. **No dedicated unit tests** for SqaLauncher/FounderLauncher/BugsView/AdminFeedbackPanel/PerfPanel/runDeepLink — behavior verified only by browser rounds. Phase 7's test-rework plan should pin RUN_ID_PATTERN + these contracts.
4. **Spec Phase 6 gaps not built**: SQA/Founder view tabs + founder completion report (showCompletedFounderReport), Activity/Plan viewer tabs, Drytis board push, roving-tabindex on tabs, reduced-motion variants, ≤1100px dock→bottom bar, 1920px responsive check. Must be delivered or descoped in Phase 7.
5. Toast quote style (straight vs curly) — cosmetic.
