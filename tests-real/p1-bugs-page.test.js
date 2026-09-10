/**
 * P1 Bugs page regression coverage.
 *
 * Boots disposable QASE servers with isolated finding stores and exercises the
 * real SPA in Chromium. The large fixture proves the list is API-paginated:
 * the browser receives and renders one 50-item page, never all 8,000 records.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let browser;

function fixture(count) {
	return Array.from({ length: count }, (_, index) => ({
		id: `p1-fixture-${index}`,
		ts: 1_700_000_000_000 + index,
		title: `Fixture finding ${index}`,
		severity: ['critical', 'high', 'medium', 'low', 'info'][index % 5],
		status: ['open', 'in_testing', 'resolved', 'closed'][index % 4],
		category: ['functional', 'usability', 'security'][index % 3],
		url: `https://fixture.test/${index}`,
		expected: 'Expected fixture behavior', actual: 'Actual fixture behavior',
		steps: [], comments: [], history: [], testCaseIds: [], evidenceIds: []
	}));
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function stop(child) {
	if (child.exitCode !== null) return;
	const exited = new Promise(resolve => child.once('exit', resolve));
	try { child.kill('SIGTERM'); } catch {}
	await Promise.race([exited, delay(2_000)]);
	if (child.exitCode !== null) return;
	const forced = new Promise(resolve => child.once('exit', resolve));
	try { child.kill('SIGKILL'); } catch {}
	await Promise.race([forced, delay(2_000)]);
}

async function boot(count, label, { authMode = 'disabled' } = {}) {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), `qase-p1-bugs-${label}-`));
	writeFileSync(join(dataDir, 'findings.json'), JSON.stringify(fixture(count)));
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port), QASE_DATA_DIR: dataDir, QASE_AUTH_MODE: authMode, QASE_API_TOKEN: '', QASE_ENABLE_DEMO: 'false', QASE_ORPHAN_SWEEP: '0' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', chunk => { stderr += chunk.toString(); });
	const base = `http://127.0.0.1:${port}`;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (child.exitCode !== null) throw new Error(`${label} exited early: ${stderr.slice(-500)}`);
		try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
		await delay(100);
		if (attempt === 79) throw new Error(`${label} did not become healthy: ${stderr.slice(-500)}`);
	}
	return {
		base,
		async close() {
			await stop(child);
			try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
		}
	};
}

async function pageFor(base) {
	browser ??= await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.goto(`${base}/#/bugs`, { waitUntil: 'domcontentloaded' });
	return page;
}

async function waitForSettled(page) {
	await page.waitForFunction(() => !document.querySelector('#bugs-board > .page-loading'), null, { timeout: 5_000 });
}

after(async () => { await browser?.close(); });

test('P1-Bugs-1: zero findings clears loading and shows an empty result', async t => {
	const srv = await boot(0, 'zero'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await waitForSettled(page);
	assert.match(await page.locator('#bugs-board').innerText(), /No bugs match/i);
	assert.equal(await page.locator('.bug-card').count(), 0);
	assert.equal(await page.locator('#bugs-page-summary').innerText(), 'Showing 0–0 of 0 findings');
});

test('P1-Bugs-2: small data renders all records without a loading residue', async t => {
	const srv = await boot(10, 'small'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await waitForSettled(page);
	assert.equal(await page.locator('.bug-card').count(), 10);
	assert.equal(await page.locator('#bugs-page-summary').innerText(), 'Showing 1–10 of 10 findings');
});

test('P1-Bugs-3: API failure terminates in a retryable error state', async t => {
	const srv = await boot(10, 'api-error'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await page.route('**/api/findings?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture failure' }) }));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('#bugs-board .page-error').waitFor();
	assert.match(await page.locator('#bugs-board').innerText(), /Could not load findings/i);
	assert.equal(await page.locator('#bugs-board .page-loading').count(), 0);
});

