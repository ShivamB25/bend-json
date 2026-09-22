import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { expectArray, expectBoolean, expectLiteral, expectRecord, expectSafeInteger, expectString } from '../types/runtime.ts';
import { ROOT, CORPUS_PIN, CORPUS_TREE } from '../scripts/tools.ts';
import {
  corpusLimits,
  limits,
  strictDecode,
  done,
  failure,
  assertAst,
} from './support.ts';
import type { Limits, ParseCode, TestCase } from './support.ts';

type FixtureClass = 'y' | 'n' | 'i';
type CorpusExpected = 'byte-excluded' | 'accept' | 'reject' | 'bom-reject' | 'surrogate-reject';
export type CorpusClassification =
  | 'byte-excluded'
  | 'accept'
  | 'resource-reject'
  | 'profile-reject'
  | 'syntax-reject';
interface ManifestFixture {
  name: string;
  class: FixtureClass;
  bytes: number;
  gitBlob: string;
  sha256: string;
  strictUtf8: boolean;
  leadingBom: boolean;
  expected: CorpusExpected;
}
interface CorpusManifest {
  revision: string;
  tree: string;
  licenseSha256: string;
  fixtures: ManifestFixture[];
}
export interface CorpusEntry extends ManifestFixture {
  id: string;
  text: string | undefined;
  limits: Limits;
}
export interface CorpusDetail {
  fixture: string;
  class: FixtureClass;
  classification: CorpusClassification;
  code?: ParseCode;
  offset?: string;
}

