import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, COMPILER, BUN, NODE, ENV, versions, artifacts } from './tools.ts';
import type { Versions } from './tools.ts';
import { inventory, proofChecks, proofSelftest } from './proof-gate.ts';
import { nativeProcess } from './native-process.ts';
import { corpusEntries } from '../tests/conformance.ts';
import { parseCodes } from '../tests/support.ts';
import type { CorpusClassification, CorpusDetail } from '../tests/conformance.ts';

export interface HarnessError extends Error {
  category: string;
  report?: unknown;
  reports?: unknown;
  result?: unknown;
  directory?: string;
}
export interface HostStartEvent {
  event: 'start';
  id: string;
  startupMemory?: unknown;
}
export interface HostResultEvent {
  event: 'result';
  id: string;
  status: 'pass' | 'fail';
  detail?: unknown;
  message?: string;
}
export interface HostSummaryMemory {
  method: string;
  startup: unknown;
  allCases: { samples: number; rssPeak: number };
  campaign: { samples: number; rssPeak: number; limit: number; scope: string };
}
export interface HostSummaryEvent {
  event: 'summary';
  passed: number;
  failed: number;
  memory: HostSummaryMemory;
}
export type HostEvent = HostStartEvent | HostResultEvent | HostSummaryEvent;
export interface SupervisorMemory {
  method: string;
  limit: number;
  samples: number;
  rssPeak: number;
  observedAllCaseRssPeak: number;
  startup: { samples: number; rssPeak: number; scope: string };
  enforcement: 'unverified' | 'sampled';
}
export interface WorkerReport {
  label: string;
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  events: HostEvent[];
  status: number | null;
  signal: NodeJS.Signals | null;
  memory: SupervisorMemory;
  summary: HostSummaryEvent | null;
  corpusAccounting?: unknown[];
  mutationRecovery?: unknown;
  mutationRecoveryError?: string;
}
export interface SuperviseOptions {
  label?: string;
  startupMs?: number;
  caseMs?: number;
  campaignMs?: number;
  memory?: boolean;
}
export interface CorpusCounts {
  inventory: number;
  attempted: number;
  byteExcluded: number;
  accept: number;
  syntaxReject: number;
  profileReject: number;
  resourceReject: number;
  yAccepted: number;
}
type GateStatus = 'pass' | 'unverified' | 'fail';
type GateRecord =
  | { name: string; status: 'pass' | 'unverified'; evidence: unknown }
  | {
      name: string;
      status: 'fail';
      category: string;
      message: string;
      evidence: unknown;
      directory: string | undefined;
    };
export interface VerificationReport {
  started: string;
  finished: string | null;
  gates: GateRecord[];
  versions: Versions;
  status: 'running' | 'pass' | 'fail';
}

export function writeReport(path: string, report: unknown): void {
  const serialized = JSON.stringify(
    report,
    (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value,
    2,
  );
  if (serialized === undefined) throw new Error(`Report is not serializable: ${path}`);
  writeFileSync(path, `${serialized}\n`);
}

function issue(
  category: string,
  message: string,
  detail: { report?: unknown; reports?: unknown; result?: unknown; directory?: string } = {},
): HarnessError {
  return Object.assign(new Error(message), { category, ...detail });
}
export function asHarnessError(error: unknown, fallback = 'failure'): HarnessError {
  if (error instanceof Error) {
    const harnessError = error as HarnessError;
    harnessError.category ||= fallback;
    return harnessError;
  }
  return issue(fallback, String(error));
}
export function rss(pid: number): number | undefined {
  if (process.platform === 'linux') {
    const text = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+) kB$/m.exec(text);
    const kibibytes = match?.[1];
    if (kibibytes !== undefined) return Number(kibibytes) * 1024;
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
    });
    if (!result.error && result.status === 0 && /^\s*\d+\s*$/.test(result.stdout)) {
      return Number(result.stdout) * 1024;
    }
  }
  return undefined;
}

