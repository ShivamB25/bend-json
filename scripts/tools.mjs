import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN = '15ae0c86f3193b8f645b4bedbc438655b648d0da';
export const CORPUS_PIN = '1ef36fa01286573e846ac449e8683f8833c5b26a';
export const CORPUS_TREE = 'b936f9acdd24b9f5fefe68b90b9beab2c681137a';
function executable(command) {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : (process.env.PATH || '').split(delimiter).map(dir => resolve(dir || '.', command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {}
  }
  throw new Error(`Executable not found: ${command}`);
}

function checkout(path) {
  const inspect = args => {
    const result = spawnSync('git', ['--no-optional-locks', '-C', path, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal) throw new Error(`Cannot inspect compiler checkout ${path}: ${result.error || result.signal}`);
    return result;
  };
  const revision = inspect(['rev-parse', 'HEAD']);
  const status = inspect(['status', '--porcelain', '--untracked-files=all']);
  if (revision.status !== 0 || status.status !== 0) return `Not a readable Git checkout: ${path}`;
  if (revision.stdout.trim() !== PIN) return `Bend pin mismatch at ${path}: ${revision.stdout.trim()}`;
  if (status.stdout !== '') return `Modified compiler checkout: ${path}`;
  if (!existsSync(resolve(path, 'bend2/main.ts'))) return `Missing compiler source: ${path}`;
  return null;
}

function compilerRef() {
  if (process.env.BEND_REF !== undefined) {
    if (!process.env.BEND_REF) throw new Error('BEND_REF must not be empty');
    const explicit = resolve(process.env.BEND_REF);
    const problem = existsSync(explicit) ? checkout(explicit) : null;
    if (problem) throw new Error(problem);
    return explicit;
  }
  const preferred = resolve(ROOT, '.tools/bend');
  if (!existsSync(preferred) || checkout(preferred) === null) return preferred;
  const fallback = resolve(ROOT, '.tools/bend-15ae0c86');
  const problem = existsSync(fallback) ? checkout(fallback) : null;
  if (problem) throw new Error(`Refusing to replace fallback checkout. ${problem}`);
  return fallback;
}

export const BUN = executable(process.env.BUN || 'bun');
export const NODE = executable(process.env.NODE || process.execPath);
export const REF = compilerRef();
export const COMPILER = resolve(REF, 'bend2/main.ts');
export const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, ...options });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}\nstatus=${result.status} signal=${result.signal} ${result.error || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return result;
}
export function check(file) {
  const result = run(BUN, ['--no-install', COMPILER, file], { timeout: 30000 });
  if (result.stdout.replaceAll('\r\n', '\n') !== 'All terms check.\n' || result.stderr !== '') throw new Error(`Unsafe/unfamiliar checker verdict for ${file}: ${result.stdout}\n${result.stderr}`);
  return result;
}
export function versions() {
  const node = run(NODE, ['--version']).stdout.trim();
  const bun = run(BUN, ['--version']).stdout.trim();
  if (node !== 'v26.9.0' || bun !== '1.4.2') throw new Error(`Pinned runtimes required: Node v26.9.0/Bun 1.4.2; observed ${node}/${bun}`);
  const revision = run('git', ['-C', REF, 'rev-parse', 'HEAD']).stdout.trim();
  const problem = checkout(REF);
  if (problem) throw new Error(problem);
  const bend = run(BUN, ['--no-install', COMPILER, '--version']).stdout.trim();
  if (bend !== 'bend 2.0.16') throw new Error(`Unexpected Bend version: ${bend}`);
  return { node, bun, bend, revision };
}
export function artifacts() { mkdirSync(resolve(ROOT, 'artifacts'), { recursive: true }); }
