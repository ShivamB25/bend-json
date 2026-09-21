import assert from 'node:assert/strict';

export const parseCodes = new Set(['PUnexpectedEnd','PUnexpectedCharacter','PExpectedColon','PExpectedCommaOrEnd','PInvalidNumber','PInvalidEscape','PInvalidUnicodeEscape','PUnpairedSurrogate','PInvalidScalar','PLeadingBom','PTrailingContent','PInputLimit','PDepthLimit','PNumberLimit','PStringLimit','PValueLimit','PInvalidLimits']);
export const encodeCodes = new Set(['EInvalidNumber','EInvalidScalar','EDepthLimit','ENumberLimit','EStringLimit','EValueLimit','EOutputLimit','EInvalidLimits']);
export function limits(overrides = {}) {
  return {$:'Limits',max_input:1048576n,max_depth:128n,max_number:4096n,max_string:262144n,max_values:100000n,max_output:2097152n,...overrides};
}
export const corpusLimits = limits({max_depth:1024n});
export const propertyLimits = limits({max_input:131072n,max_depth:16n,max_number:128n,max_string:128n,max_values:256n,max_output:131072n});
export const Null = () => ({$:'Null'});
export const BooleanValue = value => ({$:'Boolean',value});
export const NumberValue = text => ({$:'Number',text});
export const Text = value => ({$:'Text',value});
export function list(items) { let tail = {$:'Nil'}; for (let i=items.length-1;i>=0;i--) tail = {$:'Con',head:items[i],tail}; return tail; }
export const ArrayValue = items => ({$:'Array',items:list(items)});
export const ObjectValue = members => ({$:'Object',members:list(members.map(([key,value])=>({$:'Member',key,value})))});
export function codepoints(text) { let n=0; for (const unused of text) n++; return n; }

export function assertResult(result) {
  assert.ok(result && typeof result === 'object', 'Result must be an object');
  assert.ok(result.$ === 'Done' || result.$ === 'Fail', `Invalid Result tag ${result.$}`);
  if (result.$ === 'Done') assert.ok(Object.hasOwn(result,'value'), 'Done.value missing');
  else {
    const e=result.error;
    assert.ok(e && (e.$ === 'ParseError' || e.$ === 'EncodeError'), 'Structured error missing');
    assert.ok((e.$ === 'ParseError' ? parseCodes : encodeCodes).has(e.code?.$), 'Unknown error code');
    assert.equal(typeof e.offset,'bigint'); assert.ok(e.offset>=0n && e.offset<=16777217n, 'Invalid error offset');
  }
  return result;
}
export function done(result) { assertResult(result); assert.equal(result.$,'Done', result.$==='Fail' ? `${result.error.code.$} at ${result.error.offset}` : 'Expected success'); return result.value; }
export function failure(result, code, offset) {
  assertResult(result); assert.equal(result.$,'Fail','Expected structured failure');
  if (code !== undefined) assert.equal(result.error.code.$,code);
  if (offset !== undefined) assert.equal(result.error.offset,BigInt(offset));
  return result.error;
}

// Deliberately iterative: neither Bend linked-list width nor tree depth uses the JS stack.
export function assertAst(actual, expected) {
  const work=[[actual,expected,'root']];
  while (work.length) {
    const [a,b,path]=work.pop();
    assert.ok(a && b && typeof a==='object' && typeof b==='object', `${path}: invalid AST`);
    assert.equal(a.$,b.$,`${path}: tag`);
    switch (b.$) {
      case 'Null': case 'Nil': break;
      case 'Boolean': assert.equal(a.value,b.value,`${path}: boolean`); break;
      case 'Number': assert.equal(a.text,b.text,`${path}: number lexeme`); break;
      case 'Text': assert.equal(a.value,b.value,`${path}: string`); break;
      case 'Array': work.push([a.items,b.items,'array items']); break;
      case 'Object': work.push([a.members,b.members,'object members']); break;
      case 'Member': assert.equal(a.key,b.key,`${path}: key/order`); work.push([a.value,b.value,'member value']); break;
      case 'Con': work.push([a.tail,b.tail,'list tail'],[a.head,b.head,'list head']); break;
      default: assert.fail(`Unknown AST tag ${b.$}`);
    }
  }
}

