import { getSession, listSessions, saveSessions, flushSessionsForShutdown } from './store.js';
import { collectSessionEvidence, flushEvidenceGraphForShutdown, getFindingEvidence, getMissionEvidencePage } from './evidenceGraph.js';
import { syncSessionFinding, flushFindingsForShutdown, setFindingConfirmation } from './findings.js';
import { calculateMissionQuality, isConfirmedFinding } from './devIntelligence.js';

/** Shared by every terminal writer, before the terminal mission is persisted. */
export function prepareMissionOutcome(mission, patch = {}) {
 const session = getSession(patch.sessionId ?? mission.sessionId);
 const current = {...mission,...patch};
 // Autonomy may replace mission.sessionId before its first terminal write.
 // Preserve every server-linked session, including the initial observation.
 const linkedIds = new Set([session?.id,...(current.iterations ?? []).map(i=>i.sessionId),...(current.iterationMetadata ?? []).map(i=>i.sessionId),...listSessions().filter(s=>s.missionId===mission.id).map(s=>s.id)]);
 const linkedSessions = [...linkedIds].map(getSession).filter(Boolean);
 const all = new Map([...(mission.findings ?? []),...(patch.findings ?? []),...linkedSessions.flatMap(s=>s.findings ?? [])].map(f=>[f.id,f]));
 const findings = [...all.values()];
 let evidenceStats = mission.evidenceStats;
 let publicationFailed = false;
 if (linkedSessions.length) {
  const stats = {evidenceCreated:0,evidenceAttempted:0,evidenceIdsPersisted:0,observationsCreated:0,linksCreated:0,screenshotsAttempted:0,screenshotsPersisted:0};
  for (const observedSession of linkedSessions) {
   for (const finding of observedSession.findings ?? []) syncSessionFinding(observedSession, finding);
   const collection = collectSessionEvidence(observedSession,current,`iter_${current.iterations?.find(i=>i.sessionId===observedSession.id)?.number ?? current.currentIteration ?? 1}`);
   for (const key of Object.keys(stats)) stats[key] += (key === 'evidenceCreated' ? collection.evidenceCreated : collection.stats[key]) ?? 0;
  }
  publicationFailed = !flushEvidenceGraphForShutdown().ok;
  evidenceStats = {...stats,evidencePersisted:getMissionEvidencePage(mission.id,{limit:1}).total,stampedAt:Date.now()};
 }
 for (const finding of findings) {
  finding.evidenceIds = getFindingEvidence(finding.id).map(e=>e.id);
  finding.confirmation = isConfirmedFinding(finding) ? 'confirmed' : 'suggestion';
  setFindingConfirmation(finding.id,finding.confirmation);
 }
 const coverageSession = session && {...session,capturedSteps:linkedSessions.flatMap(s=>s.capturedSteps ?? []),report:{...session.report,covered:linkedSessions.flatMap(s=>s.report?.covered ?? [])}};
 const quality = calculateMissionQuality(findings,{session:coverageSession,mission:current,executionStatus:current.status});
 if (linkedSessions.length) { saveSessions(); publicationFailed = !flushSessionsForShutdown().ok || publicationFailed; }
 publicationFailed = !flushFindingsForShutdown().ok || publicationFailed;
 if (publicationFailed) Object.assign(quality,{verdict:'inconclusive',releaseReady:false,confidence:0,score:null,reason:'Evidence or execution persistence failed.'});
 return {findings,findingsCount:findings.length,evidenceStats,quality,coverage:quality.coverage,qualityScore:quality.score,verdict:quality.verdict,releaseReady:quality.releaseReady};
}
