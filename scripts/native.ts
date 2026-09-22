import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, REF, COMPILER, BUN, NODE, ENV, versions, artifacts } from './tools.ts';
import type { Versions } from './tools.ts';
import {
  limits,
  parseCodes,
  encodeCodes,
  encodeExpected,
  measure,
  strictDecode,
} from '../tests/support.ts';
import type {
  Expectation,
  JsonErrorCode,
  LimitField,
  Limits,
  ParseCode,
  TextFixture,
} from '../tests/support.ts';
import { textCases, numberCases, encoderCases } from '../tests/regressions.ts';
import { corpusEntries } from '../tests/conformance.ts';
import type { CorpusEntry } from '../tests/conformance.ts';
import { generated, commonGenerated, whitespace, escapedScalars, largeFixtures } from '../tests/properties.ts';
import type { GeneratedFixture } from '../tests/properties.ts';
import { mutationFixtures, commonScalar, retainMutationFailure } from '../tests/mutations.ts';
import type { MutationFixture, MutationKind, NativeMutationMinimized } from '../tests/mutations.ts';
import { limitFields, invalidScalars, constructionSource, controlsSource } from './native-source.ts';
import type { ConstructionItem } from './native-source.ts';
import { rss } from './verify.ts';
import { nativeProcess } from './native-process.ts';
import type { DescribedError, NativeProcessResult } from './native-process.ts';

type NativeSuccessKind = 'parse-done' | 'done' | 'number-done';
type NativeFailureKind = 'parse-fail' | 'encode-fail';
type NativeProtocol =
  | { kind: 'parse-done' }
  | { kind: 'done' | 'number-done'; text: string }
  | { kind: NativeFailureKind; code: JsonErrorCode; offset: bigint };
type CoveragePhase =
  | 'directedText'
  | 'malformedParse'
  | 'directedEncode'
  | 'directedEncodeShared'
  | 'directedEncodeNative'
  | 'number'
  | 'defaultDepth';
