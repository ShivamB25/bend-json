import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { limits, Null, NumberValue, Text, ArrayValue, ObjectValue, assertAst, done, assertFits, codepoints } from './support.mjs';

export const WARMUPS = 5;
export const SAMPLES = 20;
export const SAMPLE_MS = 5000;
export const TOTAL_MS = 600000;
export const OPERATIONS = ['parse', 'encode', 'equality', 'materialize-ast', 'materialize-text'];

// All expected trees are constructed independently of the parser. Draw order is fixed.
export function* fixtures() {
  function fixture(id, value, bound = limits()) {
    const m = assertFits(value, bound);
    return { id, value, text: m.text, limits: bound, inputBytes: Buffer.byteLength(m.text), inputCodepoints: m.output, outputCodepoints: m.output, values: m.values, depth: m.depth };
  }
  for (const size of [1024, 4096, 16384, 65536, 100000]) {
    yield fixture(`ascii-${size}`, Text('a'.repeat(size)));
    for (const [name, alphabet] of [['escaped', ['\u0000', '\n', '"', '\\', '\t']], ['unicode', ['é', '😀', '中', 'e', '\u0301']]]) {
      const chars = new Array(size);
      for (let i = 0; i < size; i++) chars[i] = alphabet[i % alphabet.length];
      yield fixture(`${name}-${size}`, Text(chars.join('')));
    }
  }
  for (const size of [128, 512, 2048, 8192, 32768, 100000]) {
    yield fixture(`array-${size}`, ArrayValue(Array.from({ length: size }, (_, i) => NumberValue(String(i % 10)))), limits({ max_values: BigInt(size + 1 > 100000 ? size + 1 : 100000) }));
  }
  const D = Number(limits().max_depth);
  for (const depth of [...new Set([1, 8, 32, 64, D - 1, D])].filter(n => n > 0 && n <= D)) {
    let value = Null();
    for (let i = 0; i < depth; i++) value = ArrayValue([value]);
    yield fixture(`depth-${depth}`, value);
  }
  const numbers = ['-0', '1E-07', '281474976710656'];
  for (const size of [16, 64, 256, 1024]) {
    yield fixture(`mixed-${size}`, ArrayValue(Array.from({ length: size }, (_, i) => ObjectValue([
      ['n', NumberValue(numbers[i % numbers.length])], ['text', Text(`é😀中\u0000\n${i}`)], ['n', NumberValue('-0')],
    ]))));
  }
}

// Iterative full traversal forces host ABI materialization; it never serializes the tree.
export function forceAst(value) {
  const work = [value];
  let count = 0;
  while (work.length) {
    const node = work.pop(); count++;
    switch (node.$) {
      case 'Null': case 'Boolean': case 'Nil': break;
      case 'Number': count += codepoints(node.text); break;
      case 'Text': count += codepoints(node.value); break;
      case 'Array': work.push(node.items); break;
      case 'Object': work.push(node.members); break;
      case 'Member': count += codepoints(node.key); work.push(node.value); break;
      case 'Con': work.push(node.tail, node.head); break;
      default: throw new Error(`Unexpected materialization tag ${node.$}`);
    }
  }
  return count;
}
export function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { minMs: sorted[0], medianMs: (sorted[9] + sorted[10]) / 2, maxMs: sorted.at(-1) };
}
export function metadata(item) {
  const { value, text, ...data } = item;
  return { ...data, limits: Object.fromEntries(Object.entries(data.limits).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])) };
}
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');

async function main() {
  const { default: Core } = await import('../json.bend');
  emit({ event: 'ready', runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}` });
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
      const samples = [], materialization = [];
      for (let i = -WARMUPS; i < SAMPLES; i++) {
        const id = `${item.id}/${operation}/${i}`;
        emit({ event: 'start', id, timeoutMs: SAMPLE_MS });
        const start = performance.now();
        let output;
        if (operation === 'parse') output = Core['Json.parse'](item.text, item.limits);
        else if (operation === 'encode') output = Core['Json.encode'](item.value, item.limits);
        else if (operation === 'equality') assertAst(parsed, item.value);
        else if (operation === 'materialize-ast') output = forceAst(parsed);
        else output = codepoints(item.text);
        const stopped = performance.now();
        // Force and verify every output outside the core-call interval. ABI conversion
        // performed by the loader is necessarily included in the core-call interval.
        if (operation === 'parse') { output = done(output); assert.equal(forceAst(output), astCount); }
        else if (operation === 'encode') { output = done(output); assert.equal(codepoints(output), textCount); assert.equal(output, item.text); }
        else if (operation === 'materialize-ast') { assert.equal(output, astCount); sink ^= output; }
        else if (operation === 'materialize-text') { assert.equal(output, textCount); sink ^= output; }
        const end = performance.now();
        if (end - start > SAMPLE_MS) throw new Error(`${id}: sample deadline exceeded`);
        if (end - campaignStart > TOTAL_MS) throw new Error('Benchmark campaign deadline exceeded');
        if (i >= 0) { samples.push(stopped - start); materialization.push(end - stopped); }
        emit({ event: 'end', id });
      }
      emit({ event: 'measurement', ...metadata(item), operation, warmups: WARMUPS, samples: SAMPLES, batch: 1, ...stats(samples), sampleMs: samples, postCallForceAndCheckMs: materialization, rssBytes: process.memoryUsage().rss, timer: 'performance.now', timing: 'core call including eager ABI conversion; traversal/check excluded and separately recorded' });
    }
  }
  emit({ event: 'summary', status: 'pass', sink, rssBytes: process.memoryUsage().rss });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { emit({ event: 'failure', message: error.stack ?? String(error) }); process.exitCode = 1; });
}
