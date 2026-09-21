import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {ROOT} from './tools.mjs';
import {supervise} from './verify.mjs';
import {mutationFixtures,admissible,retainMutationFailure} from '../tests/mutations.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
function matchingFailure(original,observed) {
  const expectedMemory=original.category==='worker-memory'||original.message.includes('RSS limit exceeded');
  if(expectedMemory)return observed.category==='worker-memory'||observed.report?.events.some(event=>event.event==='result'&&event.status==='fail'&&event.message?.includes('RSS limit exceeded'));
  if(original.category==='worker-case-timeout')return observed.category==='worker-case-timeout';
  if(original.category==='worker-protocol'||original.category==='worker-exit')return observed.category===original.category&&observed.report?.signal===original.signal&&observed.report?.status===original.status;
  return observed.category==='worker-failures';
}
export async function recoverMutationFailures(error,{backend,command,prefix=[],entry,caseMs=5000,campaignMs=600000,startupMs=120000,maxAttempts=64}) {
  const worker=error.report;
  if(!worker?.events)return [];
  const completed=new Set(),failed=new Map();
  for(const event of worker.events)if(event.event==='result'){
    completed.add(event.id);
    if(event.status==='fail'&&event.id.startsWith('mutation/'))failed.set(event.id,{category:'worker-failures',message:event.message||'Mutation mismatch',signal:worker.signal,status:worker.status});
  }
  for(const event of worker.events)if(event.event==='start'&&event.id.startsWith('mutation/')&&!completed.has(event.id))failed.set(event.id,{category:error.category,message:error.message,signal:worker.signal,status:worker.status});
  if(failed.size===0)return [];
  const items=[];
  // Persist every original before attempting even one replay. A killed shrinking
  // process can never destroy the only copy of seed/origin/hash/source.
  for(const item of mutationFixtures())if(failed.has(item.id)){
    const cause=failed.get(item.id);retainMutationFailure(item,cause.message,{status:'pending-supervised-recovery'},backend);items.push(item);
  }
  const reports=[],deadline=Date.now()+campaignMs;
  for(const item of items){
    const original=failed.get(item.id),attempts=[];
    let text=item.text,status='retained',width=Math.floor([...text].length/2);
    const candidatePath=resolve(ROOT,'artifacts/mutations',`${backend}-${item.id.replace('/','-')}-candidate.json`);
    const checkpoint=()=>{
      const result={id:item.id,status,text,sha256:hash(text),attempts};
      retainMutationFailure(item,original.message,result,backend);
      return result;
    };
    const fails=async candidate=>{
      if(Date.now()>=deadline)return false;
      writeFileSync(candidatePath,candidate);
      try{
        await supervise(command,[...prefix,entry,'--mutation-replay',item.id,candidatePath],{label:`${backend}:shrink:${item.id}`,startupMs,caseMs,campaignMs:Math.max(1,deadline-Date.now())});
        attempts.push({sha256:hash(candidate),codepoints:[...candidate].length,status:'pass'});return false;
      }catch(observed){
        const reproduced=matchingFailure(original,observed);
        attempts.push({sha256:hash(candidate),codepoints:[...candidate].length,status:reproduced?'matching-failure':'different-failure',category:observed.category,exit:observed.report?.status,signal:observed.report?.signal,message:observed.message});
        return reproduced;
      }
    };
    if(Date.now()>=deadline){status='recovery-deadline';reports.push(checkpoint());continue;}
    status='replaying-original';checkpoint();
    if(!await fails(text)){status=Date.now()>=deadline?'recovery-deadline':'not-reproduced';reports.push(checkpoint());continue;}
    status='shrinking';checkpoint();
    while(width>0&&attempts.length<maxAttempts+1&&Date.now()<deadline){
      const chars=[...text];let reduced=false;
      for(let at=0;at+width<=chars.length&&attempts.length<maxAttempts+1&&Date.now()<deadline;at+=width){
        const candidate=chars.slice(0,at).concat(chars.slice(at+width)).join('');
        if(admissible(item,candidate)&&await fails(candidate)){text=candidate;reduced=true;checkpoint();break;}
      }
      if(!reduced)width=Math.floor(width/2);
    }
    status=Date.now()>=deadline?'recovery-deadline':width>0&&attempts.length>=maxAttempts+1?'attempt-limit':'minimized';reports.push(checkpoint());
  }
  return reports;
}
