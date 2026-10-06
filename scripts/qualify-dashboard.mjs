import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createApplication } from '../server/app.js';
import { buildReportMarkdown } from '../server/report.js';

// Real dashboard + HTTP handlers, isolated in-memory storage and a stub model.
const sessions = new Map();
const turns = [];
let stopCalls = 0;
let rejectStop = false;
const listeners = new Map();
const publish = (s, type, payload = {}) => { for (const listener of listeners.get(s.id) ?? []) listener({ type, sessionId:s.id, ts:Date.now(), ...payload }); };
const config = { provider:'custom', model:'dashboard-fixture', ready:true, hasApiKey:true, providers:['custom'], headless:true };
const tenantContext = { organizationId:randomUUID(), projectId:randomUUID(), actorUserId:randomUUID(), actorEmail:'fixture@example.test', actorName:'Fixture owner' };
const services = {
	tenantContext,
	feedback: {
		create: async input => input, get: async () => undefined,
		list: async () => [], update: async (_id, patch) => patch,
		remove: async () => false, forRun: async () => undefined,
		stats: async () => ({ total: 0, byCategory: {}, byStatus: {}, byRating: {} })
	},
	testCases: { list: async () => [] },
	environments: {
		seed: async () => ({ inserted: 0 }), list: async () => [], get: async () => null,
		create: async input => input, update: async (envId, patch) => ({ envId, ...patch }),
		facets: async () => ({ total: 0, platform: [], device: [], os: [], osVersion: [], browser: [], browserVersion: [], deviceType: [], executionProvider: [], isRealDevice: [], active: [] }),
		availability: () => [], catalogVersion: () => 'dashboard-fixture'
	},
	runs: {
		load(){}, async create(title = 'New test run', options = {}) { const s = {id:randomUUID(),title,mode:'qa',createdAt:Date.now(),updatedAt:Date.now(),status:'idle',messages:[],activities:[],findings:[],todos:[],secretNames:[],...options};sessions.set(s.id,s);return s; },
		get:id=>sessions.get(id), list:()=>[...sessions.values()], async delete(id){return sessions.delete(id);},
		async commit(s,type,payload){publish(s,type,payload);},
		async addMessage(s,item){const message={id:randomUUID(),ts:Date.now(),...item};s.messages.push(message);publish(s,'message',{message});return message;},
		async addActivity(s,item){const activity={id:randomUUID(),ts:Date.now(),...item};s.activities.push(activity);return activity;},
		async updateActivity(s,id,patch){Object.assign(s.activities.find(a=>a.id===id),patch);},
		async setStatus(s,status){s.status=status;publish(s,'status',{status});}
	},
	events:{publish,async subscribe(id,listener){await new Promise(resolve=>setTimeout(resolve,150));const group=listeners.get(id)??new Set();group.add(listener);listeners.set(id,group);return()=>group.delete(listener);}},
	configuration:{getPublic:()=>config,save:()=>config,testConnection:async()=>({ok:true,models:['dashboard-fixture']})},
	secrets:{clear(){},names:()=>[],store:()=>[]}, reports:{buildMarkdown:buildReportMarkdown},
	agent:{ensureRuntime(){},async runTurn(s,options){turns.push({mode:s.mode,options});await services.runs.setStatus(s,'idle');},closeBrowser:async()=>{},getLiveState:id=>({running:false,frame:sessions.get(id)?.frame}),async stop(id) {
		stopCalls++;
		await new Promise(resolve => setTimeout(resolve, 250));
		if (rejectStop) throw new Error('Fixture stop failure');
		await services.runs.setStatus(sessions.get(id), 'interrupted');
	},invalidateIdleRuntimes:()=>({kept:0})},
	readiness:{check:async()=>({ready:true})}, lifecycle:{close:async()=>{}}
};
const application = createApplication({services,environment:{NODE_ENV:'production'}});
const server = await new Promise(resolve=>{const s=application.app.listen(0,'127.0.0.1',()=>resolve(s));});
const streams = new Map();
server.on('request', (request, response) => {
	const match = request.url.match(/^\/api\/sessions\/([^/]+)\/events$/);
	if (match) streams.set(match[1], response);
});
const base = `http://127.0.0.1:${server.address().port}`;
// Exercise the real preflight against this fixture, without external DNS/model access.
const targetUrl = `${base}/healthz`;
const output = path.resolve('test-results','dashboard');fs.mkdirSync(output,{recursive:true});
const browser = await chromium.launch({executablePath:chromium.executablePath()});
const errors = [];
const checks = [];
const reportSources = {};
let activePage;
const screenshot = async (page, name) => {
	await page.locator('dialog[open]').evaluateAll(async dialogs=>Promise.all(dialogs.flatMap(dialog=>dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})))));
	await page.screenshot({path:path.join(output,name), animations:'disabled'});
};
try {
	const page = await browser.newPage({viewport:{width:1440,height:1000}});
	activePage = page;
	page.on('pageerror',error=>errors.push(error.message));
	await page.goto(base);
	await page.locator('.app').waitFor({ state: 'visible' });
	if (!await page.locator('#qa-start').evaluate(dialog=>dialog.open)) await page.locator('#new-run').click();
	await page.locator('#qa-start[open]').waitFor();
	await page.waitForFunction(() => !document.querySelector('#qa-tests-fieldset').disabled);
	const duplicateIds = await page.locator('[id]').evaluateAll(nodes => {
		const ids = nodes.map(node => node.id);
		return ids.filter((id, index) => ids.indexOf(id) !== index);
	});
	assert.deepEqual(duplicateIds, [], 'All DOM IDs are unique');
	assert.equal(await page.locator('#qa-customize').evaluate(node => node.open), false);
	await screenshot(page, 'qa-compact-light.png');
	await page.emulateMedia({ colorScheme: 'dark' });
	await screenshot(page, 'qa-compact-dark.png');
	await page.emulateMedia({ colorScheme: 'light' });
	checks.push('Unique DOM controls and a compact launcher in both themes');
	await page.locator('#qa-submit').click();assert.equal(sessions.size,0,'Empty URL cannot launch QA');
	await page.locator('#qa-target-url').fill(targetUrl);
	await page.locator('#qa-customize > summary').click();
	await page.locator('#qa-device-select').selectOption('iphone-15-pro');
	await page.locator('#qa-start .qa-advanced > summary').click();
	await page.locator('#qa-device-landscape').check();
	await page.locator('.qa-engine[value="firefox"]').uncheck();
	await page.locator('.qa-engine[value="webkit"]').uncheck();
	if (await page.locator('#qa-security-auth').isVisible()) await page.locator('#qa-security-authorized').check();
	await screenshot(page,'qa-launch.png');
	await page.locator('#qa-submit').click();await page.locator('#qa-start').waitFor({state:'hidden'});
	await page.waitForFunction(()=>document.querySelector('#chat-title')?.textContent?.includes('127.0.0.1'));
	assert.equal([...sessions.values()][0].device,'iphone-15-pro');assert.equal([...sessions.values()][0].deviceLandscape,true);
	checks.push('QA launcher validates URL and preserves selected mobile landscape profile');
	const expectTheme = async theme => {
		await page.waitForFunction(expected => {
			const color = expected === 'dark' ? 'rgb(16, 16, 18)' : 'rgb(255, 255, 255)';
			return getComputedStyle(document.body).backgroundColor === color && getComputedStyle(document.documentElement).colorScheme === expected;
		}, theme);
		assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), theme === 'dark' ? '#101012' : '#ffffff');
	};
	await page.locator('#theme-select').selectOption('dark');
	await expectTheme('dark');
	await screenshot(page, 'theme-manual-dark.png');
	await page.reload();
	await page.locator('#chat-title').filter({hasText:'127.0.0.1'}).waitFor();
	await expectTheme('dark');
	assert.equal(await page.locator('#theme-select').inputValue(), 'dark');
	await page.emulateMedia({colorScheme:'dark'});
	await page.locator('#theme-select').selectOption('light');
	await expectTheme('light');
	await page.locator('#nav-environments').evaluate(node => { node.closest('details').open = true; });
	await page.locator('#nav-environments').click();
	assert.equal(await page.locator('#environments').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
	await page.locator('#env-close').click();
	await page.locator('.sidebar-tools > summary').click();
	await screenshot(page, 'theme-manual-light.png');
	await page.locator('#theme-select').selectOption('system');
	await expectTheme('dark');
	await page.emulateMedia({colorScheme:'light'});
	await expectTheme('light');
	checks.push('Manual themes override the device, persist on reload, and System follows live device changes');
	const qaSession = [...sessions.values()][0];
	streams.get(qaSession.id).end();
	qaSession.status = 'awaiting_input';
	qaSession.messages.push({id:randomUUID(),ts:Date.now(),role:'agent',text:'Report progress recovered from the saved session.'});
	await page.waitForFunction(()=>document.querySelector('#status-chip')?.textContent === 'waiting for you');
	await page.getByText('Report progress recovered from the saved session.',{exact:true}).waitFor();
	checks.push('EventSource reconnect reloads state missed during a disconnect');
	await services.runs.setStatus(qaSession, 'running');
	await page.locator('#stop-run').waitFor({ state: 'visible' });
	rejectStop = true;
	await page.locator('#stop-run').click();
	assert.equal(await page.locator('#stop-run').isDisabled(), true);
	assert.equal(await page.locator('#stop-run').textContent(), 'Stopping…');
	await page.locator('#stop-run').evaluate(node => node.click());
	await page.getByText(/Could not stop this run/).waitFor();
	await page.waitForFunction(() => !document.querySelector('#stop-run').disabled);
	assert.equal(stopCalls, 1, 'Pending Stop cannot issue duplicate requests');
	assert.equal(qaSession.status, 'running', 'Failed cancellation does not claim the run stopped');
	rejectStop = false;
	await page.locator('#stop-run').click();
	await page.locator('#stop-run').waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.querySelector('#status-chip').textContent === 'interrupted');
	assert.equal(stopCalls, 2);
	checks.push('Stop prevents duplicate requests, recovers after failure, and reflects server state');
	qaSession.findings = [{ id: randomUUID(), title: 'Signup accepts an invalid email', severity: 'high', category: 'forms', url: qaSession.targetUrl, expected: 'Ask for a valid email before submitting.', actual: 'The form accepts an invalid address.', steps: ['Open signup', 'Enter an invalid email', 'Submit the form'], evidence: 'The request was sent despite the invalid email.' }];
	qaSession.report = { verdict: 'pass_with_issues', summary: 'The main pages work, but signup needs validation.', bySeverity: { high: 1 }, covered: ['Navigation', 'Signup'], notCovered: ['Checkout'], recommendations: [] };
	qaSession.frame = { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', viewport: {width: 1440, height: 900} };
	await services.runs.setStatus(qaSession, 'done');
	await page.reload();
	await page.locator('.viewer.stage-collapsed').waitFor();
	assert.equal(await page.locator('#tab-findings').getAttribute('aria-selected'), 'true');
	assert.equal(await page.locator('#stage').getAttribute('role'), 'button');
	assert.equal(await page.locator('#stage-toggle').getAttribute('aria-label'), 'Show live preview');
	assert.equal(await page.locator('#stage-inner').isVisible(), true);
	assert.equal(await page.locator('.findings-selection-count').textContent(), '1 of 1 selected');
	await page.locator('.finding-select-input').uncheck();
	assert.equal(await page.locator('.findings-selection-count').textContent(), '0 of 1 selected');
	assert.equal(await page.getByRole('button', { name: 'Copy selected fixes' }).isDisabled(), true);
	await page.locator('#pane-findings').getByText('Select all', { exact: true }).click();
	assert.equal(await page.locator('.findings-selection-count').textContent(), '1 of 1 selected');
	const finishedWidths = await page.locator('.chat, .viewer').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
	assert.ok(finishedWidths[1] > finishedWidths[0] * 1.5, 'Completed results receive substantially more space than conversation');
	await page.locator('#stage-toggle').click();
	assert.equal(await page.locator('#stage-toggle').getAttribute('aria-expanded'), 'true');
	assert.equal(await page.locator('#stage-toggle').getAttribute('aria-label'), 'Minimize live preview');
	await page.locator('#stage-toggle').click();
	assert.equal(await page.locator('#stage-toggle').getAttribute('aria-expanded'), 'false');
	checks.push('Completed runs prioritize selectable findings and expose an accessible preview thumbnail');
	await page.locator('#tab-findings').click();
	await page.locator('.finding-head').click();
	assert.equal(await page.locator('.finding-fix-prompt').evaluate(node => node.open), false);
	await page.locator('.finding-fix-prompt > summary').click();
	assert.equal(await page.locator('.finding-fix-prompt-body').isVisible(), true);
	streams.get(qaSession.id).end();
	qaSession.messages.push({id:randomUUID(),ts:Date.now(),role:'agent',text:'Updated coverage after reconnect.'});
	await page.getByText('Updated coverage after reconnect.', {exact:true}).waitFor();
	assert.equal(await page.locator('.finding-head').getAttribute('aria-expanded'), 'true');
	assert.equal(await page.locator('.finding-fix-prompt').evaluate(node => node.open), true);
	await page.locator('.finding-fix-prompt > summary').click();
	assert.ok(await page.locator('.brand').evaluate(node => node.getBoundingClientRect().top >= 0), 'Desktop header stays inside the viewport');
	await screenshot(page, 'findings-light.png');
	await page.emulateMedia({ colorScheme: 'dark' });
	await screenshot(page, 'findings-dark.png');
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 1101, height: 900 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
	await page.setViewportSize({ width: 1440, height: 1000 });
	checks.push('Evidence precedes optional fix instructions and reading context survives reconnects');
	await page.locator('#new-sqa').click();await page.locator('#sqa-start[open]').waitFor();
	assert.equal(await page.locator('#sqa-submit').isDisabled(),true);
	assert.equal(await page.locator('#sqa-customize').evaluate(node => node.open), false);
	await page.locator('#sqa-target-url').fill(targetUrl);
	await page.locator('#sqa-authorization').check();
	assert.equal(await page.locator('#sqa-submit').isDisabled(),false);
	await screenshot(page,'sqa-launch.png');
	await page.locator('#sqa-submit').click();await page.locator('#sqa-start').waitFor({state:'hidden'});
	await page.locator('#tab-sqa').waitFor({state:'visible'});await page.locator('#tab-sqa').click();
	const sqaSession = [...sessions.values()].find(s=>s.mode==='sqa'&&s.sqa.scope.authorization.confirmed);
	assert.ok(sqaSession);
	assert.deepEqual(sqaSession.sqa.scope.target, {name:'127.0.0.1',release:'Current',environment:'Preview'});
	checks.push('Quality review uses recommended defaults, authorization, and optional advanced scope');
	await page.locator('#new-founder').click();await page.locator('#founder-start[open]').waitFor();
	await page.locator('#founder-target-name').fill('Fixture');await page.locator('#founder-target-url').fill(targetUrl);await page.locator('#founder-authorization').check();
	await screenshot(page,'founder-launch.png');
	await page.locator('#founder-submit').click();await page.locator('#founder-start').waitFor({state:'hidden'});
	await page.locator('#tab-founder').waitFor({state:'visible'});await page.locator('#tab-founder').click();
	assert.ok([...sessions.values()].some(s=>s.mode==='founder'&&s.founder.scope.authorization.confirmed));
	checks.push('Founder context, authorization, launcher API, pending review panel');
	await page.screenshot({path:path.join(output,'desktop.png')});
	for(const width of [1280,768,390,360]) {
		await page.setViewportSize({width,height:844});
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
		assert.ok(await page.locator('#new-run').isVisible());assert.ok(await page.locator('#new-sqa').isVisible());assert.ok(await page.locator('#new-founder').isVisible());
		await page.locator('#new-sqa').click();await page.locator('#sqa-start[open]').waitFor();
		await screenshot(page,`sqa-${width}.png`);await page.locator('#sqa-cancel').click();
		await page.locator('#sidebar-new-run').click();
		await page.locator('#qa-start[open]').waitFor();
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await screenshot(page, `qa-${width}.png`);
		await page.locator('#qa-cancel').click();
		checks.push(`Mode dock and QA/SQA dialogs usable at ${width}px`);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.locator('.sidebar-tools > summary').click();
	await page.locator('#qa-view-results').click();
	assert.equal(await page.locator('#tab-report').getAttribute('aria-selected'), 'true');
	assert.equal(await page.locator('#profile-dialog').evaluate(node => node.open), false);
	await page.locator('#nav-environments').click();
	await page.locator('#environments[open]').waitFor();
	await page.locator('#env-close').click();
	for (const [navId, dialogId, closeSelector] of [
		['nav-device-matrix', 'device-matrix', '.dm-close'],
		['nav-test-cases', 'test-cases', '#tc-close'],
		['nav-bulk-runs', 'bulk-run', '#bulk-close']
	]) {
		await page.locator(`#${navId}`).click();
		await page.locator(`#${dialogId}[open]`).waitFor();
		await page.locator(closeSelector).click();
	}
	checks.push('Consolidated sidebar navigation opens workspace tools');
	assert.equal((await fetch(`${base}/demo`)).status,404);assert.equal((await fetch(`${base}/readyz`)).status,200);
	checks.push('Production demo disabled and readiness reachable');
	// Replay only completed controlled qualification output if available.
	for(const mode of ['qa','sqa','founder']) {
		const candidate = fs.readdirSync('test-results').filter(name=>name.startsWith(`agent-${mode}-`)).map(name=>path.join('test-results',name,'session.json')).filter(file=>fs.existsSync(file)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs).find(file=>JSON.parse(fs.readFileSync(file)).status==='done');
		if(!candidate) continue;
		reportSources[mode] = candidate;
		const s=JSON.parse(fs.readFileSync(candidate));
		// Early qualification outputs predate fixture timestamp initialization.
		s.createdAt ??= s.messages[0]?.ts ?? s.activities[0]?.ts;
		s.updatedAt ??= s.activities.at(-1)?.ts ?? s.createdAt;
		sessions.set(s.id,s);
		const md=await fetch(`${base}/api/sessions/${s.id}/report.md`);assert.equal(md.status,200);assert.ok((await md.text()).length>200);
		const pdf=await fetch(`${base}/api/sessions/${s.id}/report.pdf`);assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
		checks.push(`${mode} completed model report exports through real Markdown and PDF HTTP routes`);
	}
	assert.deepEqual(errors,[]);assert.deepEqual([...new Set(turns.map(t=>t.mode))].sort(),['founder','qa','sqa']);
	console.log(JSON.stringify({passed:true,checks,pageErrors:errors,reportSources},null,2));
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,pageErrors:errors,reportSources},null,2));
} catch (error) {
	if (activePage) {
		await activePage.screenshot({ path: path.join(output, 'failure.png') });
		console.error(JSON.stringify({ pageErrors: errors, qaError: await activePage.locator('#qa-form-error').textContent(), sessionCount: sessions.size, checks }, null, 2));
	}
	throw error;
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
