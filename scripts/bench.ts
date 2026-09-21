import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { ROOT, COMPILER, BUN, NODE, ENV, versions, artifacts, run } from './tools.ts';
import type { Versions } from './tools.ts';
import {
  fixtures,
  metadata,
  forceAst,
  stats,
  OPERATIONS,
  WARMUPS,
  SAMPLES,
  SAMPLE_MS,
  TOTAL_MS,
} from '../tests/bench-host.ts';
import type {
  BenchmarkFixture,
  BenchmarkMetadata,
  Operation,
  SampleStats,
} from '../tests/bench-host.ts';

interface BenchError extends Error {
  code?: string;
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
}
interface ChildResult {
  processMs: number;
  stderr: string;
  status: number;
}
interface NativeSampleResult {
  duration: number;
  batch: number;
  processMs: number;
  setupMs: number;
  stderr: string;
}
interface Measurement extends BenchmarkMetadata, SampleStats {
  operation: Operation;
  warmups: number;
  samples: number;
  batch: number;
  sampleMs: number[];
  [key: string]: unknown;
}
interface GrowthDiagnostic {
  family: string;
  from: string;
  to: string;
  sizeRatio: number;
  timeRatio: number | null;
  diagnostic: string;
}
interface BenchmarkLane {
  name: string;
  status: 'running' | 'pass' | 'fail' | 'unverified';
  measurements: Measurement[];
  startupMs?: number | null;
  processMs?: number;
  stderr?: string;
  compiler?: string;
  memory?: string;
  compileMs?: number;
  build?: { stdout: string; stderr: string };
  reason?: string;
  growthDiagnostics?: GrowthDiagnostic[];
}
interface BenchmarkFailure {
  message: string;
  stderr?: string;
  status?: number | null;
  signal?: NodeJS.Signals | null;
}
interface BenchmarkReport {
  date: string;
  versions: Versions | null;
  hardware: {
    platform: NodeJS.Platform;
    release: string;
    arch: string;
    cpu: string | undefined;
    logicalCpus: number;
    totalMemoryBytes: number;
  };
  policy: {
    warmups: number;
    samples: number;
    sampleDeadlineMs: number;
    campaignDeadlineMs: number;
    nativeTargetBatchMs: number;
    nativeMaxBatch: number;
  };
  boundary: string;
  memory: string;
  lanes: BenchmarkLane[];
  failures: BenchmarkFailure[];
  watchdogControl?: unknown;
  elapsedMs?: number;
  status?: 'pass' | 'fail';
}
type BenchmarkEvent =
  | { event: 'ready'; runtime: string }
  | { event: 'start'; id: string; timeoutMs: number }
  | { event: 'end'; id: string }
  | ({ event: 'measurement' } & Measurement)
  | { event: 'summary'; status: 'pass'; sink: number; rssBytes: number }
  | { event: 'failure'; message: string };

artifacts();
const started = performance.now();
const cpus = os.cpus();
const report: BenchmarkReport = {
  date: new Date().toISOString(),
  versions: null,
  hardware: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: cpus[0]?.model,
    logicalCpus: cpus.length,
    totalMemoryBytes: os.totalmem(),
  },
  policy: {
    warmups: WARMUPS,
    samples: SAMPLES,
    sampleDeadlineMs: SAMPLE_MS,
    campaignDeadlineMs: TOTAL_MS,
    nativeTargetBatchMs: 100,
    nativeMaxBatch: 1024,
  },
  boundary: 'Fixture generation, UTF-8 decoding, file IO, loader/compiler/process startup and correctness checks are outside timed calls. Host eager ABI conversion is inside core calls. Native parse/encode include full result traversal; traversal is also measured separately. Equality is the test-only iterative comparator, not a public library API.',
  memory: 'Host RSS snapshots are measured, not peak RSS or enforced bounds. Native memory is unmeasured.',
  lanes: [],
  failures: [],
};
let directory: string | undefined;
function remaining(): number {
  const left = TOTAL_MS - (performance.now() - started);
  if (left <= 0) throw new Error('Benchmark campaign exceeded ten minutes');
  return left;
}
function benchError(error: unknown): BenchError {
  return error instanceof Error ? error as BenchError : new Error(String(error));
}

