# QASE Phase 7 — Benchmark Results & Analysis

**Date:** 2025-01-20  
**Git:** 5c9f56e  
**Model:** z-ai/glm-5 (switched from drytis/kimi-k3 due to quota exhaustion)  
**Methodology:** 5 controlled HTML benchmark apps with known ground truth, each with intentionally broken behaviors and missing features. Ground truth documented BEFORE running QASE.

---

## 1. Benchmark Apps

| App | Port | Category | Intentionally Broken | Intentionally Missing |
|-----|------|----------|---------------------|----------------------|
| SalesFlow CRM | 9901 | CRM | Login dead, Settings no-persist | Reports, Team mgmt, Email, API settings, Search |
| TaskBoard | 9902 | Project Mgmt | Sign In/Reports/Team links dead | Search, Due dates, Comments, Drag-drop, Auth, Notifications |
| ShopHub E-commerce | 9903 | E-commerce | No auth at all | Account, Order history, Reviews, Wishlist, Categories, Shipping, Cart persistence |
| MetricsPro Analytics | 9904 | SaaS Dashboard | Sign In dead, API key no-persist, Settings no-persist, Refresh no-op | Charts, Export, Date filter, Roles, Notifications, Webhooks |
| SaaSLaunch Marketing | 9905 | Marketing Site | All CTAs dead, Sign In dead, Pricing buttons dead | Login, Blog, Contact form, Privacy, Terms, Dashboard |

---

## 2. Raw Results

| App | Steps | Findings | Critical | High | Medium | Low | Info |
|-----|-------|----------|----------|------|--------|-----|------|
| SalesFlow CRM | 116 | 23 | 5 | 4 | 10 | 0 | 0 |
| TaskBoard | 61 | 20 | 4 | 3 | 9 | 1 | 1 |
| ShopHub E-commerce | 125 | 10 | 3 | 3 | 2 | 1 | 0 |
| MetricsPro Analytics | 97 | 27 | 3 | 6 | 9 | 3 | 0 |
| SaaSLaunch Marketing | 107 | 23 | 5 | 6 | 7 | 0 | 0 |
| **TOTAL** | **506** | **103** | **20** | **22** | **37** | **5** | **1** |

---

## 3. Precision Analysis (Source-Code Verified)

Each QASE finding was manually classified against the benchmark app's actual source code:

| Classification | Count | % |
|---------------|-------|---|
| **True Positive (unique real issue)** | 66 | 64% |
| **Duplicate (real issue, already reported)** | 24 | 23% |
| **False Positive (wrong/hallucinated)** | 13 | 13% |

### Precision Metrics
- **All real issues / total findings: 87%** — 90 of 103 findings describe real problems
- **Unique real issues / total findings: 64%** — 66 of 103 are unique real findings
- **False positive rate: 13%** — 13 of 103 are wrong
- **Duplicate rate: 23%** — 24 of 103 are redundant

### Per-App Breakdown

| App | Total | TP | DUP | FP | Precision (real/total) |
|-----|-------|----|-----|----|----------------------|
| SalesFlow CRM | 23 | 15 | 7 | 1 | 96% |
| TaskBoard | 20 | 17 | 1 | 2 | 90% |
| ShopHub E-commerce | 10 | 6 | 4 | 0 | 100% |
| MetricsPro Analytics | 27 | 11 | 7 | 9 | 67% |
| SaaSLaunch Marketing | 23 | 17 | 5 | 1 | 96% |

---

## 4. Recall Analysis

Of the 43 intentionally planted issues, QASE found 22.

| App | GT Items | Found | Recall |
|-----|----------|-------|--------|
| SalesFlow CRM | 7 | 6 | 86% |
| TaskBoard | 9 | 5 | 56% |
| ShopHub E-commerce | 8 | 0 | 0% |
| MetricsPro Analytics | 10 | 5 | 50% |
| SaaSLaunch Marketing | 9 | 6 | 67% |
| **AGGREGATE** | **43** | **22** | **51%** |

### By Issue Type
- **Bug recall: 69%** (9 of 13 planted bugs found)
- **Missing feature recall: 43%** (13 of 30 planted missing features found)

