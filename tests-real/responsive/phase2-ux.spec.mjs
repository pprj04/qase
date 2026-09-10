/**
 * Phase 2 — responsive product UX regression suite.
 *
 * Uses browser-level API interception so populated, empty, loading, and error
 * states are deterministic and never touch a developer's QASE data stores.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
const SHOTS = path.join(ROOT, 'artifacts', 'phase2-responsive-ux');
fs.mkdirSync(SHOTS, { recursive: true });

const LONG_TEST = 'Critical checkout identity remains visible while a very long generated test title wraps naturally on a mobile screen';
const LONG_WORKFLOW = 'Auto: Untitled checkout recovery workflow with a deliberately long generated name for responsive validation';
const LONG_SCHEDULE = 'Daily responsive checkout and account recovery regression schedule with an intentionally long descriptive name';
const LONG_URL = 'https://example.test/a/very/long/product/path/that/must/remain/readable/on/mobile?campaign=phase-two&source=responsive-suite';
const NOW = Date.now();

const session = {
	id: 'run-phase2-responsive',
	title: 'Responsive failure verification',
	projectId: 'project-phase2',
	createdAt: NOW - 60_000,
	updatedAt: NOW,
	status: 'interrupted',
	interruptedReason: 'server_restart_recovery',
	targetUrl: LONG_URL,
	messages: [
		{ id: 'm1', ts: NOW - 20_000, role: 'user', text: LONG_URL },
		{ id: 'm2', ts: NOW - 10_000, role: 'system', kind: 'error', text: 'Connection failed: test provider unavailable.' }
	],
	activities: [],
	findings: [],
	todos: [],
	capturedSteps: [],
	execution: { provider: 'local', requestedProvider: 'local', browser: 'chromium' },
	ownerUserId: null
};

const testCase = {
	id: 'test-phase2-responsive', projectId: 'project-phase2', suiteId: 'suite-phase2',
	name: LONG_TEST, targetUrl: LONG_URL, severity: 'critical', tags: ['mobile', 'checkout', 'regression'],
	viewport: 'mobile', viewports: ['mobile', 'tablet'], hasBaselines: false,
	steps: [
		{ action: 'navigate', description: 'Open the checkout route', target: LONG_URL },
		{ action: 'click', description: 'Continue checkout', target: '[data-test="continue"]' }
	],
	assertions: [
		{ type: 'element_visible', description: 'Checkout remains visible' },
		{ type: 'no_console_errors', description: 'No console errors occur' }
	]
};

const workflow = {
	id: 'workflow-phase2-responsive', projectId: 'project-phase2', sessionId: session.id,
	name: LONG_WORKFLOW, targetUrl: LONG_URL, stepCount: 8, tags: ['generated', 'mobile'],
	createdAt: NOW - 90_000, updatedAt: NOW - 30_000,
	steps: [{ id: 'wf-step-1', action: 'navigate', displayLabel: 'Open checkout', target: LONG_URL }]
};

const schedule = {
	id: 'schedule-phase2-responsive', projectId: 'project-phase2', name: LONG_SCHEDULE,
	enabled: true, cronExpr: '0 9 * * *', testCaseIds: [testCase.id], targetUrl: LONG_URL,
	createdAt: NOW - 90_000, updatedAt: NOW - 30_000, lastRun: null, nextRun: NOW + 86_400_000
};

const finding = {
	id: 'finding-phase2-responsive', projectId: 'project-phase2', sessionId: session.id,
	title: 'Checkout confirmation content overflows after a deliberately long account name is entered',
	severity: 'high', status: 'open', category: 'responsive', url: LONG_URL,
	ts: NOW - 45_000, expected: 'Content remains inside the viewport.',
	actual: 'The confirmation text extends past the card edge.',
	evidence: 'Long evidence text remains readable and wraps instead of forcing the finding detail beyond the viewport.',
	comments: [], testCaseIds: [testCase.id]
};

const evidence = [{
	id: 'evidence-phase2-responsive', type: 'step_outcome', timestamp: NOW - 5_000,
	action: 'navigate', target: LONG_URL,
	observation: 'The responsive checkout page loaded and its evidence remains readable at mobile width.',
	payload: { status: 'failure', urlAfter: LONG_URL },
	metadata: { stepId: 'step-with-a-long-internal-identifier', findingId: finding.id },
	integrity: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef'
}];

const mocks = { delayFindings: false, emptyWorkflows: false, failSchedules: false };

const json = (route, body, status = 200) => route.fulfill({
	status,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

async function mockApi(route) {
	const request = route.request();
	const url = new URL(request.url());
	const p = url.pathname;

	if (p === '/api/auth/me') return json(route, { kind: 'user', id: 'admin-phase2', name: 'Phase 2 Admin', email: 'admin@example.test', role: 'admin' });
	if (p === '/api/auth/users') return json(route, { users: [] });
	if (p === '/api/config') return json(route, {
		providers: ['custom', 'openai'], provider: 'custom', ready: false,
		hasApiKey: false, apiKeyHint: null, apiKeyFromEnv: false,
		baseUrl: 'https://provider.example.test/v1', model: 'test-model', reasoningEffort: 'low',
		maxTurns: 40, headless: true, browserstackEnabled: false
	});
	if (p === '/api/projects') return json(route, [{ id: 'project-phase2', name: 'Phase 2 UX fixtures' }]);
	if (p === '/api/sessions') return json(route, [session]);
	if (p === `/api/sessions/${session.id}/events`) {
		return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': phase2 fixture\n\n' });
	}
	if (p === `/api/sessions/${session.id}`) return json(route, session);
	if (p === `/api/sessions/${session.id}/detail`) return json(route, []);
	if (p === `/api/v1/sessions/${session.id}/evidence`) return json(route, { evidence, total: evidence.length });
	if (p === `/api/sessions/${session.id}/workflow`) return json(route, { steps: [], savedWorkflows: [workflow] });
	if (p.startsWith(`/api/sessions/${session.id}/`)) return json(route, {});
	if (p === '/api/workflows') {
		const items = mocks.emptyWorkflows ? [] : [workflow];
		return json(route, url.searchParams.has('includeMetrics')
			? { items, total: items.length, metrics: { total: items.length, steps: items.reduce((n, w) => n + w.stepCount, 0), targets: items.length } }
			: items);
	}
	if (p === `/api/workflows/${workflow.id}`) return json(route, workflow);
	if (p === '/api/test-cases') return json(route, {
		items: [testCase], total: 1, metrics: { total: 1, suites: 1, severity: { critical: 1 } }
	});
	if (p === '/api/suites') return json(route, [{ id: 'suite-phase2', projectId: 'project-phase2', name: 'Checkout and account recovery suite with a long mobile label' }]);
	if (p === '/api/schedules') {
		if (mocks.failSchedules) return json(route, { error: 'Synthetic schedules outage' }, 503);
		return json(route, { items: [schedule], total: 1, metrics: { total: 1, active: 1, testAssignments: 1 } });
	}
	if (p === '/api/regression/trend') return json(route, { items: [], total: 0, metrics: { totalRuns: 0, passRate: null } });
	if (p === '/api/findings') {
		if (mocks.delayFindings) {
			mocks.delayFindings = false;
			await new Promise(resolve => setTimeout(resolve, 350));
		}
		return json(route, { items: [finding], total: 51, limit: 50, offset: 0 });
	}
	if (p === `/api/findings/${finding.id}`) return json(route, { ...finding, linkedTests: [{ id: testCase.id, name: testCase.name, severity: testCase.severity }] });
	if (p === `/api/findings/${finding.id}/evidence`) return json(route, { items: evidence, total: evidence.length });
	if (p === '/api/metrics/dashboard') return json(route, {});
	if (p === '/api/missions' || p.startsWith('/api/missions/')) return json(route, []);
	if (p.startsWith('/api/v1/')) return json(route, {});
	return json(route, {});
}

const browser = await chromium.launch({ headless: true });
let passed = 0;
let failed = 0;
const failures = [];
const browserErrors = [];

function check(condition, name, detail = '') {
	if (condition) {
		passed += 1;
		console.log(`OK - ${name}`);
	} else {
		failed += 1;
		const message = `${name}${detail ? ` — ${detail}` : ''}`;
		failures.push(message);
		console.log(`NOT OK - ${message}`);
	}
}

async function makePage(viewport) {
	const context = await browser.newContext({ viewport });
	await context.route('**/api/**', mockApi);
	const page = await context.newPage();
	page.on('pageerror', error => browserErrors.push(error.message));
	return { context, page };
}

async function goto(page, route, ready) {
	await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
	if (ready) await page.locator(ready).first().waitFor({ state: 'visible', timeout: 10_000 });
}

async function fits(page, selector, tolerance = 1) {
	return page.locator(selector).first().evaluate((element, t) => {
		const r = element.getBoundingClientRect();
		return r.left >= -t && r.right <= document.documentElement.clientWidth + t && r.width > 0;
	}, tolerance).catch(() => false);
}

try {
	const mobile = await makePage({ width: 375, height: 812 });
	const page = mobile.page;

	// 1–4 Tests page.
	await goto(page, '/tests', '.tc-card');
	check(await page.locator('.tc-name').isVisible(), '1. mobile test title visible');
	const titleMetrics = await page.locator('.tc-name').evaluate(el => {
		const cs = getComputedStyle(el);
		return { height: el.getBoundingClientRect().height, lineHeight: Number.parseFloat(cs.lineHeight), text: el.textContent };
	});
	check(titleMetrics.text === LONG_TEST && titleMetrics.height > titleMetrics.lineHeight * 1.45, '2. long test title wraps');
	check(await fits(page, '.tc-card'), '3. test card does not overflow viewport');
	const testActions = await page.locator('.tc-card-actions button').evaluateAll(buttons => buttons
		.filter(b => getComputedStyle(b).display !== 'none')
		.map(b => ({ visible: b.getBoundingClientRect().width > 0, name: b.getAttribute('aria-label') || b.title || b.textContent.trim() })));
	check(testActions.length >= 4 && testActions.every(a => a.visible && a.name), '4. test actions remain accessible');

	// 5–8 Bugs page, including a real loading transition and server pagination contract.
	mocks.delayFindings = true;
	const bugNavigation = page.goto(`${BASE}/bugs`, { waitUntil: 'domcontentloaded' });
	await page.locator('#bugs-board .page-loading').waitFor({ state: 'visible', timeout: 5_000 });
	await bugNavigation;
	await page.locator('.bug-card').waitFor({ state: 'visible', timeout: 10_000 });
	check(await fits(page, '.bug-card'), '5. bug card fits mobile viewport');
	const filtersFit = await page.locator('.bugs-header-right').evaluate(el => {
		const vw = document.documentElement.clientWidth;
		return [...el.querySelectorAll('input,select,button')].filter(x => getComputedStyle(x).display !== 'none').every(x => {
			const r = x.getBoundingClientRect(); return r.width > 0 && r.right <= vw + 1;
		});
	});
	check(filtersFit, '6. bug filters remain usable');
	check(await page.locator('#bugs-pagination').isVisible() && await page.locator('#bugs-page-next').isEnabled(), '7. bug pagination remains visible and usable');
	check((await page.locator('#bugs-page-summary').textContent())?.includes('Showing 1–1 of 51'), '8. Bugs loading resolves to correct paginated state');

	// 9–10 Workflows.
	await goto(page, '/workflows', '.wf-card');
	check(await fits(page, '.wf-card') && await fits(page, '.wf-card-name'), '9. long workflow title does not overflow');
	check(await page.locator('.wf-card-actions').isVisible() && await fits(page, '.wf-card-actions'), '10. workflow target/action layout remains usable');

	// 11–13 Schedules.
	await goto(page, '/schedules', '.sched-card');
	check(await fits(page, '.sched-card'), '11. schedule card does not overflow');
	const scheduleStats = await page.locator('#schedules-stats').textContent();
	check(scheduleStats?.includes('—') && !scheduleStats?.includes('0%'), '12. schedule pass-rate no-data state remains truthful');
	check(await page.locator('.sched-card-actions').isVisible() && Boolean(await page.locator('.reg-toggle input').getAttribute('aria-label')), '13. schedule actions are accessible');

	// 14–16 Runs and evidence.
	await goto(page, `/runs/${session.id}`, '#status-chip');
	check(await fits(page, '#chat-target') && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '14. long run URL and identity do not overflow');
	await page.locator('#mobile-runs-toggle').click();
	await page.locator('.panel.runs.mobile-open').waitFor({ state: 'visible' });
	check(await page.locator('.run-status-label').isVisible() && await page.locator('.run-del').isVisible(), '14b. mobile run history and actions remain reachable');
	await page.locator('#close-runs-drawer').click();
	const runText = `${await page.locator('#status-chip').textContent()} ${await page.locator('#transcript').textContent()}`;
	check(runText.includes('interrupted — server restart') && runText.includes('Connection failed'), '15. run status and failure reason are visible');
	await page.locator('#viewer-toggle').click();
	await page.locator('#tab-evidence').click();
	await page.locator('.ev-card').waitFor({ state: 'visible', timeout: 10_000 });
	check(await fits(page, '.panel.viewer') && await fits(page, '.ev-card'), '16. evidence section fits mobile viewport');

	// 17 Core page overflow at the narrowest required viewport.
	let corePagesFit = true;
	for (const [route, ready] of [['/runs', '#chat-target'], ['/tests', '.tc-card'], ['/bugs', '.bug-card'], ['/workflows', '.wf-card'], ['/schedules', '.sched-card']]) {
		await goto(page, route, ready);
		const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
		corePagesFit &&= noOverflow;
	}
	check(corePagesFit, '17. no horizontal document overflow on core pages at 375px');

	// 19 Loading resolved was observed above; 20/21 exercise empty and error terminal states.
	const visibleLoading = await page.locator('.page-loading').evaluateAll(nodes => nodes.filter(node => {
		const r = node.getBoundingClientRect();
		return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden';
	}).length);
	check(visibleLoading === 0, '19. loading state resolves');
	mocks.emptyWorkflows = true;
	await goto(page, '/workflows?phase2=empty', '.wf-page-empty');
	check((await page.locator('.wf-page-empty').textContent())?.includes('No workflows saved yet'), '20. empty state is visible and truthful');
	mocks.emptyWorkflows = false;
	mocks.failSchedules = true;
	await goto(page, '/schedules?phase2=error', '.page-error');
	check(await page.locator('.page-error button').isVisible() && (await page.locator('.page-error').textContent())?.includes('Could not load schedules'), '21. error state is visible with Retry');
	mocks.failSchedules = false;

	// 22 Accessible names for every icon-only action touched in Phase 2.
	await goto(page, '/tests', '.tc-card');
	const names = await page.locator('.tc-delete,.tc-edit,.tc-clone').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.title));
	await goto(page, '/workflows', '.wf-card');
	names.push(...await page.locator('.wf-card-del').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.title)));
	await goto(page, '/schedules', '.sched-card');
	names.push(...await page.locator('.sched-card-del').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.title)));
	await goto(page, '/runs', '#chat-target');
	await page.locator('.run-del').waitFor({ state: 'attached', timeout: 10_000 });
	names.push(...await page.locator('.run-del').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.title)));
	check(names.length >= 6 && names.every(Boolean), '22. touched icon-only buttons have accessible names', JSON.stringify(names));

	// Settings is part of the shell: reach it through the mobile overflow menu.
	await page.locator('#topnav-more').click();
	await page.locator('#menu-open-settings').click();
	await page.locator('#settings').waitFor({ state: 'visible' });
	const modalFit = await page.locator('#settings').evaluate(el => {
		const r = el.getBoundingClientRect();
		return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
	});
	check(modalFit && await page.locator('#cfg-key').isVisible(), '23. Admin Settings modal fits and credential control remains reachable at 375px');
	await page.screenshot({ path: path.join(SHOTS, '375-settings.png'), fullPage: false });
	await mobile.context.close();

	// 18 Desktop behavior and the complete required viewport matrix.
	const requiredViewports = [
		['375x812', { width: 375, height: 812 }],
		['390x844', { width: 390, height: 844 }],
		['768x1024', { width: 768, height: 1024 }],
		['1280x720', { width: 1280, height: 720 }],
		['1440x900', { width: 1440, height: 900 }]
	];
	let matrixFits = true;
	let desktopIntact = true;
	for (const [label, viewport] of requiredViewports) {
		const fixture = await makePage(viewport);
		for (const [route, ready] of [['/runs', '#chat-target'], ['/tests', '.tc-card'], ['/bugs', '.bug-card'], ['/workflows', '.wf-card'], ['/schedules', '.sched-card']]) {
			await goto(fixture.page, route, ready);
			const state = await fixture.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
			matrixFits &&= state.scroll <= state.client + 1;
			await fixture.page.screenshot({ path: path.join(SHOTS, `${label}-${route.slice(1)}.png`), fullPage: false });
		}
		if (viewport.width >= 1280) {
			await goto(fixture.page, '/tests', '.tc-card');
			desktopIntact &&= await fixture.page.locator('.tc-name').isVisible() && await fixture.page.locator('.tc-card-actions').isVisible();
		}
		await fixture.context.close();
	}
	check(desktopIntact, '18. desktop test identity and actions remain intact');
	check(matrixFits, '24. all core pages fit the five required viewport sizes');
	check(browserErrors.length === 0, '25. no uncaught browser errors were introduced', browserErrors.join(' | '));
} catch (error) {
	check(false, 'Phase 2 suite completed without an unhandled browser error', error?.stack || String(error));
} finally {
	await browser.close();
}

fs.writeFileSync(path.join(SHOTS, 'findings.txt'), failures.join('\n') || '(none)');
console.log(`TESTS ${passed + failed}`);
console.log(`PASS ${passed}`);
console.log(`FAIL ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