// Streamed start/end messages let the parent kill and reap a hung synchronous
// library call. A child-side elapsed check alone cannot enforce that boundary.
function child(
  command: string,
  args: readonly string[],
  line: (text: string, arm: (milliseconds: number) => void, elapsedMs: number) => void,
  { native = false }: { native?: boolean } = {},
): Promise<ChildResult> {
  const { promise, resolve: resolvePromise, reject } = Promise.withResolvers<ChildResult>();
  const born = performance.now();
  const processChild = spawn(command, args, {
    cwd: ROOT,
    env: ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  let timer: NodeJS.Timeout | undefined;
  let error: BenchError | undefined;
  let bytes = 0;
  const fail = (reason: unknown): void => {
    error ||= benchError(reason);
    processChild.kill('SIGKILL');
  };
  const arm = (milliseconds: number): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(Object.assign(
      new Error(`${command}: ${native ? 'native ' : ''}benchmark deadline exceeded`),
      { code: 'benchmark-timeout' },
    )), Math.max(1, Math.min(milliseconds, TOTAL_MS - (performance.now() - started))));
  };
  arm(120000);
  processChild.stdout.setEncoding('utf8');
  processChild.stderr.setEncoding('utf8');
  processChild.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 64 * 1024 * 1024) {
      fail(new Error('Benchmark stdout cap exceeded'));
      return;
    }
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      try {
        line(text, arm, performance.now() - born);
      } catch (lineError) {
        fail(lineError);
      }
    }
  });
  processChild.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 1048576) fail(new Error('Benchmark stderr cap exceeded'));
  });
  processChild.on('error', fail);
  processChild.on('close', (status, signal) => {
    clearTimeout(timer);
    if (stderr) process.stderr.write(stderr); // In particular, retain Node loader warnings.
    if (error || status !== 0 || signal || buffer) {
      reject(Object.assign(
        error ?? new Error(`Benchmark child status=${status} signal=${signal}; incomplete=${Boolean(buffer)}`),
        { status, signal, stderr },
      ));
    } else {
      assert.ok(status !== null);
      resolvePromise({ processMs: performance.now() - born, stderr, status });
    }
  });
  return promise;
}

function parseBenchmarkEvent(text: string): BenchmarkEvent {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('event' in parsed)) {
    throw new Error('Benchmark event must be an object with a discriminant');
  }
  if (parsed.event === 'ready') {
    if (!('runtime' in parsed) || typeof parsed.runtime !== 'string') throw new Error('Malformed ready event');
    return parsed as BenchmarkEvent;
  }
  if (parsed.event === 'start') {
    if (!('id' in parsed) || typeof parsed.id !== 'string'
      || !('timeoutMs' in parsed) || typeof parsed.timeoutMs !== 'number') {
      throw new Error('Malformed benchmark start event');
    }
    return parsed as BenchmarkEvent;
  }
  if (parsed.event === 'end') {
    if (!('id' in parsed) || typeof parsed.id !== 'string') throw new Error('Malformed benchmark end event');
    return parsed as BenchmarkEvent;
  }
  if (parsed.event === 'measurement') {
    if (!('id' in parsed) || typeof parsed.id !== 'string'
      || !('operation' in parsed) || typeof parsed.operation !== 'string'
      || !OPERATIONS.includes(parsed.operation as Operation)
      || !('samples' in parsed) || parsed.samples !== SAMPLES
      || !('sampleMs' in parsed) || !Array.isArray(parsed.sampleMs)
      || !parsed.sampleMs.every(value => typeof value === 'number'
        && Number.isFinite(value) && value >= 0 && value <= SAMPLE_MS)
      || !('inputCodepoints' in parsed) || typeof parsed.inputCodepoints !== 'number'
      || !('medianMs' in parsed) || typeof parsed.medianMs !== 'number') {
      throw new Error('Malformed benchmark measurement event');
    }
    return parsed as BenchmarkEvent;
  }
  if (parsed.event === 'summary') {
    if (!('status' in parsed) || parsed.status !== 'pass'
      || !('sink' in parsed) || typeof parsed.sink !== 'number'
      || !('rssBytes' in parsed) || typeof parsed.rssBytes !== 'number') {
      throw new Error('Malformed benchmark summary event');
    }
    return parsed as BenchmarkEvent;
  }
  if (parsed.event === 'failure') {
    if (!('message' in parsed) || typeof parsed.message !== 'string') {
      throw new Error('Malformed benchmark failure event');
    }
    return parsed as BenchmarkEvent;
  }
  throw new Error(`Unknown benchmark event ${String(parsed.event)}`);
}

