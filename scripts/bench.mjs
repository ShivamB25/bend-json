import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { ROOT, COMPILER, BUN, NODE, ENV, versions, artifacts, run } from './tools.mjs';
import { fixtures, metadata, forceAst, stats, OPERATIONS, WARMUPS, SAMPLES, SAMPLE_MS, TOTAL_MS } from '../tests/bench-host.mjs';

artifacts();
const started = performance.now();
const report = {
  date: new Date().toISOString(), versions: null,
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  policy: { warmups: WARMUPS, samples: SAMPLES, sampleDeadlineMs: SAMPLE_MS, campaignDeadlineMs: TOTAL_MS, nativeTargetBatchMs: 100, nativeMaxBatch: 1024 },
  boundary: 'Fixture generation, UTF-8 decoding, file IO, loader/compiler/process startup and correctness checks are outside timed calls. Host eager ABI conversion is inside core calls. Native parse/encode include full result traversal; traversal is also measured separately. Equality is the test-only iterative comparator, not a public library API.',
  memory: 'Host RSS snapshots are measured, not peak RSS or enforced bounds. Native memory is unmeasured.',
  lanes: [], failures: [],
};
let directory;
function remaining() {
  const left = TOTAL_MS - (performance.now() - started);
  if (left <= 0) throw new Error('Benchmark campaign exceeded ten minutes');
  return left;
}

// Streamed start/end messages let the parent kill and reap a hung synchronous
// library call. A child-side elapsed check alone cannot enforce that boundary.
function child(command, args, line, { native = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const born = performance.now();
    const processChild = spawn(command, args, { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', timer, error, bytes = 0;
    function fail(reason) { if (!error) error = reason; processChild.kill('SIGKILL'); }
    function arm(ms) {
      clearTimeout(timer);
      timer = setTimeout(() => fail(Object.assign(new Error(`${command}: ${native ? 'native ' : ''}benchmark deadline exceeded`), { code: 'benchmark-timeout' })), Math.max(1, Math.min(ms, TOTAL_MS - (performance.now() - started))));
    }
    arm(120000);
    processChild.stdout.setEncoding('utf8'); processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 64 * 1024 * 1024) return fail(new Error('Benchmark stdout cap exceeded'));
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        try { line(text, arm, performance.now() - born); } catch (e) { fail(e); }
      }
    });
    processChild.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1048576) fail(new Error('Benchmark stderr cap exceeded')); });
    processChild.on('error', fail);
    processChild.on('close', (status, signal) => {
      clearTimeout(timer);
      if (stderr) process.stderr.write(stderr); // In particular, retain Node loader warnings.
      if (error || status !== 0 || signal || buffer) reject(Object.assign(error ?? new Error(`Benchmark child status=${status} signal=${signal}; incomplete=${Boolean(buffer)}`), { status, signal, stderr }));
      else resolvePromise({ processMs: performance.now() - born, stderr, status });
    });
  });
}

async function watchdogSelftest() {
  let observedStart = null, failure;
  const began = performance.now();
  try {
    await child(NODE, ['--input-type=module', '-e',
      'import { writeSync } from "node:fs"; writeSync(1, "START\\n"); setTimeout(() => process.exit(0), 15000);'],
    (line, arm) => {
      assert.equal(line, 'START');
      assert.equal(observedStart, null);
      observedStart = performance.now();
      arm(SAMPLE_MS);
    }, { native: true });
  } catch (error) { failure = error; }
  assert.notEqual(observedStart, null, 'Watchdog control never emitted its flushed START');
  assert.equal(failure?.code, 'benchmark-timeout', 'Delayed child must fail the shared sample watchdog');
  assert.equal(failure.signal, 'SIGKILL', 'Watchdog must kill and reap the delayed child');
  const sampleElapsedMs = performance.now() - observedStart;
  assert.ok(sampleElapsedMs >= SAMPLE_MS - 50 && sampleElapsedMs < SAMPLE_MS + 5000,
    `Watchdog used wrong boundary: ${sampleElapsedMs} ms`);
  return { status: 'pass', startObserved: true, killedAndReaped: true, sampleElapsedMs,
    processMs: performance.now() - began, expectedSampleDeadlineMs: SAMPLE_MS,
    childNaturalExitMs: 15000, signal: failure.signal };
}

