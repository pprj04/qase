/** UI-1 shell/router contract checks. No browser runtime or external provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const router = read('public/router.js');
const html = read('public/index.html');
const shell = read('public/shell.js');
const server = read('server/index.js');

test('UI-1: every V1 route has a client route, shell destination, and intentional page', () => {
  const routes = [
    ['overview', 'overview'], ['runs', 'runs'], ['test-cases', 'tests'], ['workflows', 'workflows'],
    ['findings', 'bugs'], ['schedules', 'schedules'], ['reports', 'reports'],
    ['integrations', 'integrations'], ['settings', 'settings-route']
  ];
  for (const [route, page] of routes) {
    assert.match(router, new RegExp(`(?:'${route}'|${route}): \\{ page: '${page}'`));
    assert.match(html, new RegExp(`data-nav="${route}"`));
    assert.match(html, new RegExp(`id="page-${page}"`));
  }
});

test('UI-1: legacy Tests and Bugs URLs remain aliases to canonical pages', () => {
  assert.match(router, /ALIASES = \{ tests: 'test-cases', bugs: 'findings' \}/);
  assert.match(server, /'\/tests', '\/test-cases', '\/bugs', '\/findings'/);
});

test('UI-1: unknown client paths resolve to a not-found state, never Runs', () => {
  assert.match(router, /page: 'not-found'/);
  assert.match(html, /id="page-not-found"/);
  assert.doesNotMatch(router, /PAGES\.includes\(page\) \? page : 'runs'/);
});

test('UI-1: run deep links are retained', () => {
  assert.match(router, /route\.name === 'runs' && route\.parts\[1\]/);
  assert.match(server, /'\/runs\/:id'/);
});

test('UI-1: SPA serving gates all new known routes and preserves the login gate', () => {
  for (const route of ['overview', 'test-cases', 'findings', 'reports', 'integrations', 'settings']) {
    assert.match(server, new RegExp(route));
  }
  assert.match(server, /if \(!authenticated\) return response\.redirect\('\/login'\)/);
});

test('UI-1: shell has semantic primary navigation and active page semantics', () => {
  assert.match(html, /<aside class="shell-sidebar"[^>]*aria-label="QASE navigation"/);
  assert.match(html, /<nav class="shell-nav" aria-label="Primary navigation">/);
  assert.match(router, /setAttribute\('aria-current', 'page'\)/);
});

test('UI-1: account identity, role, theme, settings, and sign-out share one reachable menu', () => {
  for (const id of ['shell-account-identity', 'shell-account-role', 'shell-account-theme', 'shell-account-settings', 'shell-account-signout']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(shell, /fetch\('\/api\/auth\/logout'/);
  assert.match(shell, /who\?\.role === 'admin'/);
});

test('UI-1: mobile drawer has escape, focus trap, focus restoration, and destination close behavior', () => {
  assert.match(shell, /event\.key === 'Escape'/);
  assert.match(shell, /event\.key !== 'Tab'/);
  assert.match(shell, /shell-nav-toggle'\)\?\.focus\(\)/);
  assert.match(shell, /#shell-sidebar a\[data-nav\]/);
  assert.match(shell, /closeDrawer\(\{ restore: false \}\)/);
});

test('UI-1: project switching masks stale content and rejects late project responses', () => {
	assert.match(shell, /is-project-switching/);
	const app = read('public/app.js');
	const shared = read('public/shared.js');
	assert.match(shared, /projectVersion: 0/);
	assert.match(app, /const projectVersion = \+\+state\.projectVersion/);
	assert.match(app, /state\.stream\?\.close\(\)/);
	assert.match(app, /state\.sessionId = undefined/);
	assert.match(app, /el\.transcript\.replaceChildren\(el\.chatEmpty\)/);
	assert.match(app, /projectVersion !== state\.projectVersion \|\| projectId !== state\.projectId/);
	assert.match(read('public/tests.js'), /provenanceCache\.projectId !== projectId/);
	assert.match(read('public/bugs.js'), /projectVersion !== state\.projectVersion/);
	assert.match(read('public/workflows.js'), /projectVersion !== state\.projectVersion/);
	assert.match(read('public/schedules.js'), /projectVersion !== state\.projectVersion/);
});
