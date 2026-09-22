import assert from 'node:assert/strict';
import { expectBoolean, expectRecord, expectString } from '../types/runtime.ts';
import type { UnknownRecord } from '../types/runtime.ts';

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
export type ErrorLayer = JsonError['$'];
export type LayerError<L extends ErrorLayer> = Extract<JsonError, { $: L }>;
export type BendResult<T, E extends JsonError = JsonError> = { $: 'Done'; value: T } | { $: 'Fail'; error: E };

export interface JsonCore {
  'Json.parse'(text: string, bounds: Limits): BendResult<Json, ParseError>;
  'Json.encode'(value: Json, bounds: Limits): BendResult<string, EncodeError>;
  'Json.number'(text: string, bounds: Limits): BendResult<NumberJson, ParseError>;
  'Json.default_limits'(): Limits;
}

export interface SuccessExpectation {
  kind: 'done';
  value?: Json;
  encoded?: string;
  text?: string;
}
export interface FailureExpectation<C extends JsonErrorCode = JsonErrorCode> {
  kind: 'fail';
  code?: C;
  offset?: number | bigint;
}
export type Expectation<C extends JsonErrorCode = JsonErrorCode> = SuccessExpectation | FailureExpectation<C>;
export interface TextFixture {
  id: string;
  text: string;
  limits: Limits;
  expect: Expectation<ParseCode>;
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
export type ValueCheck<T> = (value: unknown) => asserts value is T;

function ownField(record: UnknownRecord, field: string, label: string): unknown {
  assert.ok(Object.hasOwn(record, field), `${label}.${field} missing`);
  return record[field];
}
export function assertLimits(value: unknown): asserts value is Limits {
  const record = expectRecord(value, 'Json.default_limits result');
  assert.ok(Object.hasOwn(record, '$'), 'Limits tag missing');
  assert.equal(record['$'], 'Limits', 'Invalid Limits tag');
  for (const field of limitFields) {
    assert.ok(Object.hasOwn(record, field), `Limits.${field} missing`);
    const amount = record[field];
    if (typeof amount !== 'bigint') throw new Error(`Limits.${field} must be a bigint`);
    assert.ok(amount >= 0n && amount <= 16777216n, `Limits.${field} outside contract`);
  }
}
// Deliberately iterative: neither Bend linked-list width nor tree depth uses the JS stack.
export function assertJson(value: unknown): asserts value is Json {
  const work: Array<readonly [unknown, 'json' | 'items' | 'members']> = [[value, 'json']];
  while (work.length > 0) {
    const task = work.pop();
    assert.ok(task);
    const [node, kind] = task;
    const record = expectRecord(node, 'Json node');
    const tag = ownField(record, '$', 'Json node');
    if (kind !== 'json') {
      if (tag === 'Nil') continue;
      assert.equal(tag, 'Con', `Invalid list tag ${String(tag)}`);
      work.push([ownField(record, 'tail', 'Con'), kind]);
      const head = ownField(record, 'head', 'Con');
      if (kind === 'items') {
        work.push([head, 'json']);
      } else {
        const member = expectRecord(head, 'Member');
        assert.equal(ownField(member, '$', 'Member'), 'Member', 'Invalid Member tag');
        expectString(ownField(member, 'key', 'Member'), 'Member.key');
        work.push([ownField(member, 'value', 'Member'), 'json']);
      }
      continue;
    }
    switch (tag) {
      case 'Null':
        break;
      case 'Boolean':
        expectBoolean(ownField(record, 'value', 'Boolean'), 'Boolean.value');
        break;
      case 'Number':
        expectString(ownField(record, 'text', 'Number'), 'Number.text');
        break;
      case 'Text':
        expectString(ownField(record, 'value', 'Text'), 'Text.value');
        break;
      case 'Array':
        work.push([ownField(record, 'items', 'Array'), 'items']);
        break;
      case 'Object':
        work.push([ownField(record, 'members', 'Object'), 'members']);
        break;
      default:
        throw new Error(`Invalid Json tag ${String(tag)}`);
    }
  }
}
export function assertNumberJson(value: unknown): asserts value is NumberJson {
  const record = expectRecord(value, 'Json.number value');
  assert.equal(ownField(record, '$', 'Json.number value'), 'Number', 'Json.number returned a non-Number tag');
  expectString(ownField(record, 'text', 'Number'), 'Number.text');
}
export function assertText(value: unknown): asserts value is string {
  expectString(value, 'Json.encode value');
}
const anyValue: ValueCheck<unknown> = () => {};

// Untyped input must name its error layer; only already-typed results may be rechecked without one.
export function assertResult<T, E extends JsonError>(result: BendResult<T, E>): BendResult<T, E>;
export function assertResult<T, L extends ErrorLayer>(
  result: unknown,
  check: ValueCheck<T>,
  layer: L,
): BendResult<T, LayerError<L>>;
export function assertResult(
  result: unknown,
  check: ValueCheck<unknown> = anyValue,
  layer?: ErrorLayer,
): BendResult<unknown> {
  assertResultShape(result, check, layer);
  return result;
}
function assertResultShape<T>(
  result: unknown,
  check: ValueCheck<T>,
  layer: ErrorLayer | undefined,
): asserts result is BendResult<T> {
  const record = expectRecord(result, 'Result');
  assert.ok(Object.hasOwn(record, '$'), 'Result tag missing');
  const tag = record['$'];
  assert.ok(tag === 'Done' || tag === 'Fail', `Invalid Result tag ${String(tag)}`);
  if (tag === 'Done') {
    assert.ok(Object.hasOwn(record, 'value'), 'Done.value missing');
    check(record['value']);
  } else {
    assert.ok(Object.hasOwn(record, 'error'), 'Fail.error missing');
    const error = expectRecord(record['error'], 'structured error');
    assert.ok(Object.hasOwn(error, '$'), 'Structured error tag missing');
    const errorTag = error['$'];
    assert.ok(errorTag === 'ParseError' || errorTag === 'EncodeError', 'Structured error missing');
    if (layer !== undefined && errorTag !== layer) throw new Error(`Expected ${layer}, got ${errorTag}`);
    assert.ok(Object.hasOwn(error, 'code'), 'Structured error code missing');
    const codeRecord = expectRecord(error['code'], 'structured error code');
    assert.ok(Object.hasOwn(codeRecord, '$'), 'Structured error code tag missing');
    const code = codeRecord['$'];
    if (typeof code !== 'string') throw new Error('Structured error code must be a string');
    const knownCodes: Readonly<Partial<Record<JsonErrorCode, true>>> = errorTag === 'ParseError'
      ? parseCodes
      : encodeCodes;
    assert.ok(Object.hasOwn(knownCodes, code), 'Unknown error code');
    assert.ok(Object.hasOwn(error, 'offset'), 'Structured error offset missing');
    const offset = error['offset'];
    if (typeof offset !== 'bigint') throw new Error('Structured error offset must be a bigint');
    assert.ok(offset >= 0n && offset <= 16777217n, 'Invalid error offset');
  }
}

// Raw Bend ABI: callability is checked, every return value stays unknown.
export interface JsonAbi {
  'Json.parse'(text: string, bounds: Limits): unknown;
  'Json.encode'(value: Json, bounds: Limits): unknown;
  'Json.number'(text: string, bounds: Limits): unknown;
  'Json.default_limits'(): unknown;
}
function callable(core: UnknownRecord, name: keyof JsonAbi): Function {
  const method = core[name];
  if (typeof method !== 'function') throw new Error(`${name} must be callable`);
  return method;
}
export function expectJsonAbi(value: unknown): JsonAbi {
  const core = expectRecord(value, 'Bend JSON module');
  const parse = callable(core, 'Json.parse');
  const encode = callable(core, 'Json.encode');
  const number = callable(core, 'Json.number');
  const defaultLimits = callable(core, 'Json.default_limits');
  return {
    'Json.parse': (text, bounds) => Reflect.apply(parse, core, [text, bounds]),
    'Json.encode': (json, bounds) => Reflect.apply(encode, core, [json, bounds]),
    'Json.number': (text, bounds) => Reflect.apply(number, core, [text, bounds]),
    'Json.default_limits': () => Reflect.apply(defaultLimits, core, []),
  };
}
export const expectParseResult = (value: unknown): BendResult<Json, ParseError> =>
  assertResult(value, assertJson, 'ParseError');
export const expectEncodeResult = (value: unknown): BendResult<string, EncodeError> =>
  assertResult(value, assertText, 'EncodeError');
export const expectNumberResult = (value: unknown): BendResult<NumberJson, ParseError> =>
  assertResult(value, assertNumberJson, 'ParseError');
export function expectLimitsValue(value: unknown): Limits {
  assertLimits(value);
  return value;
}
// Every call is validated, including full Json trees; callers never see an unchecked value.
export function checkedCore(abi: JsonAbi): JsonCore {
  const core: JsonCore = {
    'Json.parse': (text, bounds) => expectParseResult(abi['Json.parse'](text, bounds)),
    'Json.encode': (json, bounds) => expectEncodeResult(abi['Json.encode'](json, bounds)),
    'Json.number': (text, bounds) => expectNumberResult(abi['Json.number'](text, bounds)),
    'Json.default_limits': () => expectLimitsValue(abi['Json.default_limits']()),
  };
  const bounds = core['Json.default_limits']();
  const parsed = core['Json.parse']('null', bounds);
  assert.equal(parsed.$, 'Done', 'Json.parse ABI probe failed');
  if (parsed.$ === 'Done') assert.equal(parsed.value.$, 'Null', 'Json.parse returned an invalid probe value');
  const encoded = core['Json.encode'](Null(), bounds);
  assert.equal(encoded.$, 'Done', 'Json.encode ABI probe failed');
  if (encoded.$ === 'Done') assert.equal(encoded.value, 'null', 'Json.encode returned an invalid probe value');
  const numeric = core['Json.number']('0', bounds);
  assert.equal(numeric.$, 'Done', 'Json.number ABI probe failed');
  if (numeric.$ === 'Done') assert.equal(numeric.value.text, '0', 'Json.number returned an invalid probe value');
  return core;
}
export function expectJsonCore(value: unknown): JsonCore {
  return checkedCore(expectJsonAbi(value));
}
export function done<T>(result: BendResult<T>): T {
  assertResult(result);
  assert.equal(result.$, 'Done', result.$ === 'Fail'
    ? `${result.error.code.$} at ${result.error.offset}`
    : 'Expected success');
  return result.value;
}
export function failure<E extends JsonError>(
  result: BendResult<unknown, E>,
  code?: E['code']['$'],
  offset?: number | bigint,
): E {
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
