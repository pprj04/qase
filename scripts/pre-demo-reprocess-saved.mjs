// Re-publish ONLY the saved pre-demo acceptance mission. No browser/provider calls.
// Run with QASE stopped; snapshots preserve the original stores before repair.
import {resolve,join} from 'node:path';
import {readFileSync,copyFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
try {await fetch('http://127.0.0.1:5173/api/health',{signal:AbortSignal.timeout(1500)});throw Error('Stop QASE before reprocessing its stores.');}catch(e){if(e.message.startsWith('Stop QASE'))throw e;}
const dir=resolve(root,'.qase');process.env.QASE_DATA_DIR=dir;
const out=resolve(root,'artifacts/pre-demo-core-acceptance');
const result=JSON.parse(readFileSync(join(out,'results.json'),'utf8'));
const id=result.checks.find(c=>c.name==='missionCreated')?.value?.json?.missionId;
if(!id)throw Error('No saved acceptance mission id');
const backup=join(out,'before-reprocessing-'+Date.now());mkdirSync(backup,{recursive:true});
for(const name of ['missions.json','sessions.json','findings.json','evidence-graph.json'])if(existsSync(join(dir,name)))copyFileSync(join(dir,name),join(backup,name));
const store=await import('../server/store.js');store.loadSessions();
const missions=await import('../server/missions.js');missions.loadMissionsFromDisk();
const {buildImprovementPrompt}=await import('../server/devIntelligence.js');
const m=missions.getMission(id);if(!m||m.status!=='completed'||m.targetUrl!=='http://127.0.0.1:9907/')throw Error('Unexpected acceptance mission; no repair performed');
const before={status:m.status,verdict:m.verdict,findings:m.findings.length};
missions.updateMission(id,{status:m.status});
missions.updateMission(id,{improvementPrompt:buildImprovementPrompt(m,m.findings).improvementPrompt});
missions.flushMissionsForShutdown();
const summary={missionId:id,replayedRecordedEvidenceOnly:true,backup,before,after:{status:m.status,verdict:m.verdict,releaseReady:m.releaseReady,coverage:m.coverage,findings:m.findings.length,confirmed:m.quality.confirmedFindings,speculative:m.quality.speculativeFindings,evidence:m.evidenceStats}};
writeFileSync(join(out,'reprocessing.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