async function watchdogSelftest() {
  let observedStart: number | null = null;
  let failure: BenchError | undefined;
  const began = performance.now();
  try {
    await child(
      NODE,
      [
        '--input-type=module',
        '-e',
        'import { writeSync } from "node:fs"; writeSync(1, "START\\n"); setTimeout(() => process.exit(0), 15000);',
      ],
      (line, arm) => {
        assert.equal(line, 'START');
        assert.equal(observedStart, null);
        observedStart = performance.now();
        arm(SAMPLE_MS);
      },
      { native: true },
    );
  } catch (error) {
    failure = benchError(error);
  }
  if (observedStart === null) throw new Error('Watchdog control never emitted its flushed START');
  assert.equal(failure?.code, 'benchmark-timeout', 'Delayed child must fail the shared sample watchdog');
  assert.equal(failure.signal, 'SIGKILL', 'Watchdog must kill and reap the delayed child');
  const sampleElapsedMs = performance.now() - observedStart;
  assert.ok(
    sampleElapsedMs >= SAMPLE_MS - 50 && sampleElapsedMs < SAMPLE_MS + 5000,
    `Watchdog used wrong boundary: ${sampleElapsedMs} ms`,
  );
  return {
    status: 'pass',
    startObserved: true,
    killedAndReaped: true,
    sampleElapsedMs,
    processMs: performance.now() - began,
    expectedSampleDeadlineMs: SAMPLE_MS,
    childNaturalExitMs: 15000,
    signal: failure.signal,
  };
}

async function hostLane(name: string, command: string, loader: readonly string[]): Promise<void> {
  const lane: BenchmarkLane = { name, status: 'running', measurements: [], startupMs: null };
  report.lanes.push(lane);
  let ready = false;
  let pending: string | null = null;
  let summary = false;
  const seen = new Set<string>();
  try {
    const result = await child(
      command,
      [...loader, resolve(ROOT, 'tests/bench-host.ts')],
      (text, arm, elapsed) => {
        const event = parseBenchmarkEvent(text);
        switch (event.event) {
          case 'ready':
            assert.equal(ready, false);
            ready = true;
            lane.startupMs = elapsed;
            arm(SAMPLE_MS);
            break;
          case 'start':
            assert.ok(ready && !summary);
            assert.equal(pending, null);
            pending = event.id;
            arm(SAMPLE_MS);
            break;
          case 'end':
            assert.equal(event.id, pending);
            pending = null;
            arm(SAMPLE_MS);
            break;
          case 'measurement': {
            assert.equal(pending, null);
            const key = `${event.id}/${event.operation}`;
            assert.ok(!seen.has(key));
            seen.add(key);
            lane.measurements.push(event);
            break;
          }
          case 'summary':
            assert.equal(pending, null);
            assert.equal(summary, false);
            summary = true;
            break;
          case 'failure':
            throw new Error(event.message);
        }
      },
    );
    assert.ok(ready && summary && pending === null);
    const expected = [...fixtures()].flatMap(item => (
      OPERATIONS.map(operation => `${item.id}/${operation}`)
    ));
    assert.deepEqual([...seen].sort(), expected.sort());
    Object.assign(lane, result, { status: 'pass' });
  } catch (error) {
    lane.status = 'fail';
    throw error;
  }
}

