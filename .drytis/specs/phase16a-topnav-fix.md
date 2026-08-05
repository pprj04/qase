# Phase 16A — Topnav Layout Fix + Responsive CSS Corrections

## Goal
Fix overlapping buttons in the topnav bar and correct dead responsive CSS selectors that targeted non-existent class names.

## Issues Found
1. **No spacer** between topnav-left and topnav-right — all controls bunched together
2. **Wrong responsive selectors** — `.run-list-panel` (actual: `.panel.runs`), `.viewer-panel` (actual: `.panel.viewer`), `.model-badge` (actual: `.brand-sub`)
3. **Invalid HTML** — `</input>` closing tag on line 345
4. **Old conflicting breakpoint** at 1100px that didn't account for the topnav

## Fixes Applied
1. Added `<div class="topnav-spacer"></div>` between left links and right controls in index.html
2. Added `.topnav-left` CSS with `flex-shrink: 0` + `white-space: nowrap` so links never wrap
3. Added `.topnav-project` CSS with `max-width: 180px` + constrained select to 140px
4. Changed topnav `gap` from 24px to 16px, added `overflow: hidden` + `flex-wrap: nowrap`
5. Fixed all responsive selectors: `.run-list-panel` → `.panel.runs`, `.viewer-panel` → `.panel.viewer`, `.model-badge` → `.brand-sub`
6. Updated old breakpoint from 1100px to 1200px (adds project select constraint)
7. Mobile breakpoint now hides `#new-project` button and `.brand-sub` to save space
8. Removed invalid `</input>` tag
9. Added `flex-wrap: wrap` to toolbars in mobile breakpoint

## Acceptance Criteria
- [ ] Topnav has spacer pushing right controls to the edge
- [ ] No button overlap at any screen size
- [ ] Responsive selectors use correct class names
- [ ] No invalid HTML tags
