# Phase 15E — Bugs Page Full Build

## Goal
Redesign Bugs page from overlay-style layout to a proper first-class page with sticky header, inline stats, view toggle (grid/list), and board layout.

## Files Changed
- `public/index.html` — Bugs page redesigned with: sticky header (title + inline stats + search + filters), toolbar (New Bug + view toggle + export), scrollable board area
- `public/shared.js` — Added el refs: bugViewGrid, bugViewList
- `public/bugs.js` — Added bugState.view (grid/list), view toggle handlers in initBugsWiring, truncateUrl() for display, dynamic className on board for grid/list CSS, null guards on all element refs in initBugsWiring
- `public/styles.css` — Full bugs page CSS: flex layout, sticky header, stats row, search/filter inputs, grid auto-fill columns, list compact mode

## Acceptance Criteria
- [ ] Bugs page has sticky header with title + inline stat counts
- [ ] Search box filters bugs in real time
- [ ] Severity/Status/Category dropdown filters work
- [ ] Grid view shows bug cards in auto-fill grid (340px min)
- [ ] List view shows compact horizontal rows
- [ ] View toggle buttons (Grid/List) switch layout and highlight active
- [ ] Export buttons (Markdown/GitHub/JIRA/Linear) still work
- [ ] New Bug button opens editor
- [ ] Bug cards open detail drawer on click
- [ ] No console errors
