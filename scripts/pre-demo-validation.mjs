// Disposable validation harness; no production code changes.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const dataDir = process.env.QASE_DATA_DIR || resolve(root, '.qase');
const secret = randomBytes(32).toString('hex');
const base = 'http://127.0.0.1:5173';
const inspectExisting = process.argv.includes('--inspect-existing');
const coreAcceptance = process.argv.includes('--core-acceptance');
const results = { root, dataDir, startedAt: new Date().toISOString(), checks: [] };
const out = resolve(root, coreAcceptance ? 'artifacts/pre-demo-core-acceptance' : 'artifacts/pre-demo-validation');
mkdirSync(out, { recursive: true });
function record(name, value) { results.checks.push({ name, value }); console.log(JSON.stringify({ name, value: ['missionfindings','missionevidence','missionreport'].includes(name) ? {status:value.status,total:value.json?.total,findings:value.json?.findings?.length,evidence:value.json?.evidence?.length,verdict:value.json?.verdict} : value })); writeFileSync(resolve(out,inspectExisting?'followup.json':'results.json'), JSON.stringify(results,null,2)); }
const target = createServer((req,res) => {
 res.setHeader('Content-Type','text/html');
 res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>QASE demo login</title><h1>Demo account login</h1><p>Both email and password are required. Empty credentials must be rejected.</p><form id="login"><label>Email <input id="email" type="text"></label><label>Password <input id="password" type="password"></label><button>Sign in</button></form><p id="result" role="status"></p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("#result").textContent="Welcome! You are signed in."}</script></html>');
});
await new Promise(r=>target.listen(9907,'127.0.0.1',r));
const child = spawn(process.execPath,[resolve(root,'server/index.js')],{cwd:root,env:{...process.env,PORT:'5173',QASE_DATA_DIR:dataDir,QASE_AUTH_MODE:'required',QASE_API_TOKEN:'',QASE_INTEGRATION_SECRET:secret},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logTail='';
for (const stream of [child.stdout,child.stderr]) stream.on('data',b=>{logTail=(logTail+b.toString()).slice(-12000);});
child.on('exit',code=>record('serverExit',code));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(key,method,path,body) {
 const raw=body===undefined?'':JSON.stringify(body), ts=String(Date.now()),nonce=randomBytes(12).toString('hex');
 const digest=createHmac('sha256','').update(raw).digest('hex');
 const sig=createHmac('sha256',secret).update([method,path.split('?')[0],ts,nonce,digest].join('\n')).digest('hex');
 const res=await fetch(base+path,{method,headers:{Authorization:`QASE-HMAC-SHA256 ${key}:${ts}:${nonce}:${sig}`,...(raw?{'Content-Type':'application/json'}:{})},body:raw||undefined,signal:AbortSignal.timeout(20000)});
 const buffer=Buffer.from(await res.arrayBuffer()); let json;try{json=JSON.parse(buffer.toString('utf8'))}catch{}
 return {status:res.status,json,bytes:buffer.length,contentType:res.headers.get('content-type')};
}
try {
 for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break}catch{} await sleep(200);}
 record('server',{pid:child.pid,base,requiredAuth:true,masterTokenConfigured:false,temporaryIntegrationSecret:true});
 for(const path of ['/api/health','/api/v2/health','/openapi.json','/api/config']) {const r=await fetch(base+path);record('HTTP '+path,{status:r.status});}
 const doc=await (await fetch(base+'/openapi.json')).json();
 record('openapiIntegration',Object.entries(doc.paths).filter(([p])=>p.includes('/integration/')).flatMap(([p,ops])=>Object.keys(ops).filter(m=>['get','post','put','delete'].includes(m)).map(m=>m.toUpperCase()+' '+p)));
 const key='predemo-'+Date.now();
 record('registerStudioIdentity',await call('qase-admin','POST','/api/v1/integration/keys',{keyId:key,workspaceId:'predemo-local',label:'Disposable pre-demo validation'}));
 record('studioWhoami',await call(key,'GET','/api/v1/integration/whoami'));
 // Give the UI time to attach before this single bounded real execution.
 if(!inspectExisting) await sleep(15000);
 const prior=inspectExisting?JSON.parse(readFileSync(resolve(out,'results.json'),'utf8')).checks.find(c=>c.name==='missionCreated').value:null;
 const created=prior || await call(key,'POST','/api/v1/integration/missions',{name:coreAcceptance?'Core handoff known-login-bug':'Pre-demo known-login-bug',type:'full_audit',targetUrl:'http://127.0.0.1:9907/',context:{maxTurns:coreAcceptance?12:10},constraints:{provider:'local'},objectives:['Open the page. Submit Sign in with both fields empty. Verify the stated requirement that empty credentials must be rejected. Report the observed bypass as one high severity defect, with exact steps. Take one screenshot of the result. Then finish. Do not test any other site.'],successCriteria:['Login rejects empty credentials']});
 record('missionCreated',created);
 const id=created.json?.missionId;
 if(id){
  const start=Date.now(); let last='';
  for(let n=0;n<90;n++){
   const s=await call(key,'GET','/api/v1/integration/missions/'+id);
   const shape=JSON.stringify(s.json);
   if(shape!==last){record('missionStatus',s);last=shape;}
   if(['completed','failed','aborted','cancelled','timeout','interrupted'].includes(s.json?.status))break;
   if(n===89)record('boundedStop',await call(key,'POST','/api/v1/integration/missions/'+id+'/stop',{}));
   await sleep(4000);
  }
  record('durationSeconds',(Date.now()-start)/1000);
  for(const part of ['findings','evidence','report'])record('mission'+part,await call(key,'GET','/api/v1/integration/missions/'+id+'/'+part));
  const ev=await call(key,'GET','/api/v1/integration/missions/'+id+'/evidence');
  const artifacts=(ev.json?.evidence||[]).map(e=>e.metadata?.artifact?.id).filter(Boolean);
  if(inspectExisting || coreAcceptance){
   const missionStatus=await call(key,'GET','/api/v1/integration/missions/'+id);
   const sessions=JSON.parse(readFileSync(resolve(dataDir,'sessions.json'),'utf8'));
   const session=sessions.find(s=>s.id===missionStatus.json?.sessionId);
   for(const step of session?.capturedSteps||[])if(step.screenshot?.artifactId&&!artifacts.includes(step.screenshot.artifactId))artifacts.push(step.screenshot.artifactId);
   record('actualSession',{status:session?.status,steps:session?.capturedSteps?.length,pages:[...new Set((session?.capturedSteps||[]).filter(s=>s.action==='navigate').map(s=>s.target))].length,screenshotsAttempted:(session?.capturedSteps||[]).filter(s=>s.screenshot?.captureAttempted).length,screenshotsPersisted:(session?.capturedSteps||[]).filter(s=>s.screenshot?.persisted).length});
  }
  for(const artifact of artifacts.slice(0,3))record('studioArtifact',await call(key,'GET','/api/v1/artifacts/'+artifact+'/content'));
  for(const artifact of artifacts.slice(0,1))record('anonymousArtifact',{status:(await fetch(base+'/api/v1/artifacts/'+artifact+'/content')).status});
  if(!artifacts.length)record('studioArtifactAuthProbe',await call(key,'GET','/api/v1/artifacts/nonexistent-predemo/content'));
  record('missionLogClassification',{connectionError:/Connection error/i.test(logTail),browserLaunchError:/browser.*(failed|error)/i.test(logTail),providerAuthError:/401|403|unauthorized/i.test(logTail)});
 }
 record('validationFinished',{serverLeftRunning:true,targetLeftRunning:true,secretPersisted:false});
}catch(error){record('harnessError',{name:error.name,message:String(error.message).replaceAll(secret,'[redacted]').slice(0,300)});}
process.on('SIGINT',()=>{child.kill();target.close();process.exit(0)});
process.on('SIGTERM',()=>{child.kill();target.close();process.exit(0)});
