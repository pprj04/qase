# Audit B — QASE UI/UX Review (2026-09-03, Playwright walkthrough)

Evidence: browser walkthrough of all 5 SPA routes + REPORT tab + bug-detail modal + 375px checks; console capture; app.js bundle grep. Preview URL reachable, no login gate (dev auth off).

## Structural finding
There is NO standalone overview dashboard. `/` redirects to `#/runs/<latest>` (agent console). Metrics live in the run viewer's **REPORT tab** with exactly **4 cards**: Sessions / Findings / Test Cases / Regression Pass Rate. The richer dashboard the 2026-09-01 audit described (9 card groups incl. Authentication card, top categories, knowledge updates, fix-validation buckets) **does not exist in the current UI** — the bundle has 0 occurrences of "Authentication"/"topCategories"/"byCategory"/"verified_fixed"/"still_broken". That earlier audit's dashboard description is stale relative to the current bundle (or described a different surface than shipped).

## Route findings

| Route | Status | Notes |
|---|---|---|
| `#/runs` (console) | WORKS | 3 runs listed; connection badge transitions connecting→connected; detail loads with 5 tabs; "No browser yet" empty state well-handled |
| `#/bugs` | WORKS w/ issues | 7,914 cards rendered at ONCE — no pagination on this view (2 navigations hit 10s timeouts); rich filters (search/sort/severity/status/category 70 opts/fix-status); export Markdown/GitHub/JIRA/Linear; detail modal good (chips, evidence step-IDs, dev-intelligence root cause) |
| `#/tests` | WORKS | 862 tests, severity+viewport filters, 25-card pages + Load more (837 remaining ✓), JSON/CSV export, per-card provenance |
| `#/workflows` | WORKS w/ issues | 747 workflows / 13,547 steps / 21 targets; ~628 cards at once; NO filters; every card "Auto: Untitled" — naming gap |
| `#/schedules` | WORKS w/ issues | 35 schedules / 9 active; PASS RATE TREND all 0% (18 cells); no regression section on page |
| Bug detail modal | WORKS | Expected/Actual show "—" when absent; validation 404 surfaced gracefully as "No validation runs" |

## Ranked improvements (P0 → P3)

**P0 — misleads or blocks**
1. Bugs page renders all 7,914 cards at once — page regularly exceeds 10s / times out. Add server-side pagination or infinite scroll (API supports limit, UI ignores it). (`#/bugs`)
2. Metric scope unlabeled: REPORT tab shows "Findings = 14" (session-scoped) while Bugs page says 7,914 (global) — two truths, no scope label; users will read 14 as the total. Add "this run" vs "all findings" labels. (REPORT tab vs #/bugs)
3. Bug cards clip at 375px (558px-wide cards in 351px container, text cut off); top nav overflows without wrapping. (mobile)

**P1 — confusing/degraded**
4. Empty "quality dimension" filter group on #/bugs (0 options) — dead control; hide or populate.
5. Pass-rate trend strip all 0% with no explanation (legend exists but data uniformly stale/no-tests) — surface "no tests recorded" explicitly per cell.
6. Workflows all named "Auto: Untitled" (628 cards) — derive names from target+first-step.
7. Project filter is a no-op: `/api/v2/metrics/dashboard?projectId=` returns identical numbers for all 3 projects — either wire it or remove the combobox.

**P2 — polish**
8. Workflows page: no filters/pagination for 747 items.
9. Bug-detail Expected/Actual "—" — collapse fields when empty instead of placeholders.
10. Evidence shows raw step-IDs (`step:f97d42a3…`) — render human-readable labels or screenshots.

**P3 — nice-to-have**
11. Test-cases page is the best-built list (pagination, filters, exports) — bring Bugs/Workflows to that standard.
12. UX assessment pane renders just "—" — remove or implement.

## Known-discrepancy re-check (2026-09-01 audit vs today)
1. 7,637 vs 7,617 mixed dedup → **OBSOLETE-SURFACE**: dashboard no longer shows those cards; current pair is 14 (session) vs 7,914 (global), scope unlabeled — still the same *class* of problem (unlabeled scopes), now different numbers.
2. "100 regression runs" limit artifact → **STILL PRESENT**: REPORT tab says "100 runs · 232 tests · 8%" — API `total_runs:100` is the limit:100 read; true store total is 200.
3. Knowledge-updates label (423 fix-flags vs 430 store) → **NOT RENDERED**: no knowledge card exists; 423 only in API payload.
4. Authentication card 490/432/88% classifier drift → **NOT RENDERED**: card doesn't exist in current bundle.
5. FEATURE_GAP hidden (4,588) → **NOT RENDERED as such**: no top-categories list; Bugs category dropdown (70 options) has feature-gap *variants* (`missing-feature`, `features`, `missing feature`, `missing_feature`, `feature-missing`) — taxonomy fragmentation is the real issue.

## Console errors
Single 404 (`/api/v1/findings/<id>/validation`) from bug-detail modal — handled gracefully (expected-empty state), not a defect.

## Verdict
SPA is coherent and feature-rich; the systemic UX issues are **scale** (unpaginated 7k-card list), **scope labeling** (14 vs 7,914), **mobile clipping**, and **taxonomy fragmentation** in categories. The dashboard the earlier audit scored no longer exists in this form — historical discrepancy rows are superseded.
