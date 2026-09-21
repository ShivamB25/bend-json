import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  limits,
  Null,
  NumberValue,
  Text,
  ArrayValue,
  ObjectValue,
  assertAst,
  done,
  assertFits,
  codepoints,
} from './support.ts';
import type { AstNode, Json, JsonCore, Limits } from './support.ts';

export const WARMUPS = 5;
export const SAMPLES = 20;
export const SAMPLE_MS = 5000;
export const TOTAL_MS = 600000;
export const OPERATIONS = ['parse', 'encode', 'equality', 'materialize-ast', 'materialize-text'] as const;
export type Operation = typeof OPERATIONS[number];
export interface BenchmarkFixture {
  id: string;
  value: Json;
  text: string;
  limits: Limits;
  inputBytes: number;
  inputCodepoints: number;
  outputCodepoints: number;
  values: number;
  depth: number;
}
export interface SampleStats {
  minMs: number;
  medianMs: number;
  maxMs: number;
}
export interface BenchmarkMetadata extends Omit<BenchmarkFixture, 'value' | 'text' | 'limits'> {
  limits: Record<string, string>;
}

// All expected trees are constructed independently of the parser. Draw order is fixed.
export function* fixtures(): Generator<BenchmarkFixture> {
  function fixture(id: string, value: Json, bound = limits()): BenchmarkFixture {
    const measured = assertFits(value, bound);
    return {
      id,
      value,
      text: measured.text,
      limits: bound,
      inputBytes: Buffer.byteLength(measured.text),
      inputCodepoints: measured.output,
      outputCodepoints: measured.output,
      values: measured.values,
      depth: measured.depth,
    };
  }
  for (const size of [1024, 4096, 16384, 65536, 100000]) {
    yield fixture(`ascii-${size}`, Text('a'.repeat(size)));
    const alphabets: Array<[string, readonly string[]]> = [
      ['escaped', ['\u0000', '\n', '"', '\\', '\t']],
      ['unicode', ['é', '😀', '中', 'e', '\u0301']],
    ];
    for (const [name, alphabet] of alphabets) {
      const chars = new Array<string>(size);
      for (let index = 0; index < size; index++) {
        const character = alphabet[index % alphabet.length];
        assert.ok(character !== undefined);
        chars[index] = character;
      }
      yield fixture(`${name}-${size}`, Text(chars.join('')));
    }
  }
  for (const size of [128, 512, 2048, 8192, 32768, 100000]) {
    yield fixture(
      `array-${size}`,
      ArrayValue(Array.from({ length: size }, (_, index) => NumberValue(String(index % 10)))),
      limits({ max_values: BigInt(size + 1 > 100000 ? size + 1 : 100000) }),
    );
  }
  const maximumDepth = Number(limits().max_depth);
  for (const depth of [...new Set([1, 8, 32, 64, maximumDepth - 1, maximumDepth])]
    .filter(value => value > 0 && value <= maximumDepth)) {
    let value: Json = Null();
    for (let index = 0; index < depth; index++) value = ArrayValue([value]);
    yield fixture(`depth-${depth}`, value);
  }
  const numbers = ['-0', '1E-07', '281474976710656'] as const;
  for (const size of [16, 64, 256, 1024]) {
    yield fixture(`mixed-${size}`, ArrayValue(Array.from({ length: size }, (_, index) => {
      const number = numbers[index % numbers.length];
      assert.ok(number !== undefined);
      return ObjectValue([
        ['n', NumberValue(number)],
        ['text', Text(`é😀中\u0000\n${index}`)],
        ['n', NumberValue('-0')],
      ]);
    })));
  }
}

