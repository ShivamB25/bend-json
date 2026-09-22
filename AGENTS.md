# Bend JSON development

## Scope and authoritative files

This is an original pure Bend 2.0.16 JSON library. Preserve the supplied project directory, `.codegraph/`, raw fixture bytes and unrelated user work. Read `SPEC.md`, `LAWS.bend` and `STATUS.md` before any behavioral change. `SPEC.md` freezes the four supported API definitions, representations, error constructors/precedence, resource units/defaults and formal inventory. Do not weaken it to make code pass.

Do not copy another JSON implementation, add host JSON fallbacks, fork/modify the compiler, contact maintainers, or import upstream cluster/release infrastructure. No HTTP/router/TLS/database/schema/JSONPath/derive/LSP/framework or GPU-parsing scope. The only package-manager scope is the owner-authorized, dev-only strict TypeScript harness gate pinned in `package.json` and `bun.lock`; it must never become a production parser dependency. Later typed decoders and byte/incremental APIs are roadmap, not unfinished v0.1 deliverables.

## Private GitHub repository and licensing

This repository is authorized for the private GitHub destination `https://github.com/ShivamB25/bend-json`. Configure only `origin` to that exact URL and push only while GitHub reports `PRIVATE` visibility. Do not add another remote, change visibility, publish a public package/release, upload generated artifacts, or otherwise distribute the repository unless the owner explicitly authorizes it. `.gitignore` reduces accidental inclusion of local credentials and generated state, but it does not control remote visibility or protect already tracked content. Never commit secrets.

Original project source and documentation are licensed under the MIT License in `LICENSE.md`, Copyright (c) 2026 Shivam Bansal. The vendored JSONTestSuite bytes retain their separate upstream MIT notice at `tests/fixtures/JSONTestSuite/LICENSE`, Copyright (c) 2016 Nicolas Seriot. Do not replace, merge or remove that fixture notice. Ignored upstream tooling under `.tools/` retains its own licensing and is not part of this repository's tracked source.

## Pinned language and tools

Use Bend source `15ae0c86f3193b8f645b4bedbc438655b648d0da`, Node 26.9.0, Bun 1.4.2, TypeScript 7.0.2 and `@types/node` 26.6.2. Install only the locked dev tooling with `bun install --frozen-lockfile`; type-check the Node/Bun harness with `bun run typecheck`. Run the selected Bend source's guide and inspect actual Base definitions before coding; never invent helpers or rely on a different Bend generation:

```sh
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts guide
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts base String
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts base List
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts base Char
BEND_NO_TELEMETRY=1 bun --no-install .tools/bend/bend2/main.ts base Result
```

The initial installed `BEND_NO_TELEMETRY=1 bend guide` and pinned source/Base review were already performed. Reinspect only the relevant sections unless the pin changes. `.tools/bend` is normally selected; substitute `.tools/bend-15ae0c86`/`BEND_REF` consistently if setup selected another checkout. Use `scripts/tools.ts` for script path/version resolution. Never reset a preexisting checkout, silently upgrade runtimes, or edit upstream `bend2/bend.ts`/Base/compiler files.

Preserve source-selection controls for dirty default checkout, fallback and explicit override. They must not reset or alter source files. Offline fixture verification must validate all raw bytes, retained tree and license and reject corruption. Retain original Git `100644`/`100755` fixture modes in `tree.json` solely for tree-hash reconstruction; never execute fixture data or chmod it to match upstream modes.

Prefer semantic/MCP/native tools. Initial codegraph discovery had no indexed source and did not establish Bend coverage. Bend has no supported Serena language server: use exact-file reads, pinned compiler/Base introspection and anchored edits; never fake language support. Main subsequently activated Serena on this project with a real TypeScript server and verified symbols in `scripts/tools.ts`; use that supported route for TypeScript intelligence. The generic `xd://lsp` status reported no configured servers. No onboarding/memory write is needed. Consult pinned primary sources for contradictions; Firecrawl Developer Index is an issue/release fallback, not permission to substitute an unrelated JSON implementation.

## Ownership and implementation invariants

