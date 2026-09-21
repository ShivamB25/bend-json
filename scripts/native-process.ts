import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ROOT, ENV } from './tools.ts';
import { strictDecode } from '../tests/support.ts';

export interface DescribedError {
  name: string;
  message: string;
  code?: string | number;
  stack?: string;
}
export interface MemoryOptions {
  read: (pid: number) => number | undefined;
  limitBytes: number;
  intervalMs: number;
}
export interface MemoryMeasurement {
  enabled: boolean;
  limitBytes: number | undefined;
  intervalMs: number | undefined;
  samples: number;
  maximumSampledRssBytes: number;
  exceeded: boolean;
  enforcement: 'unverified' | 'sampled';
  samplingError: DescribedError | null;
}
export type CasePhase = 'startup' | 'case' | 'exit' | 'between-cases';
export interface CaseEvent {
  event: 'start' | 'end';
  id: string;
  elapsedMs: number;
  caseElapsedMs?: number;
}
export interface CaseProgress {
  expected: readonly string[];
  started: number;
  completed: number;
  active: string | null;
  phase: CasePhase;
  complete: boolean;
  error: string | null;
  diagnostics: string;
  events: CaseEvent[];
  timeoutMs: number;
}
export interface NativeProcessOptions {
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  memory?: MemoryOptions | null;
  caseIds?: readonly string[] | null;
  caseTimeout?: number;
  onCaseEvent?: (event: CaseEvent) => void;
  onInvalidOutput?: (stdout: Buffer, stderr: Buffer) => void;
}
export interface NativeProcessResult {
  command: string;
  args: readonly string[];
  status: number | null;
  signal: NodeJS.Signals | null;
  error: DescribedError | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutPhase: 'batch' | 'invocation' | CasePhase | null;
  overflow: boolean;
  killError: DescribedError | null;
  memory: MemoryMeasurement;
  caseProgress: CaseProgress | null;
  elapsedMs: number;
}

function describe(error: unknown): DescribedError | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      name: error.name,
      message: error.message || String(error),
      ...(code === undefined ? {} : { code }),
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

