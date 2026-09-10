/**
 * Client-side router for QASE. It supports path-based URLs while continuing
 * to understand legacy #/ URLs users may have bookmarked.
 */
export const PAGES = ['runs', 'tests', 'workflows', 'schedules', 'bugs'];

let current = 'runs';
let initialized = false;

export function navigate(page) {
  if (!PAGES.includes(page)) return;

  if (usesHashRoute()) {
    const wanted = '#/' + page;
    if (location.hash !== wanted) location.hash = wanted;
    else render(page);
    return;
  }

  history.pushState(null, '', '/' + page);
  render(page);
}

export function currentPage() {
  return current;
}

export function initRouter() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('hashchange', () => render(parseRoute().page));
  window.addEventListener('popstate', () => render(parseRoute().page));

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-nav]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.dataset.nav);
  });

  render(parseRoute().page);
}

function partsFromHash() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  return raw ? raw.split('/').filter(Boolean) : [];
}

function partsFromPathname() {
  return location.pathname.split('/').filter(Boolean);
}

function usesHashRoute() {
  return PAGES.includes((partsFromHash()[0] || '').toLowerCase());
}

function parseRoute() {
  const parts = usesHashRoute() ? partsFromHash() : partsFromPathname();
  const page = (parts[0] || '').toLowerCase();
  return { page: PAGES.includes(page) ? page : 'runs', parts };
}

// Retained for callers and legacy links; it reads both URL schemes.
export function runIdFromHash() {
  const { parts } = parseRoute();
  return (parts[0] || '').toLowerCase() === 'runs' && parts[1] ? parts[1] : null;
}

export function setRunRoute(id, { replace = true } = {}) {
  if (!id || current !== 'runs') return;

  if (usesHashRoute()) {
    const wanted = '#/runs/' + encodeURIComponent(id);
    if (location.hash !== wanted) history.replaceState(null, '', wanted);
    return;
  }

  const wanted = '/runs/' + encodeURIComponent(id);
  if (location.pathname !== wanted) {
    history[replace ? 'replaceState' : 'pushState'](null, '', wanted);
  }
}

function render(page) {
  current = page;
  for (const name of PAGES) {
    const container = document.getElementById('page-' + name);
    if (container) container.hidden = name !== page;
    document.querySelector('[data-nav="' + name + '"]')?.classList.toggle('active', name === page);
  }
  window.dispatchEvent(new CustomEvent('routechange', { detail: { page } }));
}
