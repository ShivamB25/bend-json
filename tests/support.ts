import assert from 'node:assert/strict';

export const parseCodeValues = [
  'PUnexpectedEnd', 'PUnexpectedCharacter', 'PExpectedColon', 'PExpectedCommaOrEnd',
  'PInvalidNumber', 'PInvalidEscape', 'PInvalidUnicodeEscape', 'PUnpairedSurrogate',
  'PInvalidScalar', 'PLeadingBom', 'PTrailingContent', 'PInputLimit', 'PDepthLimit',
  'PNumberLimit', 'PStringLimit', 'PValueLimit', 'PInvalidLimits',
] as const;
export type ParseCode = typeof parseCodeValues[number];
export const encodeCodeValues = [
  'EInvalidNumber', 'EInvalidScalar', 'EDepthLimit', 'ENumberLimit', 'EStringLimit',
  'EValueLimit', 'EOutputLimit', 'EInvalidLimits',
] as const;
export type EncodeCode = typeof encodeCodeValues[number];
export type JsonErrorCode = ParseCode | EncodeCode;
export const parseCodes = Object.fromEntries(
  parseCodeValues.map(code => [code, true]),
) as Readonly<Record<ParseCode, true>>;
export const encodeCodes = Object.fromEntries(
  encodeCodeValues.map(code => [code, true]),
) as Readonly<Record<EncodeCode, true>>;

export interface Limits {
  $: 'Limits';
  max_input: bigint;
  max_depth: bigint;
  max_number: bigint;
  max_string: bigint;
  max_values: bigint;
  max_output: bigint;
}
export type LimitField = Exclude<keyof Limits, '$'>;
export const limitFields = [
  'max_input', 'max_depth', 'max_number', 'max_string', 'max_values', 'max_output',
] as const satisfies readonly LimitField[];

export interface Nil {
  $: 'Nil';
}
export interface Con<T> {
  $: 'Con';
  head: T;
  tail: BendList<T>;
}
export type BendList<T> = Nil | Con<T>;
export interface NullJson {
  $: 'Null';
}
export interface BooleanJson {
  $: 'Boolean';
  value: boolean;
}
export interface NumberJson {
  $: 'Number';
  text: string;
}
export interface TextJson {
  $: 'Text';
  value: string;
}
export interface ArrayJson {
  $: 'Array';
  items: BendList<Json>;
}
export interface Member {
  $: 'Member';
  key: string;
  value: Json;
}
export interface ObjectJson {
  $: 'Object';
  members: BendList<Member>;
}
export type Json = NullJson | BooleanJson | NumberJson | TextJson | ArrayJson | ObjectJson;
export type AstNode = Json | Member | BendList<Json> | BendList<Member>;

export interface ParseError {
  $: 'ParseError';
  code: { $: ParseCode };
  offset: bigint;
}
export interface EncodeError {
  $: 'EncodeError';
  code: { $: EncodeCode };
  offset: bigint;
}
export type JsonError = ParseError | EncodeError;
export type BendResult<T> = { $: 'Done'; value: T } | { $: 'Fail'; error: JsonError };

export interface JsonCore {
  'Json.parse'(text: string, bounds: Limits): BendResult<Json>;
  'Json.encode'(value: Json, bounds: Limits): BendResult<string>;
  'Json.number'(text: string, bounds: Limits): BendResult<NumberJson>;
  'Json.default_limits'(): Limits;
}

export interface SuccessExpectation {
  kind: 'done';
  value?: Json;
  encoded?: string;
  text?: string;
}
export interface FailureExpectation {
  kind: 'fail';
  code?: JsonErrorCode;
  offset?: number | bigint;
}
export type Expectation = SuccessExpectation | FailureExpectation;
export interface TextFixture {
  id: string;
  text: string;
  limits: Limits;
  expect: Expectation;
}
export interface TestCase<Detail = unknown> {
  id: string;
  prepare?: () => void;
  run: (core: JsonCore) => Detail | void;
}

