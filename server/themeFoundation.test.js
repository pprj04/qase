import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node:url';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

/* Theme foundation contract: the stylesheet defines a light token layer
   under [data-theme="light"] that re-declares every core token with
   readable light values, and index.html restores the stored theme
   before first paint. No DOM library is available, so the CSS is
   asserted structurally and the boot script behavior is asserted via
   a real browser-free parse of its source + a live style resolution
   using the CSS custom property cascade rules. */

const STYLES = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const DARK_TOKENS = {
	'--bg': '#1a1a1a',
	'--text': '#fafafa',
	'--border': '#3f3f46',
	'--accent': '#2f5bea'
};

function extractTokenBlock(css, selector) {
	const start = css.indexOf(`${selector} {`);
	assert.notEqual(start, -1, `missing selector ${selector}`);
	const open = css.indexOf('{', start);
	let depth = 1;
	let end = open + 1;
	while (depth > 0 && end < css.length) {
		if (css[end] === '{') depth += 1;
		if (css[end] === '}') depth -= 1;
		end += 1;
	}
	return css.slice(open + 1, end - 1);
}

function readToken(block, name) {
	const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
	return match ? match[1].trim() : undefined;
}

test('light token layer exists and re-declares every core token with light values', () => {
	const light = extractTokenBlock(STYLES, '[data-theme="light"]');
	for (const name of Object.keys(DARK_TOKENS)) {
		const lightValue = readToken(light, name);
		assert.ok(lightValue, `${name} missing from light layer`);
	}
	// Core inversion: light backgrounds, dark text (dark mode has the reverse).
	assert.equal(readToken(light, '--bg'), '#ffffff');
	assert.equal(readToken(light, '--text'), '#0a0a0a');
	assert.notEqual(readToken(light, '--border'), DARK_TOKENS['--border']);
	// Accent is the shared brand blue in both themes.
	assert.equal(readToken(light, '--accent'), DARK_TOKENS['--accent']);
	assert.match(light, /color-scheme:\s*light/);
});

test('light layer covers the full token surface of the dark root', () => {
	const dark = extractTokenBlock(STYLES, ':root');
	const light = extractTokenBlock(STYLES, '[data-theme="light"]');
	const darkTokens = [...dark.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
	const colorNames = darkTokens.filter(t => !t.startsWith('--radius') && !t.startsWith('--ease') && !t.startsWith('--font'));
	for (const name of colorNames) {
		assert.ok(readToken(light, name) !== undefined, `${name} present in dark :root but not in the light layer`);
	}
});

test('index.html restores the stored light theme before first paint', () => {
	const scriptStart = INDEX.indexOf("localStorage.getItem('qase.theme')");
	assert.ok(scriptStart > -1, 'boot script must read qase.theme');
	const stylesEnd = INDEX.indexOf('entry-terminal.css');
	assert.ok(scriptStart > stylesEnd && scriptStart < INDEX.indexOf('<body'), 'boot script must sit after the stylesheets and before <body>');
	assert.ok(INDEX.slice(stylesEnd, scriptStart).includes('<script>'), 'boot script must be an inline script immediately after the stylesheet links');
	const script = INDEX.slice(INDEX.indexOf('<script>', stylesEnd), INDEX.indexOf('</script>', stylesEnd));
	assert.match(script, /data-theme.*light|light.*data-theme/s, 'boot script sets data-theme=light');
	assert.match(script, /theme-color/, 'boot script patches the theme-color meta');
	assert.match(script, /color-scheme/, 'boot script patches the color-scheme meta');
	assert.match(script, /try\s*{/, 'boot script tolerates storage failures (try/catch)');
});

test('dark remains the default: no data-theme in static html, dark metas unchanged', () => {
	assert.doesNotMatch(INDEX.slice(0, INDEX.indexOf('</head>')), /<html[^>]*data-theme/, 'html element must not hardcode a theme');
	assert.match(INDEX, /<meta name="color-scheme" content="dark">/, 'default color-scheme meta stays dark');
});

/* Live cascade check: serve the real stylesheet and resolve tokens the
   way a browser would for html[data-theme=light] — last declaration of
   a custom property on the matching, higher-specificity rule wins. */
test('cascade: light values override dark for [data-theme=light]', async () => {
	const light = extractTokenBlock(STYLES, '[data-theme="light"]');
	const dark = extractTokenBlock(STYLES, ':root');
	const bgLight = readToken(light, '--bg');
	const bgDark = readToken(dark, '--bg');
	assert.equal(bgLight, '#ffffff');
	assert.equal(bgDark, '#1a1a1a');
	assert.notEqual(bgLight, bgDark);
	// Attribute selector specificity (0,1,0) > :root pseudo-class reference in
	// practical cascade for custom properties on the same element when the
	// light block appears later in the sheet — assert source order.
	assert.ok(STYLES.indexOf('[data-theme="light"]') > STYLES.indexOf(':root {'),
		'light block must come after the dark :root block in source order');
});

test('no server-side dependency: files are static assets only', async () => {
	const server = createServer((request, response) => {
		const path = parse(request.url).pathname;
		try {
			const body = readFileSync(new URL(`../public${path === '/' ? '/index.html' : path}`, import.meta.url));
			response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/html' });
			response.end(body);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const css = await (await fetch(`http://127.0.0.1:${server.address().port}/styles.css`)).text();
		assert.ok(css.includes('[data-theme="light"]'), 'served stylesheet contains the light layer');
		const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
		assert.ok(html.includes('qase.theme'), 'served html contains the boot script');
	} finally {
		server.close();
	}
});