const base = resolve(ROOT, 'tests/fixtures/JSONTestSuite');
const resource: Readonly<Partial<Record<ParseCode, true>>> = {
  PInputLimit: true,
  PDepthLimit: true,
  PNumberLimit: true,
  PStringLimit: true,
  PValueLimit: true,
};
const profile: Readonly<Partial<Record<ParseCode, true>>> = {
  PUnpairedSurrogate: true,
  PInvalidScalar: true,
  PLeadingBom: true,
};
function parseManifest(value: unknown): CorpusManifest {
  const record = expectRecord(value, 'corpus manifest');
  const fixtureValues = expectArray(record['fixtures'], 'corpus manifest fixtures');
  const fixtures: ManifestFixture[] = fixtureValues.map((item, index) => {
    const fixture = expectRecord(item, `corpus manifest fixture ${index}`);
    return {
      name: expectString(fixture['name'], `fixture ${index}.name`),
      class: expectLiteral(fixture['class'], ['y', 'n', 'i'], `fixture ${index}.class`),
      bytes: expectSafeInteger(fixture['bytes'], `fixture ${index}.bytes`),
      gitBlob: expectString(fixture['gitBlob'], `fixture ${index}.gitBlob`),
      sha256: expectString(fixture['sha256'], `fixture ${index}.sha256`),
      strictUtf8: expectBoolean(fixture['strictUtf8'], `fixture ${index}.strictUtf8`),
      leadingBom: expectBoolean(fixture['leadingBom'], `fixture ${index}.leadingBom`),
      expected: expectLiteral(
        fixture['expected'],
        ['byte-excluded', 'accept', 'reject', 'bom-reject', 'surrogate-reject'],
        `fixture ${index}.expected`,
      ),
    };
  });
  return {
    revision: expectString(record['revision'], 'manifest revision'),
    tree: expectString(record['tree'], 'manifest tree'),
    licenseSha256: expectString(record['licenseSha256'], 'manifest license hash'),
    fixtures,
  };
}
let cached: CorpusEntry[] | undefined;
export function corpusEntries(): CorpusEntry[] {
  if (cached) return cached;
  const manifest = parseManifest(JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8')));
  assert.equal(manifest.revision, CORPUS_PIN);
  assert.equal(manifest.tree, CORPUS_TREE);
  assert.equal(manifest.fixtures.length, 318);
  assert.equal(new Set(manifest.fixtures.map(entry => entry.name)).size, 318);
  assert.deepEqual(
    readdirSync(resolve(base, 'test_parsing')).sort(),
    manifest.fixtures.map(entry => entry.name).sort(),
  );
  const license = readFileSync(resolve(base, 'LICENSE'));
  assert.equal(createHash('sha256').update(license).digest('hex'), manifest.licenseSha256);
  assert.match(license.toString(), /Copyright \(c\) 2016 Nicolas Seriot/);
  const counts: Record<FixtureClass, number> = { y: 0, n: 0, i: 0 };
  const excluded: Record<FixtureClass, number> = { y: 0, n: 0, i: 0 };
  let boms = 0;
  cached = manifest.fixtures.map(entry => {
    assert.ok(/^[yni]_[^/]+\.json$/.test(entry.name));
    assert.equal(entry.class, entry.name[0]);
    counts[entry.class]++;
    const bytes = readFileSync(resolve(base, 'test_parsing', entry.name));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      entry.gitBlob,
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    let text: string | undefined;
    try {
      text = strictDecode(bytes);
    } catch (error) {
      assert.ok(error instanceof TypeError);
    }
    assert.equal(text !== undefined, entry.strictUtf8);
    assert.equal(text?.startsWith('\ufeff') || false, entry.leadingBom);
    if (text === undefined) excluded[entry.class]++;
    if (entry.leadingBom) boms++;
    const expected: CorpusExpected = text === undefined
      ? 'byte-excluded'
      : entry.class === 'y'
        ? 'accept'
        : entry.class === 'n'
          ? 'reject'
          : entry.name.startsWith('i_number_') || entry.name === 'i_structure_500_nested_arrays.json'
            ? 'accept'
            : entry.name === 'i_structure_UTF-8_BOM_empty_object.json'
              ? 'bom-reject'
              : 'surrogate-reject';
    assert.equal(entry.expected, expected);
    return { ...entry, id: `corpus/${entry.name}`, text, limits: corpusLimits, expected };
  });
  assert.deepEqual(counts, { y: 95, n: 188, i: 35 });
  assert.deepEqual(excluded, { y: 0, n: 12, i: 13 });
  assert.equal(boms, 2);
  assert.equal(cached.filter(entry => entry.class === 'i' && entry.expected === 'accept').length, 11);
  assert.equal(cached.filter(entry => entry.class === 'i' && entry.expected === 'surrogate-reject').length, 10);
  return cached;
}
export function* cases(): Generator<TestCase<CorpusDetail>> {
  for (const entry of corpusEntries()) {
    yield {
      id: entry.id,
      run(core) {
        if (entry.expected === 'byte-excluded') {
          return { fixture: entry.name, class: entry.class, classification: 'byte-excluded' };
        }
        assert.ok(entry.text !== undefined);
        const result = core['Json.parse'](entry.text, entry.limits);
        if (entry.expected === 'accept') {
          const value = done(result);
          const encoded = done(core['Json.encode'](value, entry.limits));
          assertAst(done(core['Json.parse'](encoded, entry.limits)), value);
          return { fixture: entry.name, class: entry.class, classification: 'accept' };
        }
        const error = failure(result);
        assert.equal(error.$, 'ParseError');
        if (entry.expected === 'bom-reject') {
          assert.equal(error.code.$, 'PLeadingBom');
          assert.equal(error.offset, 0n);
        }
        if (entry.expected === 'surrogate-reject') assert.equal(error.code.$, 'PUnpairedSurrogate');
        const classification: CorpusClassification = Object.hasOwn(resource, error.code.$)
          ? 'resource-reject'
          : Object.hasOwn(profile, error.code.$)
            ? 'profile-reject'
            : 'syntax-reject';
        return {
          fixture: entry.name,
          class: entry.class,
          classification,
          code: error.code.$,
          offset: String(error.offset),
        };
      },
    };
  }
  yield {
    id: 'corpus-policy/default-depth-500',
    run(core) {
      const entry = corpusEntries().find(item => item.name === 'i_structure_500_nested_arrays.json');
      assert.ok(entry?.text !== undefined);
      failure(core['Json.parse'](entry.text, limits()), 'PDepthLimit', 128);
      return { fixture: entry.name, class: entry.class, classification: 'resource-reject' };
    },
  };
}