type GeneratedCoverageField = 'generatedText' | 'generatedWhitespace' | 'generatedEscapes';
interface NativeError extends Error {
  category?: string;
  nativeResult?: NativeProcessResult;
  report?: unknown;
}
interface NativeInputFixture {
  id: string;
  text: string;
  limits: Limits;
}
interface EncodedFixture extends NativeInputFixture {
  value: GeneratedFixture['value'];
}
interface NativeCorpusEntryReport {
  id: string;
  name: string;
  class: CorpusEntry['class'];
  expected: CorpusEntry['expected'];
  status: string;
  code?: JsonErrorCode;
  offset?: bigint;
  category?: string;
  roundtrip?: 'pass';
  verdict?: 'pass' | 'fail';
  error?: DescribedError | null;
}
interface NativeMutationReport {
  seed: string;
  deadlineMs: number;
  caseTimeoutMs: number;
  counts: Record<MutationKind, number>;
  results: Array<Record<string, unknown>>;
  failure?: Record<string, unknown>;
  elapsedMs?: number;
}
interface NativeReport {
  backend: 'native';
  status: 'running' | 'pass' | 'fail' | 'unverified';
  required: boolean;
  artifacts: string;
  events: string;
  invocations: number;
  builds: number;
  concurrency: {
    textInvocations: number;
    constructionPipelines: number;
    mutations: number;
    overlappingPhases: false;
    nativeThreadsPerChild: 1;
    gpu: 'off';
  };
  compiler: {
    command: string | null;
    probes: NativeProcessResult[];
    version?: string;
    absent?: true;
  } | null;
  versions: Versions | null;
  corpus: {
    inventory: number;
    decoded: number;
    byteExcluded: number;
    attempted: number;
    accepted: number;
    rejected: number;
    rejectionCategories: Record<string, number>;
    entries: NativeCorpusEntryReport[];
  };
  coverage: {
    directedText: number;
    generatedText: number;
    generatedWhitespace: number;
    generatedEscapes: number;
    commonDomain: number;
    mutations: number;
    large: number;
    defaultDepth: number;
  };
  coverageIds: Record<CoveragePhase, string[]>;
  construction: {
    generated: number;
    batches: number;
    directedEncode: number;
    number: number;
    malformedParse: number;
    scalarBoundaries: unknown[];
  };
  memory: {
    status: 'unverified' | 'sampled';
    method: string;
    limitBytes: number;
    intervalMs: number;
    invocations: number;
    sampledInvocations: number;
    unobservedInvocations: number;
    samples: number;
    maximumSampledRssBytes: number;
    exceeded: boolean;
    reason: string;
    control?: Record<string, unknown>;
  };
  effectBoundary: { close: string };
  compilerSource?: { root: string; entry: string };
  reason?: string;
  byteControls?: { invalid: number; mutated: number; bomPreserved: true };
  driverControls?: Array<{ id: string; status: number | null; stderr: string }>;
  comparatorControls?: string[];
  mutations?: NativeMutationReport;
  error?: DescribedError | null;
}

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => JSON.stringify(
  value,
  (_key: string, item: unknown) => typeof item === 'bigint' ? item.toString() : item,
  2,
) + '\n';
const errorRecord = (error: unknown): DescribedError | null => {
  if (error === null || error === undefined) return null;
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const code = (error as NodeJS.ErrnoException).code;
  return {
    name: error.name,
    message: error.message || String(error),
    ...(code === undefined ? {} : { code }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
};
const asNativeError = (error: unknown): NativeError => (
  error instanceof Error ? error as NativeError : new Error(String(error))
);

// Exercise the same sampler/kill/reap path with a small control-only budget.
// Allocation size is not a residency claim; only observed RSS satisfies this control.
export async function nativeMemorySelftest({
  limitBytes = 64 * 1024 * 1024,
  allocationBytes = 128 * 1024 * 1024,
  intervalMs = 25,
}: {
  limitBytes?: number;
  allocationBytes?: number;
  intervalMs?: number;
} = {}) {
  assert.ok(Number.isSafeInteger(limitBytes) && limitBytes > 0);
  assert.ok(Number.isSafeInteger(allocationBytes) && allocationBytes > limitBytes);
  assert.ok(Number.isSafeInteger(intervalMs) && intervalMs > 0 && intervalMs <= 250);
  let available: number | undefined;
  try {
    available = rss(process.pid);
  } catch (error) {
    return { status: 'unverified', controlBudgetBytes: limitBytes, reason: 'Platform RSS sampler is unavailable', error: errorRecord(error) };
  }
  if (available === undefined || !Number.isSafeInteger(available) || available <= 0) {
    return { status: 'unverified', controlBudgetBytes: limitBytes, reason: 'Platform RSS sampler yielded no reliable resident-byte measurement' };
  }
  const source = `globalThis.retained = Buffer.allocUnsafe(${allocationBytes}); require("node:crypto").randomFillSync(globalThis.retained); process.stdout.write("ALLOCATED\\n"); setTimeout(() => { process.stdout.write(String(globalThis.retained[0])+"\\n"); }, 1000);`;
  const result = await nativeProcess(NODE, ['-e', source], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    memory: { read: rss, limitBytes, intervalMs },
  });
  try {
    assert.equal(result.error, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.overflow, false);
    assert.equal(result.killError, null);
    assert.equal(result.stderr, '');
    assert.equal(result.memory.exceeded, true, 'RSS negative control was not rejected by the memory ceiling');
    assert.ok(result.memory.samples > 0 && result.memory.maximumSampledRssBytes > limitBytes);
    assert.equal(result.signal, 'SIGKILL', 'RSS ceiling must terminate and reap the child');
    assert.equal(result.status, null);
  } catch (error) {
    const failure = asNativeError(error);
    failure.nativeResult = result;
    failure.report = { status: 'fail', controlBudgetBytes: limitBytes, allocationBytes, intervalMs, result };
    throw failure;
  }
  return { status: 'pass', controlBudgetBytes: limitBytes, allocationBytes, intervalMs, result };
}

// No replacement decoding, including subprocess protocol bytes. Invalid UTF-16
// cannot be written to a UTF-8 file: those cases use explicit native constructors.
function inputBytes(text: string, original?: Uint8Array): Buffer {
  const bytes = original === undefined ? Buffer.from(text, 'utf8') : Buffer.from(original);
  assert.equal(strictDecode(bytes), text, 'Native file boundary changed input/BOM or replaced an invalid scalar');
  return bytes;
}

function protocol(line: string): NativeProtocol {
  if (line === 'PARSE_DONE') return { kind: 'parse-done' };
  const successes: ReadonlyArray<readonly [string, 'done' | 'number-done']> = [
    ['DONE\t', 'done'],
    ['NUMBER_DONE\t', 'number-done'],
  ];
  for (const [prefix, kind] of successes) {
    if (line.startsWith(prefix)) {
      const text = line.slice(prefix.length);
      assert.ok(text.length > 0 && !/[\x00-\x1f]/.test(text), 'Malformed native successful text envelope');
      return { kind, text };
    }
  }
  const match = /^(PARSE_FAIL|ENCODE_FAIL)\t([A-Za-z]+)\t(0|[1-9][0-9]*)$/.exec(line);
  const phase = match?.[1];
  const code = match?.[2];
  const offsetText = match?.[3];
  assert.ok((phase === 'PARSE_FAIL' || phase === 'ENCODE_FAIL') && code !== undefined && offsetText !== undefined,
    `Unknown native protocol: ${JSON.stringify(line)}`);
  const codes: Readonly<Partial<Record<JsonErrorCode, true>>> = phase === 'PARSE_FAIL'
    ? parseCodes
    : encodeCodes;
  assert.ok(Object.hasOwn(codes, code), `Unknown native error constructor ${code}`);
  const offset = BigInt(offsetText);
  assert.ok(offset <= 16777217n, 'Native error offset outside contract');
  return {
    kind: phase === 'PARSE_FAIL' ? 'parse-fail' : 'encode-fail',
    code: code as JsonErrorCode,
    offset,
  };
}

function resultLine(stdout: string): NativeProtocol {
  assert.ok(stdout.endsWith('\n'), 'Native response lacks terminal newline');
  const line = stdout.slice(0, -1);
  assert.ok(!line.includes('\n') && !line.includes('\r'), 'Native driver emitted multiple lines or CR');
  return protocol(line);
}

function expectResult(
  result: NativeProtocol,
  expect: Expectation,
  success: NativeSuccessKind | 'encode' = 'done',
): void {
  if (expect.kind === 'fail') {
    const expectedKind: NativeFailureKind = success === 'encode' ? 'encode-fail' : 'parse-fail';
    assert.equal(result.kind, expectedKind, 'Wrong native rejection phase');
    if (result.kind !== 'parse-fail' && result.kind !== 'encode-fail') return;
    if (expect.code !== undefined) assert.equal(result.code, expect.code);
    if (expect.offset !== undefined) assert.equal(result.offset, BigInt(expect.offset));
    return;
  }
  const expectedKind: NativeSuccessKind = success === 'encode' ? 'done' : success;
  assert.equal(result.kind, expectedKind);
  const expected = expect.text ?? expect.encoded;
  if (expected !== undefined) {
    assert.ok(result.kind === 'done' || result.kind === 'number-done');
    assert.equal(result.text, expected);
  }
}

function fixtureFits(item: EncodedFixture): void {
  const measured = measure(item.value);
  const counts: ReadonlyArray<readonly [LimitField, number]> = [
    ['max_depth', measured.depth],
    ['max_number', measured.number],
    ['max_string', measured.string],
    ['max_values', measured.values],
    ['max_output', measured.output],
    ['max_input', [...item.text].length],
  ];
  for (const [field, count] of counts) {
    assert.ok(BigInt(count) <= item.limits[field], `${item.id}: generated ${field} overflow`);
  }
  assert.equal(item.text, measured.text, `${item.id}: fixture's independent encoding drifted`);
}

// Stop assigning work on the first failure, but reap every in-flight child
// before returning that failure. Fixture iteration and IDs remain deterministic.
async function bounded<T>(
  items: Iterable<T>,
  width: number,
  work: (item: T) => void | Promise<void>,
): Promise<void> {
  const iterator = items[Symbol.iterator]();
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: width }, async () => {
    while (!failed) {
      try {
        const next = iterator.next();
        if (next.done) return;
        await work(next.value);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  }));
  if (failed) throw failure;
}

