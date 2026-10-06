import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { publicQaTestCatalog } from '../server/qaTestCatalog.js';

// Controlled layout qualification only. This server is local, read-only, and
// never creates a run or calls a model. It serves the real dashboard assets and
// bounded API fixtures required to render the launch state.
const publicRoot = path.resolve('public');
const output = path.resolve('test-results', 'studio-demo');
await fs.mkdir(output, { recursive: true });

const contentTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.woff2', 'font/woff2']
]);
const json = (response, body, status = 200) => {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
	const url = new URL(request.url, 'http://127.0.0.1');
	if (url.pathname.startsWith('/api/')) {
		if (request.method !== 'GET') return json(response, { error: 'Read-only Studio fixture.' }, 405);
		const body = url.pathname === '/api/auth/me'
			? { id: 'studio-fixture', displayName: 'Demo owner', role: 'owner' }
			: url.pathname === '/api/config'
				? { provider: 'custom', model: 'studio-layout-fixture', ready: true, hasApiKey: true, providers: ['custom'] }
				: url.pathname === '/api/devices'
					? { default: 'desktop', devices: [{ id: 'desktop', label: 'Desktop', kind: 'desktop' }] }
					: url.pathname === '/api/qa/catalog'
						? publicQaTestCatalog()
						: url.pathname === '/api/feedback/stats'
							? { total: 0, byCategory: {}, byStatus: {}, byRating: {} }
							: [];
		return json(response, body);
	}

	const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
	const file = path.resolve(publicRoot, relative);
	if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) {
		response.writeHead(404).end();
		return;
	}
	try {
		const body = await fs.readFile(file);
		response.writeHead(200, { 'content-type': contentTypes.get(path.extname(file)) ?? 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404).end();
	}
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const checks = [];
const pageErrors = [];

async function open(viewport, studio = true) {
	const page = await browser.newPage({ viewport });
	page.on('pageerror', error => pageErrors.push(error.message));
	const route = studio
		? '/?studio=mock&project=Checkout%20redesign&target=https%3A%2F%2Fpreview.example.test%2F'
		: '/';
	await page.goto(`${base}${route}`);
	await page.locator('.app').waitFor({ state: 'visible' });
	await page.locator('#qa-start[open]').waitFor();
	await page.waitForFunction(() => !document.querySelector('#qa-tests-fieldset').disabled);
	return page;
}

try {
	const standalone = await open({ width: 1440, height: 1000 }, false);
	assert.equal(await standalone.locator('html').getAttribute('data-qase-layout'), 'standalone');
	assert.equal(await standalone.locator('.studio-host-rail').isVisible(), false);
	checks.push('Standalone remains the default and does not render host chrome');
	await standalone.close();

	const desktop = await open({ width: 1440, height: 1000 });
	assert.equal(await desktop.locator('html').getAttribute('data-qase-layout'), 'studio-mock');
	assert.equal(await desktop.locator('.studio-host-rail').isVisible(), true);
	assert.equal(await desktop.locator('#studio-context').isVisible(), true);
	assert.equal(await desktop.locator('#studio-project-name').textContent(), 'Checkout redesign');
	assert.equal(await desktop.locator('#studio-project-target').textContent(), 'preview.example.test');
	const [contextWidth, toolWidth] = await desktop.locator('#studio-context, .studio-tool-workspace')
		.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
	assert.ok(toolWidth > contextWidth * 3, 'Qase receives most of the Studio workspace');
	await desktop.screenshot({ path: path.join(output, 'studio-launcher-1440.png'), animations: 'disabled' });
	await desktop.locator('#qa-cancel').click();
	await desktop.locator('#studio-context-toggle').click();
	assert.equal(await desktop.locator('#studio-context-toggle').getAttribute('aria-expanded'), 'false');
	assert.equal(await desktop.locator('#studio-context').isVisible(), false);
	checks.push('Studio shell shows host navigation, project context, and a larger Qase center workspace');
	await desktop.close();

	for (const width of [1280, 768, 390, 360]) {
		const page = await open({ width, height: width <= 390 ? 844 : 900 });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
		assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
		assert.equal(await page.locator('#qa-submit').isVisible(), true, `Primary action visible at ${width}px`);
		await page.screenshot({ path: path.join(output, `studio-launcher-${width}.png`), animations: 'disabled', fullPage: width <= 390 });
		checks.push(`Studio launcher remains usable at ${width}px`);
		await page.close();
	}

	assert.deepEqual(pageErrors, [], 'No browser runtime errors');
	const result = {
		passed: true,
		checks,
		pageErrors,
		limitations: 'Controlled read-only layout fixture. It does not create a run, call a model, or claim exact hosted Studio parity.'
	};
	await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}
