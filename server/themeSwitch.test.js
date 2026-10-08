/**
 * Theme Stateful Switch — Phase 2 tests (static + served-HTML assertions).
 *
 * There is no DOM library in this project (vanilla JS, no build step), so the
 * behavior is verified by (a) asserting the served markup contains an
 * accessible switch and (b) asserting app.js wires the exact contract:
 * change-listener → toggleTheme → applyTheme → localStorage qase.theme +
 * data-theme attribute + aria-checked + title + glyph swap, and that boot()
 * syncs from the attribute the no-flicker head script set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

const ROOT = new URL('../public/', import.meta.url);

async function readAsset(name) {
	return readFile(new URL(name, ROOT), 'utf8');
}

function serveOnce(html) {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(html);
			server.close();
		});
		server.listen(0, '127.0.0.1', async () => {
			const { port } = server.address();
			const body = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
			resolve(body);
		});
	});
}

test('switch: served markup has accessible Stateful Switch', async () => {
	const html = await serveOnce(await readAsset('index.html'));
	assert.match(html, /id="theme-switch"/, 'switch input exists');
	assert.match(html, /role="switch"/, 'switch role for screen readers');
	assert.match(html, /aria-checked="false"/, 'initial state exposed');
	assert.match(html, /aria-label="Switch to Light Mode"/, 'label names the action');
	assert.match(html, /id="theme-switch-state"/, 'non-color state text exists');
	assert.match(html, /title="Switch to Light Mode"/, 'tooltip on label');
});

test('switch: boot() syncs switch from the head-script attribute', async () => {
	const app = await readAsset('app.js');
	assert.match(app, /syncThemeFromDocument\(\)/, 'boot calls syncThemeFromDocument');
	assert.match(app, /el\.themeSwitch\?\.addEventListener\('change'/, 'change listener wired');
	assert.match(app, /classList\.add\('theme-transition'\)/, 'swap animates via theme-transition class');
});

test('switch: applyTheme contract — attribute, storage, aria, title, glyph', async () => {
	const app = await readAsset('app.js');
	assert.match(app, /setAttribute\('data-theme'/, 'sets data-theme');
	assert.match(app, /localStorage\.setItem\(THEME_KEY/, 'persists preference');
	assert.match(app, /THEME_KEY = 'qase\.theme'/, 'same key as head script');
	assert.match(app, /setAttribute\('aria-checked'/, 'aria-checked synced');
	assert.match(app, /Switch to Dark Mode/, 'tooltip flips to dark when light');
	assert.match(app, /Switch to Light Mode/, 'tooltip flips to light when dark');
	assert.match(app, /'☀️' : '🌙'/, 'glyph swaps sun/moon (not color-only)');
	assert.match(app, /theme-switch-state/, 'sr-only state text updated');
});

test('switch: toggle reads stored theme (no desync with head script)', async () => {
	const app = await readAsset('app.js');
	assert.match(app, /function toggleTheme\(\)/);
	assert.match(app, /readStoredTheme\(\) === 'light' \? 'dark' : 'light'/);
});

test('switch: el map resolves the new nodes', async () => {
	const app = await readAsset('app.js');
	assert.match(app, /themeSwitch: \$\('theme-switch'\)/);
	assert.match(app, /themeSwitchLabel: \$\('theme-switch-label'\)/);
});
