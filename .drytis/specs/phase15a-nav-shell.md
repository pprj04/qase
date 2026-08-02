# Phase 15A — Navigation Shell + Hash Router

## Goal
Replace the single-page layout with a persistent top navigation bar and hash-based router enabling multi-page navigation (#/runs, #/tests, #/bugs). The old bugs overlay becomes a full page.

## Files Changed
- `public/router.js` (NEW) — hash-based router: navigate(), currentPage(), routechange event
- `public/index.html` — persistent topnav bar with brand, nav links, project selector, status. Page containers: #page-runs, #page-tests, #page-bugs
- `public/app.js` — import router, boot calls initRouter(), routechange listener loads page data, removed old bugs overlay toggle (el.bugsHub, el.openBugs, el.closeBugs)
- `public/styles.css` — .topnav, .topnav-link, .page[hidden], .bugs-hub-page styles

## Acceptance Criteria
- [ ] Top nav bar visible on all pages with Runs · Tests · Bugs links
- [ ] Clicking a nav link changes the URL hash and shows the correct page
- [ ] Direct URL access (#/bugs) loads the correct page on refresh
- [ ] Bugs hub is shown as a page, not an overlay
- [ ] Router highlights active nav item
- [ ] No console errors on page load
- [ ] Existing runs page (sessions, composer, detail) still works
- [ ] Bug badge on test case still opens bug detail
- [ ] Page-specific data loads on navigation (bugs load when visiting #/bugs)
