import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createApplication } from '../server/app.js';
import { buildReportMarkdown } from '../server/report.js';
import { launcherCatalog, launcherConfigurations } from './fixtures/launcher-catalog.mjs';

// Real dashboard + HTTP handlers, isolated in-memory storage and a stub model.
const sessions = new Map();
const turns = [];
const listeners = new Map();
const publish = (s, type, payload = {}) => { for (const listener of listeners.get(s.id) ?? []) listener({ type, sessionId:s.id, ts:Date.now(), ...payload }); };
const config = { provider:'custom', model:'dashboard-fixture', ready:true, hasApiKey:true, providers:['custom'], headless:true };
const tenantContext = { organizationId:randomUUID(), projectId:randomUUID(), actorUserId:randomUUID(), actorEmail:'fixture@example.test', actorName:'Fixture owner' };
const services = {
	tenantContext,
	feedback: { async create(input){ return input; }, async get(){ return null; }, async list(){ return []; }, async update(){ return null; }, async remove(){ return null; }, async stats(){ return { total: 0, byCategory: {}, byStatus: {}, byRating: {} }; }, async forRun(){ return null; } },
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
	agent:{ensureRuntime(){},async runTurn(s,options){turns.push({mode:s.mode,options});await services.runs.setStatus(s,'idle');},closeBrowser:async()=>{},getLiveState:()=>({running:false}),stop(){},invalidateIdleRuntimes:()=>({kept:0})},
	environments: {
		seed(){}, async list(){ return []; },
		async facets(){ return { total: 0, devices: [], osVersions: [], browsers: [] }; },
		async get(){ return null; }, async create(){ return {}; }, async update(){ return null; },
		async availability(){ return { available: 0, busy: 0 }; }, async catalogVersion(){ return 'fixture'; }
	},
	bugs: { async list(){ return []; }, async get(){ return null; }, async create(input){ return input; }, async update(){ return null; }, async remove(){ return null; } },
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
const settleTeardown = promise => Promise.race([
	promise,
	new Promise(resolve => {
		const timer = setTimeout(resolve, 2_000);
		timer.unref();
	})
]);
const screenshot = async (page, name) => {
	await page.screenshot({path:path.join(output,name), animations:'disabled'});
};
try {
	const page = await browser.newPage({viewport:{width:1440,height:1000}});
	page.on('pageerror',error=>errors.push(error.message));
	// Matrix execution is a bounded HTTP fixture; session, SQA and Founder
	// handlers below still exercise the real application with a stub agent.
	let matrixRequest;
	let matrixRequestCount = 0;
	let rejectNextMatrixRequest = false;
	let successfulMatrixSessionId;
	let catalogRequestCount = 0;
	let failNextCatalogRequest = true;
	let matrixRun = { id: 'matrix-fixture', status: 'pending', items: [], targetUrl: 'https://example.test/' };
	await page.route('**/api/qa-configurations*', route => {
		catalogRequestCount += 1;
		if (failNextCatalogRequest) {
			failNextCatalogRequest = false;
			return route.fulfill({ status: 503, json: { error: 'Device catalog temporarily unavailable.' } });
		}
		return route.fulfill({ json: launcherCatalog() });
	});
	await page.route('**/api/qa-matrix-runs', async route => {
		matrixRequestCount += 1;
		matrixRequest = route.request().postDataJSON();
		if (rejectNextMatrixRequest) {
			rejectNextMatrixRequest = false;
			return route.fulfill({ status: 503, json: { error: 'The run service is temporarily unavailable.' } });
		}
		const created = await services.runs.create('QA run — https://example.test/', {
			targetUrl: matrixRequest.targetUrl,
			selectedTests: matrixRequest.selectedTests,
			scopeSelection: matrixRequest.scopeSelection,
			environmentId: matrixRequest.configurationEnvIds[0],
			environmentSnapshot: { envId: matrixRequest.configurationEnvIds[0], device: 'Desktop', os: 'Windows', osVersion: '11', browser: 'Edge', browserVersion: '140' }
		});
		created.status = 'running';
		created.runStartedAt = Date.now();
		created.updatedAt = Date.now();
		successfulMatrixSessionId = created.id;
		matrixRun = {
			id: 'matrix-fixture', status: 'running', targetUrl: matrixRequest.targetUrl,
			items: [{ id: 'matrix-item-fixture', status: 'RUNNING', sessionId: created.id }]
		};
		return route.fulfill({ status: 201, json: matrixRun });
	});
	await page.route('**/api/matrix-runs/matrix-fixture', route => route.fulfill({ json: { run: matrixRun } }));
	await page.goto(base);
	// The decorative entry screen is gone — authentication owns the gate now.
	await page.locator('#auth-gate').waitFor({state:'hidden'});
	if (!await page.locator('#qa-start').evaluate(dialog=>dialog.open)) await page.locator('#new-run').click();
	await page.locator('#qa-start[open]').waitFor();
	await page.locator('#qa-matrix-retry').waitFor({ state: 'visible' });
	assert.equal(await page.locator('#qa-submit').isDisabled(), true, 'Catalog failure cannot launch an invented configuration');
	assert.match(await page.locator('#qa-matrix-error-text').textContent(), /temporarily unavailable/i);
	await page.locator('#qa-matrix-retry').click();
	await page.waitForFunction(()=>document.querySelector('#qa-matrix-summary').textContent.includes('3 of 3 available configurations selected'));
	assert.ok(catalogRequestCount >= 2, 'The launcher catalog can recover through its visible retry action');
	await page.locator('#qa-cancel').click();
	await page.locator('#sidebar-new-run').click();
	await page.locator('#qa-start[open]').waitFor();
	await page.waitForFunction(()=>document.querySelector('#qa-matrix-summary').textContent.includes('3 of 3 available configurations selected'));
	await page.locator('#qa-cancel').click();
	await page.locator('#new-run').click();
	await page.locator('#qa-start[open]').waitFor();
	await page.waitForFunction(()=>document.querySelector('#qa-matrix-summary').textContent.includes('3 of 3 available configurations selected'));
	assert.equal(await page.locator('#qa-submit').isDisabled(),true,'Empty URL cannot launch QA');
	await page.locator('#qa-target-url').fill('https://example.test/');
	await screenshot(page,'start-dialog-invalid.png');
	assert.equal(await page.locator('#qa-submit').isDisabled(),true,'Authorization is required before QA can start');
	assert.match(await page.locator('#qa-selection-summary').textContent(), /authorized to test/i);
	await page.locator('#qa-security-authorized').check();
	assert.equal(await page.locator('#qa-submit').isEnabled(),true,'Valid URL and authorization enable Start testing');
	await screenshot(page,'start-dialog-ready.png');
	rejectNextMatrixRequest = true;
	await page.locator('#qa-submit').click();
	await page.locator('#qa-form-error').filter({ hasText: 'temporarily unavailable' }).waitFor();
	assert.equal(await page.locator('#qa-start').evaluate(dialog=>dialog.open), true, 'Rejected creation keeps the launcher open');
	assert.equal(await page.locator('#qa-submit').isEnabled(), true, 'Rejected creation restores the primary action');
	const requestsBeforeRetry = matrixRequestCount;
	await page.evaluate(() => {
		const form = document.querySelector('#qa-form');
		const submitter = document.querySelector('#qa-submit');
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }));
		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }));
	});
	await page.locator('#qa-start').waitFor({state:'hidden'});
	assert.equal(matrixRequestCount, requestsBeforeRetry + 1, 'Pending guard prevents duplicate create-run requests');
	assert.deepEqual(matrixRequest.configurationEnvIds, launcherConfigurations.map(row=>row.envId));
	assert.equal(matrixRequest.targetUrl, 'https://example.test/');
	assert.ok(matrixRequest.securityAuthorization);
	await page.waitForFunction(id => localStorage.getItem('qase.session') === id && document.body.dataset.runStatus === 'running', successfulMatrixSessionId);
	assert.equal(await page.locator('#status-chip').textContent(), 'Running');
	await page.locator('#run-list').filter({ hasText: 'example.test' }).waitFor();
	await screenshot(page,'start-run-success.png');
	checks.push('QA launcher explains disabled states, recovers catalog and backend failures, prevents duplicate creation, selects the created run, and enters the running workspace from both entry points');
	const created = await page.request.post(`${base}/api/sessions`, { data: { selectedTests: ['navigation'], scopeSelection: ['navigation'] } });
	assert.equal(created.status(), 201);
	const {id: qaId} = await created.json();
	const qaSession = sessions.get(qaId);
	await page.request.post(`${base}/api/sessions/${qaId}/message`, { data: { text: targetUrl } });
	await page.evaluate(id => localStorage.setItem('qase.session', id), qaId);
	await page.reload();
	await page.locator('#qa-start').evaluate(dialog=>{ if(dialog.open) dialog.close(); });
	await page.waitForFunction(()=>document.querySelector('#chat-title')?.textContent?.includes('127.0.0.1'));
	await page.waitForTimeout(200);
	streams.get(qaSession.id).end();
	qaSession.status = 'awaiting_input';
	qaSession.messages.push({id:randomUUID(),ts:Date.now(),role:'agent',text:'Report progress recovered from the saved session.'});
	await page.waitForFunction(()=>document.querySelector('#status-chip')?.textContent === 'waiting for you');
	await page.getByText('Report progress recovered from the saved session.',{exact:true}).waitFor();
	checks.push('EventSource reconnect reloads state missed during a disconnect');
	await page.locator('#new-sqa').click();await page.locator('#sqa-start[open]').waitFor();
	assert.equal(await page.locator('#sqa-submit').isDisabled(),true);
	await page.locator('#sqa-target-url').fill(targetUrl);
	await page.locator('#sqa-authorization').check();
	await screenshot(page,'sqa-launch.png');
	await page.locator('#sqa-submit').click();await page.locator('#sqa-start').waitFor({state:'hidden'});
	await page.locator('#tab-sqa').waitFor({state:'visible'});await page.locator('#tab-sqa').click();
	assert.ok([...sessions.values()].some(s=>s.mode==='sqa'&&s.sqa.scope.authorization.confirmed));
	checks.push('SQA scope authorization, launcher API, pending assessment panel');
	await page.locator('#new-founder').click();await page.locator('#founder-start[open]').waitFor();
	assert.equal(await page.locator('#founder-customize').evaluate(node => node.open), false);
	await page.locator('#founder-target-url').fill(targetUrl);await page.locator('#founder-authorization').check();
	const founderReadability = await page.locator('.founder-intro').evaluate(node => {
		const strong = getComputedStyle(node.querySelector('strong'));
		const paragraph = getComputedStyle(node.querySelector('p'));
		const reference = document.createElement('span');
		reference.style.color = 'var(--text-secondary)';
		document.body.append(reference);
		const secondaryText = getComputedStyle(reference).color;
		reference.remove();
		return {
			strongUsesPrimaryText: strong.color === getComputedStyle(document.body).color,
			paragraphUsesSecondaryText: paragraph.color === secondaryText,
			strongSize: Number.parseFloat(strong.fontSize),
			paragraphSize: Number.parseFloat(paragraph.fontSize)
		};
	});
	assert.deepEqual(founderReadability, {
		strongUsesPrimaryText: true,
		paragraphUsesSecondaryText: true,
		strongSize: 14,
		paragraphSize: 12.5
	}, 'Founder recommendation uses the readable Studio text hierarchy');
	await screenshot(page,'founder-launch.png');
	await page.locator('#founder-submit').click();await page.locator('#founder-start').waitFor({state:'hidden'});
	await page.locator('#tab-founder').waitFor({state:'visible'});await page.locator('#tab-founder').click();
	assert.ok([...sessions.values()].some(s=>s.mode==='founder'&&s.founder.scope.authorization.confirmed&&s.founder.scope.target.name==='127.0.0.1'));
	checks.push('Founder submits with Advanced options closed and derives the product name from its URL');
	await page.screenshot({path:path.join(output,'desktop.png')});
	for(const width of [768,390]) {
		await page.setViewportSize({width,height:844});
		if (width <= 720) await page.locator('[data-workspace-view="runs"]').click();
		assert.ok(await page.locator('#new-run').isVisible());assert.ok(await page.locator('#new-sqa').isVisible());assert.ok(await page.locator('#new-founder').isVisible());
		await page.locator('#new-sqa').click();await page.locator('#sqa-start[open]').waitFor();
		await screenshot(page,`sqa-${width}.png`);await page.locator('#sqa-cancel').click();
		checks.push(`Mode dock and SQA dialog usable at ${width}px`);
	}
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
} finally {
	for (const response of streams.values()) {
		if (!response.writableEnded) response.end();
	}
	await settleTeardown(browser.close());
	server.closeAllConnections();
	await settleTeardown(new Promise(resolve=>server.close(resolve)));
}
process.exit(0);
