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
const fixtureRunId = '12345678-1234-4234-8234-123456789abc';
let fixtureSession;

const previewSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
  <rect width="1200" height="760" fill="#f7f8fb"/>
  <rect width="1200" height="74" fill="#ffffff"/>
  <rect x="42" y="24" width="132" height="25" rx="7" fill="#315ee8"/>
  <rect x="810" y="27" width="76" height="18" rx="5" fill="#dfe4ee"/>
  <rect x="910" y="27" width="76" height="18" rx="5" fill="#dfe4ee"/>
  <rect x="1010" y="20" width="146" height="32" rx="8" fill="#171717"/>
  <rect x="68" y="142" width="510" height="38" rx="9" fill="#171717"/>
  <rect x="68" y="198" width="448" height="18" rx="5" fill="#a8adb7"/>
  <rect x="68" y="232" width="382" height="18" rx="5" fill="#c5c9d1"/>
  <rect x="68" y="294" width="164" height="44" rx="9" fill="#315ee8"/>
  <rect x="680" y="126" width="448" height="480" rx="18" fill="#ffffff" stroke="#e3e5e8" stroke-width="3"/>
  <rect x="724" y="178" width="316" height="28" rx="6" fill="#171717"/>
  <rect x="724" y="230" width="360" height="54" rx="9" fill="#f0f2f7"/>
  <rect x="724" y="308" width="360" height="54" rx="9" fill="#f0f2f7"/>
  <rect x="724" y="386" width="360" height="54" rx="9" fill="#f0f2f7"/>
  <rect x="724" y="474" width="360" height="54" rx="9" fill="#fee7e7"/>
