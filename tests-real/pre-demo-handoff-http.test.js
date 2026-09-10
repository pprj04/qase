import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

test('persisted handoff: HMAC mission chain, session UI, empty UI and restart', {timeout:90000}, async t => {
 const root=resolve(import.meta.dirname,'..'), dir=mkdtempSync(join(tmpdir(),'qase-handoff-http-'));
 process.env.QASE_DATA_DIR=dir;
 const store=await import('../server/store.js'), missions=await import('../server/missions.js');
 const artifacts=await import('../server/artifactStore.js'), users=await import('../server/userStore.js');
 const password='Dummy-password-1234';
 const admin=users.createBootstrapAdmin({email:'admin@handoff.test',password,name:'Handoff Admin'});
 const other=users.createUser({email:'other@handoff.test',password,role:'operator'});users.flushUsers();
 const browser=await chromium.launch({headless:true});
 let child;
 t.after(async()=>{await browser.close();if(child){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true,maxRetries:3});});
 const fixturePage=await browser.newPage();await fixturePage.setContent('<h1>Known bug: empty login accepted</h1>');
 const jpeg=await fixturePage.screenshot({type:'jpeg'});await fixturePage.close();
 function seed(empty=false){
  const m=missions.createMission({name:empty?'Empty fixture':'Handoff fixture',workspaceId:'handoff-a',ownerUserId:admin.id,targetUrl:'https://fixture.test/'});
  const s=store.createSession(m.name,m.projectId,{missionId:m.id,ownerUserId:admin.id});
  s.targetUrl=m.targetUrl;s.status='done';s.report={verdict:'fail',covered:['empty login validation']};
  s.capturedSteps=empty?[]:[{id:'n',action:'navigate',target:m.targetUrl,outcome:{status:'success'}},{id:'c',action:'click',url:m.targetUrl,outcome:{status:'success'}}];
  s.findings=empty?[]:[{id:'finding_'+m.id,title:'Empty login accepted',severity:'high',url:m.targetUrl,steps:['Open login','Submit empty'],expected:'Rejected',actual:'Welcome',evidence:'Observed Welcome after empty submit'}];
  let art;
  if(!empty){art=artifacts.persistScreenshotArtifact({sessionId:s.id,missionId:m.id,ownerUserId:admin.id,base64:jpeg.toString('base64')});s.capturedSteps.push({id:'shot',action:'screenshot',url:m.targetUrl,outcome:{status:'success'},screenshot:{...art,captureAttempted:true}});}
  const last=empty?s:store.createSession('Follow-up',m.projectId,{missionId:m.id,ownerUserId:admin.id});
  if(!empty){last.status='done';last.report={covered:[]};}
  missions.updateMission(m.id,{status:'running',sessionId:last.id});missions.finalizeMission(m.id,{status:'completed'});
  return {m,s,art};
 }
 const full=seed(),empty=seed(true);
 const unlinked=artifacts.persistScreenshotArtifact({sessionId:full.s.id,missionId:full.m.id,ownerUserId:admin.id,base64:jpeg.toString('base64')});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base='http://127.0.0.1:'+port,secret=randomBytes(32).toString('hex');
 async function boot(){
  child=spawn(process.execPath,[join(root,'server/index.js')],{cwd:dir,env:{...process.env,QASE_DATA_DIR:dir,PORT:String(port),QASE_AUTH_MODE:'required',QASE_API_TOKEN:'',QASE_INTEGRATION_SECRET:secret,QASE_API_KEY:'test-only',QASE_PROVIDER:'custom',QASE_BASE_URL:'http://127.0.0.1:1/v1',QASE_MODEL:'dummy',QASE_ORPHAN_SWEEP:'0'},stdio:'ignore',windowsHide:true});
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await delay(150);}throw Error('Server did not start');
 }
 function signed(key,method,path,raw=''){
  const ts=String(Date.now()),nonce=randomBytes(12).toString('hex');
  const digest=createHmac('sha256','').update(raw).digest('hex');
  const signature=createHmac('sha256',secret).update([method,path.split('?')[0],ts,nonce,digest].join('\n')).digest('hex');
  return {authorization:`QASE-HMAC-SHA256 ${key}:${ts}:${nonce}:${signature}`};
 }
 async function hmac(key,path,body){const method=body?'POST':'GET',raw=body?JSON.stringify(body):'';return fetch(base+path,{method,headers:{...signed(key,method,path,raw),...(body?{'content-type':'application/json'}:{})},body:raw||undefined});}
 await boot();
 for(const [keyId,workspaceId] of [['handoff-a','handoff-a'],['handoff-b','handoff-b']]) assert.equal((await hmac('qase-admin','/api/v1/integration/keys',{keyId,workspaceId})).status,201);
 const artPath='/api/v1/artifacts/'+full.art.artifactId+'/content';
 const evPath='/api/v1/integration/missions/'+full.m.id+'/evidence';
 const ev=await (await hmac('handoff-a',evPath)).json();assert.equal(ev.total,4);
 assert.ok(ev.evidence.some(e=>e.metadata?.artifact?.id===full.art.artifactId));
 const bytes=await hmac('handoff-a',artPath);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),jpeg);
 assert.equal((await hmac('handoff-b',artPath)).status,404);
 assert.equal((await hmac('handoff-b',evPath)).status,403);
 assert.equal((await hmac('handoff-a','/api/v1/artifacts/'+unlinked.artifactId+'/content')).status,404);
 assert.equal((await fetch(base+artPath)).status,401);
 assert.equal((await fetch(base+artPath,{headers:{authorization:'QASE-HMAC-SHA256 invalid'}})).status,401);
 const findings=await (await hmac('handoff-a','/api/v1/integration/missions/'+full.m.id+'/findings?confirmedOnly=true')).json();
 assert.equal(findings.confirmedTotal,1);assert.equal(findings.actionableFindings.length,1);
 const report=await (await hmac('handoff-a','/api/v1/integration/missions/'+full.m.id+'/report')).json();
 assert.equal(report.executionStatus,'completed');assert.equal(report.qualityVerdict,'fail');
 const emptyReport=await (await hmac('handoff-a','/api/v1/integration/missions/'+empty.m.id+'/report')).json();assert.equal(emptyReport.verdict,'not_tested');assert.equal(emptyReport.regressionReady,false);
 const context=await browser.newContext();
 const login=await context.request.post(base+'/api/auth/login',{data:{email:admin.email,password}});assert.equal(login.status(),200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/runs/'+full.s.id);await page.locator('#tab-evidence').click();
 await page.locator('#ev-grid .ev-card').first().waitFor();
 const image=page.locator('#ev-grid img').first();await image.waitFor();
 await page.waitForFunction(()=>{const img=document.querySelector('#ev-grid img');return img?.complete&&img.naturalWidth>0;});
 assert.equal((await context.request.get(base+artPath)).status(),200);
 await page.goto(base+'/runs/'+empty.s.id);await page.locator('#tab-evidence').click();await page.locator('.ev-empty-title').filter({hasText:'No evidence captured'}).waitFor();
 assert.ok(!errors.some(e=>/token is not defined/.test(e)),errors.join('\n'));
 const otherContext=await browser.newContext();await otherContext.request.post(base+'/api/auth/login',{data:{email:other.email,password}});
 assert.equal((await otherContext.request.get(base+artPath)).status(),404);await otherContext.close();
 child.kill();await new Promise(r=>child.once('exit',r));child=null;await boot();
 const after=await (await hmac('handoff-a',evPath)).json();assert.deepEqual(after.evidence.map(e=>e.id),ev.evidence.map(e=>e.id));
 assert.equal((await hmac('handoff-a',artPath)).status,200);
 await page.reload();await page.locator('#tab-evidence').click();await page.locator('.ev-empty-title').filter({hasText:'No evidence captured'}).waitFor();
 await context.close();
});
