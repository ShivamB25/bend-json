import { readFileSync, writeSync } from 'node:fs';
import Core from '../json.bend';
import * as regressions from './regressions.ts';
import * as conformance from './conformance.ts';
import * as properties from './properties.ts';
import * as mutations from './mutations.ts';
import type { TestCase } from './support.ts';
interface Suite {
  cases(): Generator<TestCase>;
}
const emit = (event: object): void => {
  writeSync(1, `${JSON.stringify(event)}\n`);
};
const chosen = process.argv.slice(2);
function* replayCases(): Generator<TestCase> {
  if (chosen.length !== 3) throw new Error('Mutation replay requires case ID and candidate file');
  const selectedId = chosen[1];
  const candidatePath = chosen[2];
  if (selectedId === undefined || candidatePath === undefined) {
    throw new Error('Mutation replay requires case ID and candidate file');
  }
  const item = [...mutations.mutationFixtures()].find(candidate => candidate.id === selectedId);
  if (!item) throw new Error(`Unknown replay mutation ${selectedId}`);
  const text = readFileSync(candidatePath, 'utf8');
  if (!mutations.admissible(item, text)) {
    throw new Error('Shrinking candidate left the original expectation domain');
  }
  yield {
    id: item.id,
    run(core) {
      mutations.exerciseMutation(core, item, text);
    },
  };
}
const suites = {
  regressions,
  conformance,
  properties,
  mutations,
  'mutation-replay': { cases: replayCases },
} satisfies Record<string, Suite>;
type SuiteName = keyof typeof suites;
const requested = chosen[0] === '--mutation-replay'
  ? ['mutation-replay']
  : chosen.length > 0
    ? chosen
    : Object.keys(suites).filter(name => name !== 'mutation-replay');
const names: SuiteName[] = requested.map(name => {
  if (!Object.hasOwn(suites, name)) throw new Error(`Unknown suite ${name}`);
  return name as SuiteName;
});
let passed = 0;
let failed = 0;
let rssPeak = 0;
let memorySamples = 0;
let campaignRssPeak = 0;
let campaignSamples = 0;
const seen = new Set<string>();
const startupMemory = {
  route: 'real-preloaded-import',
  afterImport: process.memoryUsage(),
  scope: 'compiler/import RSS reported separately; no explicit collection or baseline subtraction',
};
let first = true;
for (const name of names) {
  for (const item of suites[name].cases()) {
    if (seen.has(item.id)) throw new Error(`Duplicate case ID ${item.id}`);
    seen.add(item.id);
    item.prepare?.();
    emit({ event: 'start', id: item.id, ...(first ? { startupMemory } : {}) });
    first = false;
    try {
      const detail: unknown = item.run(Core);
      if (typeof detail === 'object' && detail !== null && 'then' in detail) {
        throw new Error('Cases must be finite synchronous API calls');
      }
      const rss = process.memoryUsage().rss;
      memorySamples++;
      rssPeak = Math.max(rssPeak, rss);
      if (item.id.startsWith('mutation/')) {
        campaignSamples++;
        campaignRssPeak = Math.max(campaignRssPeak, rss);
        if (rss > 512 * 1024 * 1024) throw new Error(`Mutation campaign RSS limit exceeded: ${rss}`);
      }
      passed++;
      emit({ event: 'result', id: item.id, status: 'pass', ...(detail === undefined ? {} : { detail }) });
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      emit({ event: 'result', id: item.id, status: 'fail', message: message.slice(0, 8192) });
    }
  }
}
emit({
  event: 'summary',
  passed,
  failed,
  memory: {
    method: 'process.memoryUsage().rss after each case',
    startup: startupMemory,
    allCases: { samples: memorySamples, rssPeak },
    campaign: {
      samples: campaignSamples,
      rssPeak: campaignRssPeak,
      limit: 512 * 1024 * 1024,
      scope: '2048 deterministic mutation cases only',
    },
  },
});
if (failed > 0) process.exitCode = 1;
