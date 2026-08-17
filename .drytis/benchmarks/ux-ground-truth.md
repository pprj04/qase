# QASE Phase 17 — UX Intelligence Ground Truth

Deterministic UX ground truth for each benchmark app. The Phase 17 benchmark
runner (`scripts/ux-benchmark.mjs`) runs ONLY the deterministic sweep + checks
(no LLM, no mission) and compares against this document. Written BEFORE the
benchmark run, from reading the benchmark app sources.

## Adjudication appendix (post first run, evidence-based corrections)

Written AFTER the first benchmark run, from DOM measurements — not from the
engine's output labels. Three labels corrected:

1. **TaskBoard `ux_resp_overflow_mobile` moved from ux_clean → ux_issue.**
   Measured: mobile viewport scrollWidth=429 > clientWidth=375, overflowing
   selectors `#col-progress`, `.card`, `.meta` (kanban columns overflow).
   The engine flag was a TRUE POSITIVE; my original "no horizontal overflow"
   clean-area note was wrong.
2. **ShopHub `ux_a11y_images_no_alt` removed.** Measured: all 6 product
   images carry alt text ("Wireless Headphones", …). The engine correctly did
   NOT flag this; the label was a ground-truth error.
3. **SaaSLaunch `ux_a11y_images_no_alt` removed.** Measured: the app renders
   zero `<img>` elements (pure text/CSS hero). Nothing to flag; label invalid.

Extra engine flags NOT in the original label set, adjudicated TRUE:
- `hierarchy_heading_order` (TaskBoard, ShopHub) — heading levels skip order.
- `navigation_broken_internal_links` (ShopHub, SaaSLaunch) — same dead-end
  phenomenon surfaced via link validation.
- `clarity_page_heading` + `console_errors` (ShopHub) — console errors are
  real (placeholder image hosts unreachable offline).

These are counted neither as recall hits nor FPs (they are outside the label
set; adjudicated true so precision impact is zero).

Labels:
- ux_issue     — a deterministic UX issue the checks MUST flag (recall set)
- ux_clean     — a known-good area the checks must NOT flag (FP set)
- gap_confirmed— explicit-expectation feature gap (requirements → CONFIRMED)
- gap_absent   — requirement that IS implemented (must classify IMPLEMENTED)

---

## App 1: SalesFlow CRM (http://localhost:9901)

### ux_issues (must be flagged)
- ux_a11y_images_no_alt      — img elements without alt attribute (if any)
- ux_nav_dead_end            — "Sign In" link navigates to #login but no
                               login section exists (dead-end navigation)
- ux_resp_overflow_mobile    — horizontal overflow at 375px (nav/table row)
- ux_resp_touch_targets      — nav links < 44px tall at mobile viewport
- ux_feedback_missing        — Settings "save" shows toast but no persistent
                               success/failure state; forms without feedback
- ux_consistency_titles      — identical page titles across sections (hash
                               routing, single title)

### ux_clean (must NOT be flagged)
- clarity_document_title     — has a unique descriptive title
- form_field_labels          — modal forms use explicit labels
- heading hierarchy          — single h1 per section view (not assertable at
                               page level; page-level order is valid)

### gaps
- gap_confirmed: "Reports / analytics section" — explicit requirement absent
- gap_confirmed: "Search functionality" — explicit requirement absent
- gap_absent:   "Contacts list" — implemented

---

## App 2: TaskBoard (http://localhost:9902)

### ux_issues (must be flagged)
- ux_nav_dead_end            — "Reports", "Team", "Sign In" nav links go to
                               #reports / #team / #login with no matching
                               section (3 dead ends)
- ux_consistency_titles      — single document title for all views
- ux_resp_overflow_mobile    — kanban columns overflow 375px (measured
                               429px scrollWidth; corrected in adjudication)

### ux_clean (must NOT be flagged)
- form_field_labels          — task modal labels every field
- heading_order              — (corrected: engine DOES flag skipped order —
                               adjudicated true, removed from clean set)

### gaps
- gap_confirmed: "Search/filter" — explicit requirement absent
- gap_confirmed: "Due dates" — explicit requirement absent
- gap_absent:   "Kanban board" — implemented

---

## App 3: ShopHub E-commerce (http://localhost:9903)

### ux_issues (must be flagged)
- ux_resp_touch_targets      — dense product grid links at mobile
- ux_nav_dead_end            — "Sign In" without login section (verified)

### ux_clean (must NOT be flagged)
- clarity_document_title
- form_field_labels          — checkout form fully labeled
- a11y_image_alt             — all product images carry alt text
                               (corrected in adjudication)

### gaps
- gap_confirmed: "User reviews" — explicit requirement absent
- gap_absent:   "Cart" — implemented

---

## App 4: MetricsPro Analytics (http://localhost:9904)

### ux_issues (must be flagged)
- ux_resp_overflow_mobile    — wide data tables overflow at 375px
- ux_resp_touch_targets      — dense table/chart controls at mobile
- ux_a11y_images_no_alt      — chart placeholders (canvas/svg) where alt-ish
                               text missing (verify against source)

### ux_clean (must NOT be flagged)
- clarity_document_title
- heading hierarchy          — section headings ordered

### gaps
- gap_confirmed: "Export data (CSV)" — explicit requirement absent
- gap_absent:   "Dashboard stats" — implemented

---

## App 5: SaaSLaunch Marketing (http://localhost:9905)

### ux_issues (must be flagged)
- ux_nav_dead_end            — footer links to #features/#pricing may lack
                               matching sections (verified: flagged)
- ux_resp_overflow_mobile    — pricing table row may overflow 375px (flagged)

### ux_clean (must NOT be flagged)
- clarity_document_title
- form_field_labels          — contact/newsletter form labeled
- a11y_image_alt             — zero img elements in the app
                               (corrected in adjudication)

### gaps
- gap_confirmed: "Blog" — explicit requirement absent
- gap_absent:   "Pricing section" — implemented

---

## Measurement Definitions

- **UX precision** = flagged issues that match a ux_issue label / all flagged
- **UX recall**    = ux_issue labels matched / all ux_issue labels
- **UX FP rate**   = flags on ux_clean areas / total flags
- **Evidence completeness** = issues carrying ≥1 typed evidence / all issues (target 100%)
- **Gap precision (CONFIRMED)** = correctly CONFIRMED / all CONFIRMED (target 100%: explicit-gated)
- **Gap recall**   = confirmed real gaps found / gap_confirmed count

The runner also verifies the NEGATIVE guarantees:
- no ux issue may lack evidence
- no CONFIRMED gap may come from a heuristic/LLM expectation
- UNVERIFIED/UNKNOWN states must survive (they appear as unverifiedAreas)
