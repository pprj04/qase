import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// A full isolated source copy is essential: legacy stores ignore QASE_DATA_DIR.
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(root, 'artifacts', 'auth-phase1-'));
for (const entry of ['server', 'public', 'package.json']) cpSync(join(root, entry), join(dir, entry), { recursive: true });
mkdirSync(join(dir, '.qase'));
const password = 'Local-test-password-43';
writeFileSync(join(dir, 'fixture.mjs'), `
import { createUser, flushUsers } from './server/userStore.js';
import { createSession, flushSessionsForShutdown } from './server/store.js';
import { createMission, flushMissionsForShutdown } from './server/missions.js';
import { addFinding, flushFindingsForShutdown } from './server/findings.js';
import { createEvidence, flushEvidenceGraphForShutdown } from './server/evidenceGraph.js';
import { saveWorkflow, flushWorkflowsForShutdown } from './server/workflows.js';
import { persistScreenshotArtifact } from './server/artifactStore.js';
import { createTestCase, flushTestCasesForShutdown } from './server/testCases.js';
import { createSchedule, flushSchedulesForShutdown } from './server/scheduler.js';
import { addRegressionRun, flushRegressionRunsForShutdown } from './server/regressionStore.js';
import { createSession as createAuthSession } from './server/userStore.js';
import { writeFileSync } from 'node:fs';
const users = Object.fromEntries(['a','b','admin'].map(name => [name, createUser({email:name+'@phase1.test', password:${JSON.stringify(password)}, role:name==='admin'?'admin':'operator'})]));
flushUsers();
const session = createSession('A run', null, {ownerUserId:users.a.id});
const mission = createMission({name:'A mission',ownerUserId:users.a.id,sessionId:session.id});
const finding = addFinding({title:'B private finding',ownerUserId:users.b.id});
const evidence = createEvidence({type:'observation',source:'test',ownerUserId:users.b.id,observation:'private B evidence'});
session.capturedSteps = [{action:'click',target:'#fixture'}];
const workflow = saveWorkflow(session,{name:'A workflow'});
const inheritedCase = createTestCase({name:'Legacy A case via workflow',workflowId:workflow.id});
const schedule = createSchedule({name:'A disabled schedule',ownerUserId:users.a.id,enabled:false});
const regression = addRegressionRun({scheduleId:schedule.id,total:1,passed:1});
flushTestCasesForShutdown(); flushSchedulesForShutdown(); flushRegressionRunsForShutdown();
flushWorkflowsForShutdown();
const artifact = persistScreenshotArtifact({sessionId:session.id,ownerUserId:users.a.id,base64:'aXNvbGF0ZWQgdGVzdA=='});
const expired = createAuthSession(users.a.id,{ttlHours:-1});
const legacy = createMission({name:'Unclaimed legacy'});
flushSessionsForShutdown(); flushMissionsForShutdown(); flushFindingsForShutdown(); flushEvidenceGraphForShutdown();
writeFileSync('fixture.json',JSON.stringify({users,inheritedCaseId:inheritedCase.id,regressionId:regression.id,scheduleId:schedule.id,workflowId:workflow.id,artifactId:artifact.artifactId,expired,sessionId:session.id,missionId:mission.id,findingId:finding.id,evidenceId:evidence.id,legacyId:legacy.id}));
await import('./server/index.js');
`);
const port = await new Promise(resolvePort => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const chosen = socket.address().port; socket.close(() => resolvePort(chosen)); }); });
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['fixture.mjs'], { cwd: dir, env: { ...process.env, PORT: String(port), QASE_DATA_DIR: join(dir,'.qase'), QASE_AUTH_MODE:'required', QASE_API_TOKEN:'', QASE_API_KEY:'' }, stdio:['ignore','pipe','pipe'], windowsHide:true });
let log = '';
child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
async function call(path, cookie, method='GET', body) {
 const response=await fetch(base+path,{method,redirect:'manual',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body && !['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{})});
 const text=await response.text(); let data; try { data=JSON.parse(text); } catch { data=text; }
 return {status:response.status,data,headers:response.headers};
}
test('Phase 1 isolated HTTP authorization', async t => {
 t.after(() => { child.kill(); writeFileSync(join(dir,'server.log'),log); });
 for(let i=0;i<100;i++){ if(child.exitCode!==null) throw Error(log); try {if((await call('/api/health')).status===200)break;}catch{} await delay(100); }
 assert.equal((await call('/api/health')).status,200);
 const fixture=JSON.parse(readFileSync(join(dir,'fixture.json'),'utf8'));
 const cookies={};
 cookies.invalid='qase_session=%ZZ';
 cookies.expired='qase_session='+fixture.expired;
 for(const name of ['a','b','admin']){
  const login=await call('/api/auth/login',null,'POST',{email:name+'@phase1.test',password});
  assert.equal(login.status,200); cookies[name]=login.headers.get('set-cookie').split(';')[0];
 }
 const check=async(name,path,who,status,method='GET',body)=>t.test(name,async()=>assert.equal((await call(path,cookies[who],method,body)).status,status));
 await check('unauthenticated API rejected','/api/missions',null,401);
 await check('shell redirects to dedicated login','/',null,302);
 await check('login page renders','/login',null,200);
 await check('signed in redirects from login','/login','a',302);
 await check('reload restores identity','/api/auth/me','a',200);
 await check('malformed cookie rejected','/api/auth/me','invalid',401);
 await check('expired cookie rejected','/api/auth/me','expired',401);
 await check('expired document redirects','/runs','expired',302);
 await check('wrong password rejected','/api/auth/login',null,401,'POST',{email:'a@phase1.test',password:'wrong-password'});
 await t.test('successful login rotates an existing session and preserves cookie security',async()=>{
  const oldCookie=cookies.b;
  const rotated=await call('/api/auth/login',oldCookie,'POST',{email:'b@phase1.test',password});
  assert.equal(rotated.status,200);
  const setCookie=rotated.headers.get('set-cookie');
  assert.match(setCookie,/HttpOnly/i); assert.match(setCookie,/SameSite=Strict/i);
  cookies.b=setCookie.split(';')[0];
  assert.notEqual(cookies.b,oldCookie);
  assert.equal((await call('/api/auth/me',oldCookie)).status,401);
  assert.equal((await call('/api/auth/me',cookies.b)).status,200);
  const secure=await call('/api/auth/login',cookies.b,'POST',{email:'b@phase1.test',password});
  // Production TLS termination is conveyed through the existing proxy header.
  const secureResponse=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'https',cookie:secure.headers.get('set-cookie').split(';')[0]},body:JSON.stringify({email:'b@phase1.test',password})});
  assert.match(secureResponse.headers.get('set-cookie'),/; Secure/i);
  cookies.b=secureResponse.headers.get('set-cookie').split(';')[0];
 });
 await check('A reads own mission','/api/missions/'+fixture.missionId,'a',200);
 await check('B cannot read A mission','/api/missions/'+fixture.missionId,'b',404);
 await check('B cannot update A mission','/api/missions/'+fixture.missionId,'b',404,'PUT',{name:'stolen'});
 await check('B cannot delete A mission','/api/missions/'+fixture.missionId,'b',404,'DELETE');
 await check('B cannot start A mission','/api/v1/missions/'+fixture.missionId+'/start','b',404,'POST',{});
 await check('admin reads A mission','/api/missions/'+fixture.missionId,'admin',200);
 await check('A cannot read B finding','/api/findings/'+fixture.findingId,'a',404);
 await check('A cannot read B evidence','/api/v1/evidence/'+fixture.evidenceId,'a',404);
 await check('B cannot read A report','/api/sessions/'+fixture.sessionId+'/report.md','b',404);
 await check('B cannot read A legacy artifact','/api/artifacts/'+fixture.sessionId+'/secret.jpeg','b',404);
 for(const suffix of ['', '/content']) {
  await check('A reads own canonical artifact '+suffix,'/api/v1/artifacts/'+fixture.artifactId+suffix,'a',200);
  await check('B denied canonical artifact '+suffix,'/api/v1/artifacts/'+fixture.artifactId+suffix,'b',404);
 }
 for(const prefix of ['/api/','/api/v2/']) {
  await check('workflow own '+prefix,prefix+'workflows/'+fixture.workflowId,'a',200);
  await check('workflow foreign '+prefix,prefix+'workflows/'+fixture.workflowId,'b',404);
 }
 for(const method of ['PUT','DELETE']) await check('workflow foreign '+method,'/api/workflows/'+fixture.workflowId,'b',404,method,{name:'stolen'});
 await check('workflow foreign execute','/api/workflows/'+fixture.workflowId+'/generate-tests','b',404,'POST',{});
 await check('cross user parent injection','/api/missions','b',404,'POST',{name:'bad link',sessionId:fixture.sessionId});
 await t.test('caller cannot overwrite mission ID',async()=>{
  const result=await call('/api/missions',cookies.b,'POST',{id:fixture.missionId,name:'attempted overwrite',ownerUserId:fixture.users.a.id});
  assert.equal(result.status,201); assert.notEqual(result.data.id,fixture.missionId); assert.equal(result.data.ownerUserId,fixture.users.b.id);
  assert.equal((await call('/api/missions/'+fixture.missionId,cookies.a)).data.name,'A mission');
 });
 for(const path of ['/api/v1/evidence/validate','/api/v1/artifacts/stats','/api/metrics/dashboard/ux','/api/knowledge','/api/v2/knowledge']) await check('admin-only global '+path,path,'a',403,path.endsWith('validate')?'POST':'GET',{});
 for(const path of ['/api/sessions/'+fixture.sessionId,'/api/v2/sessions/'+fixture.sessionId,'/api/v1/sessions/'+fixture.sessionId+'/evidence','/api/sessions/'+fixture.sessionId+'/events']) await check('foreign session path '+path,path,'b',404);
 await check('last admin cannot disable self','/api/auth/users/'+fixture.users.admin.id,'admin',409,'PATCH',{disabled:true});
 await check('rejected admin update preserves session','/api/auth/me','admin',200);
 await check('normal users cannot manage accounts','/api/auth/users','a',403);
 await check('admin manages accounts','/api/auth/users','admin',200);
 await check('legacy unavailable to normal users','/api/missions/'+fixture.legacyId,'a',404);
 await check('legacy retained for admin','/api/missions/'+fixture.legacyId,'admin',200);
 await check('legacy case inherits trusted workflow','/api/test-cases/'+fixture.inheritedCaseId,'a',200);
 await check('legacy case hidden from B','/api/test-cases/'+fixture.inheritedCaseId,'b',404);
 for(const prefix of ['/api/','/api/v2/']) {
  await check('regression inherits schedule '+prefix,prefix+'regression/runs/'+fixture.regressionId,'a',200);
  await check('regression denied '+prefix,prefix+'regression/runs/'+fixture.regressionId,'b',404);
 }
 await check('schedule foreign execution rejected','/api/schedules/'+fixture.scheduleId+'/run','b',404,'POST',{});
 await check('foreign evidence reference rejected','/api/findings','a',404,'POST',{title:'bad ref',evidenceRefs:[fixture.evidenceId]});
 await t.test('list isolation',async()=>{
  const list=(await call('/api/missions',cookies.b)).data;
  assert.ok(!JSON.stringify(list).includes(fixture.missionId));
  assert.ok(JSON.stringify((await call('/api/missions',cookies.a)).data).includes(fixture.missionId));
 });
 for(const kind of ['test-cases','suites','schedules','projects']){
  const own=await call('/api/'+kind,cookies.a,'POST',{name:'A '+kind,enabled:false}); assert.equal(own.status,201);
  for(const prefix of ['/api/','/api/v2/']) {
   await t.test(prefix+kind+' list scoped',async()=>assert.ok(!JSON.stringify((await call(prefix+kind,cookies.b)).data).includes(own.data.id)));
  }
  for(const method of ['PUT','DELETE']) await check(kind+' cross-user '+method,'/api/'+kind+'/'+own.data.id,'b',404,method,{name:'stolen'});
 }
 await t.test('aggregates do not count foreign findings',async()=>{
  assert.equal((await call('/api/findings/stats',cookies.a)).data.total,0);
  assert.equal((await call('/api/v2/findings/stats',cookies.a)).data.total,0);
  assert.equal((await call('/api/metrics/dashboard',cookies.b)).data.testCases.total,0);
 });
 await t.test('signup normal role, duplicate and mismatch protection',async()=>{
  const body={email:'signup@phase1.test',password,confirmPassword:password};
  const created=await call('/api/auth/signup',null,'POST',body); assert.equal(created.status,201);assert.equal(created.data.user.role,'operator');
  assert.equal((await call('/api/auth/signup',null,'POST',body)).status,409);
  assert.equal((await call('/api/auth/signup',null,'POST',{...body,email:'x@phase1.test',confirmPassword:'mismatch'})).status,400);
  assert.equal((await call('/api/auth/signup',null,'POST',{...body,email:'x@phase1.test',role:'admin'})).status,400);
  assert.ok(!readFileSync(join(dir,'.qase','users.json'),'utf8').includes(password));
 });
 await check('logout succeeds','/api/auth/logout','a',200,'POST',{});
 await check('old cookie invalid after logout','/api/auth/me','a',401);
 console.log('Isolated test directory: '+dir);
});
