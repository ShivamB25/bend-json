import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {ROOT,CORPUS_PIN,CORPUS_TREE} from '../scripts/tools.mjs';
import {corpusLimits,limits,strictDecode,done,failure,assertAst} from './support.mjs';
const base=resolve(ROOT,'tests/fixtures/JSONTestSuite');
const resource=new Set(['PInputLimit','PDepthLimit','PNumberLimit','PStringLimit','PValueLimit']);
const profile=new Set(['PUnpairedSurrogate','PInvalidScalar','PLeadingBom']);
let cached;
export function corpusEntries() {
  if(cached)return cached;
  const manifest=JSON.parse(readFileSync(resolve(base,'manifest.json'),'utf8'));
  assert.equal(manifest.revision,CORPUS_PIN);assert.equal(manifest.tree,CORPUS_TREE);assert.equal(manifest.fixtures.length,318);
  assert.equal(new Set(manifest.fixtures.map(x=>x.name)).size,318);
  assert.deepEqual(readdirSync(resolve(base,'test_parsing')).sort(),manifest.fixtures.map(x=>x.name).sort());
  const license=readFileSync(resolve(base,'LICENSE'));assert.equal(createHash('sha256').update(license).digest('hex'),manifest.licenseSha256);assert.match(license.toString(),/Copyright \(c\) 2016 Nicolas Seriot/);
  const counts={y:0,n:0,i:0},excluded={y:0,n:0,i:0};let boms=0;
  cached=manifest.fixtures.map(entry=>{
    assert.ok(/^[yni]_[^/]+\.json$/.test(entry.name));assert.equal(entry.class,entry.name[0]);counts[entry.class]++;
    const bytes=readFileSync(resolve(base,'test_parsing',entry.name));assert.equal(bytes.length,entry.bytes);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),entry.gitBlob);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    let text;try{text=strictDecode(bytes);}catch(error){assert.ok(error instanceof TypeError);}
    assert.equal(text!==undefined,entry.strictUtf8);assert.equal(text?.startsWith('\ufeff')||false,entry.leadingBom);
    if(text===undefined)excluded[entry.class]++;if(entry.leadingBom)boms++;
    const expected=text===undefined?'byte-excluded':entry.class==='y'?'accept':entry.class==='n'?'reject':entry.name.startsWith('i_number_')||entry.name==='i_structure_500_nested_arrays.json'?'accept':entry.name==='i_structure_UTF-8_BOM_empty_object.json'?'bom-reject':'surrogate-reject';
    assert.equal(entry.expected,expected);
    return {...entry,id:`corpus/${entry.name}`,text,limits:corpusLimits,expected};
  });
  assert.deepEqual(counts,{y:95,n:188,i:35});assert.deepEqual(excluded,{y:0,n:12,i:13});assert.equal(boms,2);
  assert.equal(cached.filter(x=>x.class==='i'&&x.expected==='accept').length,11);
  assert.equal(cached.filter(x=>x.class==='i'&&x.expected==='surrogate-reject').length,10);
  return cached;
}
export function* cases() {
  for(const entry of corpusEntries())yield {id:entry.id,run(Core){
    if(entry.expected==='byte-excluded')return {fixture:entry.name,class:entry.class,classification:'byte-excluded'};
    const result=Core['Json.parse'](entry.text,entry.limits);
    if(entry.expected==='accept'){
      const value=done(result);const encoded=done(Core['Json.encode'](value,entry.limits));assertAst(done(Core['Json.parse'](encoded,entry.limits)),value);
      return {fixture:entry.name,class:entry.class,classification:'accept'};
    }
    const error=failure(result);
    if(entry.expected==='bom-reject'){assert.equal(error.code.$,'PLeadingBom');assert.equal(error.offset,0n);}
    if(entry.expected==='surrogate-reject')assert.equal(error.code.$,'PUnpairedSurrogate');
    return {fixture:entry.name,class:entry.class,classification:resource.has(error.code.$)?'resource-reject':profile.has(error.code.$)?'profile-reject':'syntax-reject',code:error.code.$,offset:String(error.offset)};
  }};
  yield {id:'corpus-policy/default-depth-500',run(Core){const entry=corpusEntries().find(x=>x.name==='i_structure_500_nested_arrays.json');assert.ok(entry);failure(Core['Json.parse'](entry.text,limits()),'PDepthLimit',128);}};
}
