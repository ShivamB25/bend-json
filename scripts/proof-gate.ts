import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, COMPILER, BUN, ENV, check, artifacts } from './tools.ts';

// This is a review boundary, not a security boundary against simultaneous edits
// to the laws, SPEC, and this baseline. Contract changes require explicit review.
type BaselinePair = readonly [id: string, name: string];
type ReleaseFile = 'SPEC.md' | 'json.bend' | 'LAWS.bend' | 'PROOF.bend';
type DeclarationKind = 'law' | 'def';
type CompilerExpectation = 'safe' | 'unsafe' | 'missing-import' | 'incomplete' | 'equality-mismatch';
type FixtureFiles = Readonly<Record<string, string>>;
type ReleaseFixture = Record<ReleaseFile, string>;
interface LawRow {
  id: string;
  name: string;
  domain: string;
}
interface GateError extends Error {
  category: string;
  result?: unknown;
  reports?: unknown[];
  directory?: string;
}
interface ProcessLike {
  status?: number | null;
  signal?: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  timedOut?: boolean;
  timeout?: boolean;
  stdout?: unknown;
  stderr?: unknown;
}
export interface InventoryReport {
  root: string;
  files: ReleaseFile[];
  laws: LawRow[];
  directImport: true;
  noMain: true;
}

// This is a review boundary, not a security boundary against simultaneous edits
// to the laws, SPEC, and this baseline. Contract changes require explicit review.
const BASELINE = Object.freeze([
  ['JSON-P001', 'Json.bool_roundtrip'],
  ['JSON-P002', 'Json.null_roundtrip'],
  ['JSON-P003', 'Json.empty_array_roundtrip'],
  ['JSON-P004', 'Json.empty_object_roundtrip'],
  ['JSON-P005', 'Json.string_reverse_accumulator'],
] as const satisfies readonly BaselinePair[]);
const FILES: readonly ReleaseFile[] = Object.freeze(['SPEC.md', 'json.bend', 'LAWS.bend', 'PROOF.bend']);
const TIMEOUT = 30_000;
const MAX_BUFFER = 1024 * 1024;
const normalize = (text: string): string => text.replaceAll('\r\n', '\n');
const NAME = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';

function fail(category: string, message: string, details: Record<string, unknown> = {}): never {
  const error = new Error(`${category}: ${message}`) as GateError;
  Object.assign(error, { category, ...details });
  throw error;
}

function diagnostic(result: ProcessLike) {
  return {
    status: result.status ?? null,
    signal: result.signal ?? null,
    error: result.error == null ? null : {
      name: result.error.name ?? 'Error',
      message: result.error.message ?? String(result.error),
      code: result.error.code ?? null,
      errno: result.error.errno ?? null,
      syscall: result.error.syscall ?? null,
      path: result.error.path ?? null,
      spawnargs: (result.error as NodeJS.ErrnoException & { spawnargs?: readonly string[] }).spawnargs ?? null,
      stack: result.error.stack ?? null,
    },
    timedOut: result.timedOut === true || result.timeout === true || result.error?.code === 'ETIMEDOUT',
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
  };
}

export function strictVerdict(result: ProcessLike, label: string) {
  const evidence = diagnostic(result);
  if (evidence.error || evidence.signal || evidence.timedOut || evidence.status !== 0) {
    fail('checker-process', `${label}: checker did not exit cleanly`, { result: evidence });
  }
  if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || normalize(result.stdout) !== 'All terms check.\n' || result.stderr !== '') {
    fail('checker-verdict', `${label}: unsafe or unfamiliar checker output`, { result: evidence });
  }
  return { label, category: 'safe', ...evidence };
}

