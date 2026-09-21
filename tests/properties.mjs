import assert from 'node:assert/strict';
import {limits,propertyLimits,Null,BooleanValue,NumberValue,Text,ArrayValue,ObjectValue,assertAst,done,assertFits,encodeExpected,codepoints} from './support.mjs';

export const seeds=[0x00000001,0x82590001,0xC0FFEE01];
export function xorshift(seed) {
  let state=seed>>>0;
  return () => { state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0; };
}
const edges=['','a','é','e\u0301','中文','😀','𝄞','\0','\b\f\n\r\t','"\\/','\u007f','\ufdd0','\ufffe','\uffff','\u2028\u2029','\ufeff','\u{1fffe}','\u{10fffe}','\u{10ffff}'];
const keys=['','b','a','b','2','1','0','__proto__','constructor','é','e\u0301'];
function string(rng) {
  // Draw order: length first, then one alphabet selection per scalar slot.
  const length=rng()%65; const chars=[];
  for(let i=0;i<length;i++) chars.push(['a','é','中','😀','\0','"','\\','\n','\ufeff','\u{10ffff}'][rng()%10]);
  return chars.join('');
}
function number(rng) {
  // Grammar generation, never a random float. Fixed choices preserve spelling variation.
  const variants=['0','-0','1.5','1e3','1E-07','281474976710656','0e+1','-0.0','1E+0007','1e400','1e-10000000'];
  const variant=rng()%3;
  if(variant===0) return variants[rng()%variants.length];
  const negative=rng()%2===0?'-':''; const length=1+rng()%24;
  let out=negative+String(1+rng()%9);
  for(let i=1;i<length;i++) out+=String(rng()%10);
  if(variant===2) { const fraction=1+rng()%12;out+='.';for(let i=0;i<fraction;i++) out+=String(rng()%10);out+=(rng()%2?'e':'E')+(rng()%2?'+':'-')+String(rng()%100000); }
  return out;
}
function value(rng,budget,depth) {
  assert.ok(budget.left>0);budget.left--;
  const kind=rng()%(depth===6||budget.left===0?4:6);
  switch(kind) {
    case 0:return Null();
    case 1:return BooleanValue((rng()&1)===1);
    case 2:return NumberValue(number(rng));
    case 3:return Text(rng()%2?edges[rng()%edges.length]:string(rng));
    case 4:{ const count=rng()%9,items=[];for(let i=0;i<count&&budget.left;i++)items.push(value(rng,budget,depth+1));return ArrayValue(items); }
    default:{ const count=rng()%9,members=[];let previous='';for(let i=0;i<count&&budget.left;i++){const choice=rng()%4;const key=choice===0&&i?previous:choice===1?string(rng):keys[rng()%keys.length];previous=key;members.push([key,value(rng,budget,depth+1)]);}return ObjectValue(members); }
  }
}
export function* generated() {
  for(const seed of seeds) {
    const rng=xorshift(seed);
    for(let i=0;i<1000;i++) {
      // Every sixteenth fixture guarantees duplicates/order/special keys, rather than hoping a seed draws them.
      const ast=i%16===0?ObjectValue([['',Null()],['b',value(rng,{left:120},1)],['a',NumberValue('0')],['b',NumberValue('-0')],['2',Text('😀')],['1',Text('\0')],['__proto__',Null()],['constructor',BooleanValue(true)]]):value(rng,{left:128},0);
      const m=assertFits(ast,propertyLimits);
      assert.ok(m.depth<=6&&m.values<=128&&m.string<=64&&m.number<=64);
      yield {id:`generated/${seed.toString(16).padStart(8,'0')}/${i}`,value:ast,text:m.text,limits:propertyLimits};
    }
  }
}
function commonValue(rng,depth) {
  const kind=rng()%(depth===3?4:6);
  if(kind===0)return {ast:Null(),host:null};
  if(kind===1){const b=Boolean(rng()&1);return {ast:BooleanValue(b),host:b};}
  if(kind===2){const n=(rng()%2000001)-1000000;return {ast:NumberValue(String(n)),host:n};}
  if(kind===3){const s=edges[rng()%edges.length];return {ast:Text(s),host:s};}
  const count=rng()%5,items=[],members=[],host=kind===4?[]:{};
  for(let i=0;i<count;i++){const child=commonValue(rng,depth+1);if(kind===4){items.push(child.ast);host.push(child.host);}else{const key=`k:${i}:${rng()%100}`;members.push([key,child.ast]);host[key]=child.host;}}
  return {ast:kind===4?ArrayValue(items):ObjectValue(members),host};
}
export function* commonGenerated() {
  for(const seed of seeds){const rng=xorshift(seed^0x51A7E123);for(let i=0;i<100;i++){const v=commonValue(rng,0);yield {id:`oracle/${seed.toString(16)}/${i}`,value:v.ast,host:v.host,text:assertFits(v.ast,propertyLimits).text,limits:propertyLimits};}}
}
export function whitespace(text) {
  const out=[' \t\r\n'];let quoted=false,escaped=false;
  for(const ch of text){if(quoted){out.push(ch);if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;}else if(ch==='"'){quoted=true;out.push(ch);}else if('{}[],:'.includes(ch))out.push(' \t',ch,'\r\n');else out.push(ch);}
  out.push('\n\r\t ');return out.join('');
}
export function escapedScalars(text) {
  const out=[];let quoted=false,escaped=false,hexRemaining=0;
  for(const ch of text){if(!quoted){out.push(ch);if(ch==='"')quoted=true;}else if(hexRemaining){out.push(ch);hexRemaining--;}else if(escaped){out.push(ch);escaped=false;if(ch==='u')hexRemaining=4;}else if(ch==='\\'){out.push(ch);escaped=true;}else if(ch==='"'){out.push(ch);quoted=false;}else{const cp=ch.codePointAt(0);if(cp<=0xffff)out.push('\\u'+cp.toString(16).padStart(4,'0'));else{const n=cp-65536;out.push('\\u'+(55296+(n>>>10)).toString(16)+'\\u'+(56320+(n&1023)).toString(16));}}}
  return out.join('');
}
export function* largeFixtures() {
  for(const size of [1000,10000,100000,262144]){const value=Text('a'.repeat(size-1)+'😀');yield {id:`large/string/${size}`,value,text:encodeExpected(value),limits:limits()};}
  for(const size of [128,8192,99999]){const value=ArrayValue(Array.from({length:size},()=>Null()));yield {id:`large/array/${size}`,value,text:encodeExpected(value),limits:limits()};}
}
export function* cases() {
  yield {id:'harness/escape-transformation',run(){const value='A\0"\\\n😀';const text=encodeExpected(Text(value));const escaped=escapedScalars(text);assert.equal(JSON.parse(escaped),value);assert.equal(JSON.parse(escapedScalars(escaped)),value);}};
  yield {id:'comparator/large-width-depth',run(){const a=ArrayValue(Array.from({length:100000},()=>NumberValue('1'))),b=ArrayValue(Array.from({length:100000},()=>NumberValue('1')));assertAst(a,b);let cursor=b.items;for(let i=0;i<99999;i++)cursor=cursor.tail;cursor.head=NumberValue('2');assert.throws(()=>assertAst(a,b));let x=Null(),y=Null();for(let i=0;i<10000;i++){x=ArrayValue([x]);y=ArrayValue([y]);}assertAst(x,y);assert.throws(()=>assertAst(ObjectValue([['a',Null()],['a',BooleanValue(true)]]),ObjectValue([['a',BooleanValue(true)],['a',Null()]])));assert.throws(()=>assertAst(NumberValue('-0'),NumberValue('0')));}};
  for(const item of generated())yield {id:item.id,run(Core){const encoded=done(Core['Json.encode'](item.value,item.limits));assert.equal(encoded,item.text);assertAst(done(Core['Json.parse'](encoded,item.limits)),item.value);assertAst(done(Core['Json.parse'](whitespace(item.text),item.limits)),item.value);const escaped=escapedScalars(item.text);assert.ok(codepoints(escaped)<=Number(item.limits.max_input));assertAst(done(Core['Json.parse'](escaped,item.limits)),item.value);}};
  for(const item of commonGenerated())yield {id:item.id,run(Core){assert.deepEqual(JSON.parse(item.text),item.host);const encoded=done(Core['Json.encode'](item.value,item.limits));assert.deepEqual(JSON.parse(encoded),item.host);assertAst(done(Core['Json.parse'](JSON.stringify(item.host),item.limits)),item.value);}};
  for(const item of largeFixtures())yield {id:item.id,run(Core){assertAst(done(Core['Json.parse'](item.text,item.limits)),item.value);assert.equal(done(Core['Json.encode'](item.value,item.limits)),item.text);}};
}