function parseHostEvent(line: string): HostEvent {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== 'object' || parsed === null || !('event' in parsed)) {
    throw new Error('event must be an object with a discriminant');
  }
  if (parsed.event === 'start') {
    if (!('id' in parsed) || typeof parsed.id !== 'string' || parsed.id.length === 0) {
      throw new Error('start event requires a non-empty id');
    }
    return parsed as HostStartEvent;
  }
  if (parsed.event === 'result') {
    if (!('id' in parsed) || typeof parsed.id !== 'string'
      || !('status' in parsed) || (parsed.status !== 'pass' && parsed.status !== 'fail')
      || ('message' in parsed && typeof parsed.message !== 'string')) {
      throw new Error('result event has an invalid id, status or message');
    }
    return parsed as HostResultEvent;
  }
  if (parsed.event === 'summary') {
    if (!('passed' in parsed) || typeof parsed.passed !== 'number'
      || !Number.isSafeInteger(parsed.passed)
      || !('failed' in parsed) || typeof parsed.failed !== 'number'
      || !Number.isSafeInteger(parsed.failed)
      || !('memory' in parsed) || typeof parsed.memory !== 'object' || parsed.memory === null) {
      throw new Error('summary event has invalid totals or memory evidence');
    }
    const memory = parsed.memory;
    if (!('method' in memory) || typeof memory.method !== 'string'
      || !('allCases' in memory) || typeof memory.allCases !== 'object' || memory.allCases === null
      || !('samples' in memory.allCases) || typeof memory.allCases.samples !== 'number'
      || !Number.isSafeInteger(memory.allCases.samples)
      || !('rssPeak' in memory.allCases) || typeof memory.allCases.rssPeak !== 'number'
      || !Number.isFinite(memory.allCases.rssPeak)
      || !('campaign' in memory) || typeof memory.campaign !== 'object' || memory.campaign === null
      || !('samples' in memory.campaign) || typeof memory.campaign.samples !== 'number'
      || !Number.isSafeInteger(memory.campaign.samples)
      || !('rssPeak' in memory.campaign) || typeof memory.campaign.rssPeak !== 'number'
      || !Number.isFinite(memory.campaign.rssPeak)
      || !('limit' in memory.campaign) || typeof memory.campaign.limit !== 'number'
      || !Number.isSafeInteger(memory.campaign.limit)
      || !('scope' in memory.campaign) || typeof memory.campaign.scope !== 'string'
      || !('startup' in memory)) {
      throw new Error('summary memory evidence is malformed');
    }
    return parsed as HostSummaryEvent;
  }
  throw new Error(`unknown event ${String(parsed.event)}`);
}