### Notable Misses
1. **ShopHub E-commerce: 0% recall** — QASE found 10 real bugs (broken checkout validation, mobile layout, dead images) but did NOT identify ANY of the planted missing features (no auth, no reviews, no wishlist, no shipping). All findings were about bugs in existing functionality, not about absent features.
2. **MetricsPro: Refresh button** — QASE missed the planted "refresh does nothing" bug
3. **MetricsPro: 9 nonsensical FPs** — QASE hallucinated GitHub-like features (create repository, merge to main, code review) for an analytics dashboard. This indicates the app-understanding module misclassified the app's domain.

---

## 5. Duplicate Analysis

QASE reports the same issue multiple times in 23% of findings. Key patterns:
- Same issue from different perspectives (e.g., "Sign In link broken" reported as navigation bug AND authentication bug)
- Console errors reported separately from their visual effects
- Mobile issues split into viewport, layout, and overflow variants

---

## 6. Additional Findings (Beyond Ground Truth)

QASE found 44 real issues NOT in the ground truth:
- **Mobile/responsive bugs:** 18 findings across all 5 apps (none were intentionally planted)
- **Data inconsistencies:** 3 (dashboard stat mismatches in CRM and Analytics)
- **Accessibility gaps:** 3 (unassociated form labels)
- **UX/safety issues:** 4 (no delete confirmation, no undo)
- **Dead external dependencies:** 2 (via.placeholder.com images)
- **Security gaps:** 4 (invalid payment data accepted, no validation on critical forms)

These are TRUE POSITIVES — real issues a developer would want to know about, even though they weren't in the ground truth.

---

## 7. Notable False Positives

| App | Finding | Why Wrong |
|-----|---------|-----------|
| MetricsPro | "Missing: Repository/project creation" | App is analytics dashboard, not GitHub. App understanding module misclassified domain. |
| MetricsPro | "Missing: Create repository workflow" | Same hallucination — 9 total GitHub-related FPs |
| MetricsPro | "Missing: Compile final QA report" | QASE confusing its own mission with the app's features |
| SaaSLaunch | "Enterprise pricing card shows empty feature list" | HTML source has 6 features — QASE hallucinated emptiness |
| TaskBoard | "Missing: Create issue/task workflow" | This feature EXISTS (add task modal works) |
| CRM | "Contact modal invisible" | CSS shows correct display:flex on active — likely a timing/rendering artifact |

---

## 8. Performance Characteristics

| Metric | Value |
|--------|-------|
| Average steps per app | 101 |
| Average findings per app | 21 |
| Average time per app | ~20 min |
| Mission completion rate | 1/5 completed cleanly (TaskBoard), 4/5 sessions done but missions stuck "running" |
| LLM quota issues | Original model (drytis/kimi-k3) exhausted quota mid-run |
| Model switch | Switched to z-ai/glm-5 to complete benchmarks |

---

## 9. Key Takeaways

### Strengths
1. **Finds real bugs** — 87% of findings are real issues (when including dups)
2. **Finds bugs developers planted** — 69% bug recall rate
3. **Discovers unplanned issues** — found 44 real issues beyond ground truth, especially mobile/responsive (18 findings)
4. **Identifies data inconsistencies** — dashboard stat mismatches that require cross-page verification
5. **Finds security validation gaps** — invalid payment data, no form validation

### Weaknesses
1. **Domain confusion** — 9/27 MetricsPro findings were nonsensical GitHub features, indicating the app understanding module failed to correctly identify the app's domain
2. **Missing feature blindness** — 43% missing-feature recall. QASE excels at finding broken features but struggles to identify what SHOULD exist but doesn't
3. **Duplicates** — 23% of findings are redundant, inflating report size and reducing perceived precision
4. **Hallucination on feature lists** — QASE claimed Enterprise pricing had "empty feature list" when it had 6 features
5. **Mission lifecycle stuck** — 4/5 missions stuck "running" despite sessions being done

### Product Differentiation Summary
QASE demonstrates clear value in autonomous bug discovery (69% recall on planted bugs, 87% precision on all findings). Its unique capability vs. a static code analysis tool or a simple LLM code review is its ability to **interactively test** the application — clicking buttons, filling forms, navigating routes, and verifying actual runtime behavior. No non-agent approach can discover that "Place Order accepts card '123' with expiry '99/99'" without running the app.

The main value gap is in missing-feature detection and domain understanding accuracy, which needs the app understanding improvements from Phase 2 to mature further.
