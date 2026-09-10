// Execute the current pure scoring/report functions with controlled inputs.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../server/devIntelligence.js',import.meta.url),'utf8');
const score=source.slice(source.indexOf('export function calculateMissionQuality('),source.indexOf('/* ── Continuous Validation Loop'));
const report=source.slice(source.indexOf('export function buildImprovementPrompt('));
const context=vm.createContext({});
vm.runInContext((score+'\n'+report).replaceAll('export function','function'),context);
const cases=[
 {name:'A meaningful coverage',status:'completed',actions:8,covered:['login']},
 {name:'B zero execution',status:'created',actions:0,covered:[]},
 {name:'C blocked execution',status:'failed',actions:0,failureReason:'target blocked'},
 {name:'D provider failure',status:'failed',actions:0,failureReason:'provider connection failed'}
];
const results=cases.map(input=>{
 context.input=input;
 const q=vm.runInContext('calculateMissionQuality([],input)',context);
 const r=vm.runInContext('buildImprovementPrompt(input,[])',context);
 return {scenario:input.name,executionStatus:input.status,actions:input.actions,score:q.score,verdict:q.verdict,releaseReady:q.releaseReady,confidence:q.confidence,reportVerdict:r.verdict,reportRegressionReady:r.regressionReady};
});
writeFileSync(new URL('../artifacts/pre-demo-validation/zero-coverage.json',import.meta.url),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