export function supervise(
  command: string,
  args: readonly string[],
  {
    label = 'worker',
    startupMs = 120000,
    caseMs = 5000,
    campaignMs = 600000,
    memory = true,
  }: SuperviseOptions = {},
): Promise<WorkerReport> {
  const { promise, resolve: resolvePromise, reject: rejectPromise } = Promise.withResolvers<WorkerReport>();
  const child = spawn(command, args, { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  const report: WorkerReport = {
    label,
    command,
    args,
    stdout: '',
    stderr: '',
    events: [],
    status: null,
    signal: null,
    memory: {
      method: 'supervisor RSS samples every 250ms; ceiling enforced only during mutation cases',
      limit: 512 * 1024 * 1024,
      samples: 0,
      rssPeak: 0,
      observedAllCaseRssPeak: 0,
      startup: {
        samples: 0,
        rssPeak: 0,
        scope: 'compiler/loader before first case; not subject to mutation ceiling',
      },
      enforcement: 'unverified',
    },
    summary: null,
  };
  let pending: string | null = null;
  let summary: HostSummaryEvent | null = null;
  let lineBuffer = '';
  let protocolError: HarnessError | null = null;
  let timer: NodeJS.Timeout | undefined;
  let mutationTimer: NodeJS.Timeout | undefined;
  let mutationActive = false;
  let settled = false;
  let bytes = 0;
  let monitor: NodeJS.Timeout | undefined;
  const ids = new Set<string>();
  let passed = 0;
  let failed = 0;
  const stop = (category: string, message: string): void => {
    if (!protocolError) {
      protocolError = issue(category, `${label}: ${message}`);
      child.kill('SIGKILL');
    }
  };
  const arm = (milliseconds: number, category: string, message: string): void => {
    clearTimeout(timer);
    timer = setTimeout(() => stop(category, message), milliseconds);
  };
  arm(startupMs, 'worker-startup-timeout', 'compiler/loader startup exceeded deadline');
  if (memory) {
    monitor = setInterval(() => {
      if (settled || child.pid === undefined) return;
      try {
        const size = rss(child.pid);
        if (size === undefined) return;
        if (ids.size === 0) {
          report.memory.startup.samples++;
          report.memory.startup.rssPeak = Math.max(report.memory.startup.rssPeak, size);
        }
        if (pending) {
          report.memory.observedAllCaseRssPeak = Math.max(report.memory.observedAllCaseRssPeak, size);
          if (pending.startsWith('mutation/')) {
            report.memory.enforcement = 'sampled';
            report.memory.samples++;
            report.memory.rssPeak = Math.max(report.memory.rssPeak, size);
            if (size > report.memory.limit) {
              stop('worker-memory', `Mutation campaign RSS ${size} exceeds ${report.memory.limit}`);
            }
          }
        }
      } catch {
        // Process exit and unsupported OS are recorded as unverified, never fabricated.
      }
    }, 250);
  }
  const consume = (line: string): void => {
    if (protocolError) return;
    let event: HostEvent;
    try {
      event = parseHostEvent(line);
    } catch {
      stop('worker-protocol', 'non-JSON or malformed stdout event');
      return;
    }
    if (summary) {
      stop('worker-protocol', 'data after summary');
      return;
    }
    if (event.event === 'start') {
      if (pending || ids.has(event.id)) {
        stop('worker-protocol', 'overlapping or duplicate start');
        return;
      }
      ids.add(event.id);
      pending = event.id;
      arm(caseMs, 'worker-case-timeout', `case ${pending} exceeded ${caseMs}ms`);
      if (event.id.startsWith('mutation/') && !mutationActive) {
        mutationActive = true;
        mutationTimer = setTimeout(
          () => stop('worker-campaign-timeout', 'mutation campaign exceeded ten-minute deadline'),
          campaignMs,
        );
      }
      if (mutationActive && !event.id.startsWith('mutation/')) {
        clearTimeout(mutationTimer);
        mutationTimer = undefined;
      }
    } else if (event.event === 'result') {
      if (event.id !== pending || !pending) {
        stop('worker-protocol', 'unmatched result');
        return;
      }
      if (event.status === 'pass') passed++;
      else failed++;
      pending = null;
      arm(caseMs, 'worker-case-timeout', 'worker stalled between cases');
    } else {
      if (pending || event.passed !== passed || event.failed !== failed || ids.size !== passed + failed) {
        stop('worker-protocol', 'summary does not reconcile case events');
        return;
      }
      summary = event;
      clearTimeout(mutationTimer);
      arm(caseMs, 'worker-exit-timeout', 'worker did not exit after summary');
    }
    report.events.push(event);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16 * 1024 * 1024) {
      stop('worker-output', 'stdout cap exceeded');
      return;
    }
    report.stdout += chunk;
    lineBuffer += chunk;
    let index: number;
    while ((index = lineBuffer.indexOf('\n')) >= 0) {
      const line = lineBuffer.slice(0, index).replace(/\r$/, '');
      lineBuffer = lineBuffer.slice(index + 1);
      consume(line);
    }
  });
  child.stderr.on('data', (chunk: string) => {
    if (Buffer.byteLength(report.stderr) + Buffer.byteLength(chunk) > 1024 * 1024) {
      stop('worker-output', 'stderr cap exceeded');
      return;
    }
    report.stderr += chunk;
  });
  child.on('error', error => {
    protocolError ||= issue('worker-spawn', String(error));
  });
  child.on('close', (status, signal) => {
    settled = true;
    clearTimeout(timer);
    clearTimeout(mutationTimer);
    clearInterval(monitor);
    report.status = status;
    report.signal = signal;
    if (lineBuffer && !protocolError) {
      protocolError = issue('worker-protocol', `${label}: unterminated stdout event`);
    }
    if (!summary && !protocolError) {
      protocolError = issue('worker-protocol', `${label}: missing summary; pending=${pending}`);
    }
    if (!protocolError && failed > 0) {
      protocolError = issue('worker-failures', `${label}: ${failed} behavioral failures`);
    }
    if (!protocolError && (status !== 0 || signal)) {
      protocolError = issue('worker-exit', `${label}: exit=${status} signal=${signal}`);
    }
    report.summary = summary;
    if (protocolError) {
      protocolError.report = report;
      rejectPromise(protocolError);
    } else {
      resolvePromise(report);
    }
  });
  return promise;
}