// Test expectation renderer only. No parser or production fallback consumes this code.
export function quote(text) {
  let out='"';
  for (const ch of text) {
    const cp=ch.codePointAt(0);
    if (ch==='"') out+='\\"';
    else if (ch==='\\') out+='\\\\';
    else if (cp===8) out+='\\b'; else if(cp===9) out+='\\t';
    else if(cp===10) out+='\\n'; else if(cp===12) out+='\\f'; else if(cp===13) out+='\\r';
    else if(cp<32) out+='\\u'+cp.toString(16).padStart(4,'0');
    else out+=ch;
  }
  return out+'"';
}
export function encodeExpected(value) {
  const work=[{value}], parts=[];
  while(work.length) {
    const task=work.pop();
    if(Object.hasOwn(task,'text')) { parts.push(task.text); continue; }
    const v=task.value;
    switch(v.$) {
      case 'Null': parts.push('null'); break;
      case 'Boolean': parts.push(v.value?'true':'false'); break;
      case 'Number': parts.push(v.text); break;
      case 'Text': parts.push(quote(v.value)); break;
      case 'Array': {
        const items=[]; for(let xs=v.items;xs.$==='Con';xs=xs.tail) items.push(xs.head);
        work.push({text:']'}); for(let i=items.length-1;i>=0;i--) { work.push({value:items[i]}); if(i>0) work.push({text:','}); } work.push({text:'['}); break;
      }
      case 'Object': {
        const members=[]; for(let xs=v.members;xs.$==='Con';xs=xs.tail) members.push(xs.head);
        work.push({text:'}'}); for(let i=members.length-1;i>=0;i--) { const m=members[i]; work.push({value:m.value},{text:':'},{text:quote(m.key)}); if(i>0) work.push({text:','}); } work.push({text:'{'}); break;
      }
      default: assert.fail(`Invalid expectation tag ${v.$}`);
    }
  }
  return parts.join('');
}
export function measure(value) {
  let values=0,depth=0,string=0,number=0; const work=[[value,0]];
  while(work.length) {
    const [v,d]=work.pop(); values++;
    if(v.$==='Text') string=Math.max(string,codepoints(v.value));
    if(v.$==='Number') number=Math.max(number,codepoints(v.text));
    if(v.$==='Array' || v.$==='Object') {
      depth=Math.max(depth,d+1);
      for(let xs=v.$==='Array'?v.items:v.members;xs.$==='Con';xs=xs.tail) {
        if(v.$==='Object') { string=Math.max(string,codepoints(xs.head.key)); work.push([xs.head.value,d+1]); }
        else work.push([xs.head,d+1]);
      }
    }
  }
  const text=encodeExpected(value);
  return {values,depth,string,number,output:codepoints(text),text};
}
export function assertFits(value, bound) {
  const m=measure(value);
  for(const [field,count] of [['max_values',m.values],['max_depth',m.depth],['max_string',m.string],['max_number',m.number],['max_output',m.output],['max_input',m.output]]) assert.ok(BigInt(count)<=bound[field],`${field}: fixture exceeds its limit`);
  return m;
}
export function checkText(Core, item) {
  const result=Core['Json.parse'](item.text,item.limits);
  if(item.expect.kind==='fail') return failure(result,item.expect.code,item.expect.offset);
  const value=done(result);
  if(item.expect.value!==undefined) assertAst(value,item.expect.value);
  if(item.expect.encoded!==undefined) assert.equal(done(Core['Json.encode'](value,item.limits)),item.expect.encoded);
  return value;
}
export function strictDecode(bytes) { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