</svg>`).toString('base64');

function demoSession(status) {
	const running = status === 'running';
	const done = status === 'done';
	return {
		id: fixtureRunId,
		title: 'Checkout release review',
		mode: 'qa',
		status,
		targetUrl: 'https://preview.example.test/',
		createdAt: Date.now() - 185_000,
		updatedAt: Date.now(),
		runStartedAt: Date.now() - 180_000,
		...(done ? { completedAt: Date.now() - 5_000 } : {}),
		messages: [{ id: 'message-1', ts: Date.now() - 170_000, role: 'agent', text: running ? 'Testing the checkout flow and collecting evidence.' : 'Testing finished. Two issues need attention.' }],
		activities: [
			{ id: 'activity-1', ts: Date.now() - 160_000, kind: 'browser', label: 'Opened checkout', status: 'completed' },
			{ id: 'activity-2', ts: Date.now() - 90_000, kind: 'browser', label: running ? 'Checking payment validation' : 'Checked payment validation', status: running ? 'running' : 'completed' }
		],
		todos: [
			{ id: 'todo-1', text: 'Open checkout', status: 'completed' },
			{ id: 'todo-2', text: 'Validate customer details', status: 'completed' },
			{ id: 'todo-3', text: 'Check payment validation', status: running ? 'in_progress' : 'completed' },
			{ id: 'todo-4', text: 'Review confirmation state', status: running ? 'pending' : 'completed' }
		],
		findings: [
			{ id: 'finding-1', title: 'Payment error does not explain the next step', severity: 'high', category: 'forms', url: 'https://preview.example.test/checkout', impact: 'Customers cannot tell how to recover and may abandon checkout.', expected: 'Explain why payment failed and how to retry.', actual: 'A generic error appears with no recovery guidance.', steps: ['Open checkout', 'Use a declined test card', 'Submit payment'], evidence: 'The error region only contains “Something went wrong”.' },
			{ id: 'finding-2', title: 'Order summary clips at narrow widths', severity: 'medium', category: 'responsive', url: 'https://preview.example.test/checkout', impact: 'Mobile customers cannot read the full total.', expected: 'Keep the summary within the viewport.', actual: 'The total extends beyond the card at 360 px.', steps: ['Open checkout at 360 px', 'Review the order summary'], evidence: 'The total is cut off on the right edge.' }
		],
		frame: { mimeType: 'image/svg+xml', base64: previewSvg, viewport: { width: 1200, height: 760 }, url: 'https://preview.example.test/checkout', title: 'Checkout' },
		...(done ? { report: { verdict: 'pass_with_issues', summary: 'Checkout works, but payment recovery and the mobile order summary need attention.', bySeverity: { high: 1, medium: 1 }, covered: ['Checkout navigation', 'Customer details', 'Payment validation', 'Responsive layout'], notCovered: ['Production payment settlement'], recommendations: ['Fix the selected issues, then retest checkout.'] } } : {})
	};
}

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
		if (url.pathname === `/api/sessions/${fixtureRunId}/events`) {
			response.writeHead(200, {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'close'
			});
			response.end('event: ready\ndata: {}\n\n');
			return;
		}
		const body = url.pathname === '/api/auth/me'
			? { id: 'studio-fixture', displayName: 'Demo owner', role: 'owner' }
			: url.pathname === '/api/config'
				? { provider: 'custom', model: 'studio-layout-fixture', ready: true, hasApiKey: true, providers: ['custom'] }
				: url.pathname === '/api/devices'
					? { default: 'desktop', devices: [{ id: 'desktop', label: 'Desktop', kind: 'desktop' }] }
					: url.pathname === '/api/qa/catalog'
						? publicQaTestCatalog()
						: url.pathname === '/api/sessions'
							? (fixtureSession ? [fixtureSession] : [])
							: url.pathname === `/api/sessions/${fixtureRunId}`
								? fixtureSession
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

async function open(viewport, studio = true, scenario = 'launcher') {
	fixtureSession = scenario === 'launcher' ? undefined : demoSession(scenario);
	const page = await browser.newPage({ viewport });
	page.on('pageerror', error => pageErrors.push(error.message));
	const route = studio
		? '/?studio=mock&project=Checkout%20redesign&target=https%3A%2F%2Fpreview.example.test%2F'
		: '/';
	await page.goto(`${base}${route}`);
	await page.locator('.app').waitFor({ state: 'visible' });
	if (scenario === 'launcher') {
		await page.locator('#qa-start[open]').waitFor();
		await page.waitForFunction(() => !document.querySelector('#qa-tests-fieldset').disabled);
	} else {
		try {
			await page.locator('#chat-title').filter({ hasText: 'preview.example.test' }).waitFor();
		} catch (error) {
			console.error(JSON.stringify({
				scenario,
				pageErrors,
				chatTitle: await page.locator('#chat-title').textContent(),
				authVisible: await page.locator('#auth-gate').isVisible(),
				launcherOpen: await page.locator('#qa-start').evaluate(dialog => dialog.open)
			}, null, 2));
			throw error;
		}
	}
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
	assert.equal(await desktop.locator('#qa-target-url').inputValue(), 'https://preview.example.test/');
	assert.equal(await desktop.locator('#studio-theme-select').isVisible(), true);
	await desktop.locator('#studio-theme-select').selectOption('dark');
	assert.equal(await desktop.locator('html').getAttribute('data-theme'), 'dark');
	await desktop.locator('#studio-theme-select').selectOption('light');
	assert.equal(await desktop.locator('html').getAttribute('data-theme'), 'light');
	assert.equal(await desktop.locator('#qa-security-scope').evaluate(node => node.open), false);
	assert.equal(await desktop.locator('#qa-security-notes').isVisible(), false);
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

	const running = await open({ width: 1440, height: 1000 }, true, 'running');
	assert.equal(await running.locator('#status-chip').textContent(), 'running');
	assert.equal(await running.locator('#stop-run').isVisible(), true);
	assert.equal(await running.locator('#current-activity-state').textContent(), '◌ Checking payment validation');
	assert.equal(await running.locator('#progress-steps').textContent(), '2/4');
	assert.equal(await running.locator('#count-findings').textContent(), '2');
	assert.equal(await running.locator('#stage-inner').isVisible(), true);
	assert.equal(await running.locator('#composer-input').isDisabled(), true);
	assert.equal(await running.locator('#composer-running-hint').isVisible(), true);
	assert.equal(await running.locator('#composer').evaluate(node => node.scrollWidth <= node.clientWidth), true);
	await running.screenshot({ path: path.join(output, 'studio-running-1440.png'), animations: 'disabled' });
	checks.push('Running fixture exposes progress and evidence while the message composer presents a clean paused state');
	await running.close();

	const completed = await open({ width: 1440, height: 1000 }, true, 'done');
	await completed.locator('.viewer.stage-collapsed').waitFor();
	assert.equal(await completed.locator('#tab-findings').getAttribute('aria-selected'), 'true');
	assert.equal(await completed.locator('.findings-selection-count').textContent(), '2 of 2 selected');
	assert.equal(await completed.locator('#stage-toggle').getAttribute('aria-label'), 'Show live preview');
	await completed.locator('#conn-label').filter({ hasText: 'results ready' }).waitFor();
	const [stageRight, previewRight] = await completed.locator('#stage, #stage-inner')
		.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
	assert.ok(stageRight - previewRight <= 16, 'Completed preview thumbnail sits at the upper-right edge');
	const [chatWidth, viewerWidth] = await completed.locator('.chat, .viewer')
		.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
	assert.ok(viewerWidth > chatWidth * 1.45, 'Results receive substantially more width than conversation');
	await completed.screenshot({ path: path.join(output, 'studio-completed-1440.png'), animations: 'disabled' });
	checks.push('Completed fixture prioritizes selected findings and moves the saved preview to the upper-right edge');
	await completed.close();

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