export async function supervisorSelftest(): Promise<unknown[]> {
  const output: unknown[] = [];
  const failureScript = `const fs=require('node:fs');const memory={method:'control',startup:{},allCases:{samples:0,rssPeak:0},campaign:{samples:0,rssPeak:0,limit:536870912,scope:'control'}};for(const x of [{event:'start',id:'intentional-failure'},{event:'result',id:'intentional-failure',status:'fail',message:'intentional'},{event:'summary',passed:0,failed:1,memory}])fs.writeSync(1,JSON.stringify(x)+'\\n');process.exitCode=1;`;
  try {
    await supervise(NODE, ['-e', failureScript], { label: 'selfcheck-failure', memory: false });
    throw new Error('Failing child was accepted');
  } catch (error) {
    const failure = asHarnessError(error);
    const evidence = failure.report as WorkerReport;
    assert.equal(failure.category, 'worker-failures');
    assert.equal(evidence.status, 1);
    assert.equal(evidence.signal, null);
    output.push({ control: 'failing-child', rejected: true, category: failure.category, report: evidence });
  }
  const timeoutScript = `require('node:fs').writeSync(1,JSON.stringify({event:'start',id:'intentional-timeout'})+'\\n');setTimeout(()=>{},10000);`;
  try {
    await supervise(NODE, ['-e', timeoutScript], {
      label: 'selfcheck-timeout',
      caseMs: 50,
      memory: false,
    });
    throw new Error('Timed-out child was accepted');
  } catch (error) {
    const failure = asHarnessError(error);
    const evidence = failure.report as WorkerReport;
    assert.equal(failure.category, 'worker-case-timeout');
    assert.equal(evidence.signal, 'SIGKILL');
    assert.equal(evidence.summary, null);
    output.push({ control: 'timed-out-child', rejected: true, category: failure.category, report: evidence });
  }
  if (process.platform === 'win32') {
    output.push({ control: 'native-post-exit-drain', status: 'unverified', reason: 'POSIX process groups unavailable' });
  } else {
    const quick = await nativeProcess(
      NODE,
      ['-e', 'process.stdout.write("ok")'],
      { timeout: 1000, drainTimeout: 100 },
    );
    assert.equal(quick.timedOut, false);
    assert.equal(quick.stdout, 'ok');
    assert.equal(quick.killError, null);
    output.push({ control: 'native-clean-exit-drain', status: 'pass', result: quick });
    const holder = `const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:["ignore","inherit","inherit"]});child.unref();`;
    const drained = await nativeProcess(
      NODE,
      ['-e', holder],
      { timeout: 1000, drainTimeout: 100 },
    );
    assert.equal(drained.status, 0);
    assert.equal(drained.signal, null);
    assert.equal(drained.timedOut, true);
    assert.equal(drained.timeoutPhase, 'drain');
    assert.equal(drained.killError, null);
    output.push({ control: 'native-post-exit-drain', status: 'pass', result: drained });
  }
  // Intentional cycle break: controls import supervise from this module.
  const { failureEvidenceSelftest } = await import('./supervisor-controls.ts');
  output.push(...await failureEvidenceSelftest());
  return output;
}

const corpusClassifications: Readonly<Record<CorpusClassification, true>> = {
  'byte-excluded': true,
  accept: true,
  'resource-reject': true,
  'profile-reject': true,
  'syntax-reject': true,
};

