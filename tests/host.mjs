import {readFileSync,writeSync} from 'node:fs';
import Core from '../json.bend';
import * as regressions from './regressions.mjs';
import * as conformance from './conformance.mjs';
import * as properties from './properties.mjs';
import * as mutations from './mutations.mjs';

const emit=event=>writeSync(1,JSON.stringify(event)+'\n');
function* replayCases() {
  if(chosen.length!==3)throw new Error('Mutation replay requires case ID and candidate file');
  let item;for(const candidate of mutations.mutationFixtures())if(candidate.id===chosen[1]){item=candidate;break;}
  if(!item)throw new Error(`Unknown replay mutation ${chosen[1]}`);
  const text=readFileSync(chosen[2],'utf8');
  if(!mutations.admissible(item,text))throw new Error('Shrinking candidate left the original expectation domain');
  yield {id:item.id,run(Core){mutations.exerciseMutation(Core,item,text);}};
}
const suites={regressions,conformance,properties,mutations,'mutation-replay':{cases:replayCases}};
const chosen=process.argv.slice(2);
const names=chosen[0]==='--mutation-replay'?['mutation-replay']:chosen.length?chosen:Object.keys(suites).filter(name=>name!=='mutation-replay');
let passed=0,failed=0,rssPeak=0,memorySamples=0,campaignRssPeak=0,campaignSamples=0;
const seen=new Set();
const startupMemory={route:'real-preloaded-import',afterImport:process.memoryUsage(),scope:'compiler/import RSS reported separately; no explicit collection or baseline subtraction'};
let first=true;
for(const name of names){
  if(!Object.hasOwn(suites,name))throw new Error(`Unknown suite ${name}`);
  for(const item of suites[name].cases()){
    if(seen.has(item.id))throw new Error(`Duplicate case ID ${item.id}`);seen.add(item.id);
    if(item.prepare)item.prepare();
    emit({event:'start',id:item.id,...(first?{startupMemory}:{})});first=false;
    try{
      const detail=item.run(Core);
      if(detail&&typeof detail.then==='function')throw new Error('Cases must be finite synchronous API calls');
      const rss=process.memoryUsage().rss;memorySamples++;rssPeak=Math.max(rssPeak,rss);
      if(item.id.startsWith('mutation/')){campaignSamples++;campaignRssPeak=Math.max(campaignRssPeak,rss);if(rss>512*1024*1024)throw new Error(`Mutation campaign RSS limit exceeded: ${rss}`);}
      passed++;emit({event:'result',id:item.id,status:'pass',...(detail===undefined?{}:{detail})});
    }catch(error){failed++;emit({event:'result',id:item.id,status:'fail',message:String(error?.stack||error).slice(0,8192)});}
  }
}
emit({event:'summary',passed,failed,memory:{method:'process.memoryUsage().rss after each case',startup:startupMemory,allCases:{samples:memorySamples,rssPeak},campaign:{samples:campaignSamples,rssPeak:campaignRssPeak,limit:512*1024*1024,scope:'2048 deterministic mutation cases only'}}});
if(failed)process.exitCode=1;