async function hostLane(name, command, loader) {
  const lane = { name, status: 'running', measurements: [], startupMs: null };
  report.lanes.push(lane);
  let ready = false, pending = null, summary = false;
  const seen = new Set();
  try {
    const result = await child(command, [...loader, resolve(ROOT, 'tests/bench-host.mjs')], (text, arm, elapsed) => {
      const event = JSON.parse(text);
      switch (event.event) {
        case 'ready': assert.equal(ready, false); ready = true; lane.startupMs = elapsed; arm(SAMPLE_MS); break;
        case 'start': assert.ok(ready && !summary); assert.equal(pending, null); pending = event.id; arm(SAMPLE_MS); break;
        case 'end': assert.equal(event.id, pending); pending = null; arm(SAMPLE_MS); break;
        case 'measurement': {
          assert.equal(pending, null); assert.equal(event.samples, SAMPLES); assert.equal(event.sampleMs.length, SAMPLES);
          assert.ok(event.sampleMs.every(n => Number.isFinite(n) && n >= 0 && n <= SAMPLE_MS));
          const key = `${event.id}/${event.operation}`; assert.ok(!seen.has(key)); seen.add(key); lane.measurements.push(event); break;
        }
        case 'summary': assert.equal(pending, null); assert.equal(event.status, 'pass'); assert.equal(summary, false); summary = true; break;
        case 'failure': throw new Error(event.message);
        default: throw new Error(`Unknown benchmark event ${event.event}`);
      }
    });
    assert.ok(ready && summary && pending === null);
    const expected = [...fixtures()].flatMap(item => OPERATIONS.map(operation => `${item.id}/${operation}`));
    assert.deepEqual([...seen].sort(), expected.sort());
    Object.assign(lane, result, { status: 'pass' });
  } catch (error) { lane.status = 'fail'; throw error; }
}

async function nativeSample(binary, path, item, operation, batch) {
  let checked = false, timed = false, result = null, setupMs;
  const mode = OPERATIONS.indexOf(operation) + 1;
  const invocation = await child(binary, ['--threads', '1', '--gpu', 'off', '--', path, 'x'.repeat(mode), 'x'.repeat(batch), item.limits.max_values > 100000n ? 'x' : ''], (line, arm, elapsed) => {
    if (line.startsWith('CHECK\t')) { assert.equal(checked, false); assert.equal(line.slice(6), item.text); checked = true; }
    else if (line === 'START') { assert.ok(checked && !timed); timed = true; setupMs = elapsed; arm(SAMPLE_MS); }
    else {
      const match = /^TIME\t([0-9]+)\t([0-9]+)$/.exec(line);
      assert.ok(match && timed && result === null, `Unexpected native protocol ${line.slice(0, 100)}`);
      const duration = Number(match[1]); assert.ok(Number.isSafeInteger(duration) && duration <= SAMPLE_MS);
      const perIteration = operation === 'parse' || operation === 'materialize-ast' ? forceAst(item.value) : operation === 'equality' ? 1 : item.outputCodepoints;
      assert.equal(BigInt(match[2]), BigInt(perIteration) * BigInt(batch));
      result = { duration, batch }; arm(SAMPLE_MS);
    }
  }, { native: true });
  assert.ok(checked && timed && result);
  return { ...result, processMs: invocation.processMs, setupMs, stderr: invocation.stderr };
}

async function nativeLane(cc, compilerVersion) {
  const lane = { name: 'native', status: 'running', compiler: compilerVersion, measurements: [], memory: 'unmeasured' };
  report.lanes.push(lane);
  const binary = resolve(directory, 'bench-native');
  const buildStart = performance.now();
  const built = run(BUN, ['--no-install', COMPILER, resolve(ROOT, 'tests/bench-native.bend'), '-o', binary], { timeout: Math.min(120000, remaining()), env: { ...ENV, CC: cc } });
  lane.compileMs = performance.now() - buildStart; lane.build = { stdout: built.stdout, stderr: built.stderr };
  for (const item of fixtures()) {
    const path = resolve(directory, `${item.id}.json`);
    writeFileSync(path, item.text, 'utf8');
    // This independently generated UTF-8 fixture must decode exactly, BOM included.
    assert.equal(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(item.text)), item.text);
    for (const operation of OPERATIONS) {
      let batch = 1, calibration;
      const calibrationSamples = [];
      do {
        remaining();
        calibration = await nativeSample(binary, path, item, operation, batch);
        calibrationSamples.push(calibration);
        if (calibration.duration >= 100 || batch === 1024) break;
        batch *= 2;
      } while (true);
      const samples = [], processSamples = [], setupSamples = [], warmupSamples = [];
      for (let i = -WARMUPS; i < SAMPLES; i++) {
        remaining();
        const sample = await nativeSample(binary, path, item, operation, batch);
        if (i < 0) warmupSamples.push(sample.duration);
        else { samples.push(sample.duration / batch); processSamples.push(sample.processMs); setupSamples.push(sample.setupMs); }
      }
      const measurement = { ...metadata(item), operation, warmups: WARMUPS, samples: SAMPLES, batch, ...stats(samples), sampleMs: samples, calibrationSamples, warmupBatchMs: warmupSamples, processMs: processSamples, startupFileSetupCheckMs: setupSamples, timer: 'IO.now milliseconds', resolutionMs: 1, belowTargetPrecision: calibration.duration < 100 || samples.some(value => value * batch < 100), belowClockResolution: samples.some(value => value === 0), timing: 'native core call plus full traversal, excluding IO/process/setup; standalone traversal measured separately' };
      lane.measurements.push(measurement);
      console.log(`native ${item.id} ${operation}: ${measurement.medianMs} ms${measurement.belowTargetPrecision ? ' (below 100 ms batch precision target)' : ''}`);
    }
  }
  lane.status = 'pass';
}