function detailFromEvent(value: unknown): CorpusDetail {
  if (typeof value !== 'object' || value === null
    || !('fixture' in value) || typeof value.fixture !== 'string'
    || !('class' in value) || (value.class !== 'y' && value.class !== 'n' && value.class !== 'i')
    || !('classification' in value) || typeof value.classification !== 'string'
    || !Object.hasOwn(corpusClassifications, value.classification)
    || ('code' in value && value.code !== undefined
      && (typeof value.code !== 'string' || !Object.hasOwn(parseCodes, value.code)))
    || ('offset' in value && value.offset !== undefined && typeof value.offset !== 'string')) {
    throw issue('host-reconciliation', 'Malformed corpus result detail');
  }
  return value as CorpusDetail;
}
function corpusAccounting(worker: WorkerReport, category: string): unknown[] {
  const results = new Map(
    worker.events
      .filter((event): event is HostResultEvent => event.event === 'result')
      .map(event => [event.id, event]),
  );
  const started = new Set(
    worker.events
      .filter((event): event is HostStartEvent => event.event === 'start')
      .map(event => event.id),
  );
  return corpusEntries().map(entry => {
    const result = results.get(entry.id);
    if (result?.status === 'pass') return { name: entry.name, ...detailFromEvent(result.detail) };
    if (result) {
      return {
        name: entry.name,
        class: entry.class,
        classification: 'harness-failure',
        message: result.message,
      };
    }
    if (entry.expected === 'byte-excluded') {
      return { name: entry.name, class: entry.class, classification: 'byte-excluded' };
    }
    return {
      name: entry.name,
      class: entry.class,
      classification: started.has(entry.id)
        ? category.includes('timeout') ? 'timeout' : 'crash'
        : 'unattempted',
    };
  });
}
function corpusReport(worker: WorkerReport): CorpusCounts {
  const entries = worker.events.filter(
    (event): event is HostResultEvent => event.event === 'result' && event.id.startsWith('corpus/'),
  );
  assert.equal(entries.length, 318);
  assert.equal(new Set(entries.map(event => event.id)).size, 318);
  const counts: CorpusCounts = {
    inventory: 318,
    attempted: 0,
    byteExcluded: 0,
    accept: 0,
    syntaxReject: 0,
    profileReject: 0,
    resourceReject: 0,
    yAccepted: 0,
  };
  for (const event of entries) {
    assert.equal(event.status, 'pass');
    const detail = detailFromEvent(event.detail);
    if (detail.classification === 'byte-excluded') counts.byteExcluded++;
    else {
      counts.attempted++;
      if (detail.classification === 'accept') {
        counts.accept++;
        if (detail.class === 'y') counts.yAccepted++;
      } else if (detail.classification === 'syntax-reject') counts.syntaxReject++;
      else if (detail.classification === 'profile-reject') counts.profileReject++;
      else if (detail.classification === 'resource-reject') counts.resourceReject++;
      else assert.fail(`Unknown corpus classification ${detail.classification}`);
    }
  }
  assert.equal(counts.byteExcluded, 25);
  assert.equal(counts.attempted, 293);
  assert.equal(counts.yAccepted, 95);
  return counts;
}
export async function verifyHostWorker(
  command: string,
  args: readonly string[],
  options: SuperviseOptions = {},
): Promise<{ route: 'real-preloaded-import'; corpus: CorpusCounts; accounting: unknown[]; worker: WorkerReport }> {
  let worker: WorkerReport | undefined;
  try {
    worker = await supervise(command, args, options);
    // Keep runtime warnings visible; never suppress Node loader deprecations.
    if (worker.stderr) process.stderr.write(worker.stderr);
    const corpus = corpusReport(worker);
    const results = worker.events.filter(
      (event): event is HostResultEvent => event.event === 'result',
    );
    assert.equal(results.filter(event => event.id.startsWith('generated/')).length, 3000);
    assert.equal(results.filter(event => event.id.startsWith('mutation/')).length, 2048);
    assert.ok(worker.summary);
    assert.equal(worker.summary.memory.campaign.samples, 2048);
    assert.equal(results.length, 6073);
    return {
      route: 'real-preloaded-import',
      corpus,
      accounting: corpusAccounting(worker, ''),
      worker,
    };
  } catch (error) {
    const failure = asHarnessError(error, 'host-reconciliation');
    const evidence = failure.report ? failure.report as WorkerReport : worker;
    if (evidence) {
      evidence.corpusAccounting = corpusAccounting(evidence, failure.category);
      failure.report = evidence;
      if (!worker && evidence.stderr) process.stderr.write(evidence.stderr);
    }
    throw failure;
  }
}