// One finite child, including its compiler descendants, is killed and reaped.
// RSS is an optional sampled ceiling, never a claim to observe the exact peak.
export function nativeProcess(
  command: string,
  args: readonly string[],
  {
    timeout = 5000,
    maxBuffer = 16 * 1024 * 1024,
    env = ENV,
    memory = null,
    caseIds = null,
    caseTimeout = 5000,
    onCaseEvent,
    onInvalidOutput,
  }: NativeProcessOptions = {},
): Promise<NativeProcessResult> {
  const started = performance.now();
  const { promise, resolve: resolveResult } = Promise.withResolvers<NativeProcessResult>();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const measured: MemoryMeasurement = {
      enabled: memory !== null,
      limitBytes: memory?.limitBytes,
      intervalMs: memory?.intervalMs,
      samples: 0,
      maximumSampledRssBytes: 0,
      exceeded: false,
      enforcement: 'unverified',
      samplingError: null,
    };
    const progressIds = caseIds ?? [];
    const caseProgress: CaseProgress | null = caseIds === null ? null : {
      expected: caseIds,
      started: 0,
      completed: 0,
      active: null,
      phase: 'startup',
      complete: false,
      error: null,
      diagnostics: '',
      events: [],
      timeoutMs: caseTimeout,
    };
    const progressDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let progressBuffer = '';
    let caseTimer: NodeJS.Timeout | undefined;
    let caseStarted = 0;
    let bytes = 0;
    let error: DescribedError | null = null;
    let timedOut = false;
    let timeoutPhase: NativeProcessResult['timeoutPhase'] = null;
    let overflow = false;
    let killError: DescribedError | null = null;
    let settled = false;
    let monitor: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = (): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (problem) {
        if (!(problem instanceof Error) || (problem as NodeJS.ErrnoException).code !== 'ESRCH') {
          killError = describe(problem);
        }
      }
    };
    const armCase = (phase: CasePhase): void => {
      assertCaseProgress(caseProgress);
      clearTimeout(caseTimer);
      caseProgress.phase = phase;
      caseTimer = setTimeout(() => {
        timedOut = true;
        timeoutPhase = phase;
        kill();
      }, caseTimeout);
    };
    const progressError = (message: string): void => {
      assertCaseProgress(caseProgress);
      caseProgress.error ||= message;
      kill();
    };
    const progressLine = (line: string): void => {
      assertCaseProgress(caseProgress);
      if (caseProgress.error) return;
      const marker = /^(START|END)\t([^\t\r\n]+)$/.exec(line);
      if (!marker) {
        if (/^(START|END)(?:\t|$)/.test(line)) progressError('Malformed construction progress marker');
        else caseProgress.diagnostics += `${line}\n`;
        return;
      }
      const kind = marker[1];
      const id = marker[2];
      assert.ok((kind === 'START' || kind === 'END') && id !== undefined);
      const now = performance.now();
      if (kind === 'START') {
        if (caseProgress.active !== null || id !== progressIds[caseProgress.started]) {
          progressError(`Unexpected construction START ${id}`);
          return;
        }
        caseProgress.active = id;
        caseProgress.started++;
        caseStarted = now;
        armCase('case');
      } else {
        if (caseProgress.active !== id || id !== progressIds[caseProgress.completed]) {
          progressError(`Unmatched construction END ${id}`);
          return;
        }
        if (now - caseStarted > caseTimeout) {
          timedOut = true;
          timeoutPhase = 'case';
          kill();
        }
        caseProgress.completed++;
        caseProgress.active = null;
        armCase(caseProgress.completed === progressIds.length ? 'exit' : 'between-cases');
      }
      const record: CaseEvent = {
        event: kind === 'START' ? 'start' : 'end',
        id,
        elapsedMs: now - started,
        ...(kind === 'END' ? { caseElapsedMs: now - caseStarted } : {}),
      };
      caseProgress.events.push(record);
      onCaseEvent?.(record);
    };
    const progressChunk = (chunk: Buffer): void => {
      try {
        progressBuffer += progressDecoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = progressBuffer.indexOf('\n')) !== -1) {
          const line = progressBuffer.slice(0, newline);
          progressBuffer = progressBuffer.slice(newline + 1);
          progressLine(line);
        }
      } catch (problem) {
        error ||= describe(problem);
        kill();
      }
    };
    if (caseProgress) armCase('startup');
    const sample = (): void => {
      if (settled || !child.pid || measured.exceeded || memory === null) return;
      try {
        const size = memory.read(child.pid);
        if (typeof size === 'number' && Number.isSafeInteger(size) && size > 0) {
          measured.samples++;
          measured.enforcement = 'sampled';
          measured.maximumSampledRssBytes = Math.max(measured.maximumSampledRssBytes, size);
          if (size > memory.limitBytes) {
            measured.exceeded = true;
            kill();
          }
        }
      } catch (problem) {
        // A fast child may exit before /proc or ps observes it. Preserve that
        // uncertainty instead of calling zero bytes a successful measurement.
        measured.samplingError = describe(problem);
      }
    };
    if (memory !== null) {
      child.once('spawn', () => {
        sample();
        monitor = setInterval(sample, memory.intervalMs);
      });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutPhase = caseProgress ? 'batch' : 'invocation';
      kill();
    }, timeout);
    const collect = (chunks: Buffer[], chunk: Buffer): void => {
      const left = maxBuffer - bytes;
      if (left > 0) chunks.push(chunk.subarray(0, left));
      bytes += chunk.length;
      if (bytes > maxBuffer && !overflow) {
        overflow = true;
        kill();
      }
    };
    child.stdout.on('data', (chunk: Buffer) => collect(out, chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      collect(err, chunk);
      if (caseProgress) progressChunk(chunk);
    });
    child.on('error', problem => {
      error = describe(problem);
    });
    child.on('close', (status, signal) => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(caseTimer);
      clearInterval(monitor);
      if (caseProgress) {
        try {
          progressBuffer += progressDecoder.decode();
        } catch (problem) {
          error ||= describe(problem);
        }
        if (progressBuffer !== '') caseProgress.error ||= 'Unterminated construction stderr line';
        caseProgress.complete = !caseProgress.error
          && !timedOut
          && caseProgress.active === null
          && caseProgress.completed === progressIds.length
          && caseProgress.started === progressIds.length;
      }
      const stdoutBytes = Buffer.concat(out);
      const stderrBytes = Buffer.concat(err);
      let stdout: string;
      let stderr: string;
      try {
        stdout = strictDecode(stdoutBytes);
        stderr = strictDecode(stderrBytes);
      } catch (problem) {
        error ||= describe(problem);
        stdout = stdoutBytes.toString('utf8');
        stderr = stderrBytes.toString('utf8');
        onInvalidOutput?.(stdoutBytes, stderrBytes);
      }
      resolveResult({
        command,
        args,
        status,
        signal,
        error,
        stdout,
        stderr,
        timedOut,
        timeoutPhase,
        overflow,
        killError,
        memory: measured,
        caseProgress,
        elapsedMs: performance.now() - started,
      });
    });
  return promise;
}

function assertCaseProgress(value: CaseProgress | null): asserts value is CaseProgress {
  if (value === null) throw new Error('Construction progress is disabled');
}