test('P1-Bugs-4: malformed findings payload terminates safely', async t => {
	const srv = await boot(10, 'malformed'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await page.route('**/api/findings?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: null, total: 'wrong' }) }));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('#bugs-board .page-error').waitFor();
	assert.match(await page.locator('#bugs-board').innerText(), /valid paginated result/i);
});

test('P1-Bugs-5 through 9: canonical pagination, totals, bounded large render, next, and previous', async t => {
	const srv = await boot(8_001, 'large'); t.after(() => srv.close());
	const requests = [];
	const page = await pageFor(srv.base); t.after(() => page.close());
	page.on('request', request => {
		if (request.url().includes('/api/findings?')) requests.push(new URL(request.url()));
	});
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForSettled(page);
	assert.ok(requests.some(url => url.searchParams.get('limit') === '50' && url.searchParams.get('offset') === '0'), 'uses canonical limit/offset parameters');
	assert.equal(await page.locator('#bugs-page-summary').innerText(), 'Showing 1–50 of 8001 findings');
	assert.equal(await page.locator('.bug-card').count(), 50, 'large data never renders every finding card');
	assert.match(await page.locator('.bug-card').first().innerText(), /Fixture finding 8000/);
	await page.locator('#bugs-page-next').click();
	await waitForSettled(page);
	assert.equal(await page.locator('#bugs-page-summary').innerText(), 'Showing 51–100 of 8001 findings');
	assert.match(await page.locator('.bug-card').first().innerText(), /Fixture finding 7950/);
	await page.locator('#bugs-page-prev').click();
	await waitForSettled(page);
	assert.equal(await page.locator('#bugs-page-summary').innerText(), 'Showing 1–50 of 8001 findings');
});

test('P1-Bugs-10: server-side filters reset pagination and do not leave loading active', async t => {
	const srv = await boot(500, 'filters'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	const requests = [];
	page.on('request', request => { if (request.url().includes('/api/findings?')) requests.push(new URL(request.url())); });
	await waitForSettled(page);
	await page.locator('#bug-filter-severity').selectOption('critical');
	await waitForSettled(page);
	assert.ok(requests.some(url => url.searchParams.get('severity') === 'critical' && url.searchParams.get('offset') === '0'));
	assert.equal(await page.locator('#bugs-board .page-loading').count(), 0);
	const badges = await page.locator('.bug-sev-badge').allTextContents();
	assert.ok(badges.every(value => value === 'critical'));
});

test('P1-Bugs-11: no secondary metrics request can block a successful findings page', async t => {
	const srv = await boot(10, 'secondary'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	let metricsCalls = 0;
	await page.route('**/api/findings/stats**', route => { metricsCalls += 1; return route.fulfill({ status: 500 }); });
	await waitForSettled(page);
	assert.equal(await page.locator('.bug-card').count(), 10);
	assert.equal(metricsCalls, 0, 'the findings list does not depend on a secondary metrics request');
});

test('P1-Bugs-12: an authentication failure becomes an error state, never a skeleton', async t => {
	const srv = await boot(10, 'auth'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await page.route('**/api/findings?**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Authentication required.' }) }));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('#bugs-board .page-error').waitFor();
	assert.match(await page.locator('#bugs-board').innerText(), /Authentication required/i);
	assert.equal(await page.locator('#bugs-board .page-loading').count(), 0);
});

test('P1-Bugs-13: a network-aborted request becomes an error state, never a skeleton', async t => {
	const srv = await boot(10, 'network'); t.after(() => srv.close());
	const page = await pageFor(srv.base); t.after(() => page.close());
	await page.route('**/api/findings?**', route => route.abort('failed'));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('#bugs-board .page-error').waitFor();
	assert.match(await page.locator('#bugs-board').innerText(), /Could not load findings/i);
	assert.equal(await page.locator('#bugs-board .page-loading').count(), 0);
});

test('P1-Bugs-14: a normally signed-in QASE account loads Bugs in required mode', async t => {
	const srv = await boot(10, 'required-session', { authMode: 'required' }); t.after(() => srv.close());
	const credentials = { email: 'p1-account@qase.test', password: 'p1-required-auth-password' };
	const bootstrap = await fetch(`${srv.base}/api/auth/register-admin`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials)
	});
	assert.equal(bootstrap.status, 200);
	const login = await fetch(`${srv.base}/api/auth/login`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials)
	});
	assert.equal(login.status, 200);
	const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
	const value = /qase_session=([^;]+)/.exec(setCookie ?? '')?.[1];
	assert.ok(value, 'login returns a session cookie');
	browser ??= await chromium.launch({ headless: true });
	const context = await browser.newContext(); t.after(() => context.close());
	await context.addCookies([{ name: 'qase_session', value, url: srv.base, httpOnly: true, sameSite: 'Strict' }]);
	const page = await context.newPage();
	await page.goto(`${srv.base}/#/bugs`, { waitUntil: 'domcontentloaded' });
	await waitForSettled(page);
	assert.equal(await page.locator('.bug-card').count(), 10);
});
