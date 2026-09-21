import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from './tools.ts';
import { asHarnessError, supervise } from './verify.ts';
import type { HarnessError, HostResultEvent, HostStartEvent, WorkerReport } from './verify.ts';
import {
  mutationFixtures,
  admissible,
  retainMutationFailure,
} from '../tests/mutations.ts';
import type { MutationFixture, MutationMinimized } from '../tests/mutations.ts';

interface FailureCause {
  category: string;
  message: string;
  signal: NodeJS.Signals | null;
  status: number | null;
}
interface RecoveryOptions {
  backend: string;
  command: string;
  prefix?: readonly string[];
  entry: string;
  caseMs?: number;
  campaignMs?: number;
  startupMs?: number;
  maxAttempts?: number;
}
interface RecoveryAttempt {
  sha256: string;
  codepoints: number;
  status: 'pass' | 'matching-failure' | 'different-failure';
  category?: string;
  exit?: number | null;
  signal?: NodeJS.Signals | null;
  message?: string;
}
export interface RecoveryReport extends MutationMinimized {
  id: string;
  status: string;
  text: string;
  sha256: string;
  attempts: RecoveryAttempt[];
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function matchingFailure(original: FailureCause, observed: HarnessError): boolean {
  const report = observed.report as WorkerReport | undefined;
  const expectedMemory = original.category === 'worker-memory'
    || original.message.includes('RSS limit exceeded');
  if (expectedMemory) {
    return observed.category === 'worker-memory'
      || report?.events.some(event => event.event === 'result'
        && event.status === 'fail'
        && event.message?.includes('RSS limit exceeded')) === true;
  }
  if (original.category === 'worker-case-timeout') return observed.category === 'worker-case-timeout';
  if (original.category === 'worker-protocol' || original.category === 'worker-exit') {
    return observed.category === original.category
      && report?.signal === original.signal
      && report.status === original.status;
  }
  return observed.category === 'worker-failures';
}
export async function recoverMutationFailures(
  error: HarnessError,
  {
    backend,
    command,
    prefix = [],
    entry,
    caseMs = 5000,
    campaignMs = 600000,
    startupMs = 120000,
    maxAttempts = 64,
  }: RecoveryOptions,
): Promise<RecoveryReport[]> {
  const worker = error.report as WorkerReport | undefined;
  if (!worker) return [];
  const completed = new Set<string>();
  const failed = new Map<string, FailureCause>();
  for (const event of worker.events) {
    if (event.event !== 'result') continue;
    const result: HostResultEvent = event;
    completed.add(result.id);
    if (result.status === 'fail' && result.id.startsWith('mutation/')) {
      failed.set(result.id, {
        category: 'worker-failures',
        message: result.message || 'Mutation mismatch',
        signal: worker.signal,
        status: worker.status,
      });
    }
  }
  for (const event of worker.events) {
    if (event.event !== 'start') continue;
    const start: HostStartEvent = event;
    if (start.id.startsWith('mutation/') && !completed.has(start.id)) {
      failed.set(start.id, {
        category: error.category,
        message: error.message,
        signal: worker.signal,
        status: worker.status,
      });
    }
  }
  if (failed.size === 0) return [];
  const items: MutationFixture[] = [];
  // Persist every original before attempting even one replay. A killed shrinking
  // process can never destroy the only copy of seed/origin/hash/source.
  for (const item of mutationFixtures()) {
    const cause = failed.get(item.id);
    if (!cause) continue;
    retainMutationFailure(item, cause.message, { status: 'pending-supervised-recovery' }, backend);
    items.push(item);
  }
  const reports: RecoveryReport[] = [];
  const deadline = Date.now() + campaignMs;
  for (const item of items) {
    const original = failed.get(item.id);
    assert.ok(original);
    const attempts: RecoveryAttempt[] = [];
    let text = item.text;
    let status = 'retained';
    let width = Math.floor([...text].length / 2);
    const candidatePath = resolve(
      ROOT,
      'artifacts/mutations',
      `${backend}-${item.id.replace('/', '-')}-candidate.json`,
    );
    const checkpoint = (): RecoveryReport => {
      const result: RecoveryReport = {
        id: item.id,
        status,
        text,
        sha256: hash(text),
        attempts,
      };
      retainMutationFailure(item, original.message, result, backend);
      return result;
    };
    const fails = async (candidate: string): Promise<boolean> => {
      if (Date.now() >= deadline) return false;
      writeFileSync(candidatePath, candidate);
      try {
        await supervise(
          command,
          [...prefix, entry, '--mutation-replay', item.id, candidatePath],
          {
            label: `${backend}:shrink:${item.id}`,
            startupMs,
            caseMs,
            campaignMs: Math.max(1, deadline - Date.now()),
          },
        );
        attempts.push({ sha256: hash(candidate), codepoints: [...candidate].length, status: 'pass' });
        return false;
      } catch (observedError) {
        const observed = asHarnessError(observedError);
        const reproduced = matchingFailure(original, observed);
        const report = observed.report as WorkerReport | undefined;
        attempts.push({
          sha256: hash(candidate),
          codepoints: [...candidate].length,
          status: reproduced ? 'matching-failure' : 'different-failure',
          category: observed.category,
          ...(report === undefined ? {} : { exit: report.status, signal: report.signal }),
          message: observed.message,
        });
        return reproduced;
      }
    };
    if (Date.now() >= deadline) {
      status = 'recovery-deadline';
      reports.push(checkpoint());
      continue;
    }
    status = 'replaying-original';
    checkpoint();
    if (!await fails(text)) {
      status = Date.now() >= deadline ? 'recovery-deadline' : 'not-reproduced';
      reports.push(checkpoint());
      continue;
    }
    status = 'shrinking';
    checkpoint();
    while (width > 0 && attempts.length < maxAttempts + 1 && Date.now() < deadline) {
      const chars = [...text];
      let reduced = false;
      for (let at = 0;
        at + width <= chars.length && attempts.length < maxAttempts + 1 && Date.now() < deadline;
        at += width) {
        const candidate = chars.slice(0, at).concat(chars.slice(at + width)).join('');
        if (admissible(item, candidate) && await fails(candidate)) {
          text = candidate;
          reduced = true;
          checkpoint();
          break;
        }
      }
      if (!reduced) width = Math.floor(width / 2);
    }
    status = Date.now() >= deadline
      ? 'recovery-deadline'
      : width > 0 && attempts.length >= maxAttempts + 1
        ? 'attempt-limit'
        : 'minimized';
    reports.push(checkpoint());
  }
  return reports;
}
