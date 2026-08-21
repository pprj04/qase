# QASE — Release Readiness Report (Build 4 / Demo Day Release Candidate)

**Date:** 2026-08-21 · **Build:** 4 (Final Demo Polish / RC) · **Preview:** https://pulse-review-workspa-6grhjr.drytis.dev/

## Verdict

**RELEASE READY for demo.** All 12 demo areas pass browser verification, the
strongest available regression suite is green (1104 tests / 1103 pass / 1
documented cross-suite harness race), the full demo journey (two real agent
runs) runs clean end-to-end, infrastructure audit passes, and security review
passes with no blocking findings. Two engine-level facts are surfaced honestly
in the UI rather than hidden or faked (see "Known engine behaviors" below).

## What Build 4 delivered (presentation layer only — no engine/server changes)

### Defect fixes (all browser-verified before/after)
1. **bugs.js ext4 corruption recovered** — served binary garbage; recovered the
   valid 46,726-byte Phase 18 source (incl. Fix Validation UI) from the
   Playwright HTTP disk cache. Verified byte-identical on the preview.
2. **Settings modal** — restored missing API-token label wrapper.
3. **Connection label** — "idle — no run selected" instead of stuck "connecting…".
4. **Terminal status split** — RUN FAILED (error) vs RUN INTERRUPTED (interrupted)
   vs RUN INTERRUPTED — 20-minute session limit (watchdog-idle runs).
5. **Mobile nav ≤390px** — ⋯ overflow menu carrying the *live* project select
   (no duplicated IDs), phone CSS last-in-cascade, scrollLeft snap-back.
   Verified: ⋯ fully visible at 390px, brand anchored at x=8.
6. **Run-list hygiene** — boot no longer auto-creates "New test run" shells;
   empty hero instead; composer creates on first submit; delete selects next
   run. Verified: 45 real runs, zero shells, "New run" produces exactly one.
7. **Deep links** — #/runs/<id> selects the run directly; hash syncs on select.
8. **Evidence honesty** — screenshots-banner (streaming vs persisted) plus the
   captured-steps fallback (below).
9. **Findings honesty** — "evidence: 0" replaced by inline-evidence note;
   exact-duplicate titles collapse to ×N occurrences badge.
10. **Schedules truth** — stale 0/0 bars render "—" dim gray with tooltip +
    legend entry; nextRun future-aware ("in 16h", not "just now"); duplicate
    "Auto:" schedules removed (3 → 1).
11. **BrowserStack truthfulness** — real last-test failure line rendered
    (✗ failed: missing_credentials); connectivity is NEVER faked; 0 false
    BrowserStack claims in visible DOM anywhere.

### Journey-driven fixes (from the full demo journey)
12. **Evidence fallback for watchdog runs** — evidence-graph collection only
    runs at mission finalize; runs ended by the 20-minute watchdog settle in
    `idle` and never finalize. The EVIDENCE tab now derives cards from the
    same captured steps the graph is built from (fetch-only, no server
    mutation), with an explanatory note. Flagship run: 96/96 steps shown.
13. **Report fallback** — `session.report` is only set when the agent publishes;
    watchdog runs never do. The REPORT tab now renders the server-generated
    report.md (honest "Run not finished" verdict, test-plan checklist,
    findings, Download/Copy actions) with a "generated from transcript" note.
14. **Device chip** — "📱 iPhone 15 · EMULATED DEVICE" with LOCAL tooltip
    (REAL_DEVICE reserved for provider=browserstack; DESKTOP otherwise).
15. **REASONING_LOG tab hint** — clarifies narrative reasoning lives in the
    transcript pane; the tab is the tool-by-tool trace.

## Demo journey (final state — all 10 stops PASS)

Dashboard ✓ → create/start test ✓ (2 real runs: CRM 9901 → 5 findings incl.
1 critical; TaskBoard 9902 with iPhone 15 device context → 1 finding) →
execution ✓ (device chip, provider line, viewport strip, terminal status) →
reasoning ✓ → application analysis ✓ (explained empty state for un-finalized
mission) → evidence ✓ (96/96 + notes) → findings ✓ (severity, inline evidence)
→ report ✓ (verdict + checklist + exports) → bugs ✓ (both journeys' findings
live in the global hub). Console: only known-acceptable 404 categories.

## Verification summary

| Gate | Result |
|---|---|
| 12-area tester survey (1280×800 + 390×844) | PASS (3 initial FAILs → fixed → re-verified) |
| Demo journey (10 stops) | PASS (4 initial FAILs → fixed → 4/4 re-verified) |
| Mobile nav re-verify (390px) | PASS 2/2 |
| Regression suite | 1104 tests / 1103 pass / 1 known harness race (see notes/regression-suite-baseline.md) |
| Infrastructure audit (infra_verifier) | **PASS** — env keys match backend, no hardcoded secrets, production services only, preview 200, Caddy routing correct, setup script deploy-ready (1 minor WARN: `npm install \|\| true` masks dep failures) |
| Code review (reviewer) | **PASS (conditional→cleared)** — all 9 fixes verified, auth enforced on all destructive routes (401s confirmed), no XSS in new render paths (textContent-only), scope discipline held (public/ only) |
| Security probes | no-token DELETE/POST/PUT → 401; bad bearer → 401 |

## Known engine behaviors (surfaced honestly, not fixable in Build 4 scope)

1. **20-minute session watchdog** — long missions abort at 20:00 and settle
   `idle`. UI now labels this "interrupted — session limit" + stats-bar line +
   generated report verdict "Run not finished". Demo guidance: keep live demo
   missions focused (<20 min) or use the flagship recorded runs.
2. **Agent-mission screenshots stream live but are not persisted as files** —
   UI explains this at the point of confusion; test-case runs (Tests page) do
   persist screenshots/traces.
3. **C2 cross-suite race** — device-execution vs execution-provenance config
   mutation under parallel `node --test`; passes in isolation and in direct
   API use. Documented in notes/regression-suite-baseline.md.
4. **BrowserStack credentials dead since 2026-08-17** — UI truthfully shows
   failed verification. Real credentials can be entered in Settings →
   "Test BrowserStack Connection" (auth + CDP probe, no faking).

## Demo-day cheat sheet

- Flagship recorded run: `#/runs/73651016-de28-4fab-873d-466ded6bb650`
  (TaskBoard · iPhone 15 EMULATED · 96 evidence steps · report + finding)
- Rich findings run: `#/runs/a3c8ad17-fa75-4766-9b54-c75673136486`
  (14 findings · dedupe ×N badges · evidence graph 56 items)
- Benchmark apps: localhost:9901–9907 (CRM, TaskBoard, Shop, Analytics, …)
- Schedules page: 1 truthful schedule card, "next: in ~16h", stale-history legend.

## Residual risks / follow-ups (non-blocking)

- All Builds 1–4 work is uncommitted (blocked by corrupted /home/coder/.gitconfig
  — git works with GIT_CONFIG_GLOBAL=/dev/null; publish before any rebuild).
- bugs.js severity/status enum interpolation is safe today (server coerces) —
  escape for defense-in-depth later.
- 4 stale 404 console entries on boot (old localStorage session/mission ids) —
  cosmetic; graceful empty states shown.
- Historical bugs hub carries many near-duplicate findings from older runs
  (~2200 items) — demo against the two flagship runs or newest-first sort.
