import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, COMPILER, BUN, NODE, run, check, versions, artifacts } from './tools.ts';

artifacts();
const dir = mkdtempSync(resolve(ROOT, 'artifacts/probe-'));
mkdirSync(resolve(dir, 'child'));
const source = `import Base

type Member<-A: Data> is Data:
  Member{key: String, value: A}

type Json is Data:
  Null{}
  Boolean{value: Bool}
  Number{text: String}
  Text{value: String}
  Array{items: List<&2, Json>}
  Object{members: List<&2, Member<Json>>}

type Scan is Data:
  Active{offset: Nat, frames: List<&2, Nat>}
  Failed{offset: Nat}

def scan.pop(frames: List<&2, Nat>, offset: Nat) -> Scan:
  match frames:
    case Nil{}:
      Failed{offset}
    case Con{opened, rest}:
      Active{1n+offset, rest}

def scan.close(close: Bool, offset: Nat, frames: List<&2, Nat>) -> Scan:
  match close:
    case False{}:
      Active{1n+offset, frames}
    case True{}:
      scan.pop(frames, offset)

def scan.open(open: Bool, +offset: Nat, frames: List<&2, Nat>, code: U32) -> Scan:
  match open:
    case False{}:
      scan.close(U32.is_eq(code,93), offset, frames)
    case True{}:
      Active{1n+offset, offset <> frames}

def scan.reject(reject: Bool, offset: Nat, frames: List<&2, Nat>, +code: U32) -> Scan:
  match reject:
    case False{}:
      scan.open(U32.is_eq(code,91), offset, frames, code)
    case True{}:
      Failed{offset}

def scan.step(offset: Nat, frames: List<&2, Nat>, char: Char) -> Scan:
  match char:
    case Chr{+code}:
      scan.reject(U32.is_eq(code,33), offset, frames, code)

def scan.finish(frames: List<&2, Nat>, offset: Nat) -> Result<&2, &2, Nat, Nat>:
  match frames:
    case Nil{}:
      Done{offset}
    case Con{opened, rest}:
      Fail{opened}

def scan.loop(rest: String, state: Scan) -> Result<&2, &2, Nat, Nat>:
  match rest state:
    case SNil{} Failed{offset}:
      Fail{offset}
    case SNil{} Active{offset, frames}:
      scan.finish(frames, offset)
    case SCon{h,t} Failed{offset}:
      Fail{offset}
    case SCon{h,t} Active{offset, frames}:
      scan.loop(t, scan.step(offset, frames, h))

type Step is Data:
  Complete{}
  Rejected{}
  Produce{character: Char, next: String}

def prepare(credit: Nat, work: String) -> Step:
  match credit work:
    case 0n SNil{}:
      Complete{}
    case 0n SCon{h,t}:
      Rejected{}
    case 1n+p SNil{}:
      Complete{}
    case 1n+p SCon{h,t}:
      Produce{h,t}

def output.loop(+credit: Nat, pending: Step, acc: String) -> Result<&2, &2, Nat, String>:
  match credit pending:
    case 0n Complete{}:
      Done{String.reverse(acc)}
    case 0n Rejected{}:
      Fail{0n}
    case 0n Produce{h,t}:
      Fail{0n}
    case 1n+p Complete{}:
      Done{String.reverse(acc)}
    case 1n+p Rejected{}:
      Fail{0n}
    case 1n+p Produce{h,t}:
      output.loop(p, prepare(p,t), SCon{h,acc})

def Json.parse(s: String) -> Result<&2, &2, Nat, Nat>:
  scan.loop(s, Active{0n,Nil{}})
def output(+n: Nat, s: String) -> Result<&2, &2, Nat, String>:
  output.loop(n, prepare(n,s), SNil{})
def bool() -> Bool:
  True{}
def text() -> String:
  "é😀"
def natural() -> Nat:
  17n
def list() -> List<&2, Nat>:
  [1n,2n]
def value() -> Json:
  Object{[Member{"k",Array{[Boolean{True{}}, Null{}]}}]}
def reverse(s: String) -> String:
  String.reverse(s)
def reverse_list(xs: List<&2, Nat>) -> List<&2, Nat>:
  List.reverse(&2,Nat,xs)
def cap(+n: Nat) -> Bool:
  Nat.is_le(n,16777216n)
def build(n: Nat, s: String) -> String:
  match n:
    case 0n:
      s
    case 1n+p:
      build(p,SCon{'a',s})
def count(s: String, acc: Nat) -> Nat:
  match s:
    case SNil{}:
      acc
    case SCon{h,t}:
      count(t,1n+acc)
def list_count(xs: List<&2,Nat>, acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case Con{h,t}:
      list_count(t,1n+acc)
def native_size(+n: Nat) -> Bool:
  Bool.and(Nat.is_eq(count(String.reverse(build(n,"")),0n),n),Nat.is_eq(list_count(List.reverse(&2,Nat,List.range(n)),0n),n))
`;
writeFileSync(resolve(dir, 'probe.bend'), source);
writeFileSync(resolve(dir, 'child/import.bend'), 'import Base\nimport ../probe.bend as P\ndef imported() -> P.Json:\n  P.value()\n');
writeFileSync(resolve(dir, 'child/host.ts'), `import assert from 'node:assert/strict';
import P from '../probe.bend';
assert.equal(P.bool(),true); assert.equal(P.text(),'é😀'); assert.equal(P.natural(),17n);
assert.deepEqual(P.list(),{$:'Con',head:1n,tail:{$:'Con',head:2n,tail:{$:'Nil'}}});
assert.equal(P.value().$,'Object'); assert.equal(P.value().members.head.value.$,'Array');
assert.deepEqual(P['Json.parse']('é😀'),{$:'Done',value:2n});
assert.deepEqual(P['Json.parse']('[!rest'),{$:'Fail',error:1n});
assert.deepEqual(P['Json.parse']('[[é😀]]'),{$:'Done',value:6n});
assert.deepEqual(P['Json.parse']('a[b[c]'),{$:'Fail',error:1n});
assert.deepEqual(P['Json.parse']('é😀]!rest'),{$:'Fail',error:2n});
assert.deepEqual(P.output(0n,''),{$:'Done',value:''});
assert.deepEqual(P.output(0n,'x'),{$:'Fail',error:0n});
assert.deepEqual(P.output(3n,'é😀x'),{$:'Done',value:'é😀x'});
assert.deepEqual(P.output(2n,'é😀x'),{$:'Fail',error:0n});
assert.equal(P.cap(0n),true); assert.equal(P.cap(16777216n),true); assert.equal(P.cap(16777217n),false);
for (const n of [1000,10000,100000,262144]) {
  const s = 'a'.repeat(n-1)+'😀'; assert.equal(P.reverse(s),'😀'+'a'.repeat(n-1));
  let xs={$:'Nil'}; for(let i=0;i<n;i++) xs={$:'Con',head:BigInt(i),tail:xs};
  let ys=P.reverse_list(xs); for(let i=0;i<n;i++){assert.equal(ys.head,BigInt(i));ys=ys.tail;} assert.equal(ys.$,'Nil');
  assert.deepEqual(P['Json.parse']('a'.repeat(n)),{$:'Done',value:BigInt(n)});
  console.log('size '+n+' passed');
}
console.log('host capabilities passed');
`);
writeFileSync(resolve(dir, 'native.bend'), `import Base
import ./probe.bend as P

def scan.show(result: Result<&2, &2, Nat, Nat>) -> String:
  match result:
    case Done{offset}:
      String.append("SCAN_DONE\\t", Nat.show(offset))
    case Fail{offset}:
      String.append("SCAN_FAIL\\t", Nat.show(offset))

def output.show(result: Result<&2, &2, Nat, String>) -> String:
  match result:
    case Done{text}:
      String.append("OUTPUT_DONE\\t", text)
    case Fail{offset}:
      String.append("OUTPUT_FAIL\\t", Nat.show(offset))

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(Bool.show(P.native_size(1000n)))
    IO.print(Bool.show(P.native_size(10000n)))
    IO.print(Bool.show(P.native_size(100000n)))
    IO.print(Bool.show(P.native_size(262144n)))
    IO.print(scan.show(P.Json.parse("")))
    IO.print(scan.show(P.Json.parse("é😀")))
    IO.print(scan.show(P.Json.parse("[[é😀]]")))
    IO.print(scan.show(P.Json.parse("[!rest")))
    IO.print(scan.show(P.Json.parse("[[é😀]!")))
    IO.print(scan.show(P.Json.parse("a[b[c]")))
    IO.print(scan.show(P.Json.parse("é😀]!rest")))
    IO.print(output.show(P.output(0n,"")))
    IO.print(output.show(P.output(0n,"x")))
    IO.print(output.show(P.output(1n,"😀")))
    IO.print(output.show(P.output(3n,"é😀x")))
    IO.print(output.show(P.output(2n,"é😀x")))
    IO.print(output.show(P.output(4n,"é😀x")))
`);
console.log(JSON.stringify(versions()));
check(resolve(dir, 'probe.bend'));
check(resolve(dir, 'child/import.bend'));
const results: Array<{ runtime: string; stdout: string; stderr: string }> = [];
const runtimes: Array<[string, string[]]> = [
  [BUN, ['--no-install', '--preload', COMPILER]],
  [NODE, ['--import', COMPILER]],
];
for (const [runtime, args] of runtimes) {
  const result = run(runtime, [...args, resolve(dir, 'child/host.ts')]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  results.push({ runtime, stdout: result.stdout, stderr: result.stderr });
}
const cc = process.env['CC'] || '/usr/bin/clang';
const detected = spawnSync(cc, ['--version'], {
  cwd: ROOT, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
});
let compiler: string | null = null;
let built: SpawnSyncReturns<string> | null = null;
let native: SpawnSyncReturns<string> | { status: 'unverified'; reason: string } = {
  status: 'unverified',
  reason: `Optional local Clang not found: ${cc}`,
};
if ((detected.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' && !process.env['CC']) {
  console.log(native.reason);
} else {
  if (detected.error || detected.signal || detected.status !== 0) {
    throw new Error(`Clang detection failed: ${detected.error || detected.signal || detected.status}\n${detected.stdout || ''}\n${detected.stderr || ''}`);
  }
  compiler = detected.stdout;
  if (!/clang version/i.test(compiler)) throw new Error(`Clang required, observed: ${compiler}`);
  const binary = resolve(dir, 'native');
  built = run(BUN, ['--no-install', COMPILER, resolve(dir, 'native.bend'), '-o', binary], {
    timeout: 120000, env: { ...process.env, BEND_NO_TELEMETRY: '1', CC: cc },
  });
  native = run(binary, ['--threads', '1', '--gpu', 'off']);
  assert.equal(native.stdout.replaceAll('\r\n', '\n'), [
    'True', 'True', 'True', 'True',
    'SCAN_DONE\t0', 'SCAN_DONE\t2', 'SCAN_DONE\t6',
    'SCAN_FAIL\t1', 'SCAN_FAIL\t5', 'SCAN_FAIL\t1', 'SCAN_FAIL\t2',
    'OUTPUT_DONE\t', 'OUTPUT_FAIL\t0', 'OUTPUT_DONE\t😀',
    'OUTPUT_DONE\té😀x', 'OUTPUT_FAIL\t0', 'OUTPUT_DONE\té😀x',
    '',
  ].join('\n'));
  console.log(native.stdout);
}
writeFileSync(resolve(ROOT, 'artifacts/probe.json'), JSON.stringify({ versions: versions(), compiler, results, native, built }, null, 2));
rmSync(dir,{recursive:true});
console.log(native.status === 'unverified' ? 'Gate A: Node/Bun PASS; native UNVERIFIED' : 'Gate A: PASS');
