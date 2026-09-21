import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,COMPILER,NODE,artifacts} from './tools.mjs';
import {supervise,verifyHostWorker,writeReport} from './verify.mjs';
import {recoverMutationFailures} from './mutation-recovery.mjs';
import {mutationFixtures} from '../tests/mutations.mjs';

export async function failureEvidenceSelftest() {
  artifacts();
  const mutationDirectory=resolve(ROOT,'artifacts/mutations');
  mkdirSync(mutationDirectory,{recursive:true});
  const directory=mkdtempSync(resolve(mutationDirectory,'supervisor-selftest-'));
  const reports=[];
  try {
    const zeroScript=`require('node:fs').writeSync(1,JSON.stringify({event:'summary',passed:0,failed:0})+'\\n');`;
    let incomplete;
    try{await verifyHostWorker(NODE,['-e',zeroScript],{label:'control-clean-incomplete-worker',startupMs:5000,caseMs:50,campaignMs:5000,memory:false});}
    catch(error){incomplete=error;}
    assert.ok(incomplete,'An empty clean-exit lane must not satisfy host acceptance');
    assert.equal(incomplete.category,'host-reconciliation');
    const accountingFile=resolve(directory,'incomplete-worker-report.json');
    writeReport(accountingFile,{name:'control-clean-incomplete-worker',status:'fail',evidence:incomplete.report});
    const saved=JSON.parse(readFileSync(accountingFile,'utf8')).evidence;
    assert.equal(saved.status,0);assert.equal(saved.signal,null);
    assert.deepEqual(saved.summary,{event:'summary',passed:0,failed:0});
    assert.equal(saved.corpusAccounting.length,318);
    assert.equal(new Set(saved.corpusAccounting.map(x=>x.name)).size,318);
    assert.equal(saved.corpusAccounting.filter(x=>x.classification==='unattempted').length,293);
    assert.equal(saved.corpusAccounting.filter(x=>x.classification==='byte-excluded').length,25);
    reports.push({control:'clean-incomplete-worker-retains-full-corpus-accounting',rejected:true,category:incomplete.category,evidence:saved,unattempted:293,byteExcluded:25});

    // A real assertion failure carries nested BigInts in its actual/expected
    // diagnostics. Persist it through the canonical writer, not a test serializer.
    let numericFailure;
    try{assert.deepEqual({offsets:[0n,9007199254740993n]},{offsets:[0n,9007199254740992n]});}
    catch(error){numericFailure=error;}
    assert.equal(numericFailure?.code,'ERR_ASSERTION');
    const numericFile=resolve(directory,'bigint-failure-report.json');
    writeReport(numericFile,{status:'fail',category:numericFailure.code,evidence:numericFailure});
    const numericSaved=JSON.parse(readFileSync(numericFile,'utf8'));
    assert.equal(numericSaved.status,'fail');assert.equal(numericSaved.category,'ERR_ASSERTION');
    assert.deepEqual(numericSaved.evidence.actual,{offsets:['0','9007199254740993']});
    assert.deepEqual(numericSaved.evidence.expected,{offsets:['0','9007199254740992']});
    reports.push({control:'nested-bigint-failure-evidence-persists-exact-decimals',rejected:true,evidence:numericSaved});

    const item=mutationFixtures().next().value;
    // Retention helpers resolve the backend beneath artifacts/mutations. Use a
    // unique local namespace so the real recovery path cannot replace diagnostics.
    const backend=`${basename(directory)}/control`;
    const pending=resolve(mutationDirectory,backend+'-pending.json');
    const retained=resolve(mutationDirectory,backend+'-'+item.id.replace('/','-')+'.json');
    const observed=resolve(directory,'retention-observed-before-replay.jsonl');
    const fixture=resolve(directory,'deliberate-hang.mjs');
    // This child never imports or modifies the production Bend API. During replay
    // it verifies the original artifact exists BEFORE deliberately not returning.
    writeFileSync(fixture,`import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeSync} from 'node:fs';
import {mutationFixtures,admissible,retainMutationInput} from ${JSON.stringify(pathToFileURL(resolve(ROOT,'tests/mutations.mjs')).href)};
const item=mutationFixtures().next().value;
if(process.argv[2]==='--mutation-replay'){
  assert.equal(process.argv[3],item.id);
  const saved=JSON.parse(readFileSync(${JSON.stringify(retained)},'utf8'));
  assert.equal(saved.text,item.text);assert.equal(saved.seed,item.seed);assert.equal(saved.origin,item.origin);assert.equal(saved.sha256,item.hash);
  const candidate=readFileSync(process.argv[4],'utf8');assert.ok(admissible(item,candidate));
  assert.ok(['replaying-original','shrinking'].includes(saved.minimized.status));
  appendFileSync(${JSON.stringify(observed)},JSON.stringify({id:item.id,originalSha256:saved.sha256,candidate,checkpoint:saved.minimized.status,completedAttempts:saved.minimized.attempts.length,retainedBeforeReplay:true})+'\\n');
}else{retainMutationInput(item,${JSON.stringify(backend)});}
writeSync(1,JSON.stringify({event:'start',id:item.id})+'\\n');
setTimeout(()=>{},60000);
`);
    let timeout;
    try{await supervise(NODE,['--import',COMPILER,fixture],{label:'control-mutation-original-hang',startupMs:5000,caseMs:50,campaignMs:5000,memory:false});}
    catch(error){timeout=error;}
    assert.ok(timeout,'The deliberately hung mutation must be terminated');
    assert.equal(timeout.category,'worker-case-timeout');assert.equal(timeout.report.signal,'SIGKILL');
    assert.equal(timeout.report.status,null);assert.equal(timeout.report.summary,null);
    assert.deepEqual(timeout.report.events,[{event:'start',id:item.id}]);
    const prepared=JSON.parse(readFileSync(pending,'utf8'));
    assert.equal(prepared.id,item.id);assert.equal(prepared.text,item.text);assert.equal(prepared.seed,item.seed);assert.equal(prepared.origin,item.origin);assert.equal(prepared.sha256,item.hash);
    const recovery=await recoverMutationFailures(timeout,{backend,command:NODE,prefix:['--import',COMPILER],entry:fixture,startupMs:5000,caseMs:50,campaignMs:5000,maxAttempts:1});
    assert.equal(recovery.length,1);assert.equal(recovery[0].status,'attempt-limit');
    assert.equal(recovery[0].attempts.length,2);
    for(const attempt of recovery[0].attempts){assert.equal(attempt.status,'matching-failure');assert.equal(attempt.category,'worker-case-timeout');assert.equal(attempt.signal,'SIGKILL');}
    const preserved=JSON.parse(readFileSync(retained,'utf8'));
    assert.equal(preserved.text,item.text);assert.equal(preserved.seed,item.seed);assert.equal(preserved.origin,item.origin);assert.equal(preserved.sha256,item.hash);
    assert.ok(preserved.minimized.text.length<item.text.length,'The guarded candidate must actually shrink the fixture');
    const observations=readFileSync(observed,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
    assert.equal(observations.length,2);
    for(const observation of observations){assert.equal(observation.retainedBeforeReplay,true);assert.equal(observation.originalSha256,item.hash);}
    assert.deepEqual(observations.map(x=>x.checkpoint),['replaying-original','shrinking']);
    assert.deepEqual(observations.map(x=>x.completedAttempts),[0,1]);
    assert.equal(observations[0].candidate,item.text);
    assert.equal(observations[1].candidate,recovery[0].text);
    assert.deepEqual(preserved.minimized,recovery[0]);
    reports.push({control:'hung-mutation-retains-original-and-guards-shrinking',rejected:true,category:timeout.category,worker:timeout.report,prepared,retained:preserved,retentionObservations:observations,recovery,deadlines:{startupMs:5000,caseMs:50,campaignMs:5000},maxReductionAttempts:1});
    // Return the durable evidence by value for verify.mjs's report, then remove
    // only this successful control's files. Failed controls keep their directory.
    rmSync(directory,{recursive:true});
    for(const report of reports)report.temporaryArtifactsRemoved=true;
    return reports;
  }catch(error){error.directory=directory;throw error;}
}