function outcome(result: NativeProcessResult): string {
  if (result.memory.exceeded) return 'memory-limit';
  if (result.timedOut) return 'timeout';
  if (result.signal) return 'crash';
  if (result.error || result.status !== 0) return 'harness-failure';
  return 'completed';
}

function rejectedCategory(code: ParseCode): string {
  if (code === 'PInvalidLimits') return 'invalid-limits';
  if (/Limit$/.test(code)) return 'resource';
  if (code === 'PUnpairedSurrogate' || code === 'PInvalidScalar' || code === 'PLeadingBom') return 'profile';
  return 'syntax';
}

export async function nativeVerify({ required = false }: { required?: boolean } = {}): Promise<NativeReport> {
  artifacts();
  const directory = mkdtempSync(resolve(ROOT, 'artifacts/native-'));
  const eventsPath = resolve(directory, 'events.jsonl');
  const reportPath = resolve(directory, 'report.json');
  const report: NativeReport = {
    backend:'native', status:'running', required, artifacts:directory,
    events:eventsPath, invocations:0, builds:0,
    concurrency:{textInvocations:4,constructionPipelines:2,mutations:1,overlappingPhases:false,nativeThreadsPerChild:1,gpu:'off'},
    compiler:null, versions:null,
    corpus:{inventory:0, decoded:0, byteExcluded:0, attempted:0, accepted:0, rejected:0, rejectionCategories:{}, entries:[]},
    coverage:{directedText:0, generatedText:0, generatedWhitespace:0, generatedEscapes:0, commonDomain:0, mutations:0, large:0, defaultDepth:0},
    coverageIds:{directedText:[],malformedParse:[],directedEncode:[],directedEncodeShared:[],directedEncodeNative:[],number:[],defaultDepth:[]},
    construction:{generated:0, batches:0, directedEncode:0, number:0, malformedParse:0, scalarBoundaries:[]},
    memory:{status:'unverified',method:'shared platform RSS sampler at spawn and every 25ms during native mutation invocations only; not an exact-peak measurement',limitBytes:512*1024*1024,intervalMs:25,invocations:0,sampledInvocations:0,unobservedInvocations:0,samples:0,maximumSampledRssBytes:0,exceeded:false,reason:'No mutation subprocess sampled yet; builds are excluded.'},
    effectBoundary:{close:'Pinned Base File.close returns IO(Unit) and discards close(2) status; close failures cannot be observed through this API. Every opened affine handle is closed before reporting size/read failure.'}
  };
  let sequence = 0;
  let cc: string | undefined;
  const event = (value: unknown): void => {
    const serialized = JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'bigint' ? item.toString() : item);
    if (serialized === undefined) throw new Error('Native event is not serializable');
    appendFileSync(eventsPath, `${serialized}\n`);
  };
  const persist = (): void => {
    writeFileSync(reportPath, json(report));
    writeFileSync(resolve(ROOT, 'artifacts/native.json'), json(report));
  };
  // Reconcile every directed/construction phase against the real shared
  // generators and the four native-only scalar payloads. Counts alone can
  // hide a skipped or duplicated case, so each completed phase also freezes
  // its exact ID set in the report.
  const textCoverageCases = [...textCases()];
  const sharedEncodeIds = new Set<string>([...encoderCases()].map(item => item.id));
  const nativeEncodeIds = new Set<string>([
    'native/scalar/1114112/text',
    'native/scalar/1114112/key',
    'native/scalar/4294967295/text',
    'native/scalar/4294967295/key'
  ]);
  const numberCoverageCases = [...numberCases()];
  const expectedCoverage: Record<CoveragePhase, Set<string>> = {
    directedText:new Set(textCoverageCases.filter(item => invalidScalars(item).length === 0).map(item => item.id)),
    malformedParse:new Set(textCoverageCases.filter(item => invalidScalars(item).length > 0).map(item => item.id)),
    directedEncodeShared:sharedEncodeIds,
    directedEncodeNative:nativeEncodeIds,
    directedEncode:new Set([...sharedEncodeIds,...nativeEncodeIds]),
    number:new Set(numberCoverageCases.map(item => item.id)),
    defaultDepth:new Set(['corpus/default-depth'])
  };
  assert.equal(textCoverageCases.length,262,'Directed text generator inventory changed');
  assert.equal(expectedCoverage.directedText.size,259,'Directed text coverage inventory changed');
  assert.equal(expectedCoverage.malformedParse.size,3,'Malformed parse coverage inventory changed');
  assert.equal(sharedEncodeIds.size,88,'Shared directed encode coverage inventory changed');
  assert.equal(nativeEncodeIds.size,4,'Native directed encode coverage inventory changed');
  assert.equal(expectedCoverage.directedEncode.size,92,'Directed encode coverage inventory changed');
  assert.equal(numberCoverageCases.length,42,'Number coverage inventory changed');
  assert.equal(expectedCoverage.number.size,42,'Number coverage IDs are not unique');
  const observedCoverage: Record<CoveragePhase, Set<string>> = {
    directedText: new Set(),
    malformedParse: new Set(),
    directedEncode: new Set(),
    directedEncodeShared: new Set(),
    directedEncodeNative: new Set(),
    number: new Set(),
    defaultDepth: new Set(),
  };
  const reportCount: Record<CoveragePhase, () => number> = {
    directedText:() => report.coverage.directedText,
    malformedParse:() => report.construction.malformedParse,
    directedEncode:() => report.construction.directedEncode,
    directedEncodeShared:() => report.coverageIds.directedEncodeShared.length,
    directedEncodeNative:() => report.coverageIds.directedEncodeNative.length,
    number:() => report.construction.number,
    defaultDepth:() => report.coverage.defaultDepth
  };
  const recordCoverage = (phase: CoveragePhase, id: string): void => {
    const observed = observedCoverage[phase];
    assert.ok(!observed.has(id), `${phase}: duplicate native case ${id}`);
    observed.add(id);
  };
  const reconcileCoverage = (phase: CoveragePhase): void => {
    const expected = expectedCoverage[phase];
    const observed = observedCoverage[phase];
    assert.equal(observed.size,expected.size,`${phase}: native coverage count mismatch`);
    assert.deepEqual([...observed].sort(),[...expected].sort(),`${phase}: native coverage IDs do not reconcile`);
    report.coverageIds[phase] = [...observed].sort();
    assert.equal(reportCount[phase](),expected.size,`${phase}: native report count mismatch`);
  };

  // Own and reap each finite child. Kill its process group on timeout/overflow so
  // a timed-out Bend compiler cannot leave a Clang subprocess behind.
  async function capture(
    label: string,
    command: string,
    args: readonly string[],
    timeout = 5000,
    maxBuffer = 16 * 1024 * 1024,
    caseIds: readonly string[] | null = null,
  ): Promise<NativeProcessResult> {
    const invocation = ++sequence;
    report.invocations++;
    event({event:'start', invocation, id:label, command, args, timeout, ...(caseIds === null ? {} : {caseIds,caseTimeout:5000})});
    const monitorMemory = label.startsWith('mutation/');
    const result = await nativeProcess(command,args,{
      timeout,maxBuffer,caseIds,caseTimeout:5000,env:{...ENV,...(cc ? {CC:cc} : {})},
      onCaseEvent(record) { event({event:'construction-progress',invocation,batch:label,progress:record}); },
      memory:monitorMemory ? {read:rss,limitBytes:report.memory.limitBytes,intervalMs:report.memory.intervalMs} : null,
      onInvalidOutput(stdoutBytes,stderrBytes) {
        writeFileSync(resolve(directory,`invocation-${invocation}.stdout.bin`),stdoutBytes);
        writeFileSync(resolve(directory,`invocation-${invocation}.stderr.bin`),stderrBytes);
      }
    });
    if (monitorMemory) {
      const measured = result.memory;
      report.memory.invocations++;
      report.memory.samples += measured.samples;
      report.memory.maximumSampledRssBytes = Math.max(report.memory.maximumSampledRssBytes,measured.maximumSampledRssBytes);
      report.memory.exceeded ||= measured.exceeded;
      if (measured.samples > 0) {
        report.memory.sampledInvocations++;
        report.memory.status = 'sampled';
        report.memory.reason = 'Ceiling enforced at observed samples; short-lived invocations and between-sample peaks are not claimed measured.';
      } else report.memory.unobservedInvocations++;
    }
    event({event:'result', invocation, id:label, outcome:outcome(result), ...result});
    return result;
  }

  function successful(
    result: NativeProcessResult,
    label: string,
    { silent = false }: { silent?: boolean } = {},
  ): NativeProcessResult {
    const progressOk = result.caseProgress?.complete && !result.caseProgress.error && result.caseProgress.diagnostics === '';
    if (result.error || result.signal || result.status !== 0 || result.timedOut || result.overflow || result.killError || result.memory.exceeded || (result.caseProgress && !progressOk) || (result.stderr !== '' && !progressOk) || (silent && result.stdout !== '')) {
      const error = new Error(`${label}: native subprocess failure\n${json(result)}`) as NativeError;
      error.nativeResult = result;
      if (result.memory.exceeded) error.category = 'native-memory';
      throw error;
    }
    return result;
  }

  async function compiler(): Promise<boolean> {
    const configured = process.env['CC'];
    const candidates: string[] = configured
      ? [configured]
      : [process.platform === 'darwin' ? '/usr/bin/clang' : 'clang'];
    if (!configured) {
      const names = new Set<string>();
      for (const path of (process.env['PATH'] || '').split(delimiter)) {
        if (!path) continue;
        try {
          for (const name of readdirSync(path)) {
            if (/^clang(?:-\d+)?$/.test(name)) names.add(resolve(path, name));
          }
        } catch (error) {
          const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
          if (code === undefined || !['ENOENT','ENOTDIR','EACCES'].includes(code)) throw error;
        }
      }
      candidates.push(...[...names].sort((left,right) => right.localeCompare(left, 'en', {numeric:true})));
    }
    const probes: NativeProcessResult[] = [];
    for (const candidate of [...new Set(candidates)]) {
      const result = await capture('compiler/discovery', candidate, ['--version'], 5000, 1024*1024);
      probes.push(result);
      if (result.error?.code === 'ENOENT' && !configured) continue;
      successful(result, `Detecting ${candidate}`);
      const major = /^(?:Apple |\w+ )?clang version (\d+)/m.exec(result.stdout)?.[1];
      assert.ok(major !== undefined, `${candidate} is not Clang; GCC is not a fallback`);
      assert.ok(Number(major) >= 14, `${candidate} is detected but too old; Clang 14+ required`);
      cc = candidate;
      report.compiler = {command:cc, version:result.stdout, probes};
      return true;
    }
    report.compiler = {command:null, probes, absent:true};
    return false;
  }

  async function build(source: string, binary: string): Promise<void> {
    const result = await capture(`build/${source}`, BUN, ['--no-install',COMPILER,source,'-o',binary], 120000, 1024*1024);
    // Pinned cli_report(book,2) is silent for safe compilation; unsafe verdicts,
    // warnings and unfamiliar output fail closed, even when the exit is zero.
    successful(result, `Compiling ${source}`, {silent:true});
    assert.ok(existsSync(binary), 'Compiler did not produce the requested native executable');
    report.builds++;
  }

  const file = resolve(directory, 'input.json');
  const inputs = resolve(directory,'inputs');
  mkdirSync(inputs);
  const driver = resolve(directory, 'driver');
  async function invoke(
    item: NativeInputFixture,
    mode: string,
    originalBytes?: Uint8Array,
  ): Promise<NativeProtocol> {
    const input = resolve(inputs,`${sha256(`${mode}\0${item.id}`)}.json`);
    writeFileSync(input,inputBytes(item.text,originalBytes),{flag:'wx'});
    const args = ['--threads','1','--gpu','off','--',mode,input,...limitFields.map(field => String(item.limits[field]))];
    const result = successful(await capture(item.id, driver, args), item.id);
    return resultLine(result.stdout);
  }

  async function directed(item: TextFixture): Promise<void> {
    const mode = item.expect.kind === 'done' && item.expect.encoded !== undefined ? 'roundtrip' : 'parse';
    const result = await invoke(item, mode);
    expectResult(result, item.expect, mode === 'parse' ? 'parse-done' : 'done');
    report.coverage.directedText++;
    recordCoverage('directedText',item.id);
  }

  let batchNumber = 0;
  async function constructionBatch(
    items: readonly ConstructionItem[],
    category: string,
    scalarBoundary = false,
  ): Promise<void> {
    assert.ok(items.length > 0 && items.length <= 64);
    const first = items[0];
    assert.ok(first);
    const index = batchNumber++, source = resolve(directory, `construction-${index}.bend`), binary = resolve(directory, `construction-${index}`);
    writeFileSync(source, constructionSource(items));
    await build(source, binary);
    const caseIds = items.map((_item, caseIndex) => String(caseIndex));
    const raw = await capture(`construction/${category}/${index}`, binary, ['--threads','1','--gpu','off'], 5000, 16*1024*1024, caseIds);
    const scalarCodes = first.scalarCodes ?? invalidScalars(first);
    if (scalarBoundary && (raw.status !== 0 || raw.signal || raw.error)) {
      // Only a specific scalar-constructor diagnostic before any materialized
      // marker establishes this upstream boundary. Crashes/timeouts never do.
      const constructorDiagnostic = /^(?:bend: )?\d+ is not a Unicode scalar value\n$/.test(raw.caseProgress?.diagnostics ?? raw.stderr);
      if (constructorDiagnostic && raw.status !== 0 && !raw.signal && !raw.error && !raw.timedOut && !raw.caseProgress?.error && raw.stdout === '') {
        report.construction.scalarBoundaries.push({id:first.id,codes:scalarCodes,status:'constructor-rejected',encoder:'unattempted',diagnostic:raw.stderr});
        event({event:'construction-boundary',id:first.id,codes:scalarCodes,encoder:'unattempted'});
        return;
      }
    }
    successful(raw, `Construction ${index}`);
    const lines = raw.stdout.split('\n');
    assert.equal(lines.pop(), '', 'Native construction output lacks final newline');
    let cursor = 0;
    for (let caseIndex = 0; caseIndex < items.length; caseIndex++) {
      const item = items[caseIndex];
      assert.ok(item);
      const codes = item.scalarCodes ?? invalidScalars(item);
      for (const code of codes) assert.equal(lines[cursor++], `CONSTRUCTED\t${code}`, `${item.id}: scalar not materialized before encoder`);
      const prefix = `CASE\t${caseIndex}\t`;
      const line = lines[cursor++];
      assert.ok(line?.startsWith(prefix), `${item.id}: missing/out-of-order construction result`);
      if (line === undefined) throw new Error(`${item.id}: missing construction result`);
      const result = protocol(line.slice(prefix.length));
      const expectedSuccess: NativeSuccessKind | 'encode' = item.operation === 'number'
        ? 'number-done'
        : item.operation === 'parse'
          ? 'parse-done'
          : 'encode';
      expectResult(result, item.expect, expectedSuccess);
      if (category === 'generated') report.construction.generated++;
      else if (item.operation === 'number') {
        report.construction.number++;
        recordCoverage('number',item.id);
      } else if (item.operation === 'parse') {
        report.construction.malformedParse++;
        recordCoverage('malformedParse',item.id);
      } else {
        assert.equal(item.operation,'encode',`${item.id}: unknown native construction operation`);
        report.construction.directedEncode++;
        const phase: 'directedEncodeNative' | 'directedEncodeShared' = nativeEncodeIds.has(item.id)
          ? 'directedEncodeNative'
          : 'directedEncodeShared';
        assert.ok(expectedCoverage[phase].has(item.id),`${item.id}: unexpected native directed encode case`);
        recordCoverage(phase,item.id);
        recordCoverage('directedEncode',item.id);
      }
      if (scalarBoundary) report.construction.scalarBoundaries.push({id:item.id,codes,status:'constructed',libraryResult:result});
      const resultText = result.kind === 'done' || result.kind === 'number-done' ? result.text : undefined;
      event({
        event:'case-result',
        id:item.id,
        category:`construction/${category}`,
        status:'pass',
        result:{...result,text:resultText === undefined ? undefined : {sha256:sha256(resultText),codepoints:[...resultText].length}},
      });
    }
    assert.equal(cursor, lines.length, 'Unexpected extra native construction output');
    report.construction.batches++;
    rmSync(source);
    rmSync(binary);
  }

  async function batches(items: Iterable<ConstructionItem>, category: string): Promise<void> {
    function* chunks(): Generator<{ items: ConstructionItem[]; scalarBoundary: boolean }> {
      let batch: ConstructionItem[] = [];
      for (const item of items) {
        if (invalidScalars(item).length || item.scalarCodes?.length) {
          if (batch.length) { yield {items:batch,scalarBoundary:false}; batch = []; }
          yield {items:[item],scalarBoundary:true};
        } else {
          batch.push(item);
          if (batch.length === 64) { yield {items:batch,scalarBoundary:false}; batch = []; }
        }
      }
      if (batch.length) yield {items:batch,scalarBoundary:false};
    }
    await bounded(chunks(),2,chunk => constructionBatch(chunk.items,category,chunk.scalarBoundary));
  }

  async function exerciseMutation(
    item: MutationFixture,
    text = item.text,
  ): Promise<NativeProtocol> {
    const fixture = {...item,text};
    const oracle = item.kind === 'unconstrained' ? commonScalar(text) : undefined;
    const mode = item.kind === 'invalid' ? 'parse' : 'roundtrip';
    const result = await invoke(fixture,mode);
    if (item.kind === 'invalid') {
      expectResult(
        result,
        {kind:'fail',...(item.code === undefined ? {} : {code:item.code})},
        'parse-done',
      );
    } else if (item.kind === 'equivalent' || oracle) {
      const expectedValue = oracle?.value ?? item.value;
      assert.ok(expectedValue);
      expectResult(result,{kind:'done',text:encodeExpected(expectedValue)},'done');
    } else {
      assert.ok(result.kind === 'parse-fail' || result.kind === 'done','Unconstrained mutation must reject structurally or complete an exact native AST roundtrip');
    }
    return result;
  }

  async function minimize(
    item: MutationFixture,
    originalError: unknown,
    campaignDeadline: number,
  ): Promise<NativeMutationMinimized> {
    const signature = (error: unknown): string => {
      const failure = asNativeError(error);
      return failure.nativeResult
        ? outcome(failure.nativeResult)
        : failure.category ?? failure.name;
    };
    const wanted = signature(originalError);
    const admissible = (text: string): boolean => {
      if (item.kind === 'unconstrained') return true;
      if (item.kind === 'invalid') {
        try { JSON.parse(text); return false; } catch { return true; }
      }
      try { assert.deepEqual(JSON.parse(text),JSON.parse(item.text)); return true; } catch { return false; }
    };
    let chars = [...item.text], width = Math.floor(chars.length / 2), attempts = 0;
    const deadline = Math.min(campaignDeadline,performance.now()+10000);
    while (width > 0 && attempts < 64 && performance.now() < deadline) {
      let reduced = false;
      for (let index = 0; index + width <= chars.length && attempts < 64 && performance.now() < deadline; index += width) {
        const text = chars.slice(0,index).concat(chars.slice(index+width)).join('');
        if (!admissible(text)) continue;
        attempts++;
        try {
          await exerciseMutation({...item,id:`${item.id}/minimize/${attempts}`},text);
        } catch (error) {
          if (signature(error) === wanted) {
            chars = [...text];
            reduced = true;
            break;
          }
        }
      }
      if (!reduced) width = Math.floor(width / 2);
    }
    const text = chars.join('');
    const status = performance.now() >= deadline
      ? 'recovery-deadline'
      : width > 0 && attempts >= 64
        ? 'attempt-limit'
        : 'minimized';
    return {status,text,attempts,sha256:sha256(text),failureClass:wanted};
  }

  try {
    const entries = corpusEntries();
    assert.equal(entries.length,318,'Native corpus inventory must reconcile all 318 files');
    assert.equal(new Set(entries.map(item => item.name)).size,318,'Duplicate native corpus names');
    report.corpus.inventory = entries.length;
    report.corpus.entries = entries.map(item => ({id:item.id,name:item.name,class:item.class,expected:item.expected,status:item.expected === 'byte-excluded' ? 'byte-excluded' : 'unattempted'}));
    report.corpus.byteExcluded = entries.filter(item => item.expected === 'byte-excluded').length;
    report.corpus.decoded = entries.length-report.corpus.byteExcluded;
    assert.equal(report.corpus.byteExcluded,25); assert.equal(report.corpus.decoded,293);
    report.versions = versions();
    report.compilerSource = {root:REF,entry:COMPILER};
    if (!await compiler()) {
      if (required) throw new Error('Native required, but Clang is absent');
      report.status = 'unverified'; report.reason = 'Clang absent; native cases are explicitly unattempted, not passing.';
      persist(); return report;
    }

    // Prove the byte precondition before allowing even one corpus byte to Bend.
    for (const bytes of [[0x80],[0xff],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe2,0x82]]) assert.throws(() => strictDecode(Uint8Array.from(bytes)));
    assert.equal(strictDecode(Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d])),'\ufeff{}');
    const validBytes = Buffer.from('"é😀"');
    for (let i = 0; i < validBytes.length; i++) { const bytes = Buffer.from(validBytes); bytes[i] = 0xff; assert.throws(() => strictDecode(bytes)); }
    report.byteControls = {invalid:6,mutated:validBytes.length,bomPreserved:true};

    const supportCheck = await capture('check/native-support',BUN,['--no-install',COMPILER,resolve(ROOT,'tests/support.bend')],30000,1024*1024);
    successful(supportCheck,'Checking native helper');
    assert.equal(supportCheck.stdout.replaceAll('\r\n','\n'),'All terms check.\n','Native equality helper must check without unsafe annotations');
    await build(resolve(ROOT,'tests/native.bend'),driver);

    writeFileSync(file,inputBytes('null'));
    const application = ['parse',file,...limitFields.map(field => String(limits()[field]))];
    const failureControls = [
      {id:'missing-arguments',args:[],status:64,diagnostic:/^HARNESS_EXPECTED_EIGHT_ARGUMENTS\n$/},
      {id:'extra-argument',args:[...application,'extra'],status:64,diagnostic:/^HARNESS_EXPECTED_EIGHT_ARGUMENTS\n$/},
      {id:'decimal-natural',args:[...application.slice(0,2),'-1',...application.slice(3)],status:64,diagnostic:/^HARNESS_ARGUMENT_NOT_DECIMAL_NAT\n$/},
      {id:'unknown-mode',args:['encode',...application.slice(1)],status:64,diagnostic:/^HARNESS_UNKNOWN_MODE\n$/},
      {id:'missing-file',args:['parse',resolve(directory,'absent-input'),...application.slice(2)],status:74,diagnostic:/^HARNESS_FILE_OPEN: [0-9]+: [^\n]+\n$/},
      {id:'read-failure',args:['parse',directory,...application.slice(2)],status:74,diagnostic:/^HARNESS_FILE_READ: [0-9]+: [^\n]+\n$/}
    ];
    report.driverControls = [];
    for (const control of failureControls) {
      const result = await capture(`driver-control/${control.id}`,driver,['--threads','1','--gpu','off','--',...control.args]);
      assert.equal(result.error,null); assert.equal(result.signal,null); assert.equal(result.timedOut,false); assert.equal(result.overflow,false); assert.equal(result.killError,null);
      assert.equal(result.status,control.status,`${control.id}: wrong harness exit`);
      assert.equal(result.stdout,'',`${control.id}: effect/argument failure was misreported as a library result`);
      assert.match(result.stderr,control.diagnostic,`${control.id}: unrelated error does not satisfy the control`);
      report.driverControls.push({id:control.id,status:result.status,stderr:result.stderr});
    }

    const controls = resolve(directory,'controls.bend'), controlsBinary = resolve(directory,'controls');
    writeFileSync(controls,controlsSource); await build(controls,controlsBinary);
    const controlResult = successful(await capture('native/comparator-controls',controlsBinary,['--threads','1','--gpu','off']),'Native equality controls');
    assert.equal(controlResult.stdout,'DEFAULTS\t1048576\t128\t4096\t262144\t100000\t2097152\nEQUAL_WIDE\nUNEQUAL_LATE\nEQUAL_DEEP\nUNEQUAL_LEXEME\nUNEQUAL_ORDER\nEXHAUSTION_DISTINCT\n');
    report.comparatorControls = ['wide-100000','late-inequality','deep-10000','number-lexeme','duplicate-member-order','exhaustion-distinct'];
    rmSync(controls); rmSync(controlsBinary);

    const malformedText: ConstructionItem[] = [];
    await bounded(textCases(),4,async item => {
      if (invalidScalars(item).length) malformedText.push({...item,operation:'parse'});
      else await directed(item);
    });
    reconcileCoverage('directedText');
    await batches(malformedText,'malformed-parse');
    reconcileCoverage('malformedParse');
    await bounded(entries.entries(),4,async ([index,item]) => {
      const entry = report.corpus.entries[index];
      assert.ok(entry);
      const bytes = readFileSync(resolve(ROOT,'tests/fixtures/JSONTestSuite/test_parsing',item.name));
      if (item.expected === 'byte-excluded') {
        assert.equal(item.text,undefined);
        assert.throws(() => strictDecode(bytes));
        return;
      }
      assert.ok(item.text !== undefined);
      const fixture = {...item,text:item.text};
      inputBytes(fixture.text,bytes);
      report.corpus.attempted++;
      try {
        const result = await invoke(fixture,'parse',bytes);
        entry.status = result.kind === 'parse-done' ? 'acceptance' : 'structured-rejection';
        if (result.kind === 'parse-done') {
          report.corpus.accepted++;
        } else {
          assert.ok(result.kind === 'parse-fail');
          assert.ok(Object.hasOwn(parseCodes, result.code));
          const code = result.code as ParseCode;
          report.corpus.rejected++;
          entry.code = code;
          entry.offset = result.offset;
          entry.category = rejectedCategory(code);
          report.corpus.rejectionCategories[entry.category] = (report.corpus.rejectionCategories[entry.category] || 0)+1;
        }
        if (item.expected === 'accept') {
          expectResult(result,{kind:'done'},'parse-done');
        } else {
          const expected: Expectation = item.expected === 'bom-reject'
            ? {kind:'fail',code:'PLeadingBom',offset:0}
            : item.expected === 'surrogate-reject'
              ? {kind:'fail',code:'PUnpairedSurrogate'}
              : {kind:'fail'};
          expectResult(result,expected,'parse-done');
        }
        if (result.kind === 'parse-done') {
          const roundtrip = await invoke({...fixture,id:`${item.id}/roundtrip`},'roundtrip',bytes);
          assert.equal(roundtrip.kind,'done');
          entry.roundtrip = 'pass';
        }
        entry.verdict = 'pass';
      } catch (error) {
        const failure = asNativeError(error);
        if (entry.status === 'unattempted') {
          entry.status = failure.nativeResult ? outcome(failure.nativeResult) : 'harness-failure';
        }
        entry.verdict = 'fail';
        entry.error = errorRecord(error);
        throw error;
      }
    });
    assert.equal(report.corpus.attempted,293);
    assert.equal(report.corpus.entries.filter(item => item.class === 'y' && item.status === 'acceptance').length,95);
    const deep = entries.find(item => item.name === 'i_structure_500_nested_arrays.json');
    assert.ok(deep?.text !== undefined,'Missing default-depth corpus fixture');
    const defaultDepth = {...deep,text:deep.text,id:'corpus/default-depth',limits:limits()};
    expectResult(await invoke(defaultDepth,'parse'),{kind:'fail',code:'PDepthLimit',offset:128},'parse-done');
    report.coverage.defaultDepth++;
    recordCoverage('defaultDepth',defaultDepth.id);
    reconcileCoverage('defaultDepth');

    const generatedHashes = new Map<string, string>();
    await bounded(generated(),4,async item => {
      fixtureFits(item);
      generatedHashes.set(item.id,sha256(item.text));
      const variants: ReadonlyArray<readonly [string, string, GeneratedCoverageField]> = [
        ['', item.text, 'generatedText'],
        ['/whitespace', whitespace(item.text), 'generatedWhitespace'],
        ['/escapes', escapedScalars(item.text), 'generatedEscapes'],
      ];
      for (const [suffix,text,field] of variants) {
        assert.ok(BigInt([...text].length) <= item.limits.max_input);
        expectResult(await invoke({...item,id:item.id+suffix,text},'roundtrip'),{kind:'done',text:item.text},'done');
        report.coverage[field]++;
      }
    });
    assert.equal(generatedHashes.size,3000);
    assert.equal(report.coverage.generatedText,3000);
    assert.equal(report.coverage.generatedWhitespace,3000);
    assert.equal(report.coverage.generatedEscapes,3000);
    function* constructedProperties(): Generator<ConstructionItem> {
      for (const item of generated()) {
        fixtureFits(item);
        assert.equal(sha256(item.text),generatedHashes.get(item.id),'Native constructed fixture seed/order differs from replay');
        yield {...item,expect:{kind:'done',text:item.text}};
      }
    }
    await batches(constructedProperties(),'generated');
    assert.equal(report.construction.generated,3000,'Every generated AST must be independently constructed natively');

    await bounded(commonGenerated(),4,async item => {
      fixtureFits(item);
      assert.deepEqual(JSON.parse(item.text),item.host);
      const hostText = JSON.stringify(item.host);
      assert.ok(hostText !== undefined);
      const variants: ReadonlyArray<readonly [string, string]> = [
        ['', item.text],
        ['/host-text', hostText],
      ];
      for (const [suffix,text] of variants) {
        const result = await invoke({...item,id:item.id+suffix,text},'roundtrip');
        expectResult(result,{kind:'done',text:item.text},'done');
        assert.ok(result.kind === 'done');
        assert.deepEqual(JSON.parse(result.text),item.host);
      }
      report.coverage.commonDomain++;
    });
    assert.equal(report.coverage.commonDomain,300);
    const encoderConstruction: ConstructionItem[] = [...encoderCases()].map(item => ({
      ...item,
      operation:'encode',
    }));
    await batches(encoderConstruction,'directed-encode');
    reconcileCoverage('directedEncodeShared');
    assert.equal(report.construction.directedEncode,88,'Shared directed encode construction count changed');
    const numberConstruction: ConstructionItem[] = [...numberCases()].map(item => {
      if (item.expect.kind === 'fail') return {...item,operation:'number'};
      const value = item.expect.value;
      assert.ok(value?.$ === 'Number');
      return {...item,operation:'number',expect:{...item.expect,text:value.text}};
    });
    await batches(numberConstruction,'number');
    reconcileCoverage('number');
    // Native can represent U32 Char payloads that JS String cannot. These are
    // separate from surrogate cases inherited from the host ABI fixtures.
    for (const code of [0x110000,0xffffffff]) {
      for (const key of [false,true]) {
        const item: ConstructionItem = {
          id:`native/scalar/${code}/${key?'key':'text'}`,
          operation:'encode',
          limits:limits(),
          scalarCodes:[code],
          expression:key
            ? 'J.Object{Con{J.Member{SCon{bad0,SNil{}},J.Null{}},Nil{}}}'
            : 'J.Text{SCon{bad0,SNil{}}}',
          expect:{kind:'fail',code:'EInvalidScalar',offset:key?2:1},
        };
        await constructionBatch([item],'invalid-scalar',true);
      }
    }
    reconcileCoverage('directedEncodeNative');
    reconcileCoverage('directedEncode');

    await bounded(largeFixtures(),4,async item => {
      fixtureFits(item);
      expectResult(await invoke(item,'parse'),{kind:'done'},'parse-done');
      expectResult(await invoke({...item,id:`${item.id}/roundtrip`},'roundtrip'),{kind:'done',text:item.text},'done');
      report.coverage.large++;
    });
    assert.equal(report.coverage.large,7);

    try {
      const control = await nativeMemorySelftest();
      report.memory.control = control;
      event({event:'memory-control',...control});
    } catch (error) {
      const failure = asNativeError(error);
      const control = typeof failure.report === 'object' && failure.report !== null
        ? failure.report as Record<string, unknown>
        : {status:'fail',error:errorRecord(error)};
      report.memory.control = control;
      event({event:'memory-control',...control});
      throw error;
    }
    const campaignStart = performance.now(), campaignDeadline = campaignStart+600000;
    report.mutations = {seed:'0x8259F00D',deadlineMs:600000,caseTimeoutMs:5000,counts:{invalid:0,equivalent:0,unconstrained:0},results:[]};
    for (const item of mutationFixtures()) {
      assert.ok(performance.now() < campaignDeadline,'Native mutation campaign exceeded ten minutes');
      assert.ok([...item.text].length <= 65536,'Native mutation source cap exceeded');
      try {
        const result = await exerciseMutation(item);
        report.mutations.counts[item.kind]++;
        report.mutations.results.push({
          id:item.id,
          origin:item.origin,
          seed:item.seed,
          hash:item.hash,
          kind:item.kind,
          status:result.kind,
          ...(
            result.kind === 'parse-fail' || result.kind === 'encode-fail'
              ? {code:result.code,offset:result.offset}
              : {}
          ),
        });
        report.coverage.mutations++;
      } catch (error) {
        const minimized = await minimize(item,error,campaignDeadline);
        retainMutationFailure(item,error,minimized,'native');
        report.mutations.failure = {id:item.id,origin:item.origin,seed:item.seed,hash:item.hash,error:errorRecord(error),minimized};
        throw error;
      }
      assert.ok(performance.now() <= campaignDeadline,'Native mutation campaign exceeded ten minutes');
    }
    assert.equal(report.coverage.mutations,2048);
    assert.equal(report.memory.invocations,2048,'Every mutation invocation must enter memory accounting');
    assert.equal(
      report.memory.sampledInvocations + report.memory.unobservedInvocations,
      report.memory.invocations,
      'Sampled and unobserved mutation invocations must reconcile',
    );
    assert.ok(
      report.memory.samples >= report.memory.sampledInvocations,
      'Every sampled mutation invocation must contribute an RSS observation',
    );
    assert.equal(report.memory.exceeded,false,'No mutation invocation may exceed the RSS ceiling');
    report.mutations.elapsedMs = performance.now()-campaignStart;
    report.status = 'pass';
    event({event:'summary',status:'pass',coverage:report.coverage,construction:report.construction,corpus:{inventory:318,attempted:293,byteExcluded:25}});
    rmSync(file,{force:true}); rmSync(inputs,{recursive:true}); rmSync(driver);
    persist(); return report;
  } catch (error) {
    report.status = 'fail';
    report.error = errorRecord(error);
    event({event:'summary',status:'fail',error:report.error});
    persist();
    const cause = asNativeError(error);
    const failure = new Error(
      `Native verification failed; retained source, input, commands, outputs and report in ${directory}\n${cause.stack ?? cause.message}`,
      { cause },
    ) as NativeError;
    failure.report = report;
    throw failure;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--required')) { console.error('Usage: node scripts/native.ts [--required]'); process.exitCode = 1; }
  else {
    try { const report = await nativeVerify({required:args.includes('--required')}); console.log(json(report)); }
    catch (error) { const failure = asNativeError(error); console.error(failure.stack ?? failure.message); process.exitCode = 1; }
  }
}
