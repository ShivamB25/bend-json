import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expectArray, expectBoolean, expectLiteral, expectRecord, expectSafeInteger, expectString } from '../types/runtime.ts';
import { ROOT, PIN, CORPUS_PIN, CORPUS_TREE, REF, run, versions } from './tools.ts';
type FixtureClass = 'y' | 'n' | 'i';
type CorpusExpected = 'byte-excluded' | 'accept' | 'reject' | 'bom-reject' | 'surrogate-reject';
interface GitTreeEntry {
  path: string;
  type: 'blob';
  mode: '100644' | '100755';
  sha: string;
  size: number;
}
interface GitTree {
  truncated: boolean;
  sha: string;
  tree: GitTreeEntry[];
}
interface ManifestEntry {
  name: string;
  class: FixtureClass;
  url: string;
  bytes: number;
  gitBlob: string;
  sha256: string;
  strictUtf8: boolean;
  leadingBom: boolean;
  expected: CorpusExpected;
}
interface RetainedManifest {
  revision: string;
  tree: string;
  licenseUrl: string;
  licenseSha256: string;
  fixtures: ManifestEntry[];
}
function parseManifest(value: unknown): RetainedManifest {
  const record = expectRecord(value, 'retained manifest');
  const fixtureValues = expectArray(record['fixtures'], 'retained manifest fixtures');
  const fixtures: ManifestEntry[] = fixtureValues.map((item, index) => {
    const fixture = expectRecord(item, `retained fixture ${index}`);
    return {
      name: expectString(fixture['name'], `retained fixture ${index}.name`),
      class: expectLiteral(fixture['class'], ['y', 'n', 'i'], `retained fixture ${index}.class`),
      url: expectString(fixture['url'], `retained fixture ${index}.url`),
      bytes: expectSafeInteger(fixture['bytes'], `retained fixture ${index}.bytes`),
      gitBlob: expectString(fixture['gitBlob'], `retained fixture ${index}.gitBlob`),
      sha256: expectString(fixture['sha256'], `retained fixture ${index}.sha256`),
      strictUtf8: expectBoolean(fixture['strictUtf8'], `retained fixture ${index}.strictUtf8`),
      leadingBom: expectBoolean(fixture['leadingBom'], `retained fixture ${index}.leadingBom`),
      expected: expectLiteral(
        fixture['expected'],
        ['byte-excluded', 'accept', 'reject', 'bom-reject', 'surrogate-reject'],
        `retained fixture ${index}.expected`,
      ),
    };
  });
  return {
    revision: expectString(record['revision'], 'retained revision'),
    tree: expectString(record['tree'], 'retained tree'),
    licenseUrl: expectString(record['licenseUrl'], 'retained license URL'),
    licenseSha256: expectString(record['licenseSha256'], 'retained license hash'),
    fixtures,
  };
}
function parseTree(value: unknown): GitTree {
  const record = expectRecord(value, 'corpus tree');
  const entries = expectArray(record['tree'], 'corpus tree entries').map((item, index) => {
    const entry = expectRecord(item, `corpus tree entry ${index}`);
    return {
      path: expectString(entry['path'], `tree entry ${index}.path`),
      type: expectLiteral(entry['type'], ['blob'], `tree entry ${index}.type`),
      mode: expectLiteral(entry['mode'], ['100644', '100755'], `tree entry ${index}.mode`),
      sha: expectString(entry['sha'], `tree entry ${index}.sha`),
      size: expectSafeInteger(entry['size'], `tree entry ${index}.size`),
    };
  });
  return {
    truncated: expectBoolean(record['truncated'], 'corpus tree truncated'),
    sha: expectString(record['sha'], 'corpus tree SHA'),
    tree: entries,
  };
}
if (!existsSync(REF)) {
  mkdirSync(resolve(ROOT, '.tools'), { recursive: true });
  run('git', ['clone', '--filter=blob:none', '--no-checkout', 'https://github.com/bendlang/bend.git', REF], { timeout: 120000 });
  run('git', ['-C', REF, 'checkout', '--detach', PIN], { timeout: 120000 });
}
const dirty = run('git', ['-C', REF, 'status', '--porcelain']).stdout;
if (dirty) throw new Error(`Refusing modified compiler checkout ${REF}; select a fresh BEND_REF`);
console.log(JSON.stringify(versions()));
const base = resolve(ROOT, 'tests/fixtures/JSONTestSuite');
const target = resolve(base, 'test_parsing');
mkdirSync(target, { recursive: true });
async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Missing response body: ${url}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1048576) {
        await reader.cancel();
        throw new Error(`Oversized fixture: ${url}`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}
const licenseUrl = `https://raw.githubusercontent.com/nst/JSONTestSuite/${CORPUS_PIN}/LICENSE`;
const licenseSha256 = '8bd0e0578be788c617ea01d18b2a8146e3746ae50bddadc65a5f9d3aad08ad49';
const manifestPath = resolve(base, 'manifest.json');
const retained = existsSync(manifestPath)
  ? parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  : null;
if (retained && (retained.revision !== CORPUS_PIN || retained.tree !== CORPUS_TREE
  || retained.licenseUrl !== licenseUrl || retained.licenseSha256 !== licenseSha256
  || !Array.isArray(retained.fixtures))) throw new Error('Invalid retained corpus provenance');

function verifyTree(entries: readonly GitTreeEntry[]): void {
  if (entries.length !== 318 || new Set(entries.map(item => item.path)).size !== 318
    || entries.some(item => item.type !== 'blob' || !['100644', '100755'].includes(item.mode)
      || !/^[yni]_[^/\0]+\.json$/.test(item.path)
      || !/^[0-9a-f]{40}$/.test(item.sha)
      || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 1048576)) {
    throw new Error('Invalid corpus tree inventory');
  }
  const ordered = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const body = Buffer.concat(ordered.flatMap(item => [
    Buffer.from(`${item.mode} ${item.path}\0`), Buffer.from(item.sha, 'hex'),
  ]));
  const hash = createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
  if (hash !== CORPUS_TREE) throw new Error(`Corpus tree mismatch: ${hash}`);
}

// Preserve original Git modes as provenance only; never chmod or execute fixtures.
const treePath = resolve(base, 'tree.json');
const api = `https://api.github.com/repos/nst/JSONTestSuite/git/trees/${CORPUS_TREE}`;
const treeBytes = existsSync(treePath) ? localBytes(treePath) : await fetchBytes(api);
const tree = parseTree(JSON.parse(treeBytes.toString()));
if (tree.truncated || tree.sha !== CORPUS_TREE || !Array.isArray(tree.tree)) throw new Error('Incomplete corpus tree');
verifyTree(tree.tree);
if (!existsSync(treePath)) writeFileSync(treePath, treeBytes, { flag: 'wx' });
const treeByName = new Map<string, GitTreeEntry>(tree.tree.map(item => [item.path, item]));
const expectedNames = new Set(treeByName.keys());
if (retained && (retained.fixtures.length !== 318
  || new Set(retained.fixtures.map(item => item.name)).size !== 318
  || retained.fixtures.some(item => !expectedNames.has(item.name)))) {
  throw new Error('Invalid retained fixture inventory');
}
if (readdirSync(target).some(name => !expectedNames.has(name))) throw new Error('Unexpected local corpus entry');
const retainedByName = new Map<string, ManifestEntry>(
  retained?.fixtures.map(item => [item.name, item]) ?? [],
);

function localBytes(path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 1048576) throw new Error(`Invalid local fixture: ${path}`);
  return readFileSync(path);
}
const counts: Record<FixtureClass, number> = { y: 0, n: 0, i: 0 };
const manifest: ManifestEntry[] = [];
let index = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (index < tree.tree.length) {
    const item = tree.tree[index++];
    assertTreeEntry(item);
    const url = `https://raw.githubusercontent.com/nst/JSONTestSuite/${CORPUS_PIN}/test_parsing/${encodeURIComponent(item.path)}`;
    const path = resolve(target, item.path);
    if (!path.startsWith(target + '/')) throw new Error('Invalid fixture path');
    const bytes = existsSync(path) ? localBytes(path) : await fetchBytes(url);
    const sha1 = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (bytes.length !== item.size || sha1 !== item.sha) throw new Error(`Corrupt fixture: ${item.path}`);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx' });
    let text: string | undefined;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch {}
    const cls = item.path[0];
    if (cls !== 'y' && cls !== 'n' && cls !== 'i') throw new Error(`Invalid corpus class: ${item.path}`);
    counts[cls]++;
    const expected: CorpusExpected = text === undefined ? 'byte-excluded' : cls === 'y' ? 'accept' : cls === 'n' ? 'reject' : item.path.startsWith('i_number_') || item.path === 'i_structure_500_nested_arrays.json' ? 'accept' : item.path === 'i_structure_UTF-8_BOM_empty_object.json' ? 'bom-reject' : 'surrogate-reject';
    const entry: ManifestEntry = { name: item.path, class: cls, url, bytes: bytes.length, gitBlob: sha1, sha256: createHash('sha256').update(bytes).digest('hex'), strictUtf8: text !== undefined, leadingBom: text?.startsWith('\uFEFF') || false, expected };
    const previous = retainedByName.get(item.path);
    if (previous && (Object.keys(entry) as Array<keyof ManifestEntry>).some(key => previous[key] !== entry[key])) {
      throw new Error(`Retained manifest mismatch: ${item.path}`);
    }
    manifest.push(entry);
  }
}));
verifyTree(manifest.map(item => {
  const source = treeByName.get(item.name);
  if (!source) throw new Error(`Missing tree entry: ${item.name}`);
  return {
    path: item.name, type: 'blob', mode: source.mode, size: item.bytes, sha: item.gitBlob,
  };
}));
const excluded = manifest.filter(x => !x.strictUtf8);
if (counts.y !== 95 || counts.n !== 188 || counts.i !== 35
  || excluded.length !== 25 || excluded.filter(x => x.class === 'n').length !== 12
  || excluded.filter(x => x.class === 'i').length !== 13
  || manifest.filter(x => x.leadingBom).length !== 2
  || manifest.filter(x => x.class === 'i' && x.expected === 'accept').length !== 11
  || manifest.filter(x => x.expected === 'surrogate-reject').length !== 10
  || manifest.filter(x => x.expected === 'bom-reject').length !== 1) throw new Error('Corpus inventory changed');
const licensePath = resolve(base, 'LICENSE');
const license = existsSync(licensePath) ? localBytes(licensePath) : await fetchBytes(licenseUrl);
if (createHash('sha256').update(license).digest('hex') !== licenseSha256
  || !license.toString().includes('Copyright (c) 2016 Nicolas Seriot')) throw new Error('Unexpected corpus license');
if (!existsSync(licensePath)) writeFileSync(licensePath, license, { flag: 'wx' });
manifest.sort((a, b) => a.name.localeCompare(b.name, 'en'));
if (!retained) writeFileSync(manifestPath, JSON.stringify({ revision: CORPUS_PIN, tree: CORPUS_TREE, licenseUrl, licenseSha256, fixtures: manifest }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ fixtures: manifest.length, classes: counts, decoded: 293, byteExcluded: 25, leadingBom: manifest.filter(x => x.leadingBom).length }));

function assertTreeEntry(item: GitTreeEntry | undefined): asserts item is GitTreeEntry {
  if (!item) throw new Error('Corpus tree index escaped its verified bounds');
}
