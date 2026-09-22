import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../scripts/tools.ts';
import {
  propertyLimits,
  Null,
  BooleanValue,
  NumberValue,
  Text,
  done,
  failure,
  assertResult,
  assertAst,
  codepoints,
} from './support.ts';
import type { Json, JsonCore, Limits, ParseCode, TestCase } from './support.ts';
import { xorshift, commonGenerated, whitespace, escapedScalars } from './properties.ts';

export const mutationSeed = 0x8259F00D;
export type MutationKind = 'invalid' | 'equivalent' | 'unconstrained';
export interface MutationFixture {
  id: string;
  text: string;
  limits: Limits;
  kind: MutationKind;
  value?: Json;
  code?: ParseCode;
  origin: string;
  seed: number;
  hash: string;
}
export interface MutationMinimized {
  status: string;
  text?: string;
  attempts?: readonly unknown[];
  [key: string]: unknown;
}
export interface NativeMutationMinimized {
  status: 'minimized' | 'attempt-limit' | 'recovery-deadline';
  text: string;
  attempts: number;
  sha256: string;
  failureClass: string;
}
function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function pick<T>(values: readonly T[], index: number): T {
  const selected = values[index];
  assert.ok(selected !== undefined);
  return selected;
}
export function* mutationFixtures(): Generator<MutationFixture> {
  const rng = xorshift(mutationSeed);
  const origins = [...commonGenerated()];
  assert.ok(origins.length > 0);
  for (let index = 0; index < 2048; index++) {
    const origin = pick(origins, rng() % origins.length);
    const group = index % 8;
    let text: string;
    let kind: MutationKind;
    let value: Json | undefined;
    // Draw order is origin index, then the branch's index/character draws. All mutations are original.
    if (group === 0) {
      text = `[${rng() % 100},,${rng() % 100}]`;
      kind = 'invalid';
    } else if (group === 1) {
      text = `"a\\q${String(rng() % 100)}"`;
      kind = 'invalid';
    } else if (group === 2) {
      text = `"a${String.fromCharCode(rng() % 32)}b"`;
      kind = 'invalid';
    } else if (group === 3) {
      text = pick(['01', '1e+', '1.', '--1'] as const, rng() % 4);
      kind = 'invalid';
    } else if (group === 4) {
      text = whitespace(origin.text);
      kind = 'equivalent';
      value = origin.value;
    } else if (group === 5) {
      text = escapedScalars(origin.text);
      kind = 'equivalent';
      value = origin.value;
    } else {
      const chars = [...origin.text];
      const operation = rng() % 3;
      const at = rng() % (chars.length + 1);
      if (operation === 0) chars.splice(at, 1);
      else if (operation === 1) {
        const insertions = ['[', ']', '{', '}', ',', ':', '"', '\\', '0', '-', 'a', ' ', '\n', '😀'] as const;
        chars.splice(at, 0, pick(insertions, rng() % insertions.length));
      } else {
        chars.length = at;
      }
      text = chars.join('');
      kind = 'unconstrained';
    }
    assert.ok(codepoints(text) <= 65536);
    yield {
      id: `mutation/${index.toString().padStart(4, '0')}`,
      text,
      limits: propertyLimits,
      kind,
      ...(value === undefined ? {} : { value }),
      origin: origin.id,
      seed: mutationSeed,
      hash: hash(text),
    };
  }
}
export function commonScalar(text: string): { value: Json } | undefined {
  const trimmed = text.trim();
  if (/^(?:null|true|false|-?(?:0|[1-9][0-9]*))$/.test(trimmed)) {
    const host: unknown = JSON.parse(trimmed);
    if (typeof host === 'number' && (!Number.isSafeInteger(host) || Object.is(host, -0))) return undefined;
    if (host === null) return { value: Null() };
    if (typeof host === 'boolean') return { value: BooleanValue(host) };
    if (typeof host === 'number') return { value: NumberValue(String(host)) };
    return undefined;
  }
  // A scalar string has no duplicate-key/numeric normalization ambiguity.
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string' && ![...parsed].some(character => {
        const codepoint = character.codePointAt(0);
        return codepoint !== undefined && codepoint >= 0xd800 && codepoint <= 0xdfff;
      })) return { value: Text(parsed) };
    } catch {
      // Invalid host JSON is outside the common scalar oracle.
    }
  }
  return undefined;
}
export function exerciseMutation(core: JsonCore, item: MutationFixture, text = item.text): void {
  const result = assertResult(core['Json.parse'](text, item.limits));
  if (item.kind === 'invalid') {
    failure(result, item.code);
    return;
  }
  if (item.kind === 'equivalent') {
    assert.ok(item.value);
    assertAst(done(result), item.value);
    return;
  }
  const oracle = commonScalar(text);
  if (oracle) assertAst(done(result), oracle.value);
  if (result.$ === 'Done') {
    const encoded = done(core['Json.encode'](result.value, item.limits));
    assertAst(done(core['Json.parse'](encoded, item.limits)), result.value);
  }
}
export function admissible(item: MutationFixture, text: string): boolean {
  if (item.kind === 'unconstrained') return true;
  if (item.kind === 'invalid') {
    try {
      JSON.parse(text);
      return false;
    } catch {
      return true;
    }
  }
  try {
    assert.deepEqual(JSON.parse(text), JSON.parse(item.text));
    return true;
  } catch {
    return false;
  }
}
export function retainMutationInput(
  item: MutationFixture,
  backend = process.versions['bun'] ? 'bun' : 'node',
): void {
  const directory = resolve(ROOT, 'artifacts/mutations');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${backend}-pending.json`), JSON.stringify({
    state: 'prepared',
    backend,
    id: item.id,
    seed: item.seed,
    origin: item.origin,
    kind: item.kind,
    sha256: item.hash,
    text: item.text,
  }, null, 2) + '\n');
}
export function retainMutationFailure(
  item: MutationFixture,
  error: unknown,
  minimized?: MutationMinimized | NativeMutationMinimized,
  backend = process.versions['bun'] ? 'bun' : 'node',
): void {
  const directory = resolve(ROOT, 'artifacts/mutations');
  mkdirSync(directory, { recursive: true });
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  const record = {
    id: item.id,
    seed: item.seed,
    origin: item.origin,
    kind: item.kind,
    sha256: item.hash,
    text: item.text,
    error: detail,
    minimized,
  };
  writeFileSync(
    resolve(directory, `${backend}-${item.id.replace('/', '-')}.json`),
    JSON.stringify({ ...record, backend }, null, 2) + '\n',
  );
}
export function* cases(): Generator<TestCase> {
  for (const item of mutationFixtures()) {
    yield {
      id: item.id,
      prepare() {
        retainMutationInput(item);
      },
      run(core) {
        try {
          exerciseMutation(core, item);
        } catch (error) {
          retainMutationFailure(item, error);
          throw error;
        }
      },
    };
  }
  yield {
    id: 'mutation-bytes/strict-decoding',
    run() {
      const decode = (bytes: Uint8Array<ArrayBufferLike>): string => new TextDecoder(
        'utf-8',
        { fatal: true, ignoreBOM: true },
      ).decode(bytes);
      const valid = Buffer.from('"é😀"');
      for (let index = 0; index < valid.length; index++) {
        const changed = Buffer.from(valid);
        changed[index] = 0xff;
        assert.throws(() => decode(changed));
      }
      assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{}')])), '\ufeff{}');
    },
  };
}
