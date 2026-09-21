# Verification record

Evidence cutoff: 2026-09-21. **Bend JSON v0.1 acceptance is complete for the approved Bend 2.0.16 pin.** Setup/probe, all five safe root proofs, all 33 proof controls, actual Bend/Node/Bun examples, both 6,071-case combined real-import host suites, the benchmark campaign, the canonical native campaign and private Ubuntu/macOS CI passed. The GitHub repository is private and no public release/package has been performed. Completed evidence is finite and is not a universal grammar, roundtrip or complexity proof.

## Revisions and environment

| Component | Exact selection / observation |
|---|---|
| Bend | 2.0.16, `15ae0c86f3193b8f645b4bedbc438655b648d0da` |
| Selected local source | `.tools/bend` (scripts may select `.tools/bend-15ae0c86` or explicit `BEND_REF`) |
| Node | `v26.9.0` |
| Bun | `1.4.2` |
| Native compiler | Apple clang version 21.0.0 (`clang-2100.1.1.101`) |
| Compiler target | `arm64-apple-darwin25.6.0` |
| Machine context | Apple M2, Darwin 25.6.0; benchmark timings measured in `artifacts/bench.json` |
| JSONTestSuite | `1ef36fa01286573e846ac449e8683f8833c5b26a` |
| Parsing tree | `b936f9acdd24b9f5fefe68b90b9beab2c681137a` |

Runtime/compiler values are recorded in [`artifacts/probe.json`](../artifacts/probe.json). All `artifacts/` links are generated ignored local evidence, not assumed checked-in release attachments. Fixture provenance, sizes, Git blob hashes and SHA-256 are in [`manifest.json`](../tests/fixtures/JSONTestSuite/manifest.json). [`tree.json`](../tests/fixtures/JSONTestSuite/tree.json) retains original Git `100644`/`100755` modes to reconstruct the pinned tree hash; modes are metadata only, never instructions to execute/chmod fixture data. Setup retains the original [MIT license](../tests/fixtures/JSONTestSuite/LICENSE), Copyright (c) 2016 Nicolas Seriot. No fixture parser/runner code is imported.

## Commands and observed status

Commands run from the project root; scripts set `BEND_NO_TELEMETRY=1`, verify pins and select compiler/runtime paths. The default source path in direct commands must be substituted consistently if `BEND_REF` or the fallback checkout is selected.

| Command | Current evidence |
|---|---|
| `node scripts/setup.mjs` | Passed acquisition and version prerequisites; Main also observed offline raw-byte/tree/license verification and corruption rejection |
| `node scripts/probe.mjs` | Passed; saved host/native outputs in `artifacts/probe.json` |
| `node scripts/verify.mjs --proofs` | Passed inventory and both safe checks; `artifacts/proofs.json` |
| `node scripts/verify.mjs --proof-gate-selftest` | Passed all 33 controls; `artifacts/proof-gate-selftest.json` |
| `node scripts/verify.mjs` | Final integrated report passed; `artifacts/verification.json` records all six gates and 6,071 host cases per runtime |
| `node scripts/verify.mjs --native=required` | Final canonical native gate passed; `artifacts/native.json` status `pass`, `required: true` |
| `node scripts/bench.mjs` | Passed actual Node/Bun/native lanes; `artifacts/bench.json` records 465 measurements and the watchdog control |
| Bend and Node/Bun examples in README | Main observed all three execute the nested number/Unicode slice successfully |
| GitHub Actions workflow | Execution unverified |

Main's source-selection controls covered protected dirty-default checkout, fallback and explicit `BEND_REF`, with source files preserved. Neither selection nor setup may reset/modify an existing checkout. Offline fixture verification uses retained tree metadata and raw bytes rather than silently refetching corrupt data.

Primary Bend-first checks (observed):

```sh
bend json.bend
bend PROOF.bend
bend examples/basic.bend
```

These are the production, proof and example path. For source-pinned reproducibility, the equivalent selected-checkout no-main checks are:

```sh
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts json.bend
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts PROOF.bend
```

