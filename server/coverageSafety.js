/** Conservative, persisted-data-only release gate. No invented coverage percent. */
export function evaluateCoverageSufficiency({ session, mission, executionStatus } = {}) {
 const status = executionStatus ?? mission?.status ?? session?.status;
 const steps = (session?.capturedSteps ?? []).filter(s => s.outcome);
 const successful = steps.filter(s => s.outcome.status === 'success');
 const pages = new Set(successful.filter(s => s.action === 'navigate').map(s => s.url || s.target || session?.targetUrl).filter(Boolean));
 const validations = successful.filter(s => ['click','fill','type','press','select','check','assert','evaluate'].includes(s.action));
 const persisted = !session && mission?.coverage;
 const facts = { browserActions: steps.length, successfulActions: successful.length, pagesVisited: pages.size, validationSteps: validations.length, scope: 'recorded run only', ...persisted };
 const interrupted = ['interrupted','aborted','cancelled','timeout'].includes(status) || ['interrupted'].includes(session?.status);
 const blocked = ['failed','error'].includes(status) || session?.status === 'error' || session?.report?.verdict === 'blocked';
 if (interrupted) return {...facts, sufficient:false, verdict:'inconclusive', reason:'Execution interrupted before coverage could be approved.'};
 if (blocked) return {...facts, sufficient:false, verdict:'blocked', reason:'Execution or provider failure prevents release approval.'};
 if (!facts.browserActions || !facts.pagesVisited) return {...facts,sufficient:false,verdict:'not_tested',reason:'No successful browser navigation and execution recorded.'};
 const covered = session ? Array.isArray(session.report?.covered) && session.report.covered.length > 0 : persisted?.sufficient === true;
 if (!['completed','done','idle'].includes(status) || !facts.validationSteps || !covered) return {...facts,sufficient:false,verdict:'inconclusive',reason:'No completed validation with recorded covered scope.'};
 return {...facts,sufficient:true,verdict:null,reason:'Navigation, validation steps and covered scope recorded; broader coverage is unknown.'};
}

export function findingHasReproduction(finding) {
 return finding?.category !== 'missing_feature' && !/^missing feature:/i.test(finding?.title ?? '')
  && !finding?.isDuplicate && !finding?.duplicateOf
  && finding?.steps?.length >= 2 && Boolean(finding.expected && finding.actual && finding.evidence)
  && !/potential missing feature|no evidence of|feature not found during exploration/i.test(String(finding.evidence));
}

export function samePage(a,b) {
 try { const x=new URL(a),y=new URL(b);return x.origin===y.origin && x.pathname===y.pathname; } catch {return false;}
}

export function relevantBrowserEvidence(finding, evidence) {
 return evidence?.source === 'browser' && evidence?.type === 'step_outcome'
  && (samePage(finding.url, evidence.target) || samePage(finding.url,evidence.payload?.urlAfter));
}
