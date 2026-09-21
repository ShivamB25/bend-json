import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ROOT} from '../scripts/tools.mjs';
import {propertyLimits,Null,BooleanValue,NumberValue,Text,ArrayValue,ObjectValue,done,failure,assertResult,assertAst,codepoints} from './support.mjs';
import {xorshift,commonGenerated,whitespace,escapedScalars} from './properties.mjs';
export const mutationSeed=0x8259F00D;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function* mutationFixtures() {
  const rng=xorshift(mutationSeed),origins=[...commonGenerated()];
  for(let i=0;i<2048;i++) {
    const origin=origins[rng()%origins.length],group=i%8;let text,kind,value;
    // Draw order is origin index, then the branch's index/character draws. All mutations are original.
    if(group===0){text=`[${rng()%100},,${rng()%100}]`;kind='invalid';}
    else if(group===1){text='"a\\q'+String(rng()%100)+'"';kind='invalid';}
    else if(group===2){text='"a'+String.fromCharCode(rng()%32)+'b"';kind='invalid';}
    else if(group===3){text=['01','1e+','1.','--1'][rng()%4];kind='invalid';}
    else if(group===4){text=whitespace(origin.text);kind='equivalent';value=origin.value;}
    else if(group===5){text=escapedScalars(origin.text);kind='equivalent';value=origin.value;}
    else {
      const chars=[...origin.text],operation=rng()%3,index=rng()%(chars.length+1);
      if(operation===0)chars.splice(index,1);
      else if(operation===1)chars.splice(index,0,['[',']','{','}',',',':','"','\\','0','-','a',' ','\n','😀'][rng()%14]);
      else chars.length=index;
      text=chars.join('');kind='unconstrained';
    }
    assert.ok(codepoints(text)<=65536);
    yield {id:`mutation/${i.toString().padStart(4,'0')}`,text,limits:propertyLimits,kind,value,origin:origin.id,seed:mutationSeed,hash:hash(text)};
  }
}
export function commonScalar(text) {
  const trimmed=text.trim();
  if(/^(?:null|true|false|-?(?:0|[1-9][0-9]*))$/.test(trimmed)) {
    const host=JSON.parse(trimmed);
    if(typeof host==='number'&&(!Number.isSafeInteger(host)||Object.is(host,-0)))return undefined;
    return {value:host===null?Null():typeof host==='boolean'?BooleanValue(host):NumberValue(String(host))};
  }
  // A scalar string has no duplicate-key/numeric normalization ambiguity.
  if(trimmed.startsWith('"'))try{const s=JSON.parse(trimmed);if(typeof s==='string'&&![...s].some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;}))return {value:Text(s)};}catch{}
  return undefined;
}
export function exerciseMutation(Core,item,text=item.text) {
  const result=assertResult(Core['Json.parse'](text,item.limits));
  if(item.kind==='invalid'){failure(result,item.code);return;}
  if(item.kind==='equivalent'){assertAst(done(result),item.value);return;}
  const oracle=commonScalar(text);
  if(oracle)assertAst(done(result),oracle.value);
  if(result.$==='Done'){
    const encoded=done(Core['Json.encode'](result.value,item.limits));
    assertAst(done(Core['Json.parse'](encoded,item.limits)),result.value);
  }
}
export function admissible(item,text) {
  if(item.kind==='unconstrained')return true;
  if(item.kind==='invalid'){try{JSON.parse(text);return false;}catch{return true;}}
  try{assert.deepEqual(JSON.parse(text),JSON.parse(item.text));return true;}catch{return false;}
}
export function retainMutationInput(item,backend=process.versions.bun?'bun':'node') {
  const dir=resolve(ROOT,'artifacts/mutations');mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,backend+'-pending.json'),JSON.stringify({state:'prepared',backend,id:item.id,seed:item.seed,origin:item.origin,kind:item.kind,sha256:item.hash,text:item.text},null,2)+'\n');
}
export function retainMutationFailure(item,error,minimized,backend=process.versions.bun?'bun':'node') {
  const dir=resolve(ROOT,'artifacts/mutations');mkdirSync(dir,{recursive:true});
  const record={id:item.id,seed:item.seed,origin:item.origin,kind:item.kind,sha256:item.hash,text:item.text,error:String(error?.stack||error),minimized};
  writeFileSync(resolve(dir,backend+'-'+item.id.replace('/','-')+'.json'),JSON.stringify({...record,backend},null,2)+'\n');
}
export function* cases() {
  for(const item of mutationFixtures())yield {id:item.id,prepare(){retainMutationInput(item);},run(Core){try{exerciseMutation(Core,item);}catch(error){retainMutationFailure(item,error);throw error;}}};
  yield {id:'mutation-bytes/strict-decoding',run(){
    const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),valid=Buffer.from('"é😀"');
    for(let i=0;i<valid.length;i++){const changed=Buffer.from(valid);changed[i]=0xff;assert.throws(()=>decode(changed));}
    assert.equal(decode(Buffer.from([0xef,0xbb,0xbf,...Buffer.from('{}')])),'\ufeff{}');
  }};
}