One integration owner controls `json.bend` and API/SPEC decisions. Assign independent files explicitly; do not overwrite a sibling's work. Proof workers own LAWS/PROOF; verification workers own scripts/tests/fixtures/CI; documentation ownership may be separately assigned. Concurrent workers skip builds, tests, linters and formatters; the integration owner validates once their changes settle. Parallel runtime work needs measured benefit and balanced scheduling, not assumed acceleration.

- The runtime graph is pure and imports no proofs. `json.bend` has no main, effects or host parser.
- Bindings are affine by default; mark reusable Data explicitly. Match parameters in binder order. Pass computed values through helper parameters before matching. No mutual recursion.
- Parser recursion consumes one structural String tail per edge, carries failures immediately, and dispatches a terminating number delimiter once. No unchanged-input recursion or generic parser fuel.
- Encoder recursion decreases public output credit and emits exactly one codepoint per edge. Recognize completion before zero-credit failure. Administrative helpers form a bounded acyclic path, never call back into the driver. Shared number validation is independently bounded.
- Reuse ordinary checked Base `String.reverse`/`List.reverse`. Never append to growing prefixes, repeatedly split/take remaining input, or introduce needless copies/abstractions.
- At the pinned Bend 2.0.16 revision, avoid U32 literal-pattern dispatch in hot compilable state machines: destructure `Char`, use intrinsic U32 comparisons with Bool branches or a private classification ADT, and retain structural Nat patterns for termination. Our former dispatch expanded the native compiler queue to 104,541 entries at `Num.class`; `queue.shift` accounted for 7,638 CPU samples. The project-only change restored a 3.84-second native JSON compile/roundtrip smoke. This is a measured pin-specific invariant, not a universal ban on literal patterns or permission to modify upstream.
- Preserve number lexemes, ordered duplicates, scalar Unicode/BOM policy and original codepoint offsets. Do not convert through machine numbers or host maps.
- Check all limits before arithmetic and capacity before the next charged allocation. Keep counters bounded by the cap plus one. No silent default reduction, extra member knob, null substitution, partial encoding success or host-type promise beyond the documented ABI.

## Immutable-by-default law and gate policy

The five obligations in SPEC are authorized agent-authored release requirements. Never remove, narrow, move out of the gate, bypass or special-case them to obtain green results. No holes, `?TODO`, open future axioms, unsafe annotations or template-generated unsafe instances in the release proof graph. Raw constructor visibility does not permit primitive-specific roundtrip shortcuts.

`LAWS.bend` owns the claims; root `PROOF.bend` explicitly imports `./LAWS.bend`, defines every corresponding qualified `Laws.Json.*` proof and has no `main`. Runtime library never imports proofs. Public roundtrips call encode once then parse under fixed adequate limits and preserve both error layers. Reversal uses an independent proof-only recursive specification tied to the Base finalizer used by the runtime.

Safe checking requires **all** of: exit 0, no signal/timeout, stdout exactly `All terms check.\n` after CRLF normalization, and empty stderr. Exit 0 or substring matching is insufficient. Both singular/plural unsafe verdicts fail. Use 30-second checking deadlines and 1 MiB diagnostic caps; diagnose cost rather than blindly extending timeouts or shrinking coverage. Never use `--checkup` or invent a proof flag.

Inventory checking must require all files, the exact five SPEC ID/name rows, law declarations, matching qualified proofs and direct laws import; compare every release-law declaration against the table. Preserve isolated positive/negative controls for omitted imports, unfilled laws, explicit holes, false equality, explicit unsafe, generated unsafe template instances and removed file/law/proof/table inventory. Assert the actual failure category so malformed syntax cannot masquerade as unsafe enforcement. Do not break the real tree for controls. Coordinated law/SPEC/verifier-baseline rewrites cannot be prevented by that same script: contract changes require explicit review.

## Required commands and evidence

```sh
bun install --frozen-lockfile
bun run typecheck
node scripts/setup.ts
node scripts/probe.ts
node scripts/verify.ts --proofs
node scripts/verify.ts --proof-gate-selftest
node scripts/verify.ts
node scripts/verify.ts --native=required
node scripts/bench.ts
```

The production/proof/example path is Bend-first:

```sh
bend json.bend
bend PROOF.bend
bend examples/basic.bend
```