async function nativeSample(
  binary: string,
  path: string,
  item: BenchmarkFixture,
  operation: Operation,
  batch: number,
): Promise<NativeSampleResult> {
  let checked = false;
  let timed = false;
  let timing: { duration: number; batch: number } | null = null;
  let setupMs: number | undefined;
  const mode = OPERATIONS.indexOf(operation) + 1;
  const invocation = await child(
    binary,
    [
      '--threads',
      '1',
      '--gpu',
      'off',
      '--',
      path,
      'x'.repeat(mode),
      'x'.repeat(batch),
      item.limits.max_values > 100000n ? 'x' : '',
    ],
    (line, arm, elapsed) => {
      if (line.startsWith('CHECK\t')) {
        assert.equal(checked, false);
        assert.equal(line.slice(6), item.text);
        checked = true;
      } else if (line === 'START') {
        assert.ok(checked && !timed);
        timed = true;
        setupMs = elapsed;
        arm(SAMPLE_MS);
      } else {
        const match = /^TIME\t([0-9]+)\t([0-9]+)$/.exec(line);
        const durationText = match?.[1];
        const resultText = match?.[2];
        assert.ok(durationText !== undefined && resultText !== undefined && timed && timing === null,
          `Unexpected native protocol ${line.slice(0, 100)}`);
        const duration = Number(durationText);
        assert.ok(Number.isSafeInteger(duration) && duration <= SAMPLE_MS);
        const perIteration = operation === 'parse' || operation === 'materialize-ast'
          ? forceAst(item.value)
          : operation === 'equality'
            ? 1
            : item.outputCodepoints;
        assert.equal(BigInt(resultText), BigInt(perIteration) * BigInt(batch));
        timing = { duration, batch };
        arm(SAMPLE_MS);
      }
    },
    { native: true },
  );
  const completed = timing as { duration: number; batch: number } | null;
  if (!checked || !timed || completed === null || setupMs === undefined) {
    throw new Error('Native benchmark sample did not complete its protocol');
  }
  return {
    ...completed,
    processMs: invocation.processMs,
    setupMs,
    stderr: invocation.stderr,
  };
}

async function nativeLane(cc: string, compilerVersion: string): Promise<void> {
  if (directory === undefined) throw new Error('Native benchmark directory is unavailable');
  const lane: BenchmarkLane = {
    name: 'native',
    status: 'running',
    compiler: compilerVersion,
    measurements: [],
    memory: 'unmeasured',
  };
  report.lanes.push(lane);
  const binary = resolve(directory, 'bench-native');
  const buildStart = performance.now();
  const built = run(
    BUN,
    ['--no-install', COMPILER, resolve(ROOT, 'tests/bench-native.bend'), '-o', binary],
    { timeout: Math.min(120000, remaining()), env: { ...ENV, CC: cc } },
  );
  lane.compileMs = performance.now() - buildStart;
  lane.build = { stdout: built.stdout, stderr: built.stderr };
  for (const item of fixtures()) {
    const path = resolve(directory, `${item.id}.json`);
    writeFileSync(path, item.text, 'utf8');
    // This independently generated UTF-8 fixture must decode exactly, BOM included.
    assert.equal(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(item.text)),
      item.text,
    );
    for (const operation of OPERATIONS) {
      let batch = 1;
      let calibration: NativeSampleResult;
      const calibrationSamples: NativeSampleResult[] = [];
      do {
        remaining();
        calibration = await nativeSample(binary, path, item, operation, batch);
        calibrationSamples.push(calibration);
        if (calibration.duration >= 100 || batch === 1024) break;
        batch *= 2;
      } while (true);
      const samples: number[] = [];
      const processSamples: number[] = [];
      const setupSamples: number[] = [];
      const warmupSamples: number[] = [];
      for (let index = -WARMUPS; index < SAMPLES; index++) {
        remaining();
        const sample = await nativeSample(binary, path, item, operation, batch);
        if (index < 0) warmupSamples.push(sample.duration);
        else {
          samples.push(sample.duration / batch);
          processSamples.push(sample.processMs);
          setupSamples.push(sample.setupMs);
        }
      }
      const measurement: Measurement = {
        ...metadata(item),
        operation,
        warmups: WARMUPS,
        samples: SAMPLES,
        batch,
        ...stats(samples),
        sampleMs: samples,
        calibrationSamples,
        warmupBatchMs: warmupSamples,
        processMs: processSamples,
        startupFileSetupCheckMs: setupSamples,
        timer: 'IO.now milliseconds',
        resolutionMs: 1,
        belowTargetPrecision: calibration.duration < 100
          || samples.some(value => value * batch < 100),
        belowClockResolution: samples.some(value => value === 0),
        timing: 'native core call plus full traversal, excluding IO/process/setup; standalone traversal measured separately',
      };
      lane.measurements.push(measurement);
      console.log(
        `native ${item.id} ${operation}: ${measurement.medianMs} ms`
          + `${measurement['belowTargetPrecision'] ? ' (below 100 ms batch precision target)' : ''}`,
      );
    }
  }
  lane.status = 'pass';
}