export function limits(overrides: Partial<Omit<Limits, '$'>> = {}): Limits {
  return {
    $: 'Limits',
    max_input: 1048576n,
    max_depth: 128n,
    max_number: 4096n,
    max_string: 262144n,
    max_values: 100000n,
    max_output: 2097152n,
    ...overrides,
  };
}
export const corpusLimits = limits({ max_depth: 1024n });
export const propertyLimits = limits({
  max_input: 131072n,
  max_depth: 16n,
  max_number: 128n,
  max_string: 128n,
  max_values: 256n,
  max_output: 131072n,
});
export const Null = (): NullJson => ({ $: 'Null' });
export const BooleanValue = (value: boolean): BooleanJson => ({ $: 'Boolean', value });
export const NumberValue = (text: string): NumberJson => ({ $: 'Number', text });
export const Text = (value: string): TextJson => ({ $: 'Text', value });
export function list<T>(items: readonly T[]): BendList<T> {
  let tail: BendList<T> = { $: 'Nil' };
  for (let index = items.length - 1; index >= 0; index--) {
    const head = items[index];
    assert.ok(head !== undefined);
    tail = { $: 'Con', head, tail };
  }
  return tail;
}
export const ArrayValue = (items: readonly Json[]): ArrayJson => ({ $: 'Array', items: list(items) });
export const ObjectValue = (members: readonly (readonly [string, Json])[]): ObjectJson => ({
  $: 'Object',
  members: list(members.map(([key, value]): Member => ({ $: 'Member', key, value }))),
});
export function codepoints(text: string): number {
  let count = 0;
  for (const _unused of text) count++;
  return count;
}


export function assertResult<T>(result: BendResult<T>): BendResult<T> {
  assert.ok(typeof result === 'object' && result !== null, 'Result must be an object');
  assert.ok(result.$ === 'Done' || result.$ === 'Fail', `Invalid Result tag ${String(result.$)}`);
  if (result.$ === 'Done') {
    assert.ok(Object.hasOwn(result, 'value'), 'Done.value missing');
  } else {
    const error: JsonError = result.error;
    assert.ok(error.$ === 'ParseError' || error.$ === 'EncodeError', 'Structured error missing');
    const knownCodes: Readonly<Partial<Record<JsonErrorCode, true>>> = error.$ === 'ParseError'
      ? parseCodes
      : encodeCodes;
    assert.ok(knownCodes[error.code.$], 'Unknown error code');
    assert.equal(typeof error.offset, 'bigint');
    assert.ok(error.offset >= 0n && error.offset <= 16777217n, 'Invalid error offset');
  }
  return result;
}
export function done<T>(result: BendResult<T>): T {
  assertResult(result);
  assert.equal(result.$, 'Done', result.$ === 'Fail'
    ? `${result.error.code.$} at ${result.error.offset}`
    : 'Expected success');
  return result.value;
}
export function failure(
  result: BendResult<unknown>,
  code?: JsonErrorCode,
  offset?: number | bigint,
): JsonError {
  assertResult(result);
  assert.equal(result.$, 'Fail', 'Expected structured failure');
  if (code !== undefined) assert.equal(result.error.code.$, code);
  if (offset !== undefined) assert.equal(result.error.offset, BigInt(offset));
  return result.error;
}

// Deliberately iterative: neither Bend linked-list width nor tree depth uses the JS stack.
export function assertAst(actual: Json, expected: Json): void {
  const work: Array<[AstNode, AstNode, string]> = [[actual, expected, 'root']];
  while (work.length > 0) {
    const task = work.pop();
    assert.ok(task);
    const [observed, wanted, path] = task;
    assert.equal(observed.$, wanted.$, `${path}: tag`);
    switch (wanted.$) {
      case 'Null':
      case 'Nil':
        break;
      case 'Boolean':
        assert.equal((observed as BooleanJson).value, wanted.value, `${path}: boolean`);
        break;
      case 'Number':
        assert.equal((observed as NumberJson).text, wanted.text, `${path}: number lexeme`);
        break;
      case 'Text':
        assert.equal((observed as TextJson).value, wanted.value, `${path}: string`);
        break;
      case 'Array':
        work.push([(observed as ArrayJson).items, wanted.items, 'array items']);
        break;
      case 'Object':
        work.push([(observed as ObjectJson).members, wanted.members, 'object members']);
        break;
      case 'Member':
        assert.equal((observed as Member).key, wanted.key, `${path}: key/order`);
        work.push([(observed as Member).value, wanted.value, 'member value']);
        break;
      case 'Con': {
        const item = observed as Con<Json> | Con<Member>;
        work.push([item.tail, wanted.tail, 'list tail'], [item.head, wanted.head, 'list head']);
        break;
      }
    }
  }
}