`examples/host.ts`, `tests/*.ts` and `scripts/bench.ts` are cross-backend test/benchmark orchestration only; `scripts/setup.ts`, `probe.ts` and `verify.ts` coordinate prerequisites and gates. None may become the production parser, proof substitute or generated-bundle replacement. When reproducible source selection is required, use the selected pinned checkout consistently.
Only observed results are evidence. See STATUS/VERIFICATION before claiming a gate passed. Keep stdout/stderr/status/signal/timeout distinct. Do not suppress the known upstream Node `module.register()` warning from the pinned loader ([`bend2/main.ts` lines 604–625](https://github.com/bendlang/bend/blob/15ae0c86f3193b8f645b4bedbc438655b648d0da/bend2/main.ts#L604-L625)); Node's current [`module.registerHooks()`](https://nodejs.org/docs/latest/api/module.html#moduleregisterhooksoptions) API is not a compatible drop-in replacement at this pin. No compiler fork or warning suppression is authorized, and Bend/native production paths do not require Node. Strict empty-stderr proof checking applies to the Bun no-main checks, not indiscriminately to Node loader stderr. No native skip when an available compiler actually fails. CPU-native execution uses Clang, `--threads 1 --gpu off`, never GCC/FFI/GPU shortcuts or checker-normalized values instead of execution.

Use one finite real-preloaded Node/Bun worker per runtime for regressions, corpus, properties and all mutations. The 2026-09-21 combined route passed 6,071 cases each (6,073 after the later ABI regression controls) without explicit collection, compiler separation or separate bundle machinery. Do not edit the compiler, clear private caches, add GC helpers or subtract an import baseline. Final per-case RSS samples reached 396,607,488 bytes on Node and 270,581,760 bytes on Bun; both in-campaign supervisor enforcement lanes were unverified (`samples: 0`). Report sampled observations separately from continuous-peak claims.

The 2026-09-21 acceptance evidence includes a passing strict TypeScript 7.0.2 gate, all five safe root proofs, all 33 controls, 6,071 combined real-import cases per host, strengthened native Gate A, the 465-measurement Node/Bun/native benchmark campaign and the final required-native campaign. All six integrated verification gates passed on that date; the current tree's required-native gate has not yet passed (see STATUS, Current tree). The strict first-64 generated-case replay also passed three times after START/END diagnostics were flushed; no timeout relaxation, smaller batch substitution or 330-second timeout was used. Private CI run `35606110009` passed Ubuntu 24.04 and macOS 15 for TypeScript migration commit `76eace7`; see STATUS for the exact boundary. Run `35769222512` also passed both platforms for `e21de47`. The later per-call ABI validator's local required-native gate is open: its host suites passed 6,073 cases per runtime, but a native construction compile timed out under swap exhaustion (STATUS, Current tree).

The canonical required-native report records 12,458 invocations, 65 builds, 63 construction batches, 3,000 native ASTs, 92 encode cases (88 shared plus four extras), 42 number cases, three malformed parses, 259 directed texts, 9,000 generated text transforms, 300 common-oracle cases, 2,048 mutations, seven large cases, and native corpus accounting of 318 fixtures/293 calls/25 byte exclusions. RSS sampling covered all 2,048 mutation invocations, with 2,048 samples and a maximum of 1,392,640 bytes against the 512 MiB production ceiling; distinct 64 MiB/128 MiB controls passed. These are sampled RSS observations, not exact continuous peaks.

Preserve all 318 corpus names/raw byte hashes and the MIT license. Strict UTF-8 decode uses `{fatal:true,ignoreBOM:true}`; invalid-byte exclusions are not parser successes. Report syntax/profile/resource rejection separately. A resource-blocked y_ case is not a pass; all 95 must succeed. Host comparisons are iterative and preserve duplicate/order/number-text semantics. Host `JSON.parse` is an oracle only in the independent restricted common domain, never production implementation.

Finite tests and benchmarks are not universal theorems. Report actual backend/version/limit/measurement conditions and trust boundaries. Keep docs and evidence current only after commands complete; no fabricated successful output, performance precision, memory enforcement or CI execution claim. A v0.1 without all five safe discharged obligations remains incomplete even if runtime tests pass.