Cross-backend host entry points (test orchestration only):

```sh
BEND_NO_TELEMETRY=1 bun --no-install --preload ./.tools/bend/bend2/main.ts tests/host.mjs regressions conformance properties mutations
BEND_NO_TELEMETRY=1 node --import ./.tools/bend/bend2/main.ts tests/host.mjs regressions conformance properties mutations
```

These combined suite selections passed with exit 0 and 6,071 passing/zero failing cases each in [`combined-node.json`](../artifacts/combined-node.json) and [`combined-bun.json`](../artifacts/combined-bun.json). Both use the real pinned preload/import path, including all 2,048 mutations in the same worker; no explicit collection, compiler separation or generated bundle is needed. The `.mjs` modules are cross-backend test/benchmark orchestration only, not a production parser or proof substitute.

Node's upstream `[DEP0205] module.register()` deprecation warning is expected from the pinned loader ([`bend2/main.ts` lines 604–625](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/main.ts#L604-L625)) and is retained, not suppressed. Node's current synchronous [`module.registerHooks()`](https://nodejs.org/docs/latest/api/module.html#moduleregisterhooksoptions) API is not a compatible drop-in replacement for this pinned loader; no compiler fork or warning suppression is used. The Bend/native production path does not require Node.


Native consumer compilation/execution contract:

```sh
CC=/usr/bin/clang BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts tests/native.bend -o artifacts/native-driver
./artifacts/native-driver --threads 1 --gpu off -- MODE PATH MAX_INPUT MAX_DEPTH MAX_NUMBER MAX_STRING MAX_VALUES MAX_OUTPUT
```

Create `artifacts/` before compiling; the supervisor does this. `MODE` is `parse` or `roundtrip`; limits are decimal naturals. `PATH` is a regular temporary file whose bytes have already passed strict decoding. Native results must come from actual Clang-compiled CPU execution, never emitted C/checker-normalized terms alone. The local Clang lane and the canonical native campaign passed; a detected compiler/build/runtime failure remains a gate failure, not a skip.

**Native diagnosis resolved; canonical campaign passed:** earlier core/parser/encoder C-emission timeouts arose from U32 literal-pattern expansion in our dispatch. Main's inspector observed a queue of 104,541 at `Num.class` and 7,638 hot `queue.shift` CPU samples. Replacing that dispatch with intrinsic U32 comparisons/private `NumClass` classifications, without upstream changes, restored the native driver compile plus empty-array roundtrip (`DONE` plus `[]`) in 3.84 seconds. The final canonical report now records 12,458 native invocations, 65 builds, 63 construction batches, 3,000 native ASTs, 92 encode cases (88 shared plus four native-only), 42 number cases, three malformed parses, 259 directed texts, 9,000 generated text transforms, 300 common-oracle cases, 2,048 mutations and seven large cases. The strict first-64 replay passed three times after START/END diagnostic flushing (`897.4 ms`, `26.7 ms`, `23.2 ms`); no timeout relaxation, smaller batch substitution or 330-second timeout was used.

## Gate A evidence (not JSON conformance)

The original temporary probe exercised child-directory library imports, the real default host export, dotted names, nullary definitions, Boolean, astral String, BigInt Nat, linked List, Result and an ordinary recursive ADT. It exercised a consuming String/frame-state driver, a computed transition and carried failure, an output-credit driver including zero/exact capacity, codepoint counting after `é`/astral text and cap/cap+1 comparisons.

For both Bun and Node, saved stdout is exactly:

```text
size 1000 passed
size 10000 passed
size 100000 passed
size 262144 passed
host capabilities passed
```

Those sizes cover String/List reversals and iterative host checks, plus the probe's shrinking driver. Strengthened native Gate A completed in 3.46 seconds as observed by Main. Compilation and execution exited 0 with empty stderr; saved native stdout contains four `True` reversal results plus `SCAN_DONE`/`SCAN_FAIL` and `OUTPUT_DONE`/`OUTPUT_FAIL` results. It now actually executes consuming computed-state transitions, carried failures, codepoint offsets and output-budget loops at zero/exact capacity, not only reversals. These are primitive/resource capability results, not full native JSON conformance or identical host/native ABI coverage.

Bun host stderr was empty. Node host stderr contained upstream warning `[DEP0205] DeprecationWarning: module.register() is deprecated. Use module.registerHooks() instead.` The full original spelling is retained in the artifact. Do not suppress it or confuse it with the strict empty-stderr no-main Bun proof verdict. The local capability evidence supported selection of the full default profile; no budget fallback has been authorized or applied.

## Formal obligations and safe gate

The canonical, immutable-by-default five-row inventory is in [SPEC.md](../SPEC.md#formal-release-inventory). [`artifacts/proofs.json`](../artifacts/proofs.json) records safe library and root-proof checks:

| Claim | Category and exact boundary | Status |
|---|---|---|
| JSON-P001, `Json.bool_roundtrip` | Quantified over every Bool; public encode then parse, exact nested success | safe checked |
| JSON-P002, `Json.null_roundtrip` | Concrete public null roundtrip, exact nested success | safe checked |
| JSON-P003, `Json.empty_array_roundtrip` | Concrete public empty-array roundtrip, exact nested success | safe checked |
| JSON-P004, `Json.empty_object_roundtrip` | Concrete public empty-object roundtrip, exact nested success | safe checked |
| JSON-P005, `Json.string_reverse_accumulator` | Induction over all structural strings/accumulators; Base accumulator reversal equals independent reverse/append | safe checked |

Roundtrip limits are fixed `Limits{32n,4n,32n,32n,32n,32n}`, independent of defaults. Both error layers must remain represented. The reversal proof and append lemmas explain the finalizer used by parser/encoder; they do not establish general JSON roundtrip/soundness/acceptance. Those broader theorems remain deferred and require missing grammar/string/list lemmas.

The release gate must capture both streams and require exit 0, no signal/timeout, exact stdout `All terms check.\n` (CRLF normalized), and empty stderr. Timeout is 30 seconds with 1 MiB diagnostics per no-main check. `All terms check, with 1 unsafe annotation.` and plural unsafe verdicts fail despite exit 0. Generated template instances also count as unsafe. No `--checkup`, invented law flag, substring acceptance or increased timeout to hide a checking defect.

Inventory separately requires SPEC/json/LAWS/PROOF, the exact baseline ID/name pairs once in the SPEC table, every corresponding top-level law and qualified proof, direct laws import and no root main. All release laws must match the table, not just the five baseline names.

`node scripts/verify.mjs --proof-gate-selftest` passed **33 controls** in [`artifacts/proof-gate-selftest.json`](../artifacts/proof-gate-selftest.json), superseding the earlier isolated helper-only record. The count includes positive/inventory and additional strict-verdict guard controls. Root proofs have their own separate passing artifact.

| Control | Observed result |
|---|---|
| Valid `0n == 0n` law/proof | Safe strict acceptance, exit 0, exact stdout and empty stderr |
| Sibling LAWS exists but PROOF omits import | Exit 1, diagnostic `PROOF.bend must import ./LAWS.bend`; rejected |
| Imported unfilled law | Exit 1/incomplete-proof diagnostic; rejected |
| Explicit `?TODO` | Exit 1/incomplete-proof diagnostic; rejected |
| False `0n == 1n` via `{==}` | Exit 1/expected-versus-observed mismatch; rejected |
| Harmless imported explicit unsafe def | Compiler exit 0/unsafe verdict; shared strict helper rejected |
| Harmless imported `List.map` template instance | Compiler exit 0/unsafe verdict; shared strict helper rejected |
| Each required file and each baseline law, proof or SPEC row omitted | Corresponding inventory rejection |
| Deliberately failing child and timed-out child | Not established by this proof-controls artifact; benchmark/native-memory controls are recorded separately below |

Underlying diagnostic categories matter: a syntax error does not prove unsafe rejection. Tiny controls bypass only the five-name project inventory, not the strict verdict helper. The guard prevents accidental omissions; simultaneous rewriting of laws, SPEC and verifier baseline needs external contract review.

## Corpus accounting and byte boundary

Acquisition verified all 318 blobs at their pinned sizes/Git SHA-1 and recorded SHA-256. Strict UTF-8 decoding is `new TextDecoder('utf-8', {fatal:true, ignoreBOM:true})`; `ignoreBOM:true` preserves BOM data. Invalid-byte rejection and BOM-retention controls are required before parser results count. Fixture raw bytes must not be normalized, trimmed, replacement-decoded or deduplicated.

| Class | Inventory | Strictly decodable | Byte-excluded | Leading BOM among decoded |
|---|---:|---:|---:|---:|
| y_ | 95 | 95 | 0 | 0 |
| n_ | 188 | 176 | 12 | 1 |
| i_ | 35 | 22 | 13 | 1 |
| Total | 318 | 293 | 25 | 2 |

These byte inventory counts reconcile with passing Node/Bun/native conformance records: each has 293 String calls and 25 explicitly excluded byte fixtures, not 318 successful parser calls. All 95 y_ inputs succeeded; the 176 decoded n_ inputs returned structured errors and the 22 i_ inputs matched the explicit policy below. Native corpus calls passed in the canonical report; the largest observed fixture is 250,001 bytes.

Corpus limits are `Limits{1048576n,1024n,4096n,262144n,100000n,2097152n}`, deliberately distinct from default depth 128. The canonical report passed all 95 y_ successes, structured rejection of all 176 decoded n_ cases, and the explicit i_ policy: 11 decoded i_ cases accepted and 11 rejected; 13 i_ fixtures were byte-excluded. The depth fixture also passed under the corpus budget and failed under defaults. Resource-blocked y_ is untested/resource-limited, not success; n_ syntax/profile/resource categories remain separate.

Final backend accounting preserves all 318 names: 25 byte exclusions plus 293 attempted String cases. Every attempt had one acceptance or structured rejection; no crash, timeout or harness failure occurred. Invalid UTF-8 exclusions do not assert Bend rejected those bytes.

## Runtime/property coverage and canonical evidence

- Directed host matrix passed: every root type, EOF/literals, exact whitespace, complete/invalid numbers, every raw/escaped control, Unicode edges/pair precedence, all container grammar states, suffixes, duplicates/special keys, original codepoint offsets, BOM/strict byte boundary, forged payloads, each limit at L−1/L/L+1 plus zero/cap+1, exact output capacity and long late failure.
- Independently generated ASTs: xorshift32 seeds `0x00000001`, `0x82590001`, `0xC0FFEE01`, 1,000 each; depth 6, 128 nodes, 8 entries/items, 64 decoded scalars per string/key, 64 characters per number. Validate fixture bounds before calling the library. Property limits are `Limits{131072n,16n,128n,128n,256n,131072n}`.
- Iterative exact AST comparison must preserve member order/duplicates, decoded strings and exact number lexemes, and itself handle large trees. Include accepted-text roundtrips, legal whitespace and equivalent string escape transformations.
- Host JSON oracle only for independently generated canonical safe integers (not negative zero), scalar strings and unique non-index `k:` keys. Fractions/exponents, huge numbers, duplicates and special keys use direct AST/text assertions.
- Mutations: 2,048 deterministic cases, seed `0x8259F00D`, 65,536 source-codepoint cap, 5 seconds/case, 10 minutes/campaign/backend. Guaranteed-invalid and semantics-preserving groups have explicit expectations; unconstrained edits require bounded execution and accepted-result roundtrip consistency unless the restricted oracle applies. Minimize failures deterministically while preserving the predicate and retain origin/seed/hash.
- Canonical native directed/corpus/generated/mutated/construction replays passed through the bounded orchestration using two build/run batch slots plus four text slots, deterministic input paths and reaped in-flight children. The strict first-64 generated-case replay passed three times after flushed START/END diagnostics. Construction batches used 63 pipelines for 3,000 independently generated ASTs; the test-only iterative equality driver used at most `8 * max_output + 1` steps for encoded-in-budget trees.

Each combined 6,071-case host artifact contains the original 4,022 regression/corpus/property cases plus 2,048 mutations and one mutation byte-boundary case. Original shared-host coverage is 262 directed, 42 standalone-number, 88 encode, 318 corpus-accounting, 3,000 generated, 300 restricted-oracle and seven large cases; one each for API, bytes, corpus policy, harness and comparator. Native replay accounting has 92 encode cases, including four native-only extras, so those counts are not interchangeable. Every host result passed. This includes actual large JSON execution, not just Gate A primitives. Generated cases and the comparator are finite evidence, not additional formal laws.

Host workers must emit a flushed start/result pair per case and one consistent summary; supervisors enforce ordering/counts/exit, 5-second case deadlines and 120-second initial loader allowance. They must terminate and reap timeout children, not leave services running. A recursive host serialization of large Bend lists is not allowed.

Native protocol is `PARSE_DONE`, `PARSE_FAIL<TAB>CODE<TAB>OFFSET`, `DONE<TAB>COMPACT_JSON` or `ENCODE_FAIL<TAB>CODE<TAB>OFFSET`, one newline-terminated response. Native file/argument/effect errors exit nonzero and remain harness failures. Handles must close even on read failure. Native malformed Char construction may trap before the library: disclose that boundary rather than claiming structured encoder rejection.

## Runtime memory and dispatch diagnosis

The final combined real-preloaded workers include the compiler/import lifecycle and ran all suites together without explicit collection, private cache clearing, baseline subtraction or a separate compiler. Per-case RSS samples (6,071 each) reached **385,204,224 bytes on Node** and **268,009,472 bytes on Bun**. During all 2,048 mutation cases the respective maxima were **385,204,224** and **267,943,936** bytes, below the 536,870,912-byte ceiling.

These are sampled maxima, not continuous peak bounds. The independent supervisor recorded no in-campaign Node or Bun samples (`enforcement: "unverified"`, `samples: 0`); do not upgrade per-case observations into a claim of continuous enforcement or an allocation-safety guarantee.

Earlier high-RSS 4,022-case runs and separate compiler-produced mutation experiments are historical diagnosis, not the supported verification route. Compiler globals remain resident, but they did not require separation after the project dispatch fix. The actionable pin-specific contributor rule is to destructure `Char`, compare U32 values through intrinsics and dispatch on Bool/private classifications rather than U32 literal patterns in hot compilable state machines; keep structural Nat patterns. The 104,541-entry queue/7,638 hot `queue.shift` samples and recovered 3.84-second native smoke ground this rule; no upstream modification or universal language restriction is implied.

[`native-memory-control-diagnostic.json`](../artifacts/native-memory-control-diagnostic.json) records the native supervisor's independent RSS negative control using a disposable Node child, not a native JSON run. A touched 629,145,600-byte allocation crossed the 536,870,912-byte limit: seven 25 ms samples reached 672,940,032 bytes; the child was killed and reaped with SIGKILL in 189.2885 ms. This proves observed supervisor enforcement/reaping, not allocation safety, native parser execution or zero overshoot.

Canonical native RSS sampling covered 2,047 of 2,048 mutation invocations (one unobserved), with 2,047 samples and a maximum of 1,392,640 bytes against the 536,870,912-byte production ceiling. This is sampled RSS, not an exact continuous peak or allocation-safety guarantee. Distinct 64 MiB/128 MiB controls passed; the 629,145,600-byte independent allocation control remains a separate supervisor negative control.

## Benchmarks

`artifacts/bench.json` (dated 2026-09-20) records actual timings for 31 deterministic families/sizes × five operations (`parse`, `encode`, `equality`, `materialize-ast`, `materialize-text`) on each Node, Bun and CPU-native lane: 155 measurements per lane, 465 total. Each case used five warmups and 20 samples. Required families were covered: ASCII and escaped/Unicode strings at 1,024/4,096/16,384/65,536/100,000 scalars; wide arrays at 128/512/2,048/8,192/32,768 and 100,000 values; depths 1/8/32/64/D−1/D; and mixed Unicode/number records at 16/64/256/1,024. D+1 remains a limit regression, not a throughput point.

| Representative fixture | Node parse | Bun parse | Native parse | Node encode | Bun encode | Native encode |
|---|---:|---:|---:|---:|---:|---:|
| ASCII, 100,000 scalars | 37.3421 | 85.01744 | 3.890625 | 32.80702 | 75.30912 | 2.6640625 |
| Wide array, 100,000 values | 99.46131 | 283.04158 | 18.5625 | 78.29123 | 167.41731 | 8.375 |

Fixture generation, strict UTF-8 decoding, file I/O, loader/compiler/process startup and correctness checks were outside timed calls. Host eager ABI conversion was inside core calls. Native parse/encode included full result traversal; traversal was measured separately. Equality was the test-only iterative comparator, not a public library API. Reported medians are per-call values after native batching; native `IO.now()` calibration targeted at least 100 ms and capped batches at 1,024 iterations. The artifact marks 83 of 155 native measurements below target precision and 10 below clock resolution, so those flags are not silently converted into precision or throughput claims.

All 75 increasing-size pairs in Node and Bun have no greater-than-2× normalized growth signal. Native has 72 such pairs and three depth pairs below clock resolution. This is finite campaign diagnostics, not a universal linear-complexity or throughput proof. The complete benchmark campaign elapsed 597,546.447625 ms (about 597.5 s), close to its 600,000 ms deadline. Host RSS snapshots reached 343,228,416 bytes on Node and 331,808,768 bytes on Bun in this benchmark; these are sampled snapshots, not continuous peak RSS or enforced bounds. Native RSS was unmeasured.
The benchmark's passing native lane demonstrates benchmark-driver execution only; the canonical native report separately establishes the complete local native gate. The strict 64-case replay passed three times after flushing diagnostic markers (`897.4 ms`, `26.7 ms`, `23.2 ms`), with no timeout relaxation, smaller batch substitution or 330-second timeout; the watchdog control remains a separate 5-second deadline check.
The canonical integrated report [`artifacts/verification.json`](../artifacts/verification.json) passed all six gates and ran from `2026-09-21T08:14:53.445Z` to `2026-09-21T08:23:40.858Z` (527.413 s). Native benchmark success and native verification are distinct evidence: the former is the 465-measurement timing artifact, while the latter is the required 12,458-invocation campaign.

`artifacts/release-summary.json` is the compact derived canonical report (`SHA-256 23d08c2b58cfe30bd4480b0806df7057fe2fab36b04f7c63de96b782aa36c958`); `artifacts/cleanup.json` records the verified diagnostic archive and retained canonical reports/inputs. Archived diagnostic scripts are historical evidence, not current runnable commands.

## CI execution evidence

`.github/workflows/verify.yml` is required to use ordinary `ubuntu-24.04`/`macos-15` jobs, triggers `push`, `pull_request`, `workflow_dispatch`, `permissions: contents: read`, `timeout-minutes: 45`, and `BEND_NO_TELEMETRY=1`. Both jobs select Node 26.9.0/Bun 1.4.2, run setup and then `verify --native=required`.

Immutable action pins:

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`

Linux used exact noble package `clang-18=1:18.1.3-1ubuntu1` with `CC=/usr/bin/clang-18`; macOS used the selected Apple Clang/image. Private push-triggered run [`35589618477`](https://github.com/ShivamB25/bend-json/actions/runs/35589618477) verified commit `a3b1a64`: `verify (ubuntu-24.04)` and `verify (macos-15)` both completed successfully. The run retained the no-cache, no-publishing-permissions, no-cluster/GPU and no-warning-suppression boundaries.

## Pinned source/evidence table

All source-review entries below are dated 2026-09-19. Source review establishes design constraints, not production runtime correctness. Issue closure alone is not evidence that a limitation was fixed.

| Claim | Pinned source / issue | Local result or command | Design consequence |
|---|---|---|---|
| Tail-safe JS design still matters | [WONTFIX](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/WONTFIX.txt), [#798](https://github.com/bendlang/bend/issues/798), [#802](https://github.com/bendlang/bend/issues/802) | Source says non-tail continuation work unresolved; `node scripts/probe.mjs` passes structural drivers/reversal through 262,144 | Explicit consuming/tail drivers and iterative host comparisons; no generic recursive folds |
| Unbalanced Base Array traps | [WONTFIX](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/WONTFIX.txt), [#808](https://github.com/bendlang/bend/issues/808) | Pinned text describes fail-stop, not repaired balance | JSON Array holds Base List, not arbitrary Base array trees |
| Native pure-library ABI unavailable | [WONTFIX](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/WONTFIX.txt), [#813](https://github.com/bendlang/bend/issues/813) | Planned/not scheduled; Gate A compiles and executes an IO main | CPU IO consumer rather than invented C library exports/FFI |
| Binary file additions shipped | [2.0.13 changelog](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/CHANGELOG.md), [#823](https://github.com/bendlang/bend/issues/823) | Source records File.read_at/File.size/File.write_bytes; no byte-API library result claimed | File.size supports the test driver; public bytes remain deferred |
| BOM survives instead of being stripped on JS | [2.0.13 changelog](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/CHANGELOG.md), [#833](https://github.com/bendlang/bend/issues/833) | Two retained BOM fixtures and actual Node/Bun profile rejection passed | Strict BOM-preserving host decoding and explicit parser rejection |
| Unsafe/template terms can check with exit 0 | [main.ts](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/main.ts), [2.0.16 changelog](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/CHANGELOG.md) | Source book_read/cli_report/book_run/cli_fail; isolated explicit-unsafe/template controls observed exit 0 and were rejected by strict gate | Exact verdict plus separate inventory; no unsafe/templates |
| Host representation differs from source notation | [comp.ts](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/comp.ts), [main.ts](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/main.ts) | Gate A default export/dotted key/BigInt/list/result/ADT assertions passed | Document and test real loader ABI; no named-import fiction |
| Base primitives are reusable but whitespace is broader | [base.bend](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/base.bend) | Selected-source String/List/Char/Result review and reversal probe | Reuse reverse; JSON-specific four-character whitespace predicate |
| Nat runtime has 48-bit ceiling | [WONTFIX](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/WONTFIX.txt), [comp.ts](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/comp.ts) | Source review; probe cap/cap+1 comparison succeeds inside host ABI | Host input prerequisite plus much smaller 16,777,216 limit cap |
| Project U32 dispatch caused native expansion | Pinned [comp.ts](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/comp.ts), Main's inspector queue/CPU profile | 104,541 queue entries at `Num.class`; 7,638 `queue.shift` samples; project intrinsic/private-ADT fix restored 3.84-second compile/roundtrip smoke | Avoid this literal dispatch at this pin; retain structural Nat patterns and ordinary combined preloaded host workers; no compiler edits |

## Trust and review boundaries

The checker, imported Base statements, compiler lowering/optimizations, host loader, JS/native runtime representations, Unicode conversion and allocation are trusted. Checked pure laws are not a proof of the external hosts or unlimited memory/stack availability. Native effects/file decoding and compiler construction traps have separate boundaries.

The harness trusts strict decoding, hash verification, deterministic generators, iterative comparators, deadlines, process reaping and event accounting; self-tests reduce but do not eliminate that trust. Host JSON.parse is only a restricted independent oracle. Corpus evidence is finite and profile-specific. Measured behavior on this Apple M2 is not a portable throughput guarantee or proof of every custom budget.

The law inventory's immutable baseline is a review commitment: rewriting laws, specification and verifier together can defeat a same-repository guard. No gate may silently drop an obligation, fixture, backend failure or performance failure to become green. Local acceptance and the recorded private cross-platform CI run are complete; preserve the exact commit/run boundary and record any future unresolved blocker explicitly in STATUS.
