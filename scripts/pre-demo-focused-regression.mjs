// Run live contract tests only against a disposable, required-auth server.
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'qase-focused-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const base='http://127.0.0.1:'+port;
const env={...process.env,QASE_DATA_DIR:dir,PORT:String(port),QASE_AUTH_MODE:'required',QASE_API_TOKEN:'disposable-regression-token',QASE_INTEGRATION_SECRET:randomBytes(32).toString('hex'),QASE_API_KEY:'test-only',QASE_PROVIDER:'custom',QASE_MODEL:'dummy',QASE_BASE_URL:'http://127.0.0.1:1/v1'};
const server=spawn(process.execPath,[join(root,'server/index.js')],{cwd:dir,env,stdio:'ignore',windowsHide:true});
try {
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(150);}if(!ready)throw Error('Isolated server failed to start');
 const tests=['tests-real/b1-integration-auth.test.js','tests-real/api-contract/contract-baseline.test.js','tests-real/user-auth.test.js'];
 // Serial files prevent the user-auth role tests from racing each other.
 const runner=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=spec',...tests.map(p=>join(root,p))],{cwd:root,env:{...env,QASE_URL:base,QASE_TEST_BASE_URL:base,QASE_BASE_URL:base},stdio:'inherit',windowsHide:true});
 process.exitCode=await new Promise(r=>runner.on('exit',r));
} finally {server.kill();await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true,maxRetries:3});}