function recordFailure(error: unknown): void {
  const failure = benchError(error);
  report.failures.push({
    message: failure.stack ?? failure.message,
    ...(failure.stderr === undefined ? {} : { stderr: failure.stderr }),
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.signal === undefined ? {} : { signal: failure.signal }),
  });
  for (const lane of report.lanes) if (lane.status === 'running') lane.status = 'fail';
  process.exitCode = 1;
}

function growthDiagnostics(measurements: readonly Measurement[]): GrowthDiagnostic[] {
  const groups = new Map<string, Measurement[]>();
  const diagnostics: GrowthDiagnostic[] = [];
  for (const sample of measurements) {
    if (sample.operation !== 'parse' && sample.operation !== 'encode' && sample.operation !== 'equality') {
      continue;
    }
    const key = `${sample.id.replace(/-[0-9]+$/, '')}/${sample.operation}`;
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }
  for (const [family, samples] of groups) {
    samples.sort((left, right) => left.inputCodepoints - right.inputCodepoints);
    for (let index = 1; index < samples.length; index++) {
      const before = samples[index - 1];
      const after = samples[index];
      assert.ok(before && after);
      const sizeRatio = after.inputCodepoints / before.inputCodepoints;
      const timeRatio = before.medianMs > 0 ? after.medianMs / before.medianMs : null;
      diagnostics.push({
        family,
        from: before.id,
        to: after.id,
        sizeRatio,
        timeRatio,
        diagnostic: timeRatio === null
          ? 'below clock resolution'
          : before.medianMs >= 0.05 && timeRatio > sizeRatio * 2
            ? 'superlinear-growth signal: investigate allocation, conversion, traversal and runtime; not an asymptotic conclusion'
            : 'no greater-than-2x normalized growth signal at this pair',
      });
    }
  }
  return diagnostics;
}

try {
  report.versions = versions();
  assert.ok(
    process.argv.slice(2).every(arg => arg === '--watchdog-selftest'),
    'Unknown benchmark argument',
  );
  report.watchdogControl = await watchdogSelftest();
  if (!process.argv.includes('--watchdog-selftest')) {
    directory = mkdtempSync(resolve(ROOT, 'artifacts/bench-'));
    const runtimes: Array<[string, string, string[]]> = [
      ['Node', NODE, ['--import', COMPILER]],
      ['Bun', BUN, ['--no-install', '--preload', COMPILER]],
    ];
    for (const [name, command, loader] of runtimes) {
      try {
        remaining();
        await hostLane(name, command, loader);
      } catch (error) {
        recordFailure(error);
      }
    }
    const cc = process.env['CC'] || (os.platform() === 'darwin' ? '/usr/bin/clang' : 'clang');
    const available = spawnSync(cc, ['--version'], {
      cwd: ROOT,
      env: ENV,
      encoding: 'utf8',
      timeout: Math.min(10000, remaining()),
    });
    if ((available.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      report.lanes.push({
        name: 'native',
        status: 'unverified',
        reason: `Clang executable unavailable: ${cc}`,
        measurements: [],
      });
    } else {
      if (available.error || available.signal || available.status !== 0) {
        throw new Error(`Detected native compiler failed: ${available.error ?? available.stderr}`);
      }
      assert.match(available.stdout, /clang version/i, 'Native benchmarks require Clang');
      await nativeLane(cc, available.stdout.trim());
    }
  }
} catch (error) {
  recordFailure(error);
} finally {
  report.elapsedMs = performance.now() - started;
  report.status = report.failures.length > 0 ? 'fail' : 'pass';
  for (const lane of report.lanes) {
    lane.growthDiagnostics = growthDiagnostics(lane.measurements);
  }
  writeFileSync(resolve(ROOT, 'artifacts/bench.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (directory) rmSync(directory, { recursive: true, force: true });
  console.log(`Benchmarks: ${report.status}; report artifacts/bench.json`);
  if (report.failures.length > 0) {
    console.error(report.failures.map(item => item.message).join('\n'));
  }
}
