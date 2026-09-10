import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'qase-core-fix-'));
process.env.QASE_DATA_DIR=dir;
const store=await import('../server/store.js');
const missions=await import('../server/missions.js');
const graph=await import('../server/evidenceGraph.js');
const artifacts=await import('../server/artifactStore.js');
const quality=await import('../server/devIntelligence.js');
after(()=>{graph.flushEvidenceGraphForShutdown();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
function fixture({empty=false, finding=false, severity='high', speculative=false}={}) {
 const m=missions.createMission({projectId:'test-project',workspaceId:'test-workspace',targetUrl:'https://fixture.test/'});
 const s=store.createSession('fixture','test-project',{missionId:m.id,ownerUserId:'owner-a'});
 s.targetUrl=m.targetUrl;s.status='done';s.report={covered:['empty login validation'],verdict:'pass'};
 s.capturedSteps=empty?[]:[{id:'nav',action:'navigate',target:s.targetUrl,outcome:{status:'success'}},{id:'click',action:'click',url:s.targetUrl,outcome:{status:'success'}}];
 s.findings=finding?[{id:'f-'+m.id,title:speculative?'Missing feature: pricing':'Empty login accepted',category:speculative?'missing_feature':'authentication',severity,url:s.targetUrl,steps:['open','submit'],expected:'reject empty',actual:'welcome',observed:'Welcome with empty fields',evidence:speculative?'LLM analysis identified a potential missing feature':'Observed Welcome text',reproducibility:'confirmed'}]:[];
 missions.updateMission(m.id,{status:'running',sessionId:s.id});
 return {m,s};
}
test('coverage A/B/C/D and release guard use one canonical report result',()=>{
 for(const [name,status,empty,expected] of [['covered','completed',false,'pass'],['empty','completed',true,'not_tested'],['provider','failed',true,'blocked'],['browser','failed',true,'blocked'],['interrupted','interrupted',true,'inconclusive'],['aborted','aborted',false,'inconclusive']]) {
  const {m,s}=fixture({empty});
  if(status==='interrupted') missions.updateMission(m.id,{status}); else missions.finalizeMission(m.id,{status});
  assert.equal(m.verdict,expected,name);
  assert.equal(m.releaseReady,expected==='pass',name);
  if(empty) assert.notEqual(m.quality.confidence,1);
  const report=quality.buildImprovementPrompt(m,m.findings);
  assert.equal(report.verdict,m.verdict);assert.equal(report.regressionReady,m.releaseReady);
 }
});
test('critical/high confirmed bugs fail quality, never execution; suggestions do not drive severity totals',()=>{
 for(const severity of ['critical','high']) {
  const {m}=fixture({finding:true,severity});missions.finalizeMission(m.id,{status:'completed'});
  assert.equal(m.status,'completed');assert.equal(m.verdict,'fail');assert.equal(m.releaseReady,false);
  assert.equal(m.quality.confirmedFindings,1);assert.equal(m.quality.breakdown[severity],1);
 }
 const {m}=fixture({finding:true,speculative:true,severity:'critical'});missions.finalizeMission(m.id,{status:'completed'});
 assert.equal(m.verdict,'pass');assert.equal(m.quality.confirmedFindings,0);assert.equal(m.quality.speculativeFindings,1);
 assert.equal(quality.buildImprovementPrompt(m,m.findings).findings.length,0);
 assert.equal(quality.buildImprovementPrompt(m,m.findings).suggestions.length,1);
});
test('all terminal writers publish evidence and screenshot/finding links exactly once, persisted on disk',()=>{
 for(const status of ['completed','failed','interrupted','aborted','timeout']) {
  const {m,s}=fixture({finding:true});
  const art=artifacts.persistScreenshotArtifact({sessionId:s.id,missionId:m.id,ownerUserId:'owner-a',base64:Buffer.from([255,216,255,217]).toString('base64')});
  s.capturedSteps.push({id:'shot',action:'screenshot',url:s.targetUrl,outcome:{status:'success'},screenshot:{...art,captureAttempted:true}});
  if(status==='interrupted')missions.updateMission(m.id,{status});else missions.finalizeMission(m.id,{status});
  const before=graph.getMissionEvidencePage(m.id,{limit:100});assert.equal(before.total,4,status);
  assert.equal(m.evidenceStats.evidenceCreated,4);assert.equal(m.evidenceStats.evidenceAttempted,4);
  assert.ok(before.items.some(e=>e.metadata?.artifact?.id===art.artifactId));
  const finding=m.findings[0];assert.ok(finding.evidenceIds.length>=3);
  assert.ok(finding.evidenceIds.every(id=>graph.getEvidence(id)));
  const observations=graph.getSessionObservationsPage(s.id).total;
  graph.collectSessionEvidence(s,m,'iter_1');missions.finalizeMission(m.id,{status});
  assert.equal(graph.getMissionEvidencePage(m.id).total,before.total);
  assert.equal(graph.getSessionObservationsPage(s.id).total,observations);
  const disk=JSON.parse(readFileSync(join(dir,'evidence-graph.json'),'utf8'));
  assert.equal(disk.evidence.filter(e=>e.missionId===m.id).length,before.total);
 }
});
test('empty mission evidence stays genuinely empty',()=>{
 const {m}=fixture({empty:true});missions.finalizeMission(m.id,{status:'completed'});
 assert.equal(graph.getMissionEvidencePage(m.id).total,0);
});
test('a deferred follow-up cannot erase the initial confirmed bug, screenshot or coverage',()=>{
 const {m,s}=fixture({finding:true});
 const art=artifacts.persistScreenshotArtifact({sessionId:s.id,missionId:m.id,ownerUserId:'owner-a',base64:Buffer.from([255,216,255,217]).toString('base64')});
 s.capturedSteps.push({id:'shot',action:'screenshot',url:s.targetUrl,outcome:{status:'success'},screenshot:{...art,captureAttempted:true}});
 const followup=store.createSession('followup','test-project',{missionId:m.id,ownerUserId:'owner-a'});
 followup.status='done';followup.targetUrl=m.targetUrl;followup.report={verdict:'pass',covered:['navigation only']};
 followup.capturedSteps=[{id:'nav2',action:'navigate',target:m.targetUrl,outcome:{status:'success'}},{id:'snap2',action:'snapshot',outcome:{status:'success'}}];
 missions.updateMission(m.id,{sessionId:followup.id});missions.finalizeMission(m.id,{status:'completed',findings:[]});
 assert.equal(m.verdict,'fail');assert.equal(m.quality.confirmedFindings,1);assert.equal(m.coverage.browserActions,5);
 assert.equal(graph.getMissionEvidencePage(m.id).total,6);assert.ok(m.findings[0].evidenceIds.includes(graph.getMissionEvidencePage(m.id).items.find(e=>e.metadata?.artifact?.id===art.artifactId).id));
});
test('navigation and snapshot alone are not meaningful validation',()=>{
 const {m,s}=fixture();s.capturedSteps[1].action='snapshot';missions.finalizeMission(m.id,{status:'completed'});
 assert.equal(m.verdict,'inconclusive');assert.equal(m.releaseReady,false);
});