// Anchored recognition of canonical declaration lines, not a Bend parser.
// A comment-only line never contributes a declaration; comments after a header
// are ignored. Bodies, including strings containing '#', are not interpreted.
function declarationLines(source: string): string[] {
  return normalize(source).split('\n').map(line => line.replace(/#.*$/, '').trimEnd());
}

function declarations(source: string, kind: DeclarationKind, file: string): string[] {
  const pattern = kind === 'law'
    ? new RegExp(`^law (${NAME}):$`)
    : new RegExp(`^def (${NAME})\\(`);
  const names: string[] = [];
  const candidate = new RegExp(`^(?:[ \\t]*|[ \\t]*@unsafe[ \\t]+)${kind}(?:[ \\t]|$)`);
  for (const line of declarationLines(source)) {
    if (!candidate.test(line)) continue;
    const match = pattern.exec(line);
    if (!match) fail('inventory-declaration', `${file}: noncanonical ${kind} declaration ${line}`);
    const name = match[1];
    if (name === undefined) fail('inventory-declaration', `${file}: missing ${kind} name`);
    if (names.includes(name)) fail('inventory-duplicate', `${file}: duplicate ${kind} ${name}`);
    names.push(name);
  }
  return names;
}

function tableRows(source: string): LawRow[] {
  // Examples and HTML comments are not formal table entries.
  const visible = normalize(source).replace(/<!--[\s\S]*?-->/g, '');
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of visible.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence === null) lines.push(line);
  }
  const heading = /^\|\s*ID\s*\|\s*Law(?: in `LAWS\.bend`)?\s*\|\s*Domain\/category\s*\|\s*$/;
  const headers = lines.flatMap((line, index) => heading.test(line) ? [index] : []);
  if (headers.length !== 1) fail('inventory-table', 'SPEC.md must contain exactly one formal law table');
  const start = headers[0];
  if (start === undefined) fail('inventory-table', 'SPEC.md formal table header is missing');
  if (!/^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*$/.test(lines[start + 1] ?? '')) {
    fail('inventory-table', 'SPEC.md formal table separator is missing');
  }
  const rows: LawRow[] = [];
  let end = start + 2;
  const row = new RegExp(`^\\|\\s*(JSON-P[0-9]{3})\\s*\\|\\s*(${NAME})\\s*\\|\\s*([^|]+)\\|\\s*$`);
  while (end < lines.length && lines[end]?.startsWith('|')) {
    const sourceLine = lines[end];
    if (sourceLine === undefined) fail('inventory-table', 'SPEC.md table ended unexpectedly');
    const match = row.exec(sourceLine);
    const id = match?.[1];
    const name = match?.[2];
    const domain = match?.[3]?.trim();
    if (!id || !name || !domain) fail('inventory-table', `Malformed formal row: ${sourceLine}`);
    rows.push({ id, name, domain });
    end++;
  }
  for (let index = 0; index < lines.length; index++) {
    if (index >= start && index < end) continue;
    const line = lines[index];
    if (line !== undefined && /^\|\s*JSON-P[0-9]+\s*\|/.test(line)) {
      fail('inventory-table', 'Formal law rows must occur only in the one formal table');
    }
  }
  for (const key of ['id', 'name'] as const) {
    if (new Set(rows.map(item => item[key])).size !== rows.length) {
      fail('inventory-duplicate', `SPEC.md contains duplicate law ${key}s`);
    }
  }
  return rows;
}

function inventoryAt(root: string, required: readonly BaselinePair[]): InventoryReport {
  const sources = {} as Record<ReleaseFile, string>;
  for (const file of FILES) {
    const path = resolve(root, file);
    try {
      if (!lstatSync(path).isFile()) fail('inventory-file', `${file} must be a regular file`);
      sources[file] = readFileSync(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'category' in error) throw error;
      fail('inventory-file', `${file} is unreadable or missing`, { cause: error });
    }
  }
  const rows = tableRows(sources['SPEC.md']);
  for (const [id, name] of required) {
    if (!rows.some(row => row.id === id && row.name === name)) {
      fail('inventory-baseline', `Required formal row ${id} / ${name} is missing or changed`);
    }
  }
  const laws = declarations(sources['LAWS.bend'], 'law', 'LAWS.bend');
  const proofs = declarations(sources['PROOF.bend'], 'def', 'PROOF.bend');
  const imports = declarationLines(sources['PROOF.bend']).filter(line => line === 'import ./LAWS.bend as Laws');
  if (imports.length !== 1) fail('inventory-import', 'PROOF.bend must directly import ./LAWS.bend as Laws exactly once');
  for (const row of rows) {
    if (!laws.includes(row.name)) fail('inventory-law', `Missing top-level law ${row.name}`);
    if (!proofs.includes(`Laws.${row.name}`)) fail('inventory-proof', `Missing def Laws.${row.name}`);
  }
  for (const name of laws) {
    if (!rows.some(row => row.name === name)) fail('inventory-table', `Release law ${name} is absent from SPEC.md`);
  }
  for (const name of proofs.filter(name => name.startsWith('Laws.'))) {
    if (!laws.includes(name.slice(5))) fail('inventory-proof', `Proof ${name} has no matching release law`);
  }
  for (const file of FILES.filter(file => file.endsWith('.bend'))) {
    if (declarations(sources[file], 'def', file).includes('main')
      || declarations(sources[file], 'law', file).includes('main')) {
      fail('inventory-main', `${file} must not define root main`);
    }
  }
  return { root: resolve(root), files: [...FILES], laws: rows, directImport: true, noMain: true };
}

export function inventory(root = ROOT): InventoryReport {
  return inventoryAt(root, BASELINE);
}