export async function verify(args = process.argv.slice(2)): Promise<VerificationReport> {
  const allowed: Readonly<Partial<Record<string, true>>> = {
    '--proofs': true,
    '--proof-gate-selftest': true,
    '--native=required': true,
  };
  for (const arg of args) if (!Object.hasOwn(allowed, arg)) throw new Error(`Unknown argument ${arg}`);
  if (args.includes('--proofs') && args.includes('--proof-gate-selftest')) {
    throw new Error('Choose only one restricted proof mode');
  }
  artifacts();
  const report: VerificationReport = {
    started: new Date().toISOString(),
    finished: null,
    gates: [],
    versions: versions(),
    status: 'running',
  };
  const target = resolve(
    ROOT,
    args.includes('--proofs')
      ? 'artifacts/proofs.json'
      : args.includes('--proof-gate-selftest')
        ? 'artifacts/proof-gate-selftest.json'
        : 'artifacts/verification.json',
  );
  const gate = async (name: string, checkGate: () => unknown | Promise<unknown>): Promise<void> => {
    try {
      const evidence = await checkGate();
      const status: Exclude<GateStatus, 'fail'> = typeof evidence === 'object'
        && evidence !== null
        && 'status' in evidence
        && evidence.status === 'unverified'
        ? 'unverified'
        : 'pass';
      report.gates.push({ name, status, evidence });
      console.log(`${name}: ${status.toUpperCase()}`);
    } catch (error) {
      const failure = asHarnessError(error);
      report.gates.push({
        name,
        status: 'fail',
        category: failure.category,
        message: failure.stack ?? failure.message,
        evidence: failure.report ?? failure.reports ?? failure.result,
        directory: failure.directory,
      });
      console.error(`${name}: FAIL\n${failure.stack ?? failure.message}`);
    }
    writeReport(target, report);
  };
  if (!args.includes('--proof-gate-selftest')) {
    await gate('proofs', () => ({ inventory: inventory(), checks: proofChecks() }));
  }
  if (!args.includes('--proofs')) await gate('proof-gate-selftest', proofSelftest);
  if (!args.includes('--proofs') && !args.includes('--proof-gate-selftest')) {
    await gate('supervisor-selftest', supervisorSelftest);
    const entry = resolve(ROOT, 'tests/host.ts');
    const runtimes: Array<[string, string, string[]]> = [
      ['node', NODE, ['--import', COMPILER]],
      ['bun', BUN, ['--no-install', '--preload', COMPILER]],
    ];
    for (const [name, command, prefix] of runtimes) {
      await gate(`host-${name}`, async () => {
        try {
          return await verifyHostWorker(command, [...prefix, entry], {
            label: `${name}:real-preloaded-import`,
          });
        } catch (error) {
          const failure = asHarnessError(error);
          if (failure.report) {
            const worker = failure.report as WorkerReport;
            try {
              // Intentional cycle break: recovery imports supervise from this module.
              const { recoverMutationFailures } = await import('./mutation-recovery.ts');
              worker.mutationRecovery = await recoverMutationFailures(
                failure,
                { backend: name, command, prefix, entry },
              );
            } catch (recoveryError) {
              worker.mutationRecoveryError = recoveryError instanceof Error
                ? recoveryError.stack ?? recoveryError.message
                : String(recoveryError);
            }
          }
          throw failure;
        }
      });
    }
    await gate('native', async () => {
      // Intentional cycle break: native verification imports rss from this module.
      const { nativeVerify } = await import('./native.ts');
      return nativeVerify({ required: args.includes('--native=required') });
    });
  }
  report.finished = new Date().toISOString();
  report.status = report.gates.some(gateResult => gateResult.status === 'fail') ? 'fail' : 'pass';
  writeReport(target, report);
  if (report.status === 'fail') {
    throw issue('verification-failed', `Verification failed; evidence: ${target}`, { report });
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify().catch((error: unknown) => {
    const failure = asHarnessError(error);
    console.error(failure.stack ?? failure.message);
    process.exitCode = 1;
  });
}
