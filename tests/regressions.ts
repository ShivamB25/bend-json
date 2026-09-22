import assert from 'node:assert/strict';
import {
  limits,
  limitFields,
  Null,
  BooleanValue,
  NumberValue,
  Text,
  ArrayValue,
  ObjectValue,
  assertAst,
  done,
  failure,
  encodeExpected,
  checkText,
  strictDecode,
  codepoints,
  assertResult,
  assertJson,
  expectJsonCore,
} from './support.ts';
import type {
  Expectation,
  Json,
  JsonCore,
  EncodeCode,
  Limits,
  ParseCode,
  TestCase,
  TextFixture,
} from './support.ts';
const N = NumberValue, T = Text, A = ArrayValue, O = ObjectValue, B = BooleanValue;
const ok = (id: string, text: string, value: Json, limit: Limits = limits()): TextFixture => ({
  id: `directed/${id}`,
  text,
  limits: limit,
  expect: { kind: 'done', value, encoded: encodeExpected(value) },
});
const bad = (
  id: string,
  text: string,
  code: ParseCode,
  offset: number,
  limit: Limits = limits(),
): TextFixture => ({ id: `directed/${id}`, text, limits: limit, expect: { kind: 'fail', code, offset } });
export interface EncoderFixture {
  id: string;
  value: Json;
  limits: Limits;
  nativeScalar?: boolean;
  expect: Expectation<EncodeCode>;
}
export const validNumbers=['0','-0','1.5','1e3','1E-07','281474976710656','0e+1','-0.0','1E+0007','1e400','1e-10000000'];
export const invalidNumbers=['01','-','+1','.5','1.','1e','1e+','1e-','NaN','Infinity','-Infinity','0x1','--1',' 1','1 ','','1\n','1+2','1..2'];

