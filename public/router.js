/** QASE V1 router with canonical paths and legacy aliases. */
const ROUTES = {
  overview: { page: 'overview', path: 'overview' },
  runs: { page: 'runs', path: 'runs' },
  'test-cases': { page: 'tests', path: 'test-cases' },
  workflows: { page: 'workflows', path: 'workflows' },
  findings: { page: 'bugs', path: 'findings' },
  schedules: { page: 'schedules', path: 'schedules' },
  reports: { page: 'reports', path: 'reports' },
  integrations: { page: 'integrations', path: 'integrations' },
  settings: { page: 'settings-route', path: 'settings' }
};
const ALIASES = { tests: 'test-cases', bugs: 'findings' };
let current = null;
let initialized = false;

const canonical = value => {
  const name = String(value ?? '').toLowerCase();
  return ROUTES[name] ? name : ALIASES[name] ?? null;
};

export function navigate(name) {
  const route = canonical(name);
  if (!route) return;
  const definition = ROUTES[route];
  const wanted = usesHashRoute() ? '#/' + definition.path : '/' + definition.path;
  if ((usesHashRoute() ? location.hash : location.pathname) !== wanted) history.pushState(null, '', wanted);
  render(parseRoute());
}

export function currentPage() { return current; }

export function initRouter() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', () => render(parseRoute()));
  window.addEventListener('popstate', () => render(parseRoute()));
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-nav]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.dataset.nav);
  });
  render(parseRoute());
}

function partsFromHash() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  return raw ? raw.split('/').filter(Boolean) : [];
}
function partsFromPathname() { return location.pathname.split('/').filter(Boolean); }
function usesHashRoute() { return Boolean(canonical(partsFromHash()[0])); }

export function parseRoute() {
  const parts = usesHashRoute() ? partsFromHash() : partsFromPathname();
  const name = canonical(parts[0] || '');
  if (!name && parts.length === 0) return { name: 'runs', page: 'runs', parts: [] };
  if (!name) return { name: null, page: 'not-found', parts };
  return { name, page: ROUTES[name].page, parts };
}

export function runIdFromHash() {
  const route = parseRoute();
  return route.name === 'runs' && route.parts[1] ? route.parts[1] : null;
}

export function setRunRoute(id, { replace = true } = {}) {
  if (!id || current !== 'runs') return;
  const wanted = usesHashRoute() ? '#/runs/' + encodeURIComponent(id) : '/runs/' + encodeURIComponent(id);
  if ((usesHashRoute() ? location.hash : location.pathname) !== wanted) history[replace ? 'replaceState' : 'pushState'](null, '', wanted);
}

function render(route) {
  current = route.name;
  for (const definition of Object.values(ROUTES)) {
    const page = document.getElementById('page-' + definition.page);
    if (page) page.hidden = definition.page !== route.page;
  }
  const missing = document.getElementById('page-not-found');
  if (missing) missing.hidden = route.page !== 'not-found';
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = canonical(link.dataset.nav) === route.name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.dispatchEvent(new CustomEvent('routechange', { detail: { page: route.name, pageId: route.page, parts: route.parts } }));
}
