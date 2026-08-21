# Phase 17 UX Benchmark Results

Run: 2026-08-16T21:33:18.917Z

| Metric | Value |
|---|---|
| UX recall | 100.0% |
| UX precision | 100.0% |
| FP rate | 0.0% |
| Evidence completeness | 100% |
| Gap precision (CONFIRMED, positive path) | 100.0% |
| Gap recall (positive path) | 100.0% |
| Honest mode never CONFIRMs | yes |
| Implemented detected | 5/5 |
| UNVERIFIED survives | yes |

## Per app

### SalesFlow CRM
- flagged: navigation_dead_end, clarity_page_heading, hierarchy_heading_order, resp_horizontal_overflow, resp_touch_targets, consistency_cross_page
- matched labels: ux_nav_dead_end, ux_resp_overflow_mobile, ux_resp_touch_targets, ux_consistency_titles
- missed labels: —
- false positives: —
- confirmed gaps: —
- gap FPs: —
- implemented detected: —
- unverified areas: 27
- sweep duration: 2949ms

### TaskBoard
- flagged: navigation_dead_end, hierarchy_heading_order, resp_horizontal_overflow, resp_touch_targets, consistency_cross_page
- matched labels: ux_nav_dead_end, ux_consistency_titles, ux_resp_overflow_mobile
- missed labels: —
- false positives: —
- confirmed gaps: —
- gap FPs: —
- implemented detected: —
- unverified areas: 27
- sweep duration: 2941ms

### ShopHub E-commerce
- flagged: navigation_dead_end, navigation_broken_internal_links, clarity_page_heading, hierarchy_heading_order, console_errors, resp_horizontal_overflow, resp_touch_targets, consistency_cross_page
- matched labels: ux_resp_touch_targets, ux_nav_dead_end
- missed labels: —
- false positives: —
- confirmed gaps: —
- gap FPs: —
- implemented detected: —
- unverified areas: 24
- sweep duration: 2889ms

### MetricsPro Analytics
- flagged: navigation_dead_end, hierarchy_heading_order, resp_horizontal_overflow, resp_touch_targets, consistency_cross_page
- matched labels: ux_resp_overflow_mobile, ux_resp_touch_targets
- missed labels: —
- false positives: —
- confirmed gaps: —
- gap FPs: —
- implemented detected: —
- unverified areas: 27
- sweep duration: 2910ms

### SaaSLaunch Marketing
- flagged: navigation_dead_end, navigation_broken_internal_links, resp_horizontal_overflow, resp_touch_targets, consistency_cross_page
- matched labels: ux_resp_overflow_mobile, ux_nav_dead_end
- missed labels: —
- false positives: —
- confirmed gaps: —
- gap FPs: —
- implemented detected: —
- unverified areas: 27
- sweep duration: 3016ms
