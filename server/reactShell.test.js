import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 1: vite config builds react app under /app-react/ base', () => {
  const config = read('vite.config.ts');
  assert.match(config, /base:\s*'\/app-react\/'/);
  assert.match(config, /outDir:\s*'public\/app-react'/);
  // React sources resolve via the @ alias
  assert.match(config, /'@'/);
});

test('phase 1: react app shell renders structural landmarks', () => {
  const app = read('src/App.tsx');
  // collapsible sidebar, conversation column, mode rail, status bar
  assert.match(app, /className="sidebar/);
  assert.match(app, /className="conversation"/);
  assert.match(app, /className="mode-rail"/);
  assert.match(app, /className="status-bar"/);
  assert.match(app, /data-testid="sidebar-toggle"/);
  // viewer is its own component since Phase 4/5 (tabs + stage + auto-collapse)
  const viewer = read('src/components/ViewerPanel.tsx');
  assert.match(viewer, /className="viewer-pane"/);
  assert.match(viewer, /viewer-tab-\$\{id\}/);
  assert.match(viewer, /id="panel-browser"/);
  assert.match(viewer, /id="panel-findings"/);
  assert.match(viewer, /id="panel-report"/);
  // QA launcher dialog is driven from the sidebar "New run" button
  assert.match(app, /QaLauncher open=\{launcherOpen\}/);
});

test('phase 1: theme system — tokens for light and dark, toggle, no-flash script', () => {
  const tokens = read('src/theme/tokens.css');
  assert.match(tokens, /:root\s*{/);
  assert.match(tokens, /\.dark\s*{/);
  // Studio palette anchors
  assert.match(tokens, /#2f5bea/i);
  // light + dark token parity for the core surface variables
  for (const token of ['--background', '--foreground', '--card', '--muted', '--border', '--brand']) {
    assert.ok(tokens.includes(token), `${token} defined`);
  }

  const provider = read('src/theme/ThemeProvider.tsx');
  assert.match(provider, /prefers-color-scheme/);
  assert.match(provider, /qase-theme/);
  // Self-heal: stored/OS theme is re-applied on mount even when the
  // bootstrap script was blocked (CSP) — reload with qase-theme=dark
  // must not render light.
  assert.match(provider, /Self-heal/);
  const toggle = read('src/theme/ThemeToggle.tsx');
  assert.match(toggle, /aria-label/);

  const html = read('index-react.html');
  // no-flash bootstrap must load synchronously before the app script and be
  // CSP-safe (external file — inline scripts are blocked by script-src 'self')
  assert.ok(!/<script>\s*\(\s*function/.test(html), 'no inline scripts in index-react.html');
  const bootIdx = html.indexOf('theme-bootstrap.js');
  const scriptIdx = html.indexOf('/src/main.tsx');
  assert.ok(bootIdx > -1 && scriptIdx > bootIdx, 'theme bootstrap precedes app script');
  assert.ok(
    fs.existsSync(path.join(root, 'public/app-react/theme-bootstrap.js')),
    'external theme bootstrap file exists in build output',
  );
});

test('phase 1: server serves the react bundle at /app-react/ without touching legacy routes', () => {
  const server = read('server/app.js');
  assert.match(server, /app\.get\('\/app-react\/'/);
  // legacy login route untouched
  assert.match(server, /app\.get\('\/login'/);
  // route registered before static middleware so index.html resolves
  const reactIdx = server.indexOf("app.get('/app-react/'");
  const staticIdx = server.indexOf('app.use(express.static(');
  assert.ok(reactIdx > -1 && staticIdx > reactIdx, 'react route precedes static middleware');
});

test('phase 1: geist fonts referenced from the existing bundle', () => {
  const tokens = read('src/theme/tokens.css');
  assert.match(tokens, /Geist-Regular\.woff2/);
  assert.match(tokens, /GeistMono-Regular\.woff2/);
  assert.ok(fs.existsSync(path.join(root, 'public/fonts/Geist-Regular.woff2')));
});

test('phase 1: build output exists and index.html mounts react root', () => {
  const builtIndex = path.join(root, 'public/app-react/index.html');
  assert.ok(fs.existsSync(builtIndex), 'vite build produced public/app-react/index.html');
  const html = fs.readFileSync(builtIndex, 'utf8');
  assert.match(html, /id="root"/);
  assert.match(html, /assets\//);
});