export function proofChecks(): unknown[] {
  const reports: unknown[] = [{ label: 'release-inventory', category: 'inventory', ...inventory() }];
  // tools.check uses the pinned compiler, 30-second timeout, and 1 MiB cap.
  // LAWS alone intentionally has open claims: check it through PROOF instead.
  for (const file of ['json.bend', 'PROOF.bend']) {
    try {
      reports.push(strictVerdict(check(resolve(ROOT, file)), file));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      (error as GateError).reports = reports;
      throw error;
    }
  }
  return reports;
}

// Unlike tools.run/check, controls must retain unsuccessful subprocess results.
function checker(file: string, cwd: string): SpawnSyncReturns<string> {
  return spawnSync(BUN, ['--no-install', COMPILER, file], {
    cwd, env: ENV, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_BUFFER,
  });
}

function expectedRejection(
  action: () => unknown,
  category: string,
  label: string,
): { category: string; message: string; result?: unknown } {
  try {
    action();
  } catch (error) {
    if (!(error instanceof Error) || !('category' in error)) throw error;
    const gateError = error as GateError;
    if (gateError.category !== category) throw error;
    return {
      category: gateError.category,
      message: gateError.message,
      ...(gateError.result === undefined ? {} : { result: gateError.result }),
    };
  }
  fail('selftest-unexpected-accept', `${label}: expected ${category}`);
}

function compilerControl(dir: string, expected: CompilerExpectation) {
  const label = dir.slice(dir.lastIndexOf('/') + 1);
  const result = checker(resolve(dir, 'PROOF.bend'), dir);
  if (expected === 'safe') return strictVerdict(result, label);
  const rejection = expectedRejection(() => strictVerdict(result, label),
    expected === 'unsafe' ? 'checker-verdict' : 'checker-process', label);
  const evidence = diagnostic(result);
  const stdout = typeof result.stdout === 'string' ? normalize(result.stdout) : null;
  const stderr = typeof result.stderr === 'string' ? normalize(result.stderr) : null;
  let matched = !evidence.error && !evidence.signal && !evidence.timedOut;
  if (expected === 'unsafe') {
    matched &&= result.status === 0 && stderr === '' && typeof stdout === 'string'
      && /^All terms check, with (?:1 unsafe annotation|(?:[2-9]|[1-9][0-9]+) unsafe annotations)\.\n$/.test(stdout);
  } else {
    matched &&= result.status === 1 && stdout === '' && typeof stderr === 'string';
    if (expected === 'missing-import') {
      matched &&= stderr === 'bend: PROOF.bend must import ./LAWS.bend (see bend --help)\n';
    } else if (expected === 'incomplete') {
      matched &&= stderr === 'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.\n';
    } else if (expected === 'equality-mismatch') {
      // Check the unequal Nat sides, not the compiler's namespace/location rendering.
      // Syntax errors and type-shape failures do not have this check-rfl diagnostic.
      matched &&= typeof stderr === 'string' && /^Error:\n- expected : 0n\n- observed : 1n\n/.test(stderr);
    } else {
      fail('selftest-category', `Unknown expected diagnostic ${expected}`);
    }
  }
  if (!matched) fail('selftest-diagnostic', `${label}: did not produce ${expected}`, { result: evidence });
  return { label, category: expected, rejection, ...evidence };
}

function fixtureFiles(pairs: readonly BaselinePair[]): ReleaseFixture {
  return {
    'SPEC.md': '| ID | Law | Domain/category |\n|---|---|---|\n'
      + pairs.map(([id, name]) => `| ${id} | ${name} | Enforcement fixture only |\n`).join(''),
    'json.bend': 'import Base\ndef harmless() -> Nat:\n  0n\n',
    'LAWS.bend': 'import Base\n' + pairs.map(([, name]) => `law ${name}:\n  {0n == 0n : Nat}\n`).join(''),
    'PROOF.bend': 'import Base\nimport ./LAWS.bend as Laws\n'
      + pairs.map(([, name]) => `def Laws.${name}():\n  {==}\n`).join(''),
  };
}

function writeFixture(parent: string, name: string, files: FixtureFiles): string {
  const dir = resolve(parent, name);
  mkdirSync(dir);
  for (const [file, source] of Object.entries(files)) writeFileSync(resolve(dir, file), source, { flag: 'wx' });
  return dir;
}

