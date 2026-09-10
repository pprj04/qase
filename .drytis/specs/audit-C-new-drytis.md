# Audit C — QASE capability campaign against new.drytis.com (+ ground truth scoring)

## Goal
Run Qase's testing capabilities at full depth against https://new.drytis.com and score the output against a manually-built ground truth. Verdict per capability: "as expected" or "still weak". This is the campaign the user asked for as the main event.

## Step 1 — Manual ground truth (built BEFORE any mission)
Two independent passes with Playwright scripts + manual review:
1. **Link/nav crawl**: every link, nav item, CTA → destination + HTTP status (expect: /, /solutions, /pricing, /about, studio.drytis.ai/login x N; watch for dead links, mixed-content, redirect chains)
2. **Page-quality checks per page** (/, /solutions, /pricing, /about): title/meta description/OG tags, single h1, heading hierarchy, image alt coverage, console errors, mobile layout at 375px, contrast spot-checks, form/CTA behavior
3. Document expected findings list (~15–25 items expected): missing/weak meta on inner pages, missing alts, any dead link, mobile overflow, contrast issues, console errors, missing sitemap/robots if applicable
Ground-truth file: artifacts/audit/new-drytis-ground-truth.md — each item: selector/url, why it's an issue, severity (P0–P3) as a human QA would rate it.

## Step 2 — Mission matrix (run through the REAL product flow)
All via the same paths a user takes (UI or /api/v1/integration/*):
1. **Functional/navigation mission** (maxTurns ~60): "Test all navigation and links on https://new.drytis.com — every link must reach a working page"
2. **Visual/UI mission**: "Check visual consistency, broken images, layout issues, mobile responsiveness"
3. **Accessibility mission**: "Audit accessibility: headings, alt text, contrast, keyboard navigation"
4. **SEO/meta mission**: "Check titles, meta descriptions, OG tags, sitemap/robots"
5. (Optional 5th) **Content/dead-code mission**: copy quality, placeholder text, outdated info
Each: same target, same guardrails (public pages only, no login attempts — studio.drytis.ai login is PRODUCTION AUTH WE DO NOT OWN; clicking "Log In" is fine, submitting credentials is NOT).

## Step 3 — Scoring vs ground truth
Per mission: findings reported vs ground-truth items → precision (share of reported findings that are real), recall (share of ground truth found), severity calibration (agent P0–P3 vs human P0–P3, count of over/under-severe), false-positive examples with why they're wrong, evidence quality (screenshot attached? selector cited? reproducible?).
Per capability (functional / visual / mobile / a11y / SEO): verdict **"as expected"** (recall ≥60% and precision ≥70% on that capability's ground-truth items, no systemic false-positive pattern) or **"still weak"** + specific failure pattern.

## Step 4 — Output
- artifacts/audit/new-drytis-campaign-report.md — matrix: capability × {missions run, findings, TP/FP, recall/precision, verdict}
- Session/mission links + export of each mission's report from the UI

## Acceptance criteria (observable)
- [ ] Ground-truth file exists with ≥15 items before any mission runs (commit order proves it)
- [ ] 4 missions minimum completed against new.drytis.com (5th optional)
- [ ] Every mission has findings + exported report
- [ ] Scoring table with per-capability verdicts as expected / still weak
- [ ] False positives documented with reasons

## Out of scope
No changes to Qase or new.drytis.com. No credential use on studio.drytis.ai.
