# bend-json

An original, pure Bend 2 JSON library with lossless number spelling, Unicode-scalar strings, ordered duplicate-preserving objects and checked compact encoding.

**Development status:** v0.1 acceptance is complete for the approved Bend 2.0.16 pin. Setup/probe, all five safe root obligations, all 33 proof-gate controls, Bend/Node/Bun examples, both 6,071-case host suites, the canonical native campaign and private Ubuntu/macOS CI passed; no public release/package has been performed. See [STATUS.md](STATUS.md), the authoritative [SPEC.md](SPEC.md), and [docs/VERIFICATION.md](docs/VERIFICATION.md) for exact evidence boundaries.

**Repository status:** private GitHub repository at [`ShivamB25/bend-json`](https://github.com/ShivamB25/bend-json). Pushes are authorized only to that private `origin`; do not add another remote, change visibility, or create a public release/package without explicit authorization. `.gitignore` is only an inclusion safeguard and does not control visibility or protect tracked content.

## Pinned prerequisites and setup

- Bend 2.0.16 source revision `15ae0c86f3193b8f645b4bedbc438655b648d0da`.
- Node **26.9.0**, Bun **1.4.2**, TypeScript **7.0.2** and `@types/node` **26.6.2**.
- CPU-native runs require Clang 14+; the capability probe used Apple Clang **21.0.0** on Apple M2/arm64. CI is specified to select Clang 18 on Ubuntu.
- Runtime and production-library dependencies remain zero. The locked Bun workspace contains only the TypeScript compiler and Node declarations as dev tooling; Bun invocations of the Bend compiler still use `--no-install`.

From this directory:

```sh
bun install --frozen-lockfile
bun run typecheck
node scripts/setup.ts
node scripts/probe.ts
```

Primary Bend-first checks use the pinned CLI:
The bare `bend` commands assume the installed CLI is 2.0.16 (`bend --version`). Scripted gates invoke the pinned checkout directly and never replace the global CLI.

```sh
bend json.bend
bend PROOF.bend
bend examples/basic.bend
```

These direct commands are the production, proof and example path. `examples/host.ts`, `tests/*.ts` and `scripts/bench.ts` provide cross-backend host-test/benchmark orchestration only; `scripts/setup.ts`, `probe.ts` and `verify.ts` coordinate gates and never replace the Bend implementation or proof terms.

The setup script still verifies/acquires the exact source and fixture pins without resetting existing directories. The selected checkout is normally `.tools/bend`; a fresh fallback is `.tools/bend-15ae0c86` if needed. Scripts support `BEND_REF`, `BUN` and `NODE` overrides and check the selected versions. Dirty-default/fallback/explicit-override selection controls preserve source files. Do not modify the upstream checkout. Offline setup verifies retained fixture bytes, tree and license and rejects corruption. `tree.json` preserves original Git `100644`/`100755` modes for tree-hash reconstruction only: never execute or chmod fixture data. Raw fixtures/license remain under `tests/fixtures/JSONTestSuite/`; no other parser or runner is used.

## Language boundary

The JSON implementation is Bend: [`json.bend`](json.bend), [`LAWS.bend`](LAWS.bend), and [`PROOF.bend`](PROOF.bend). The repository currently contains seven maintained `.bend` files (1,896 lines, 70,849 bytes). No TypeScript function parses or encodes production JSON.

The 21 `.ts` files (6,458 lines, 269,402 bytes) are the strict host harness: pinned-source setup, proof/inventory enforcement, raw-byte corpus verification, Node/Bun ABI checks, subprocess supervision, native compilation, mutation recovery, and benchmarks. Those jobs require filesystem, process, timing, RSS, and independent host-oracle APIs that do not belong in the pure Bend runtime. Bend's checker checks Bend terms; it cannot statically check Node's `fs`/`child_process`/RSS interfaces, and porting that orchestration into Bend would expand the library's scope rather than improve the production parser. `tsconfig.json` enables strict checking, unchecked-index protection, exact optional properties, erasable syntax, and no emit; CI runs `bun run typecheck` before any behavioral gate. The Bend module import is declared `unknown` ([`json.d.bend.ts`](json.d.bend.ts)): `expectJsonAbi` checks callability only, and `checkedCore` validates every returned `Result`, error tag/code/offset, `Limits` value and full `Json` tree (iteratively) before host code sees it. Benchmarks time the callability-checked ABI call (the module method behind one `Reflect.apply` forwarder, results unvalidated) and apply the same validators in the separately recorded post-call check.

GitHub Linguist does not currently recognize `.bend` source: [its Bend language PR was closed without merge](https://github.com/github-linguist/linguist/pull/7332). Consequently, GitHub's language bar reports the recognized TypeScript harness rather than the production language. After commit `76eace7`, GitHub's language API returned exactly `{"TypeScript":242489}` and the repository primary language became TypeScript; no JavaScript bytes remained classified. The repository does not misclassify `.bend` as another language or hide the harness with Linguist overrides.

## Four-function API

| Definition | Result |
|---|---|
| `Json.parse(text, limits)` | `Result<&2,&2,ParseError,Json>` for one complete document |
| `Json.encode(value, limits)` | `Result<&2,&2,EncodeError,String>`; compact output or an error, never partial success |
| `Json.number(text, limits)` | Validated `Number` from one lexeme, without whitespace |
| `Json.default_limits()` | The frozen six-field default profile |

`json.bend` is a reusable module with no `main` or IO. Import it by relative path:

```bend
import Base
import ../json.bend as J

def example() -> Result<&2, &2, J.ParseError, J.Json>:
  J.Json.parse("{\"x\":[-1.5e+2,\"\\u0041\"]}", J.Json.default_limits())
```

The executed Bend, Node and Bun examples preserved number text `-1.5e+2`, decoded `\u0041` to `A`, and encoded `{"x":[-1.5e+2,"A"]}`.

Run the primary Bend example:

```sh
bend examples/basic.bend
```

For cross-backend host interoperability checks only:

```sh
BEND_NO_TELEMETRY=1 bun --no-install --preload ./.tools/bend/bend2/main.ts examples/host.ts
BEND_NO_TELEMETRY=1 node --import ./.tools/bend/bend2/main.ts examples/host.ts
```

The `.ts` commands are test/orchestration lanes, not the primary production or proof path. Use the selected pinned source path consistently if setup chooses a fallback checkout.

### Node and Bun imports

A consumer in a child directory uses a **default import**. The loader exposes dotted definition names as keys, not nested namespaces or named exports:

```js
import Core from '../json.bend';

const limits = Core['Json.default_limits']();
const parsed = Core['Json.parse']('{"x":[-1.5e+2,"\\u0041"]}', limits);
if (parsed.$ === 'Fail') {
  console.dir(parsed.error);
} else {
  console.dir(Core['Json.encode'](parsed.value, limits));
}

const exactNumber = Core['Json.number']('1E-07', limits);
console.dir(exactNumber);
```

Run consumers through one of the real loader commands above. Emitting `-o program.js` builds an executable with a main; it is not a substitute host-library import. Node's upstream `[DEP0205] module.register()` deprecation warning is expected from the pinned loader (`bend2/main.ts` lines [604–625](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/main.ts#L604-L625)) and is retained, not suppressed. Node's current synchronous hook API is documented at [`module.registerHooks()`](https://nodejs.org/docs/latest/api/module.html#moduleregisterhooksoptions); it is not a compatible drop-in replacement for this pinned loader, so no compiler fork or warning suppression is used. The Bend production/proof/native path does not require Node.

Verification uses one finite worker per runtime through the same real preloaded import, running regression, corpus, property and mutation cases together. Both combined workers passed without explicit collection, compiler separation or upstream changes. No generated bundle substitutes for the public import route. These Node/Bun workers are cross-backend test orchestration only. See the precise [memory record](docs/VERIFICATION.md#runtime-memory-and-dispatch-diagnosis).

### Raw constructors and host representation

```text
Null{}
Boolean{value: Bool}
Number{text: String}
Text{value: String}
Array{items: List<&2, Json>}
Object{members: List<&2, Member<Json>>}
Member<A>{key: String, value: A}
```

On the host, Bool is a JS Boolean; String/Char use JS strings; Nat is a nonnegative BigInt. Record values use `{$:'Constructor', ...declaredFields}`. Lists are `{$:'Nil'}` or `{$:'Con', head, tail}`. Results are `{$:'Done',value}` or `{$:'Fail',error}`; generic type arguments are erased. For example:

```js
const number = { $: 'Number', text: '-0' };
const object = {
  $: 'Object',
  members: {
    $: 'Con', head: { $: 'Member', key: 'a', value: number },
    tail: {
      $: 'Con', head: { $: 'Member', key: 'a', value: { $: 'Null' } },
      tail: { $: 'Nil' },
    },
  },
};
const encoded = Core['Json.encode'](object, limits);
// Contractual successful text: {"a":-0,"a":null}
```

Raw construction is supported, not private. The encoder validates number text and key/text scalars. Injected values must already be finite, acyclic, correctly shaped/tagged and typed. Nats must fit the 48-bit Bend ABI; library limits additionally cap them at 16,777,216. Negative BigInts, wrong types, cycles and arbitrary getters are outside this low-level ABI. Lone UTF-16 surrogates in otherwise well-shaped strings are in scope and must yield structured scalar errors. Helpers that happen to be exported are not additional supported API.

## Semantics that matter

- **Numbers:** exact text, not floating-point values. `-0`, `1E-07`, huge integers and large exponents retain their spelling. No arithmetic or implicit numeric conversion is offered.
- **Objects:** ordered member lists, including duplicates after escape decoding. Integer-looking keys and `__proto__` never acquire JavaScript object semantics.
- **Strings:** scalar Unicode, no normalization. Valid escaped surrogate pairs become one scalar; lone/reversed/mismatched surrogates fail. Escaped NUL is preserved.
- **Documents:** only JSON space/tab/LF/CR; one root; no comments/trailing commas. Leading BOM fails at offset 0; quoted U+FEFF is accepted.
- **Encoding:** compact deterministic escaping, lowercase `\u00xx` for controls without named escapes; slash and other scalars remain literal. Not safe-by-itself for HTML/script embedding.
- **Errors:** stable code constructors plus Nat offsets. Parse offsets are original source codepoints, not UTF-16 units/bytes. Encode offsets count the prospective output prefix, not input positions or object paths. Full codes and precedence are specified in [SPEC.md](SPEC.md).
- **Bytes:** not a v0.1 API. Decode bytes strictly and preserve a leading BOM before calling the String parser. Invalid UTF-8 exclusions are not successful Bend rejections. At the pinned compiler, native `File.read` text is WHATWG replacement-decoded (`io_str`, [`bend2/comp.ts` lines 5376–5378](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/comp.ts#L5376-L5378)): malformed bytes become U+FFFD before `Json.parse` sees them, so it is not a strict decoder for untrusted input. Byte-level parsing remains roadmap.

## Limits

```js
const limits = {
  $: 'Limits',
  max_input: 1048576n,
  max_depth: 128n,
  max_number: 4096n,
  max_string: 262144n,
  max_values: 100000n,
  max_output: 2097152n,
};
```

Input/output limits count codepoints including syntax/escapes. Number limit counts lexeme codepoints; string limit counts decoded scalars per key/text. Depth counts open containers (scalar 0, empty container 1). Values include the root and all containers; keys do not count as values. All fields accept 0..16,777,216 inclusive and are validated at entry. Zero enforces an empty budget. Parse ignores output capacity; encode ignores input capacity; number applies input/number/value capacity.

Gate A exercised primitive strings/lists through 262,144 elements and native consuming computed-state/output-budget loops; the final real-import host workers passed 6,071 cases each, including seven large-input cases and a 99,999-element array plus its root within the default value budget. Final per-case RSS samples reached 396,607,488 bytes on Node and 270,581,760 bytes on Bun, below 512 MiB; both in-campaign supervisor enforcement lanes were unverified (`samples: 0`). These are sampled observations, not continuous peak bounds, throughput measurements or allocation-safety guarantees. Larger custom budgets remain best-effort. Consuming drivers and reverse accumulators avoid growing-prefix copying, but source shape is not a benchmark.

## Measured benchmark evidence

`artifacts/bench.json` (2026-09-21) records 31 deterministic families/sizes × five operations (`parse`, `encode`, `equality`, `materialize-ast`, `materialize-text`) for each Node, Bun and CPU-native lane: 155 measurements per lane, 465 total. Each case used five warmups and twenty samples. Fixture generation, strict UTF-8 decoding, file I/O, loader/compiler/process startup and correctness checks were outside timed calls; host eager ABI conversion was inside core calls. Native parse/encode included full result traversal, which was also measured separately; equality was the test-only iterative comparator, not a public API.

Representative parse/encode medians (milliseconds; 100,000 ASCII scalars or 100,000 array values) are:

| Fixture | Node | Bun | Native |
|---|---:|---:|---:|
| ASCII parse | 38.82494 | 89.82073 | 3.6875 |
| ASCII encode | 35.23177 | 84.53627 | 2.546875 |
| Wide-array parse | 103.45115 | 293.07979 | 16.875 |
| Wide-array encode | 83.24844 | 167.25742 | 8.0625 |

Native batching targeted at least 100 ms, capped at 1,024 iterations. Small records could remain below that target: the artifact marks 84 of 155 native measurements below target precision and nine below the native clock resolution. The 75 pairwise growth diagnostics report no greater-than-2× normalized signal for all Node/Bun pairs and 71 native pairs; four native depth pairs are below clock resolution. These finite diagnostics are not throughput guarantees or universal linear-complexity proofs. The complete campaign occupied 575,961.522834 ms (about 576.0 s) against the 600,000 ms campaign bound.

The benchmark's host RSS values are sampled snapshots (maximum 431,030,272 bytes for Node and 417,431,552 bytes for Bun in this benchmark artifact), not continuous peak measurements or enforced bounds; native benchmark RSS was unmeasured. A passing native benchmark lane demonstrates benchmark-driver execution only; the separate canonical verification report establishes the complete local native gate. The strict replay of the first 64 generated cases passed three times after flushing diagnostics (`897.4 ms`, `26.7 ms`, `23.2 ms`; [`focused-native-uBBXCx/results.json`](artifacts/focused-native-uBBXCx/results.json)); no timeout was relaxed, no smaller batch was substituted and no 330-second timeout was introduced.

The canonical required-native report covered 12,458 invocations, 65 builds, 63 construction batches, 3,000 independently generated native ASTs, 92 encode cases (88 shared host cases plus four native-only extras), 42 number cases, three malformed parses, 259 directed texts, 9,000 generated text transforms, 300 common-oracle cases, 2,048 mutations, seven large cases and the default-depth case. It sampled all 2,048 mutation invocations, with 2,048 RSS samples and a maximum of 1,392,640 bytes against the 512 MiB production ceiling; this is sampled RSS, not an exact continuous peak. Distinct 64 MiB/128 MiB RSS controls passed. Native corpus accounting was 318 fixtures, 293 String calls, 25 byte exclusions, 95 y_ accepts, 176 n_ structured rejects and 22 decoded i_ cases (11 accepts, 11 rejects).

## Verification and CI

```sh
bun install --frozen-lockfile
bun run typecheck
node scripts/verify.ts --proofs
node scripts/verify.ts --proof-gate-selftest
node scripts/verify.ts
node scripts/verify.ts --native=required
node scripts/bench.ts
```

The locked TypeScript gate, both proof commands and the final required-native integrated verification passed. `artifacts/verification.json` reports all six gates (`proofs`, `proof-gate-selftest`, `supervisor-selftest`, `host-node`, `host-bun`, `native`) as pass, with 6,071 host cases per runtime and the complete native campaign. The final local report ran from `2026-09-21T13:04:07.548Z` to `2026-09-21T13:15:00.068Z` (652.520 s). The primary production/proof/example path remains direct Bend CLI. Host `.ts` examples/tests and the benchmark script only orchestrate cross-backend checks; setup/probe/verify scripts coordinate prerequisites and gates. Private push-triggered CI run [`35606110009`](https://github.com/ShivamB25/bend-json/actions/runs/35606110009) verified TypeScript migration commit `76eace7`: Ubuntu 24.04 and macOS 15 both passed frozen dependency installation, strict type checking, setup, Gate A and `verify --native=required`.

CI targets Ubuntu 24.04 and macOS 15 with pinned Node/Bun/actions. Both jobs install the frozen dev-tool lock, run strict type checking, setup, Gate A, and `verify --native=required`. [Verification documentation](docs/VERIFICATION.md) records exact action/compiler pins and evidence boundaries.

All five formal obligations passed the safe checker: every Boolean, concrete null/empty-array/empty-object public roundtrips, and an inductive reversal-accumulator theorem. They do **not** establish a universal JSON roundtrip or grammar soundness theorem. The safe gate requires exact `All terms check.` output and rejects holes, omitted obligations, explicit unsafe annotations and unsafe template-generated instances; all 33 enforcement controls passed. It trusts the pinned checker/Base/compiler/runtime and cannot prevent coordinated rewriting of the law/spec/verifier baseline.

## Scope and next versions

No package publication, framework, HTTP, database, GPU parsing or copied parser is part of this work. After a stable v0.1, v0.2 targets typed decoders/builders, explicit numeric conversions, distinct missing/null behavior, duplicate-name ambiguity errors and structural field/index paths. v0.3 follows real use and measured encoding needs. Bytes, incremental parsing and NDJSON are later capability-driven work; see the [roadmap](SPEC.md#prioritized-roadmap-not-v01-features).

## License

Original project source and documentation are available under the [MIT License](LICENSE.md), Copyright (c) 2026 Shivam Bansal.

The vendored JSONTestSuite fixtures keep their independent upstream MIT license and attribution in [`tests/fixtures/JSONTestSuite/LICENSE`](tests/fixtures/JSONTestSuite/LICENSE), Copyright (c) 2016 Nicolas Seriot. The ignored Bend compiler checkout under `.tools/` is not tracked here and remains under its upstream license.

The license defines permissions if a copy is distributed; the current GitHub repository remains private and no public release/package is authorized.