export function proofSelftest(): unknown[] {
  artifacts();
  const temp = mkdtempSync(resolve(ROOT, 'artifacts/proof-selftest-'));
  const reports: unknown[] = [];
  const tinyPairs: readonly BaselinePair[] = [['JSON-P001', 'Control.identity']];
  const tiny = fixtureFiles(tinyPairs);
  try {
    const positive = writeFixture(temp, 'valid', tiny);
    reports.push({ label: 'valid-inventory', category: 'inventory', ...inventoryAt(positive, tinyPairs) });
    reports.push(compilerControl(positive, 'safe'));

    const cases: ReadonlyArray<readonly [string, FixtureFiles, CompilerExpectation, string?]> = [
      ['missing-import', { ...tiny, 'PROOF.bend': 'import Base\ndef harmless() -> Nat:\n  0n\n' }, 'missing-import', 'inventory-import'],
      ['unfilled-law', { ...tiny, 'PROOF.bend': 'import Base\nimport ./LAWS.bend as Laws\ndef harmless() -> Nat:\n  0n\n' }, 'incomplete', 'inventory-proof'],
      ['explicit-todo', { ...tiny, 'PROOF.bend': tiny['PROOF.bend'].replace('{==}', '?TODO') }, 'incomplete'],
      ['false-equality', { ...tiny, 'LAWS.bend': tiny['LAWS.bend'].replace('0n == 0n', '0n == 1n') }, 'equality-mismatch'],
      ['explicit-unsafe', {
        ...tiny,
        'PROOF.bend': tiny['PROOF.bend'].replace('import Base\n', 'import Base\nimport ./unsafe.bend as Unsafe\n'),
        'unsafe.bend': 'import Base\n@unsafe\ndef harmless() -> Nat:\n  0n\n',
      }, 'unsafe'],
      ['template-unsafe', {
        ...tiny,
        'PROOF.bend': tiny['PROOF.bend'].replace('import Base\n', 'import Base\nimport ./template.bend as Template\n'),
        'template.bend': 'import Base\ndef mapped() -> List<Nat>:\n  List.map(~Nat,~Nat,~(x=>x),[0n])\n',
      }, 'unsafe'],
    ];
    for (const [label, files, expected, inventoryError] of cases) {
      const dir = writeFixture(temp, label, files);
      const inv = inventoryError
        ? expectedRejection(() => inventoryAt(dir, tinyPairs), inventoryError, label)
        : inventoryAt(dir, tinyPairs);
      reports.push({ ...compilerControl(dir, expected), inventory: inv });
    }

    // Synthetic copies deliberately have the release's immutable names but tiny
    // equalities: these controls test inventory enforcement, not release proofs.
    const full = fixtureFiles(BASELINE);
    const intact = writeFixture(temp, 'inventory-intact', full);
    reports.push({ ...compilerControl(intact, 'safe'), inventory: inventory(intact) });
    for (const file of FILES) {
      const files: FixtureFiles = Object.fromEntries(Object.entries(full).filter(([name]) => name !== file));
      const dir = writeFixture(temp, `missing-file-${file}`, files);
      const rejection = expectedRejection(() => inventory(dir), 'inventory-file', file);
      // When the proof graph is intact, establish that compilation alone passes.
      const compiled = file === 'SPEC.md' || file === 'json.bend' ? compilerControl(dir, 'safe') : null;
      reports.push({ label: `missing-file-${file}`, rejection, compiled });
    }
    for (const [id, name] of BASELINE) {
      const law = `law ${name}:\n  {0n == 0n : Nat}\n`;
      const proof = `def Laws.${name}():\n  {==}\n`;
      const row = `| ${id} | ${name} | Enforcement fixture only |\n`;
      for (const kind of ['law', 'proof', 'law-and-proof', 'row'] as const) {
        const files = { ...full };
        if (kind === 'law' || kind === 'law-and-proof') files['LAWS.bend'] = files['LAWS.bend'].replace(law, '');
        if (kind === 'proof' || kind === 'law-and-proof') files['PROOF.bend'] = files['PROOF.bend'].replace(proof, '');
        if (kind === 'row') files['SPEC.md'] = files['SPEC.md'].replace(row, '');
        const label = `missing-${kind}-${id}`;
        const dir = writeFixture(temp, label, files);
        const category = kind === 'row' ? 'inventory-baseline' : kind === 'proof' ? 'inventory-proof' : 'inventory-law';
        const rejection = expectedRejection(() => inventory(dir), category, label);
        const compiled = kind === 'row' || kind === 'law-and-proof' ? compilerControl(dir, 'safe')
          : kind === 'proof' ? compilerControl(dir, 'incomplete') : null;
        reports.push({ label, rejection, compiled });
      }
    }
    rmSync(temp, { recursive: true });
    return reports;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const gateError = error as GateError;
    gateError.directory = temp;
    gateError.reports = reports;
    gateError.message += `\nProof self-test artifacts retained at ${temp}`;
    throw gateError;
  }
}