// Test expectation renderer only. No parser or production fallback consumes this code.
export function quote(text: string): string {
  let output = '"';
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    assert.ok(codepoint !== undefined);
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (codepoint === 8) output += '\\b';
    else if (codepoint === 9) output += '\\t';
    else if (codepoint === 10) output += '\\n';
    else if (codepoint === 12) output += '\\f';
    else if (codepoint === 13) output += '\\r';
    else if (codepoint < 32) output += `\\u${codepoint.toString(16).padStart(4, '0')}`;
    else output += character;
  }
  return `${output}"`;
}
type EncodeTask = { kind: 'value'; value: Json } | { kind: 'text'; text: string };
export function encodeExpected(value: Json): string {
  const work: EncodeTask[] = [{ kind: 'value', value }];
  const parts: string[] = [];
  while (work.length > 0) {
    const task = work.pop();
    assert.ok(task);
    if (task.kind === 'text') {
      parts.push(task.text);
      continue;
    }
    const node = task.value;
    switch (node.$) {
      case 'Null':
        parts.push('null');
        break;
      case 'Boolean':
        parts.push(node.value ? 'true' : 'false');
        break;
      case 'Number':
        parts.push(node.text);
        break;
      case 'Text':
        parts.push(quote(node.value));
        break;
      case 'Array': {
        const items: Json[] = [];
        for (let cursor = node.items; cursor.$ === 'Con'; cursor = cursor.tail) items.push(cursor.head);
        work.push({ kind: 'text', text: ']' });
        for (let index = items.length - 1; index >= 0; index--) {
          const item = items[index];
          assert.ok(item);
          work.push({ kind: 'value', value: item });
          if (index > 0) work.push({ kind: 'text', text: ',' });
        }
        work.push({ kind: 'text', text: '[' });
        break;
      }
      case 'Object': {
        const members: Member[] = [];
        for (let cursor = node.members; cursor.$ === 'Con'; cursor = cursor.tail) members.push(cursor.head);
        work.push({ kind: 'text', text: '}' });
        for (let index = members.length - 1; index >= 0; index--) {
          const member = members[index];
          assert.ok(member);
          work.push(
            { kind: 'value', value: member.value },
            { kind: 'text', text: ':' },
            { kind: 'text', text: quote(member.key) },
          );
          if (index > 0) work.push({ kind: 'text', text: ',' });
        }
        work.push({ kind: 'text', text: '{' });
        break;
      }
    }
  }
  return parts.join('');
}
export interface Measurement {
  values: number;
  depth: number;
  string: number;
  number: number;
  output: number;
  text: string;
}
export function measure(value: Json): Measurement {
  let values = 0;
  let depth = 0;
  let string = 0;
  let number = 0;
  const work: Array<[Json, number]> = [[value, 0]];
  while (work.length > 0) {
    const task = work.pop();
    assert.ok(task);
    const [node, currentDepth] = task;
    values++;
    if (node.$ === 'Text') string = Math.max(string, codepoints(node.value));
    if (node.$ === 'Number') number = Math.max(number, codepoints(node.text));
    if (node.$ === 'Array') {
      depth = Math.max(depth, currentDepth + 1);
      for (let cursor = node.items; cursor.$ === 'Con'; cursor = cursor.tail) {
        work.push([cursor.head, currentDepth + 1]);
      }
    } else if (node.$ === 'Object') {
      depth = Math.max(depth, currentDepth + 1);
      for (let cursor = node.members; cursor.$ === 'Con'; cursor = cursor.tail) {
        string = Math.max(string, codepoints(cursor.head.key));
        work.push([cursor.head.value, currentDepth + 1]);
      }
    }
  }
  const text = encodeExpected(value);
  return { values, depth, string, number, output: codepoints(text), text };
}
export function assertFits(value: Json, bounds: Limits): Measurement {
  const measured = measure(value);
  const counts: ReadonlyArray<readonly [LimitField, number]> = [
    ['max_values', measured.values],
    ['max_depth', measured.depth],
    ['max_string', measured.string],
    ['max_number', measured.number],
    ['max_output', measured.output],
    ['max_input', measured.output],
  ];
  for (const [field, count] of counts) {
    assert.ok(BigInt(count) <= bounds[field], `${field}: fixture exceeds its limit`);
  }
  return measured;
}
export function checkText(core: JsonCore, item: TextFixture): Json | JsonError {
  const result = core['Json.parse'](item.text, item.limits);
  if (item.expect.kind === 'fail') return failure(result, item.expect.code, item.expect.offset);
  const value = done(result);
  if (item.expect.value !== undefined) assertAst(value, item.expect.value);
  if (item.expect.encoded !== undefined) {
    assert.equal(done(core['Json.encode'](value, item.limits)), item.expect.encoded);
  }
  return value;
}
export function strictDecode(bytes: Uint8Array<ArrayBufferLike>): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
