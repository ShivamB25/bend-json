# Current status

Evidence cutoff: 2026-09-21. **Bend JSON v0.1 acceptance is complete for the approved Bend 2.0.16 pin.** The pure implementation, frozen API, five safe proofs, 33 proof controls, both 6,071-case host suites, examples, benchmark campaign, canonical native campaign and private Ubuntu/macOS CI passed. No public release/package has been performed.

**Repository policy:** the authorized destination is the private GitHub repository `https://github.com/ShivamB25/bend-json`; only that private `origin` may receive pushes. Additional remotes, visibility changes and public packages/releases require explicit authorization. The original project is MIT-licensed in `LICENSE.md`. Vendored JSONTestSuite fixtures retain their separate upstream MIT notice and attribution in `tests/fixtures/JSONTestSuite/LICENSE`.

## Validated evidence

1. **Pinned setup and strengthened Gate A passed.** Bend 2.0.16 at `15ae0c86f3193b8f645b4bedbc438655b648d0da`, Node v26.9.0, Bun 1.4.2, Apple Clang 21.0.0 (`clang-2100.1.1.101`), Apple M2/arm64. Real imports/ABI and primitive String/List work through 262,144 passed. Native now executes consuming computed-state and output-budget loops, carried failures, zero/exact capacity and reversals; Main observed the strengthened gate complete in 3.46 seconds. Evidence: `artifacts/probe.json`.
2. **Fixture integrity and source selection passed.** All 318 JSONTestSuite blobs at commit `1ef36fa01286573e846ac449e8683f8833c5b26a`, parsing tree `b936f9acdd24b9f5fefe68b90b9beab2c681137a`, are retained with manifest, original LICENSE and `tree.json`. Original Git `100644`/`100755` modes are provenance for tree hashing only; never execute/chmod data. Main observed offline byte/tree/license verification and corruption rejection, plus dirty-default/fallback/explicit-override controls preserving compiler source files.
3. **All five root obligations and 33 enforcement controls passed.** `node scripts/verify.mjs --proofs` produced exact safe `All terms check.\n` and empty stderr for `json.bend` and `PROOF.bend`; inventory passed. `node scripts/verify.mjs --proof-gate-selftest` passed all 33 controls. Evidence: `artifacts/proofs.json`, `artifacts/proof-gate-selftest.json`. These prove the five stated claims, not general JSON soundness or roundtrips.
4. **Combined actual-import host suites and examples passed.** Each real-preloaded Node/Bun run passed 6,071 cases with zero failures: regressions, all 318 corpus records (293 String calls and 25 byte exclusions), 3,000 independently generated ASTs, 300 restricted-oracle cases, seven large-input cases, all 2,048 mutations and the mutation byte-boundary case. All 95 y_ cases succeeded. Evidence: `artifacts/combined-node.json`, `artifacts/combined-bun.json`. No explicit collection, separate compiler or generated-worker route was needed. Main also observed Bend/Node/Bun nested examples preserve `-1.5e+2` and encode decoded `A`.
5. **Native JSON campaign and benchmark campaign passed their named slices.** Main observed the complete native JSON driver compile and execute an empty-array roundtrip (`DONE` plus `[]`) in 3.84 seconds, and the native benchmark driver compiled in 2.49 seconds. `artifacts/bench.json` records 155 measurements each for Node, Bun and native (31 families/sizes × five operations, five warmups and 20 samples). The canonical native report separately records the complete native gate.
6. **Memory/watchdog controls passed with explicit boundaries.** The independent supervisor allocation control crossed 512 MiB, sampled 672,940,032 bytes, and was killed/reaped with SIGKILL in 189.2885 ms (`artifacts/native-memory-control-diagnostic.json`). Canonical native RSS sampling covered 2,047 of 2,048 mutation invocations (one unobserved), 2,047 samples and a 1,392,640-byte maximum against the 512 MiB ceiling; distinct 64 MiB/128 MiB controls passed. These are sampled observations, not exact continuous peaks or allocation-safety guarantees. Benchmark host RSS remains a separate sampled snapshot record; native benchmark RSS was unmeasured.

Final combined-worker per-case RSS maxima were 385,204,224 bytes on Node and 268,009,472 on Bun, all below 536,870,912 bytes. Both in-campaign supervisor enforcement lanes were unverified (`samples: 0`); these are sampled maxima, not continuous bounds. The compiler/import footprint remains included without baseline subtraction. Node's upstream `[DEP0205] module.register()` warning is retained. Earlier 4,022-case/separate-worker artifacts and high RSS observations are historical, not the current route.

