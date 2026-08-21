/**
 * Hash-based router for the Qase multi-page shell (Phase 15A).
 *
 * Pages:
 *   #/runs   — Agent workspace (chat, browser, activity)
 *   #/tests  — Test case management (grid, suites, runs)
 *   #/bugs   — Bugs Hub (board, detail, export)
 *
 * The router:
 *   - Listens to `hashchange`
 *   - Swaps the visible page container
 *   - Highlights the active nav item
 *   - Exposes a simple `navigate(path)` for programmatic jumps
 *   - Fires a `routechange` event on `window` so modules can react
 *
 * No deep-linking into sub-views yet (e.g. #/bugs/:id). That comes later.
 */

export const PAGES = ['runs', 'tests', 'workflows', 'schedules', 'bugs'];

let current = null;
let initialized = false;

/** Navigate to a page programmatically. */
export function navigate(page) {
	if (!PAGES.includes(page)) return;
	if (location.hash !== `#/${page}`) {
		location.hash = `#/${page}`;
	} else {
		// Same hash — force render (e.g. clicking the active tab to refresh).
		render(page);
	}
}

/** Return the current page key. */
export function currentPage() {
	return current;
}

/** Initialise the router: reads hash on load, listens for changes. */
export function initRouter() {
	if (initialized) return;
	initialized = true;

	window.addEventListener('hashchange', () => {
		const page = parseHash();
		render(page);
	});

	// Render the initial page.
	const page = parseHash();
	render(page);
}

/** Parse `location.hash` → page key. Falls back to 'runs'. */
function parseHash() {
	const raw = location.hash.replace(/^#\/?/, '').split('/')[0].toLowerCase();
	return PAGES.includes(raw) ? raw : 'runs';
}

/**
 * Deep-link target for the runs page: `#/runs/<sessionId>` selects that
 * session on load. Returns null when no id is present.
 */
export function runIdFromHash() {
	const parts = location.hash.replace(/^#\/?/, '').split('/');
	if (parts[0].toLowerCase() === 'runs' && parts[1]) return parts[1];
	return null;
}

/** Swap visible page container + update nav state. */
function render(page) {
	if (page === current && initialized) return; // no-op if same page
	current = page;

	// Toggle page containers.
	for (const p of PAGES) {
		const container = document.getElementById(`page-${p}`);
		if (container) {
			container.hidden = p !== page;
		}
	}

	// Update nav links.
	document.querySelectorAll('[data-nav]').forEach(link => {
		link.classList.toggle('active', link.dataset.nav === page);
	});

	// Notify modules.
	window.dispatchEvent(new CustomEvent('routechange', { detail: { page } }));
}