function recordFailure(error) {
  report.failures.push({ message: error.stack ?? String(error), stderr: error.stderr, status: error.status, signal: error.signal });
  for (const lane of report.lanes) if (lane.status === 'running') lane.status = 'fail';
  process.exitCode = 1;
}

function growthDiagnostics(measurements) {
  const groups = new Map(), diagnostics = [];
  for (const sample of measurements) {
    if (!['parse', 'encode', 'equality'].includes(sample.operation)) continue;
    const key = `${sample.id.replace(/-[0-9]+$/, '')}/${sample.operation}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  for (const [family, samples] of groups) {
    samples.sort((a, b) => a.inputCodepoints - b.inputCodepoints);
    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1], after = samples[i];
      const sizeRatio = after.inputCodepoints / before.inputCodepoints;
      const timeRatio = before.medianMs > 0 ? after.medianMs / before.medianMs : null;
      diagnostics.push({ family, from: before.id, to: after.id, sizeRatio, timeRatio,
        diagnostic: timeRatio === null ? 'below clock resolution'
          : before.medianMs >= 0.05 && timeRatio > sizeRatio * 2
            ? 'superlinear-growth signal: investigate allocation, conversion, traversal and runtime; not an asymptotic conclusion'
            : 'no greater-than-2x normalized growth signal at this pair' });
    }
  }
  return diagnostics;
}

try {
  report.versions = versions();
  assert.ok(process.argv.slice(2).every(arg => arg === '--watchdog-selftest'), 'Unknown benchmark argument');
  report.watchdogControl = await watchdogSelftest();
  if (!process.argv.includes('--watchdog-selftest')) {
  directory = mkdtempSync(resolve(ROOT, 'artifacts/bench-'));
  for (const [name, command, loader] of [['Node', NODE, ['--import', COMPILER]], ['Bun', BUN, ['--no-install', '--preload', COMPILER]]]) {
    try { remaining(); await hostLane(name, command, loader); } catch (error) { recordFailure(error); }
  }
  const cc = process.env.CC || (os.platform() === 'darwin' ? '/usr/bin/clang' : 'clang');
  const available = spawnSync(cc, ['--version'], { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: Math.min(10000, remaining()) });
  if (available.error?.code === 'ENOENT') report.lanes.push({ name: 'native', status: 'unverified', reason: `Clang executable unavailable: ${cc}` });
  else {
    if (available.error || available.signal || available.status !== 0) throw new Error(`Detected native compiler failed: ${available.error ?? available.stderr}`);
    assert.match(available.stdout, /clang version/i, 'Native benchmarks require Clang');
    await nativeLane(cc, available.stdout.trim());
  }
  }
} catch (error) {
  recordFailure(error);
} finally {
  report.elapsedMs = performance.now() - started;
  report.status = report.failures.length ? 'fail' : 'pass';
  for (const lane of report.lanes) lane.growthDiagnostics = growthDiagnostics(lane.measurements ?? []);
  writeFileSync(resolve(ROOT, 'artifacts/bench.json'), JSON.stringify(report, null, 2) + '\n');
  if (directory) rmSync(directory, { recursive: true, force: true });
  console.log(`Benchmarks: ${report.status}; report artifacts/bench.json`);
  if (report.failures.length) console.error(report.failures.map(item => item.message).join('\n'));
}