The final canonical report records 12,458 native invocations, 65 builds, 63 construction batches, 3,000 native ASTs, 92 encode cases (88 shared plus four native-only), 42 number cases, three malformed parses, 259 directed texts, 9,000 generated text transforms, 300 common-oracle cases, 2,048 mutations, seven large cases and the default-depth case. Native corpus accounting is 318 fixtures, 293 calls, 25 byte exclusions, 95 y_ accepts, 176 n_ rejects and 22 decoded i_ cases (11 accepts, 11 rejects).

## Measured benchmark campaign

`artifacts/bench.json` reports these representative parse/encode medians in milliseconds:

| Fixture | Node | Bun | Native |
|---|---:|---:|---:|
| ASCII, 100,000 scalars, parse | 37.3421 | 85.01744 | 3.890625 |
| ASCII, 100,000 scalars, encode | 32.80702 | 75.30912 | 2.6640625 |
| Wide array, 100,000 values, parse | 99.46131 | 283.04158 | 18.5625 |
| Wide array, 100,000 values, encode | 78.29123 | 167.41731 | 8.375 |

Native calibration targeted 100 ms and capped batches at 1,024; below-target and clock-resolution flags remain explicit. Across 75 size-growth pairs per lane, Node/Bun had no greater-than-2× normalized signal; native had 72 such pairs and three below-clock-resolution depth pairs. These finite results do not prove throughput or universal linear complexity. The strict replay of the first 64 generated cases passed three times after diagnostic-marker flushing (`897.4 ms`, `26.7 ms`, `23.2 ms`; [`focused-native-uBBXCx/results.json`](artifacts/focused-native-uBBXCx/results.json)); no timeout was relaxed, no smaller batch was substituted and no 330-second timeout was introduced.

## Final local acceptance

`artifacts/verification.json` has status `pass` for all six gates: `proofs`, `proof-gate-selftest`, `supervisor-selftest`, `host-node`, `host-bun` and `native`. It started at `2026-09-21T08:14:53.445Z`, finished at `2026-09-21T08:23:40.858Z`, and ran for 527.413 seconds. Both host workers passed 6,071 cases with zero failures. No native or benchmark work remains locally.

Private push-triggered CI run [`35589618477`](https://github.com/ShivamB25/bend-json/actions/runs/35589618477) verified commit `a3b1a64`: Ubuntu 24.04 and macOS 15 both completed setup, strengthened Gate A and `verify --native=required` successfully. Main retained canonical local reports, native failure/interrupted inputs and the verified diagnostic archive. Private repository hosting and CI success are not a public release.

## Diagnosis

The earlier native C-emission timeouts came from U32 literal-pattern expansion in our Bend dispatch. Main's inspector observed a 104,541-entry queue at `Num.class` and 7,638 hot `queue.shift` CPU samples. Intrinsic U32 comparisons and a private `NumClass` ADT removed this project defect without upstream edits, API/default/law changes or compiler separation. Root five-proof checking passed again in 1.01 seconds. Retain structural Nat patterns; this diagnosis concerns the pinned compiler and measured dispatch, not a blanket language restriction.

## Gate status

| Gate | State |
|---|---|
| B: frozen API, five safe obligations, nested slice | Passed |
| C: complete grammar/encoder finite coverage | Node/Bun/native canonical campaign passed |
| D: independent runtime/resource evidence | Final integrated report passed host-node, host-bun and native gates |
| E: examples and measured delivery | Examples, benchmark campaign and final evidence promotion passed locally |
| CI | Private run `35589618477` passed Ubuntu 24.04 and macOS 15 for commit `a3b1a64` |

## Commands and source pointers

```sh
node scripts/setup.mjs
node scripts/probe.mjs
node scripts/verify.mjs --proofs
node scripts/verify.mjs --proof-gate-selftest
node scripts/verify.mjs
node scripts/verify.mjs --native=required
node scripts/bench.mjs
```

Setup/probe, both restricted proof commands, the final integrated local verification and private push-triggered CI passed. `artifacts/verification.json` is the canonical local acceptance report; GitHub run `35589618477` is the cross-platform CI record.

- [SPEC.md](SPEC.md): exact API/types/errors/offsets/limits, five formal rows, twelve behavior IDs and roadmap.
- [README.md](README.md): pinned setup/import/ABI, runnable examples and supported behavior.
- [AGENTS.md](AGENTS.md): ownership, termination, immutable laws, strict gate and evidence rules.
- [docs/VERIFICATION.md](docs/VERIFICATION.md): precise commands, artifacts, corpus/memory/benchmark/CI boundaries and source links.
- `json.bend`, `LAWS.bend`, `PROOF.bend`: pure runtime and separate proof graph. `scripts/tools.mjs`: selected pinned paths and strict checking.

Default profile remains `Limits{1048576n,128n,4096n,262144n,100000n,2097152n}`. The 16,777,216 custom-limit cap is not a memory-safety promise. No source/contract weakening, silent default reduction or public release/package claim is authorized.