// Iterative full traversal forces host ABI materialization; it never serializes the tree.
export function forceAst(value: Json): number {
  const work: AstNode[] = [value];
  let count = 0;
  while (work.length > 0) {
    const node = work.pop();
    assert.ok(node);
    count++;
    switch (node.$) {
      case 'Null':
      case 'Boolean':
      case 'Nil':
        break;
      case 'Number':
        count += codepoints(node.text);
        break;
      case 'Text':
        count += codepoints(node.value);
        break;
      case 'Array':
        work.push(node.items);
        break;
      case 'Object':
        work.push(node.members);
        break;
      case 'Member':
        count += codepoints(node.key);
        work.push(node.value);
        break;
      case 'Con':
        work.push(node.tail, node.head);
        break;
    }
  }
  return count;
}
export function stats(samples: readonly number[]): SampleStats {
  const sorted = [...samples].sort((left, right) => left - right);
  const minimum = sorted[0];
  const lowerMedian = sorted[9];
  const upperMedian = sorted[10];
  const maximum = sorted.at(-1);
  assert.ok(minimum !== undefined && lowerMedian !== undefined && upperMedian !== undefined && maximum !== undefined);
  return { minMs: minimum, medianMs: (lowerMedian + upperMedian) / 2, maxMs: maximum };
}
export function metadata(item: BenchmarkFixture): BenchmarkMetadata {
  const { value: _value, text: _text, limits: bounds, ...data } = item;
  return {
    ...data,
    limits: Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]),
    ),
  };
}
const emit = (value: object): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

async function main(): Promise<void> {
  // Runtime boundary: the parent imports fixture helpers without a Bend loader;
  // only the benchmark worker loads the .bend module after its preload hook.
  const loaded = await import('../json.bend');
  const Core = loaded.default as JsonCore;
  const bunVersion = process.versions['bun'];
  emit({ event: 'ready', runtime: bunVersion ? `Bun ${bunVersion}` : `Node ${process.version}` });
  let sink = 0;
  const campaignStart = performance.now();
  for (const item of fixtures()) {
    emit({ event: 'start', id: `${item.id}/correctness`, timeoutMs: SAMPLE_MS });
    const parsed = done(Core['Json.parse'](item.text, item.limits));
    assertAst(parsed, item.value);
    assert.equal(done(Core['Json.encode'](item.value, item.limits)), item.text);
    const astCount = forceAst(parsed);
    const textCount = codepoints(item.text);
    emit({ event: 'end', id: `${item.id}/correctness` });
    for (const operation of OPERATIONS) {
      const samples: number[] = [];
      const materialization: number[] = [];
      for (let index = -WARMUPS; index < SAMPLES; index++) {
        const id = `${item.id}/${operation}/${index}`;
        emit({ event: 'start', id, timeoutMs: SAMPLE_MS });
        const start = performance.now();
        let verifyOutput: () => void;
        switch (operation) {
          case 'parse': {
            const output = Core['Json.parse'](item.text, item.limits);
            verifyOutput = () => {
              const value = done(output);
              assert.equal(forceAst(value), astCount);
            };
            break;
          }
          case 'encode': {
            const output = Core['Json.encode'](item.value, item.limits);
            verifyOutput = () => {
              const value = done(output);
              assert.equal(codepoints(value), textCount);
              assert.equal(value, item.text);
            };
            break;
          }
          case 'equality':
            assertAst(parsed, item.value);
            verifyOutput = () => {};
            break;
          case 'materialize-ast': {
            const output = forceAst(parsed);
            verifyOutput = () => {
              assert.equal(output, astCount);
              sink ^= output;
            };
            break;
          }
          case 'materialize-text': {
            const output = codepoints(item.text);
            verifyOutput = () => {
              assert.equal(output, textCount);
              sink ^= output;
            };
            break;
          }
        }
        const stopped = performance.now();
        // Force and verify every output outside the core-call interval. ABI conversion
        // performed by the loader is necessarily included in the core-call interval.
        verifyOutput();
        const end = performance.now();
        if (end - start > SAMPLE_MS) throw new Error(`${id}: sample deadline exceeded`);
        if (end - campaignStart > TOTAL_MS) throw new Error('Benchmark campaign deadline exceeded');
        if (index >= 0) {
          samples.push(stopped - start);
          materialization.push(end - stopped);
        }
        emit({ event: 'end', id });
      }
      emit({
        event: 'measurement',
        ...metadata(item),
        operation,
        warmups: WARMUPS,
        samples: SAMPLES,
        batch: 1,
        ...stats(samples),
        sampleMs: samples,
        postCallForceAndCheckMs: materialization,
        rssBytes: process.memoryUsage().rss,
        timer: 'performance.now',
        timing: 'core call including eager ABI conversion; traversal/check excluded and separately recorded',
      });
    }
  }
  emit({ event: 'summary', status: 'pass', sink, rssBytes: process.memoryUsage().rss });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    emit({ event: 'failure', message: error instanceof Error ? error.stack ?? error.message : String(error) });
    process.exitCode = 1;
  });
}
