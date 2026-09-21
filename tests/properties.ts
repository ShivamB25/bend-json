import assert from 'node:assert/strict';
import {
  limits,
  propertyLimits,
  Null,
  BooleanValue,
  NumberValue,
  Text,
  ArrayValue,
  ObjectValue,
  assertAst,
  done,
  assertFits,
  encodeExpected,
  codepoints,
} from './support.ts';
import type { Json, Limits, TestCase } from './support.ts';

type Rng = () => number;
interface Budget {
  left: number;
}
export interface GeneratedFixture {
  id: string;
  value: Json;
  text: string;
  limits: Limits;
}
export type HostJson = null | boolean | number | string | HostJson[] | { [key: string]: HostJson };
export interface CommonGeneratedFixture extends GeneratedFixture {
  host: HostJson;
}

export const seeds = [0x00000001, 0x82590001, 0xC0FFEE01] as const;
export function xorshift(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}
const edges = [
  '', 'a', 'é', 'e\u0301', '中文', '😀', '𝄞', '\0', '\b\f\n\r\t', '"\\/',
  '\u007f', '\ufdd0', '\ufffe', '\uffff', '\u2028\u2029', '\ufeff',
  '\u{1fffe}', '\u{10fffe}', '\u{10ffff}',
] as const;
const keys = ['', 'b', 'a', 'b', '2', '1', '0', '__proto__', 'constructor', 'é', 'e\u0301'] as const;
function pick<T>(values: readonly T[], index: number): T {
  const selected = values[index];
  assert.ok(selected !== undefined);
  return selected;
}
function randomString(rng: Rng): string {
  // Draw order: length first, then one alphabet selection per scalar slot.
  const alphabet = ['a', 'é', '中', '😀', '\0', '"', '\\', '\n', '\ufeff', '\u{10ffff}'] as const;
  const length = rng() % 65;
  const chars: string[] = [];
  for (let index = 0; index < length; index++) chars.push(pick(alphabet, rng() % alphabet.length));
  return chars.join('');
}
function randomNumber(rng: Rng): string {
  // Grammar generation, never a random float. Fixed choices preserve spelling variation.
  const variants = ['0', '-0', '1.5', '1e3', '1E-07', '281474976710656', '0e+1', '-0.0', '1E+0007', '1e400', '1e-10000000'] as const;
  const variant = rng() % 3;
  if (variant === 0) return pick(variants, rng() % variants.length);
  const negative = rng() % 2 === 0 ? '-' : '';
  const length = 1 + rng() % 24;
  let output = negative + String(1 + rng() % 9);
  for (let index = 1; index < length; index++) output += String(rng() % 10);
  if (variant === 2) {
    const fraction = 1 + rng() % 12;
    output += '.';
    for (let index = 0; index < fraction; index++) output += String(rng() % 10);
    output += `${rng() % 2 ? 'e' : 'E'}${rng() % 2 ? '+' : '-'}${String(rng() % 100000)}`;
  }
  return output;
}
function generatedValue(rng: Rng, budget: Budget, depth: number): Json {
  assert.ok(budget.left > 0);
  budget.left--;
  const kind = rng() % (depth === 6 || budget.left === 0 ? 4 : 6);
  switch (kind) {
    case 0:
      return Null();
    case 1:
      return BooleanValue((rng() & 1) === 1);
    case 2:
      return NumberValue(randomNumber(rng));
    case 3:
      return Text(rng() % 2 ? pick(edges, rng() % edges.length) : randomString(rng));
    case 4: {
      const count = rng() % 9;
      const items: Json[] = [];
      for (let index = 0; index < count && budget.left > 0; index++) {
        items.push(generatedValue(rng, budget, depth + 1));
      }
      return ArrayValue(items);
    }
    default: {
      const count = rng() % 9;
      const members: Array<[string, Json]> = [];
      let previous = '';
      for (let index = 0; index < count && budget.left > 0; index++) {
        const choice = rng() % 4;
        const key = choice === 0 && index > 0
          ? previous
          : choice === 1
            ? randomString(rng)
            : pick(keys, rng() % keys.length);
        previous = key;
        members.push([key, generatedValue(rng, budget, depth + 1)]);
      }
      return ObjectValue(members);
    }
  }
}
export function* generated(): Generator<GeneratedFixture> {
  for (const seed of seeds) {
    const rng = xorshift(seed);
    for (let index = 0; index < 1000; index++) {
      // Every sixteenth fixture guarantees duplicates/order/special keys, rather than hoping a seed draws them.
      const ast = index % 16 === 0
        ? ObjectValue([
            ['', Null()],
            ['b', generatedValue(rng, { left: 120 }, 1)],
            ['a', NumberValue('0')],
            ['b', NumberValue('-0')],
            ['2', Text('😀')],
            ['1', Text('\0')],
            ['__proto__', Null()],
            ['constructor', BooleanValue(true)],
          ])
        : generatedValue(rng, { left: 128 }, 0);
      const measured = assertFits(ast, propertyLimits);
      assert.ok(measured.depth <= 6 && measured.values <= 128 && measured.string <= 64 && measured.number <= 64);
      yield {
        id: `generated/${seed.toString(16).padStart(8, '0')}/${index}`,
        value: ast,
        text: measured.text,
        limits: propertyLimits,
      };
    }
  }
}
function commonValue(rng: Rng, depth: number): { ast: Json; host: HostJson } {
  const kind = rng() % (depth === 3 ? 4 : 6);
  if (kind === 0) return { ast: Null(), host: null };
  if (kind === 1) {
    const value = Boolean(rng() & 1);
    return { ast: BooleanValue(value), host: value };
  }
  if (kind === 2) {
    const value = (rng() % 2000001) - 1000000;
    return { ast: NumberValue(String(value)), host: value };
  }
  if (kind === 3) {
    const value = pick(edges, rng() % edges.length);
    return { ast: Text(value), host: value };
  }
  const count = rng() % 5;
  if (kind === 4) {
    const items: Json[] = [];
    const host: HostJson[] = [];
    for (let index = 0; index < count; index++) {
      const child = commonValue(rng, depth + 1);
      items.push(child.ast);
      host.push(child.host);
    }
    return { ast: ArrayValue(items), host };
  }
  const members: Array<[string, Json]> = [];
  const host: { [key: string]: HostJson } = {};
  for (let index = 0; index < count; index++) {
    const child = commonValue(rng, depth + 1);
    const key = `k:${index}:${rng() % 100}`;
    members.push([key, child.ast]);
    host[key] = child.host;
  }
  return { ast: ObjectValue(members), host };
}
export function* commonGenerated(): Generator<CommonGeneratedFixture> {
  for (const seed of seeds) {
    const rng = xorshift(seed ^ 0x51A7E123);
    for (let index = 0; index < 100; index++) {
      const value = commonValue(rng, 0);
      yield {
        id: `oracle/${seed.toString(16)}/${index}`,
        value: value.ast,
        host: value.host,
        text: assertFits(value.ast, propertyLimits).text,
        limits: propertyLimits,
      };
    }
  }
}
export function whitespace(text: string): string {
  const output = [' \t\r\n'];
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      output.push(character);
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
      output.push(character);
    } else if ('{}[],:'.includes(character)) {
      output.push(' \t', character, '\r\n');
    } else {
      output.push(character);
    }
  }
  output.push('\n\r\t ');
  return output.join('');
}
export function escapedScalars(text: string): string {
  const output: string[] = [];
  let quoted = false;
  let escaped = false;
  let hexRemaining = 0;
  for (const character of text) {
    if (!quoted) {
      output.push(character);
      if (character === '"') quoted = true;
    } else if (hexRemaining > 0) {
      output.push(character);
      hexRemaining--;
    } else if (escaped) {
      output.push(character);
      escaped = false;
      if (character === 'u') hexRemaining = 4;
    } else if (character === '\\') {
      output.push(character);
      escaped = true;
    } else if (character === '"') {
      output.push(character);
      quoted = false;
    } else {
      const codepoint = character.codePointAt(0);
      assert.ok(codepoint !== undefined);
      if (codepoint <= 0xffff) output.push(`\\u${codepoint.toString(16).padStart(4, '0')}`);
      else {
        const scalar = codepoint - 65536;
        output.push(
          `\\u${(55296 + (scalar >>> 10)).toString(16)}`,
          `\\u${(56320 + (scalar & 1023)).toString(16)}`,
        );
      }
    }
  }
  return output.join('');
}
export function* largeFixtures(): Generator<GeneratedFixture> {
  for (const size of [1000, 10000, 100000, 262144]) {
    const value = Text(`${'a'.repeat(size - 1)}😀`);
    yield { id: `large/string/${size}`, value, text: encodeExpected(value), limits: limits() };
  }
  for (const size of [128, 8192, 99999]) {
    const value = ArrayValue(Array.from({ length: size }, () => Null()));
    yield { id: `large/array/${size}`, value, text: encodeExpected(value), limits: limits() };
  }
}
export function* cases(): Generator<TestCase> {
  yield {
    id: 'harness/escape-transformation',
    run() {
      const value = 'A\0"\\\n😀';
      const text = encodeExpected(Text(value));
      const escaped = escapedScalars(text);
      assert.equal(JSON.parse(escaped), value);
      assert.equal(JSON.parse(escapedScalars(escaped)), value);
    },
  };
  yield {
    id: 'comparator/large-width-depth',
    run() {
      const left = ArrayValue(Array.from({ length: 100000 }, () => NumberValue('1')));
      const right = ArrayValue(Array.from({ length: 100000 }, () => NumberValue('1')));
      assertAst(left, right);
      let cursor = right.items;
      for (let index = 0; index < 99999; index++) {
        assert.equal(cursor.$, 'Con');
        cursor = cursor.tail;
      }
      assert.equal(cursor.$, 'Con');
      cursor.head = NumberValue('2');
      assert.throws(() => assertAst(left, right));
      let first: Json = Null();
      let second: Json = Null();
      for (let index = 0; index < 10000; index++) {
        first = ArrayValue([first]);
        second = ArrayValue([second]);
      }
      assertAst(first, second);
      assert.throws(() => assertAst(
        ObjectValue([['a', Null()], ['a', BooleanValue(true)]]),
        ObjectValue([['a', BooleanValue(true)], ['a', Null()]]),
      ));
      assert.throws(() => assertAst(NumberValue('-0'), NumberValue('0')));
    },
  };
  for (const item of generated()) {
    yield {
      id: item.id,
      run(core) {
        const encoded = done(core['Json.encode'](item.value, item.limits));
        assert.equal(encoded, item.text);
        assertAst(done(core['Json.parse'](encoded, item.limits)), item.value);
        assertAst(done(core['Json.parse'](whitespace(item.text), item.limits)), item.value);
        const escaped = escapedScalars(item.text);
        assert.ok(codepoints(escaped) <= Number(item.limits.max_input));
        assertAst(done(core['Json.parse'](escaped, item.limits)), item.value);
      },
    };
  }
  for (const item of commonGenerated()) {
    yield {
      id: item.id,
      run(core) {
        assert.deepEqual(JSON.parse(item.text), item.host);
        const encoded = done(core['Json.encode'](item.value, item.limits));
        assert.deepEqual(JSON.parse(encoded), item.host);
        assertAst(done(core['Json.parse'](JSON.stringify(item.host), item.limits)), item.value);
      },
    };
  }
  for (const item of largeFixtures()) {
    yield {
      id: item.id,
      run(core) {
        assertAst(done(core['Json.parse'](item.text, item.limits)), item.value);
        assert.equal(done(core['Json.encode'](item.value, item.limits)), item.text);
      },
    };
  }
}