export function* textCases(): Generator<TextFixture> {
  yield ok('slice','{"x":[-1.5e+2,"\\u0041"]}',O([['x',A([N('-1.5e+2'),T('A')])]]));
  const roots: Array<[string, string, Json]> = [['null','null',Null()],['true','true',B(true)],['false','false',B(false)],['zero','0',N('0')],['empty-text','""',T('')],['text','"x"',T('x')],['empty-array','[]',A([])],['mixed-array','[null,true,"x",0]',A([Null(),B(true),T('x'),N('0')])],['empty-object','{}',O([])],['object','{"a":1}',O([['a',N('1')]])],['nested','[{"a":[{},[],false]},[]]',A([O([['a',A([O([]),A([]),B(false)])]]),A([])])]];
  for (const [id, text, value] of roots) yield ok(`root/${id}`, text, value);
  const literalFailures: Array<[string, ParseCode, number]> = [['','PUnexpectedEnd',0],[' \t\r\n','PUnexpectedEnd',4],['Null','PUnexpectedCharacter',0],['TRUE','PUnexpectedCharacter',0],['nul','PUnexpectedEnd',3],['tru','PUnexpectedEnd',3],['fals','PUnexpectedEnd',4],['nux','PUnexpectedCharacter',2],['falsex','PTrailingContent',5]];
  for (const [text, code, offset] of literalFailures) yield bad(`literal/${JSON.stringify(text)}`, text, code, offset);
  yield ok('whitespace/all',' \t\r\n{ \t"a"\r:\n[\ttrue \r,\nnull\t]\r}\n',O([['a',A([B(true),Null()])]]));
  for(const ch of ['\v','\f','\u00a0','\u2060']){const cp=ch.codePointAt(0);assert.ok(cp!==undefined);yield bad(`whitespace/start/${cp}`,ch+'null','PUnexpectedCharacter',0);yield bad(`whitespace/suffix/${cp}`,'null'+ch,'PTrailingContent',4);}
  yield bad('bom/leading','\ufeff{}','PLeadingBom',0);yield ok('bom/quoted','"\ufeff"',T('\ufeff'));
  for(const text of ['//x\nnull','/*x*/null',"'x'"])yield bad(`extension/${text}`,text,'PUnexpectedCharacter',0);
  for(const text of validNumbers)yield ok(`number/${text}`,text,N(text));
  const parseNumberBad: Array<[string, number]> = [['01',1],['-',1],['1.',2],['1e',2],['1e+',3],['1e-',3],['-Infinity',1],['--1',1],['1+2',1],['1..2',2]];
  for(const [text,pos] of parseNumberBad)yield bad(`number-invalid/${text}`,text,'PInvalidNumber',pos);
  for(const text of ['+1','.5','NaN','Infinity'])yield bad(`number-start/${text}`,text,'PUnexpectedCharacter',0);
  yield bad('number/hex','0x1','PTrailingContent',1);
  const escaped: Array<[string, string]> = [['"\\u0041"','A'],['"\\\"\\\\\\/\\b\\f\\n\\r\\t"','"\\/\b\f\n\r\t'],['"\\u0000"','\0'],['"A\\u0000B"','A\0B']];
  for(let i=0;i<escaped.length;i++){const pair=escaped[i];assert.ok(pair);yield ok(`escapes/${i}`,pair[0],T(pair[1]));}
  for(let cp=0;cp<32;cp++){yield bad(`controls/raw/${cp}`,'"'+String.fromCodePoint(cp)+'"','PUnexpectedCharacter',1);yield ok(`controls/escaped/${cp}`,'"\\u'+cp.toString(16).padStart(4,'0')+'"',T(String.fromCodePoint(cp)));}
  for(const value of ['é','e\u0301','中文','😀','\u007f','\ufdd0','\ufffe','\uffff','\u{1fffe}','\u{10fffe}','\u{10ffff}','\u2028\u2029','�'])yield ok(`unicode/${[...value].map(character=>{const cp=character.codePointAt(0);assert.ok(cp!==undefined);return cp.toString(16);}).join('-')}`,'"'+value+'"',T(value));
  const surrogatePairs: Array<[string, string]> = [['"\\uD834\\uDD1E"','𝄞'],['"\\uD800\\uDC00"','\u{10000}'],['"\\uDBFF\\uDFFF"','\u{10ffff}']];
  for(const [text,value] of surrogatePairs)yield ok(`surrogate/${text}`,text,T(value));
  for(const source of ['\\uD800','\\uDC00','\\uDC00\\uD800','\\uD800\\uD800','\\uD800\\u0041','\\uD800x','\\uD800\\n']){yield bad(`surrogate/value/${source}`,'"'+source+'"','PUnpairedSurrogate',1);yield bad(`surrogate/key/${source}`,'{"'+source+'":0}','PUnpairedSurrogate',2);}
  for(const text of ['"\\q"','"\\x41"','"\\U0041"'])yield bad(`escape/unknown/${text}`,text,'PInvalidEscape',2);
  yield bad('escape/hex-invalid','"\\u12G4"','PInvalidUnicodeEscape',5);
  yield bad('escape/hex-eof','"\\u12','PInvalidUnicodeEscape',5);
  yield bad('escape/trailing-backslash','"x\\','PUnexpectedEnd',3);
  yield bad('escape/string-eof','"x','PUnexpectedEnd',2);
  yield bad('surrogate/high-eof','"\\uD800','PUnpairedSurrogate',1);
  yield bad('surrogate/low-slash-eof','"\\uD800\\','PUnpairedSurrogate',1);
  yield bad('surrogate/low-u-missing','"\\uD800\\x"','PUnpairedSurrogate',1);
  yield bad('surrogate/low-hex-eof','"\\uD800\\u','PInvalidUnicodeEscape',9);
  yield bad('surrogate/low-hex-bad','"\\uD800\\u12G4"','PInvalidUnicodeEscape',11);
  yield bad('scalar/raw-high','"\ud800"','PInvalidScalar',1);
  yield bad('scalar/raw-low-key','{"\udfff":0}','PInvalidScalar',2);
  yield bad('limits/input-before-scalar','"\ud800"','PInputLimit',1,limits({max_input:1n}));
  const containers: Array<[string, ParseCode, number]> = [['[1,]','PUnexpectedCharacter',3],['[,1]','PUnexpectedCharacter',1],['[1,,2]','PUnexpectedCharacter',3],['[1 2]','PExpectedCommaOrEnd',3],['[1','PUnexpectedEnd',2],['[}','PUnexpectedCharacter',1],['{"a":1,}','PUnexpectedCharacter',7],['{"a" 1}','PExpectedColon',5],['{"a":1 "b":2}','PExpectedCommaOrEnd',7],['{"a":}','PUnexpectedCharacter',5],['{a:1}','PUnexpectedCharacter',1],['{"a":1]','PExpectedCommaOrEnd',6],['{]','PUnexpectedCharacter',1],['[truex]','PExpectedCommaOrEnd',5]];
  for(const [text,code,offset] of containers)yield bad(`container/${text}`,text,code,offset);
  for(const text of ['[','[0,','{','{"a"','{"a":','{"a":0,','{"a":0'])yield bad(`container-eof/${text}`,text,'PUnexpectedEnd',codepoints(text));
  const suffixes: Array<[string, number]> = [['null true',5],['{}[]',2],['1x',1],['"x"garbage',3],['null\0',4],['"é"x',3],['"😀"x',3]];
  for(const [text,offset] of suffixes)yield bad(`suffix/${JSON.stringify(text)}`,text,'PTrailingContent',offset);
  yield bad('offset/array-accent','["é",]','PUnexpectedCharacter',5);yield bad('offset/array-astral','["😀",?]','PUnexpectedCharacter',5);
  yield bad('offset/escape-source','"\\u0041"x','PTrailingContent',8);yield bad('offset/pair-source','"\\uD834\\uDD1E"x','PTrailingContent',14);yield bad('offset/escape-eof','["\\u0041"','PUnexpectedEnd',9);
  yield ok('objects/order-duplicates','{"":0,"b":1,"a":2,"b":3}',O([['',N('0')],['b',N('1')],['a',N('2')],['b',N('3')]]));
  yield ok('objects/decoded-duplicate','{"a":1,"\\u0061":2}',O([['a',N('1')],['a',N('2')]]));
  yield ok('objects/index-keys','{"2":0,"1":1,"0":2}',O([['2',N('0')],['1',N('1')],['0',N('2')]]));
  yield ok('objects/special-keys','{"__proto__":1,"constructor":2}',O([['__proto__',N('1')],['constructor',N('2')]]));
  // Each resource is checked immediately below, exactly at, and above a fixed budget.
  for(const n of [3,4,5]){const text=' '.repeat(n-1)+'0';yield n<=4?ok(`limits/input/${n}`,text,N('0'),limits({max_input:4n})):bad(`limits/input/${n}`,text,'PInputLimit',4,limits({max_input:4n}));}
  for(const n of [1,2,3]){let value: Json=Null();for(let j=0;j<n;j++)value=A([value]);const text=encodeExpected(value);yield n<=2?ok(`limits/depth/${n}`,text,value,limits({max_depth:2n})):bad(`limits/depth/${n}`,text,'PDepthLimit',2,limits({max_depth:2n}));}
  for(const n of [2,3,4]){const text='1'.repeat(n);yield n<=3?ok(`limits/number/${n}`,text,N(text),limits({max_number:3n})):bad(`limits/number/${n}`,text,'PNumberLimit',3,limits({max_number:3n}));}
  for(const n of [1,2,3])for(const escaped of [false,true]){const text='"'+(escaped?'\\u0041':'A').repeat(n)+'"';yield n<=2?ok(`limits/string/${n}/${escaped}`,text,T('A'.repeat(n)),limits({max_string:2n})):bad(`limits/string/${n}/${escaped}`,text,'PStringLimit',escaped?13:3,limits({max_string:2n}));}
  for(const n of [1,2,3]){const value=A(Array.from({length:n-1},()=>N('0')));const text=encodeExpected(value);yield n<=2?ok(`limits/values/${n}`,text,value,limits({max_values:2n})):bad(`limits/values/${n}`,text,'PValueLimit',3,limits({max_values:2n}));}
  yield ok('limits/zero-depth-scalar','null',Null(),limits({max_depth:0n}));yield bad('limits/zero-depth-container','[]','PDepthLimit',0,limits({max_depth:0n}));
  yield bad('limits/zero-input','0','PInputLimit',0,limits({max_input:0n}));yield bad('limits/zero-number','0','PNumberLimit',0,limits({max_number:0n}));yield ok('limits/zero-string-empty','""',T(''),limits({max_string:0n}));yield bad('limits/zero-string','"A"','PStringLimit',1,limits({max_string:0n}));yield bad('limits/zero-values','null','PValueLimit',0,limits({max_values:0n}));
  // Parse ignores max_output: these descriptors intentionally omit encode expectations.
  yield {id:'directed/limits/parse-ignores-output',text:'null',limits:limits({max_output:0n}),expect:{kind:'done',value:Null()}};
  yield ok('limits/astral-raw','"😀"',T('😀'),limits({max_input:3n,max_string:1n}));yield ok('limits/astral-escaped','"\\uD83D\\uDE00"',T('😀'),limits({max_input:14n,max_string:1n}));
  yield bad('limits/astral-raw-overflow','"😀x"','PStringLimit',2,limits({max_string:1n}));
  yield bad('limits/astral-escaped-overflow','"\\uD83D\\uDE00x"','PStringLimit',13,limits({max_string:1n}));
  yield bad('limits/astral-key-overflow','{"\\uD83D\\uDE00x":0}','PStringLimit',14,limits({max_string:1n}));
  yield bad('limits/escaped-source-cap','"\\u0041"','PInputLimit',3,limits({max_input:3n,max_string:1n}));yield ok('limits/key-count','{"😀":0}',O([['😀',N('0')]]),limits({max_string:1n,max_values:2n}));yield bad('limits/key-overflow','{"ab":0}','PStringLimit',3,limits({max_string:1n}));
  for(const field of limitFields){yield bad(`limits/invalid/${field}`,'null','PInvalidLimits',0,limits({[field]:16777217n}));yield ok(`limits/cap/${field}`,'null',Null(),limits({[field]:16777216n}));}
  const longArray='['+'0,'.repeat(30000)+']';yield bad('large/late-array',longArray,'PUnexpectedCharacter',60001);
  const longText='"'+'a'.repeat(100000);yield bad('large/late-string',longText,'PUnexpectedEnd',100001);
  yield ok('large/number-default','1'.repeat(4096),N('1'.repeat(4096)));
  const nested='['.repeat(128)+'0'+']'.repeat(128);let nv: Json=N('0');for(let i=0;i<128;i++)nv=A([nv]);yield ok('large/depth-default',nested,nv);yield bad('large/depth-over','['.repeat(129)+'0'+']'.repeat(129),'PDepthLimit',128);
}
export function* numberCases(): Generator<TextFixture> {
  for(const text of validNumbers)yield {id:`number/valid/${text}`,text,limits:limits(),expect:{kind:'done',value:N(text)}};
  for(const text of invalidNumbers)yield {id:`number/invalid/${JSON.stringify(text)}`,text,limits:limits(),expect:{kind:'fail',code:'PInvalidNumber'}};
  const resourceCases: Array<[string, string, Partial<Omit<Limits, '$'>>, ParseCode, number]> = [['zero-input','1',{max_input:0n},'PInputLimit',0],['input','123',{max_input:2n},'PInputLimit',2],['number','123',{max_number:2n},'PNumberLimit',2],['values','1',{max_values:0n},'PValueLimit',0],['scalar','\ud800',{},'PInvalidScalar',0]];
  for(const [id,text,overrides,code,offset] of resourceCases)yield {id:`number/resource/${id}`,text,limits:limits(overrides),expect:{kind:'fail',code,offset}};
  yield {id:'number/ignores-other-budgets',text:'-0',limits:limits({max_output:0n,max_depth:0n,max_string:0n}),expect:{kind:'done',value:N('-0')}};
  for(const field of limitFields)yield {id:`number/invalid-limit/${field}`,text:'0',limits:limits({[field]:16777217n}),expect:{kind:'fail',code:'PInvalidLimits',offset:0}};
}
export function* encoderCases(): Generator<EncoderFixture> {
  for(const text of invalidNumbers)yield {id:`encode/invalid-number/${JSON.stringify(text)}`,value:N(text),limits:limits(),expect:{kind:'fail',code:'EInvalidNumber',offset:0}};
  const scalarCases: Array<[string, Json, number]> = [['text',T('\ud800'),1],['key',O([['\udfff',Null()]]),2],['number',N('\ud800'),0]];
  for(const [id,value,offset] of scalarCases)yield {id:`encode/scalar/${id}`,value,limits:limits(),nativeScalar:true,expect:{kind:'fail',code:'EInvalidScalar',offset}};
  for(const n of [2,3,4]){const value=N('1'.repeat(n));yield {id:`encode/boundary/number/${n}`,value,limits:limits({max_number:3n}),expect:n<=3?{kind:'done',text:encodeExpected(value)}:{kind:'fail',code:'ENumberLimit',offset:0}};}
  for(const n of [1,2,3]){
    const value=T('A'.repeat(n));yield {id:`encode/boundary/string/${n}`,value,limits:limits({max_string:2n}),expect:n<=2?{kind:'done',text:encodeExpected(value)}:{kind:'fail',code:'EStringLimit',offset:3}};
    const object=O([['A'.repeat(n),Null()]]);yield {id:`encode/boundary/key/${n}`,value:object,limits:limits({max_string:2n}),expect:n<=2?{kind:'done',text:encodeExpected(object)}:{kind:'fail',code:'EStringLimit',offset:4}};
    const array=A(Array.from({length:n-1},()=>N('0')));yield {id:`encode/boundary/values/${n}`,value:array,limits:limits({max_values:2n}),expect:n<=2?{kind:'done',text:encodeExpected(array)}:{kind:'fail',code:'EValueLimit',offset:3}};
    let nested: Json=Null();for(let i=0;i<n;i++)nested=A([nested]);yield {id:`encode/boundary/depth/${n}`,value:nested,limits:limits({max_depth:2n}),expect:n<=2?{kind:'done',text:encodeExpected(nested)}:{kind:'fail',code:'EDepthLimit',offset:2}};
  }
  yield {id:'encode/limits/astral-overflow',value:T('😀x'),limits:limits({max_string:1n}),expect:{kind:'fail',code:'EStringLimit',offset:2}};
  yield {id:'encode/limits/escape-overflow',value:T('\0x'),limits:limits({max_string:1n}),expect:{kind:'fail',code:'EStringLimit',offset:7}};
  const values: Json[]=[Null(),T(''),T('\0'),T('\b\f\n\r\t'),T('"\\/'),A([Null(),T('😀')]),O([['x',N('-0')],['x',T('é')]])];
  for(let i=0;i<values.length;i++){const value=values[i];assert.ok(value);const text=encodeExpected(value),n=codepoints(text);for(const capacity of [n-1,n,n+1])yield {id:`encode/output/${i}/${capacity}`,value,limits:limits({max_output:BigInt(capacity)}),expect:capacity<n?{kind:'fail',code:'EOutputLimit',offset:capacity}:{kind:'done',text}};}
  const limitCases: Array<[string, Json, Partial<Omit<Limits, '$'>>, EncodeCode, number]> = [['zero-output',Null(),{max_output:0n},'EOutputLimit',0],['zero-values',Null(),{max_values:0n},'EValueLimit',0],['zero-depth',A([]),{max_depth:0n},'EDepthLimit',0],['zero-number',N('0'),{max_number:0n},'ENumberLimit',0],['zero-string',T('a'),{max_string:0n},'EStringLimit',1],['number',N('123'),{max_number:2n},'ENumberLimit',0],['string',T('abc'),{max_string:2n},'EStringLimit',3],['key',O([['abc',Null()]]),{max_string:2n},'EStringLimit',4],['values',A([Null(),Null()]),{max_values:2n},'EValueLimit',6],['depth',A([A([])]),{max_depth:1n},'EDepthLimit',1],['output-precedence',N('bad'),{max_output:0n},'EOutputLimit',0]];
  for(const [id,value,overrides,code,offset] of limitCases)yield {id:`encode/limits/${id}`,value,limits:limits(overrides),expect:{kind:'fail',code,offset}};
  const passCases: Array<[string, Json, Partial<Omit<Limits, '$'>>]> = [['zero-input',Null(),{max_input:0n}],['zero-depth',N('0'),{max_depth:0n}],['zero-string',T(''),{max_string:0n}],['key-no-value-count',O([['k',Null()]]),{max_values:2n}],['astral',T('😀'),{max_string:1n,max_output:3n}]];
  for(const [id,value,overrides] of passCases)yield {id:`encode/limits/pass/${id}`,value,limits:limits(overrides),expect:{kind:'done',text:encodeExpected(value)}};
  for(const field of limitFields)yield {id:`encode/invalid-limit/${field}`,value:Null(),limits:limits({[field]:16777217n}),expect:{kind:'fail',code:'EInvalidLimits',offset:0}};
  for(const field of limitFields)yield {id:`encode/cap/${field}`,value:Null(),limits:limits({[field]:16777216n}),expect:{kind:'done',text:'null'}};
}
export function* cases(): Generator<TestCase> {
  yield {
    id: 'harness/result-code-own-property',
    run() {
      for (const errorTag of ['ParseError', 'EncodeError'] as const) {
        for (const code of ['constructor', 'toString']) {
          assert.throws(
            () => assertResult({
              $: 'Fail',
              error: { $: errorTag, code: { $: code }, offset: 0n },
            }, assertJson, errorTag),
            /Unknown error code/,
          );
        }
      }
    },
  };
  yield {
    id: 'harness/json-core-runtime-boundary',
    run() {
      assert.throws(() => expectJsonCore({}), /Json\.parse must be callable/);
      assert.throws(() => expectJsonCore({
        'Json.parse': () => ({ $: 'Done', value: Null() }),
        'Json.encode': () => ({ $: 'Done', value: 'null' }),
        'Json.number': () => ({ $: 'Done', value: NumberValue('0') }),
        'Json.default_limits': () => ({}),
      }), /Limits tag missing/);
      const guarded = expectJsonCore({
        'Json.parse': () => ({ $: 'Done', value: Null() }),
        'Json.encode': () => ({ $: 'Done', value: 'null' }),
        'Json.number': () => ({ $: 'Done', value: NumberValue('0') }),
        'Json.default_limits': limits,
      });
      assert.deepEqual(guarded['Json.default_limits'](), limits());
      assertAst(done(guarded['Json.parse']('null', limits())), Null());
      assert.equal(done(guarded['Json.encode'](Null(), limits())), 'null');
      assertAst(done(guarded['Json.number']('0', limits())), NumberValue('0'));
      const lying = expectJsonCore({
        'Json.parse': (text: string) => text === 'null'
          ? { $: 'Done', value: Null() }
          : { $: 'Done', value: { $: 'Array', items: { $: 'Con', head: { $: 'Bogus' }, tail: { $: 'Nil' } } } },
        'Json.encode': (value: Json) => ({ $: 'Done', value: value.$ === 'Null' ? 'null' : 0 }),
        'Json.number': (text: string) => ({ $: 'Done', value: text === '0' ? NumberValue('0') : Null() }),
        'Json.default_limits': limits,
      });
      assert.throws(() => lying['Json.parse']('[0]', limits()), /Invalid Json tag Bogus/);
      assert.throws(() => lying['Json.encode'](Text('x'), limits()), /Json\.encode value must be a string/);
      assert.throws(() => lying['Json.number']('1', limits()), /non-Number tag/);
      const nil = { $: 'Nil' };
      const cell = (head: unknown, tail: unknown = nil): unknown => ({ $: 'Con', head, tail });
      const member = (key: unknown, value: unknown): unknown => ({ $: 'Member', key, value });
      const malformed: Array<readonly [unknown, RegExp]> = [
        [{ $: 'Array', items: { $: 'Cons', head: Null(), tail: nil } }, /Invalid list tag Cons/],
        [{ $: 'Array', items: { $: 'Con', head: Null() } }, /Con\.tail missing/],
        [{ $: 'Array', items: Object.assign(Object.create({ head: Null() }), { $: 'Con', tail: nil }) }, /Con\.head missing/],
        [{ $: 'Array', items: cell(Null(), cell(Null(), { $: 'Con', head: Null(), tail: [] })) }, /Json node must be an object/],
        [{ $: 'Object', members: cell({ $: 'Pair', key: 'k', value: Null() }) }, /Invalid Member tag/],
        [{ $: 'Object', members: cell(member(1, Null())) }, /Member\.key must be a string/],
        [{ $: 'Object', members: cell(member('k', { $: 'Boolean', value: 'true' })) }, /Boolean\.value must be a boolean/],
        [{ $: 'Object', members: cell(member('k', { $: 'Array', items: cell({ $: 'Number', text: 1 }) })) }, /Number\.text must be a string/],
        [{ $: 'Object', members: cell(member('k', Null()), cell({ $: 'Member', key: 'j' })) }, /Member\.value missing/],
      ];
      for (const [value, pattern] of malformed) {
        assert.throws(() => assertJson(value), pattern);
        const nested = expectJsonCore({
          'Json.parse': (text: string) => ({ $: 'Done', value: text === 'null' ? Null() : value }),
          'Json.encode': () => ({ $: 'Done', value: 'null' }),
          'Json.number': () => ({ $: 'Done', value: NumberValue('0') }),
          'Json.default_limits': limits,
        });
        assert.throws(() => nested['Json.parse']('[]', limits()), pattern);
      }
      const extent = 200_000;
      let wide: unknown = nil;
      for (let index = 0; index < extent; index++) wide = cell(NumberValue(String(index)), wide);
      assertJson({ $: 'Array', items: wide });
      let deep: unknown = Null();
      for (let index = 0; index < extent; index++) deep = { $: 'Object', members: cell(member('k', deep)) };
      assertJson(deep);
      let buried: unknown = { $: 'Bogus' };
      for (let index = 0; index < extent; index++) buried = { $: 'Array', items: cell(buried) };
      assert.throws(() => assertJson(buried), /Invalid Json tag Bogus/);
      const fail = (layer: string, code: string): unknown => ({
        $: 'Fail',
        error: { $: layer, code: { $: code }, offset: 0n },
      });
      const crossed = expectJsonCore({
        'Json.parse': (input: string) => input === 'null' ? { $: 'Done', value: Null() } : fail('EncodeError', 'EOutputLimit'),
        'Json.encode': (value: Json) => value.$ === 'Null' ? { $: 'Done', value: 'null' } : fail('ParseError', 'PUnexpectedEnd'),
        'Json.number': (input: string) => input === '0' ? { $: 'Done', value: NumberValue('0') } : fail('EncodeError', 'EInvalidNumber'),
        'Json.default_limits': limits,
      });
      assert.throws(() => crossed['Json.parse']('[', limits()), /Expected ParseError, got EncodeError/);
      assert.throws(() => crossed['Json.encode'](Text('x'), limits()), /Expected EncodeError, got ParseError/);
      assert.throws(() => crossed['Json.number']('x', limits()), /Expected ParseError, got EncodeError/);
      const miscoded = expectJsonCore({
        'Json.parse': (input: string) => input === 'null' ? { $: 'Done', value: Null() } : fail('ParseError', 'EOutputLimit'),
        'Json.encode': (value: Json) => value.$ === 'Null' ? { $: 'Done', value: 'null' } : fail('EncodeError', 'PUnexpectedEnd'),
        'Json.number': () => ({ $: 'Done', value: NumberValue('0') }),
        'Json.default_limits': limits,
      });
      assert.throws(() => miscoded['Json.parse']('[', limits()), /Unknown error code/);
      assert.throws(() => miscoded['Json.encode'](Text('x'), limits()), /Unknown error code/);
      assert.throws(() => expectJsonCore({
        'Json.parse': () => ({
          $: 'Fail',
          error: { $: 'ParseError', code: { $: 'constructor' }, offset: 0n },
        }),
        'Json.encode': () => ({ $: 'Done', value: 'null' }),
        'Json.number': () => ({ $: 'Done', value: NumberValue('0') }),
        'Json.default_limits': limits,
      }), /Unknown error code/);
    },
  };
  yield {id:'api/supported-defs-defaults',run(core){const keys: Array<keyof JsonCore>=['Json.parse','Json.encode','Json.number','Json.default_limits'];for(const key of keys)assert.equal(typeof core[key],'function');assert.deepEqual(core['Json.default_limits'](),limits());}};
  yield {id:'bytes/strict-boundary',run(core){for(const bytes of [[0x80],[0xff],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe2,0x82]])assert.throws(()=>strictDecode(Uint8Array.from(bytes)));const bom=strictDecode(Uint8Array.from([0xef,0xbb,0xbf,0x7b,0x7d]));assert.equal(bom,'\ufeff{}');failure(core['Json.parse'](bom,limits()),'PLeadingBom',0);assertAst(done(core['Json.parse'](strictDecode(Buffer.from('"�"')),limits())),T('�'));}};
  for(const item of textCases())yield {id:item.id,run(core){checkText(core,item);}};
  for(const item of numberCases())yield {id:item.id,run(core){const result=core['Json.number'](item.text,item.limits);if(item.expect.kind==='fail')failure(result,item.expect.code,item.expect.offset);else{assert.ok(item.expect.value?.$==='Number');assertAst(done(result),item.expect.value);}}};
  for(const item of encoderCases())yield {id:item.id,run(core){const result=core['Json.encode'](item.value,item.limits);if(item.expect.kind==='fail')failure(result,item.expect.code,item.expect.offset);else{assert.ok(item.expect.text!==undefined);assert.equal(done(result),item.expect.text);}}};
}
