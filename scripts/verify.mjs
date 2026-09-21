import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,COMPILER,BUN,NODE,ENV,versions,artifacts} from './tools.mjs';
import {inventory,proofChecks,proofSelftest} from './proof-gate.mjs';
import {corpusEntries} from '../tests/conformance.mjs';

export function writeReport(path,report) {
  writeFileSync(path,JSON.stringify(report,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');
}

function issue(category,message,detail={}) { const error=new Error(message);error.category=category;Object.assign(error,detail);return error; }
export function rss(pid) {
  if(process.platform==='linux') {const text=readFileSync(`/proc/${pid}/status`,'utf8');const match=/^VmRSS:\s+(\d+) kB$/m.exec(text);if(match)return Number(match[1])*1024;}
  if(process.platform==='darwin') {const result=spawnSync('/bin/ps',['-o','rss=','-p',String(pid)],{encoding:'utf8',timeout:1000});if(!result.error&&result.status===0&&/^\s*\d+\s*$/.test(result.stdout))return Number(result.stdout)*1024;}
  return undefined;
}
export function supervise(command,args,{label='worker',startupMs=120000,caseMs=5000,campaignMs=600000,memory=true}={}) {
  return new Promise((resolvePromise,rejectPromise)=>{
    const child=spawn(command,args,{cwd:ROOT,env:ENV,stdio:['ignore','pipe','pipe']});
    const report={label,command,args,stdout:'',stderr:'',events:[],status:null,signal:null,memory:{method:'supervisor RSS samples every 250ms; ceiling enforced only during mutation cases',limit:512*1024*1024,samples:0,rssPeak:0,observedAllCaseRssPeak:0,startup:{samples:0,rssPeak:0,scope:'compiler/loader before first case; not subject to mutation ceiling'},enforcement:'unverified'}};
    let pending=null,summary=null,lineBuffer='',protocolError=null,timer,mutationTimer,mutationActive=false,settled=false,bytes=0,monitor;
    const ids=new Set();let passed=0,failed=0;
    const stop=(category,message)=>{if(!protocolError){protocolError=issue(category,`${label}: ${message}`);child.kill('SIGKILL');}};
    const arm=(ms,category,message)=>{clearTimeout(timer);timer=setTimeout(()=>stop(category,message),ms);};
    arm(startupMs,'worker-startup-timeout','compiler/loader startup exceeded deadline');
    if(memory)monitor=setInterval(()=>{if(settled)return;try{const size=rss(child.pid);if(size!==undefined){if(ids.size===0){report.memory.startup.samples++;report.memory.startup.rssPeak=Math.max(report.memory.startup.rssPeak,size);}if(pending){report.memory.observedAllCaseRssPeak=Math.max(report.memory.observedAllCaseRssPeak,size);if(pending.startsWith('mutation/')){report.memory.enforcement='sampled';report.memory.samples++;report.memory.rssPeak=Math.max(report.memory.rssPeak,size);if(size>report.memory.limit)stop('worker-memory',`Mutation campaign RSS ${size} exceeds ${report.memory.limit}`);}}}}catch{/* Process exit and unsupported OS are recorded as unverified, never fabricated. */}},250);
    const consume=line=>{
      if(protocolError)return;
      let event;try{event=JSON.parse(line);}catch{stop('worker-protocol','non-JSON stdout line');return;}
      if(!event||typeof event!=='object'||summary){stop('worker-protocol','invalid event or data after summary');return;}
      if(event.event==='start'){
        if(pending||typeof event.id!=='string'||!event.id||ids.has(event.id)){stop('worker-protocol','overlapping/duplicate/malformed start');return;}
        ids.add(event.id);pending=event.id;arm(caseMs,'worker-case-timeout',`case ${pending} exceeded ${caseMs}ms`);
        if(event.id.startsWith('mutation/')&&!mutationActive){mutationActive=true;mutationTimer=setTimeout(()=>stop('worker-campaign-timeout','mutation campaign exceeded ten-minute deadline'),campaignMs);}
        if(mutationActive&&!event.id.startsWith('mutation/')){clearTimeout(mutationTimer);mutationTimer=undefined;}
      }else if(event.event==='result'){
        if(event.id!==pending||!pending||!['pass','fail'].includes(event.status)){stop('worker-protocol','unmatched or malformed result');return;}
        event.status==='pass'?passed++:failed++;pending=null;arm(caseMs,'worker-case-timeout','worker stalled between cases');
      }else if(event.event==='summary'){
        if(pending||!Number.isSafeInteger(event.passed)||!Number.isSafeInteger(event.failed)||event.passed!==passed||event.failed!==failed||ids.size!==passed+failed){stop('worker-protocol','summary does not reconcile case events');return;}
        summary=event;clearTimeout(mutationTimer);arm(caseMs,'worker-exit-timeout','worker did not exit after summary');
      }else{stop('worker-protocol',`unknown event ${event.event}`);return;}
      report.events.push(event);
    };
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>16*1024*1024){stop('worker-output','stdout cap exceeded');return;}report.stdout+=chunk;lineBuffer+=chunk;let index;while((index=lineBuffer.indexOf('\n'))>=0){const line=lineBuffer.slice(0,index).replace(/\r$/,'');lineBuffer=lineBuffer.slice(index+1);consume(line);}});
    child.stderr.on('data',chunk=>{if(Buffer.byteLength(report.stderr)+Buffer.byteLength(chunk)>1024*1024){stop('worker-output','stderr cap exceeded');return;}report.stderr+=chunk;});
    child.on('error',error=>{protocolError ||= issue('worker-spawn',String(error));});
    child.on('close',(status,signal)=>{
      settled=true;clearTimeout(timer);clearTimeout(mutationTimer);clearInterval(monitor);report.status=status;report.signal=signal;
      if(lineBuffer&&!protocolError)protocolError=issue('worker-protocol',`${label}: unterminated stdout event`);
      if(!summary&&!protocolError)protocolError=issue('worker-protocol',`${label}: missing summary; pending=${pending}`);
      if(!protocolError&&failed)protocolError=issue('worker-failures',`${label}: ${failed} behavioral failures`);
      if(!protocolError&&(status!==0||signal))protocolError=issue('worker-exit',`${label}: exit=${status} signal=${signal}`);
      report.summary=summary;
      if(protocolError){protocolError.report=report;rejectPromise(protocolError);}else resolvePromise(report);
    });
  });
}
export async function supervisorSelftest() {
  const out=[];
  const failureScript=`const fs=require('node:fs');for(const x of [{event:'start',id:'intentional-failure'},{event:'result',id:'intentional-failure',status:'fail',message:'intentional'},{event:'summary',passed:0,failed:1}])fs.writeSync(1,JSON.stringify(x)+'\\n');process.exitCode=1;`;
  try{await supervise(NODE,['-e',failureScript],{label:'selfcheck-failure',memory:false});throw new Error('Failing child was accepted');}catch(error){assert.equal(error.category,'worker-failures');assert.equal(error.report.status,1);assert.equal(error.report.signal,null);out.push({control:'failing-child',rejected:true,category:error.category,report:error.report});}
  const timeoutScript=`require('node:fs').writeSync(1,JSON.stringify({event:'start',id:'intentional-timeout'})+'\\n');setTimeout(()=>{},10000);`;
  try{await supervise(NODE,['-e',timeoutScript],{label:'selfcheck-timeout',caseMs:50,memory:false});throw new Error('Timed-out child was accepted');}catch(error){assert.equal(error.category,'worker-case-timeout');assert.equal(error.report.signal,'SIGKILL');assert.equal(error.report.summary,null);out.push({control:'timed-out-child',rejected:true,category:error.category,report:error.report});}
  const {failureEvidenceSelftest}=await import('./supervisor-controls.mjs');
  out.push(...await failureEvidenceSelftest());
  return out;
}
function corpusAccounting(worker,category) {
  const results=new Map(worker.events.filter(x=>x.event==='result').map(x=>[x.id,x]));
  const started=new Set(worker.events.filter(x=>x.event==='start').map(x=>x.id));
  return corpusEntries().map(entry=>{
    const result=results.get(entry.id);
    if(result?.status==='pass')return {name:entry.name,...result.detail};
    if(result)return {name:entry.name,class:entry.class,classification:'harness-failure',message:result.message};
    if(entry.expected==='byte-excluded')return {name:entry.name,class:entry.class,classification:'byte-excluded'};
    return {name:entry.name,class:entry.class,classification:started.has(entry.id)?String(category).includes('timeout')?'timeout':'crash':'unattempted'};
  });
}
function corpusReport(worker) {
  const entries=worker.events.filter(x=>x.event==='result'&&x.id.startsWith('corpus/'));
  assert.equal(entries.length,318);assert.equal(new Set(entries.map(x=>x.id)).size,318);
  const counts={inventory:318,attempted:0,byteExcluded:0,accept:0,syntaxReject:0,profileReject:0,resourceReject:0,yAccepted:0};
  for(const event of entries){assert.equal(event.status,'pass');const detail=event.detail;assert.ok(detail);if(detail.classification==='byte-excluded')counts.byteExcluded++;else{counts.attempted++;if(detail.classification==='accept'){counts.accept++;if(detail.class==='y')counts.yAccepted++;}else if(detail.classification==='syntax-reject')counts.syntaxReject++;else if(detail.classification==='profile-reject')counts.profileReject++;else if(detail.classification==='resource-reject')counts.resourceReject++;else assert.fail(`Unknown corpus classification ${detail.classification}`);}}
  assert.equal(counts.byteExcluded,25);assert.equal(counts.attempted,293);assert.equal(counts.yAccepted,95);return counts;
}
export async function verifyHostWorker(command,args,options={}) {
  let worker;
  try{
    worker=await supervise(command,args,options);
    // Keep runtime warnings visible; never suppress Node loader deprecations.
    if(worker.stderr)process.stderr.write(worker.stderr);
    const corpus=corpusReport(worker),results=worker.events.filter(x=>x.event==='result');
    assert.equal(results.filter(x=>x.id.startsWith('generated/')).length,3000);
    assert.equal(results.filter(x=>x.id.startsWith('mutation/')).length,2048);
    assert.equal(worker.summary.memory.campaign.samples,2048);
    assert.equal(results.length,6071);
    return {route:'real-preloaded-import',corpus,accounting:corpusAccounting(worker),worker};
  }catch(error){
    error.category ||= 'host-reconciliation';
    const evidence=error.report||worker;
    if(evidence){evidence.corpusAccounting=corpusAccounting(evidence,error.category);error.report=evidence;if(!worker&&evidence.stderr)process.stderr.write(evidence.stderr);}
    throw error;
  }
}
export async function verify(args=process.argv.slice(2)) {
  const allowed=new Set(['--proofs','--proof-gate-selftest','--native=required']);
  for(const arg of args)if(!allowed.has(arg))throw new Error(`Unknown argument ${arg}`);
  if(args.includes('--proofs')&&args.includes('--proof-gate-selftest'))throw new Error('Choose only one restricted proof mode');
  artifacts();const report={started:new Date().toISOString(),gates:[],versions:versions(),status:'running'};
  const target=resolve(ROOT,args.includes('--proofs')?'artifacts/proofs.json':args.includes('--proof-gate-selftest')?'artifacts/proof-gate-selftest.json':'artifacts/verification.json');
  const gate=async(name,fn)=>{try{const evidence=await fn();const status=evidence?.status==='unverified'?'unverified':'pass';report.gates.push({name,status,evidence});console.log(`${name}: ${status.toUpperCase()}`);}catch(error){report.gates.push({name,status:'fail',category:error.category||'failure',message:String(error.stack||error),evidence:error.report||error.reports||error.result,directory:error.directory});console.error(`${name}: FAIL\n${error.stack||error}`);}writeReport(target,report);};
  if(!args.includes('--proof-gate-selftest'))await gate('proofs',()=>({inventory:inventory(),checks:proofChecks()}));
  if(!args.includes('--proofs'))await gate('proof-gate-selftest',proofSelftest);
  if(!args.includes('--proofs')&&!args.includes('--proof-gate-selftest')){
    await gate('supervisor-selftest',supervisorSelftest);
    const entry=resolve(ROOT,'tests/host.mjs');
    for(const [name,command,prefix] of [['node',NODE,['--import',COMPILER]],['bun',BUN,['--no-install','--preload',COMPILER]]])await gate(`host-${name}`,async()=>{
      try{
        return await verifyHostWorker(command,[...prefix,entry],{label:`${name}:real-preloaded-import`});
      }catch(error){
        if(error.report){
          try{const {recoverMutationFailures}=await import('./mutation-recovery.mjs');error.report.mutationRecovery=await recoverMutationFailures(error,{backend:name,command,prefix,entry});}
          catch(recoveryError){error.report.mutationRecoveryError=String(recoveryError.stack||recoveryError);}
        }
        throw error;
      }
    });
    await gate('native',async()=>{const {nativeVerify}=await import('./native.mjs');return nativeVerify({required:args.includes('--native=required')});});
  }
  report.finished=new Date().toISOString();report.status=report.gates.some(x=>x.status==='fail')?'fail':'pass';writeReport(target,report);
  if(report.status==='fail')throw issue('verification-failed',`Verification failed; evidence: ${target}`,{report});
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))verify().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
