# Bend JSON v0.1 contract

Status: v0.1 acceptance is complete for the approved Bend 2.0.16 pin. Setup/probe, all five safe root obligations, 33 proof controls, Bend/Node/Bun examples, both 6,071-case combined real-import host suites, the canonical native campaign and private Ubuntu/macOS CI passed as of 2026-09-21; the later per-call ABI validator's required-native gate is open (STATUS, Current tree). The GitHub repository is private and no public release/package has been performed. See [STATUS.md](STATUS.md) and [verification evidence](docs/VERIFICATION.md). Finite host results and benchmark diagnostics are not universal grammar, roundtrip or complexity proofs.

## Representation and supported API

The production module is `json.bend`, imports Base, has no `main`, and contains no effects or proof imports. All public records are reusable `Data`.

```bend
type Member<-A: Data> is Data:
  Member{key: String, value: A}

type Json is Data:
  Null{}
  Boolean{value: Bool}
  Number{text: String}
  Text{value: String}
  Array{items: List<&2, Json>}
  Object{members: List<&2, Member<Json>>}

type Limits is Data:
  Limits{max_input: Nat, max_depth: Nat, max_number: Nat, max_string: Nat, max_values: Nat, max_output: Nat}
```

The supported API consists of exactly these four definitions:

```text
Json.parse(text: String, limits: Limits) -> Result<&2, &2, ParseError, Json>
Json.encode(value: Json, limits: Limits) -> Result<&2, &2, EncodeError, String>
Json.number(text: String, limits: Limits) -> Result<&2, &2, ParseError, Json>
Json.default_limits() -> Limits
```

Base results are `Done{value}` or `Fail{error}`. `Json.number` accepts precisely one JSON number lexeme, without surrounding whitespace. It shares the parser's number DFA, not the document parser. Raw constructors remain usable: encoding revalidates number spelling and string/key scalars. Internal dotted helpers may be visible through the host loader, but are not supported API. There is no map representation, public equality helper, machine-number conversion, constructor privacy, host JSON fallback or compatibility alias.

Objects preserve entry order and all duplicate decoded names. `{"a":1,"\u0061":2}` has two members with the same decoded key. Numeric-looking keys and `__proto__` are ordinary member strings. Numbers preserve every lexeme codepoint, including negative zero, uppercase `E`, explicit exponent signs and leading exponent zeros. Number preservation is not arbitrary-precision arithmetic.

## Grammar and Unicode profile

The parser consumes one complete RFC 8259 JSON document. Whitespace is exactly U+0020, U+0009, U+000A and U+000D. No comments, single-quoted strings, trailing commas, multiple documents, NaN, Infinity, hexadecimal notation, leading plus, leading integer zeros or additional whitespace characters are accepted.

Number grammar is `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`. Range and exponent magnitude do not require machine-number conversion: `281474976710656`, `1e400` and `1e-10000000` are valid within length limits. An illegal transition on the number alphabet (`0-9`, `+`, `-`, `.`, `e`, `E`) is `PInvalidNumber`; another character terminates an accepting number and is dispatched once as grammar input. Thus `01` is a number error, while `1x` is trailing content.

Strings and keys contain Unicode scalar values only. Raw U+0000–U+001F are rejected; escaped controls, including NUL, are retained. Raw surrogates and values above U+10FFFF are rejected. Escaped high/low surrogate pairs combine to one scalar. Lone, reversed and mismatched pairs fail. The pair formula is `65536 + (high - 55296) * 1024 + (low - 56320)` after validating both ranges; invalid `Char` values must not be constructed speculatively.

No normalization is performed: combining sequences remain distinct from precomposed text. DEL, Unicode noncharacters, U+2028/U+2029 and U+10FFFF are permitted inside strings. Leading U+FEFF is rejected at offset 0; quoted U+FEFF is an ordinary scalar. This String API does not validate byte encodings. Hosts handling bytes must first use strict decoding with BOM preservation; replacing invalid bytes or stripping the BOM changes the tested input.

Encoding is compact and deterministic: quote becomes `\"`, backslash becomes `\\`; backspace/formfeed/LF/CR/tab use `\b`, `\f`, `\n`, `\r`, `\t`; remaining controls use lowercase `\u00xx`. Slash and every other valid scalar remain literal. This is JSON encoding, not HTML or script-context escaping.

## Resource limits

All six fields are validated at every entry, including fields unused by that operation. Each accepts 0 through 16,777,216 inclusive; larger values fail before arithmetic. Zero is a real empty budget. Counters remain at most the cap plus one; structural Nat decrements and bounded increments are used, not arithmetic near the 48-bit runtime ceiling.

| Field | Unit and charging rule | Default |
|---|---|---:|
| `max_input` | Source codepoints, including whitespace and escape spelling | 1,048,576 |
| `max_depth` | Simultaneously open arrays/objects; scalar 0, empty container 1 | 128 |
| `max_number` | Number lexeme codepoints including sign, dot and exponent syntax | 4,096 |
| `max_string` | Decoded scalars in each individual string or key | 262,144 |
| `max_values` | Every value in preorder, including root/containers; keys excluded | 100,000 |
| `max_output` | Encoded codepoints including quotes, punctuation and escape expansion | 2,097,152 |

`Json.default_limits()` is `Limits{1048576n,128n,4096n,262144n,100000n,2097152n}`. Gate A supported these constants; final Node/Bun/native regression/property/resource evidence passed boundary and seven large-input cases, including 99,999 array elements plus the root. The measured benchmark campaign has 31 fixture/size cases × five operations on each Node, Bun and native lane (155 records per lane, 465 total), with five warmups and 20 samples. Native benchmark success is not by itself conformance evidence; the separate canonical report now records the complete local native gate. No automatic fallback or silent budget reduction is permitted.

Parse ignores output capacity. Encode ignores input capacity. The standalone number validator applies input, number and value limits. Every entry still validates all fields. Input/output and value budgets bound token storage and container width; there is no member-count setting. A surrogate escape pair counts as 12 source codepoints but one decoded scalar. Keys charge string/input/output budgets but not value count. Custom larger budgets within the cap are best-effort, not allocation or memory-safety guarantees.

## Errors, offsets and precedence

```bend
type ParseError is Data:
  ParseError{code: ParseCode, offset: Nat}

type EncodeError is Data:
  EncodeError{code: EncodeCode, offset: Nat}
```

Every code below is a stable nullary constructor. Error prose is not a test oracle. Parse offsets are zero-based original source codepoints; EOF is the full source length, not a UTF-16 code-unit/byte count or decoded-string length. Invalid limits have offset 0. A string-length overflow points to the source character/backslash producing the first excess decoded scalar. `PUnpairedSurrogate` points to the backslash starting the unmatched high escape or standalone low escape. For example, `"é"x` and `"😀"x` both fail with `PTrailingContent` at 3.

| Parse code | Dispatch |
|---|---|
| `PUnexpectedEnd` | Empty/whitespace-only document, incomplete literal/string/container, except the more specific EOF rules below |
| `PUnexpectedCharacter` | Unexpected value/key start, literal mismatch, raw string control, mismatched closer in an open-value/key state |
| `PExpectedColon` | Non-whitespace other than colon while awaiting an object colon |
| `PExpectedCommaOrEnd` | Illegal input after a completed array item/object member |
| `PInvalidNumber` | Invalid or incomplete number DFA; any lexical failure in `Json.number` |
| `PInvalidEscape` | Unknown simple escape |
| `PInvalidUnicodeEscape` | Invalid/incomplete four-digit `u` hex escape |
| `PUnpairedSurrogate` | Standalone low escape or missing/mismatched partner for a high escape |
| `PInvalidScalar` | Raw surrogate or out-of-range scalar |
| `PLeadingBom` | Leading U+FEFF |
| `PTrailingContent` | Non-whitespace after the root value |
| `PInputLimit` | Next source codepoint exceeds capacity |
| `PDepthLimit` | Opening another container exceeds simultaneous depth |
| `PNumberLimit` | Next number lexeme codepoint exceeds capacity |
| `PStringLimit` | Next decoded scalar exceeds this key/text capacity |
| `PValueLimit` | Next value, including root/container, exceeds capacity |
| `PInvalidLimits` | Any limit exceeds the cap |

For every next source codepoint, check input capacity first, scalar validity second, then the current grammar/token/depth/value constraint. Stop at the first failure; do not scan the suffix to prefer another error. Literals finish on their last letter; illegal later suffixes use document/container grammar codes.

At EOF, accepting number states finalize and nonaccepting number states yield `PInvalidNumber`. Incomplete hex yields `PInvalidUnicodeEscape`. A pending high surrogate takes precedence over ordinary EOF or a non-pair continuation before the low escape hex scan: return `PUnpairedSurrogate` at the saved high backslash. Once the low hex scan starts, bad/incomplete hex is `PInvalidUnicodeEscape` at its offending character/EOF. A complete second escape outside DC00–DFFF is `PUnpairedSurrogate` at the saved high backslash. Consequently an opening quote plus `\uD800` and EOF fails at 1 with `PUnpairedSurrogate`; adding `\u` before EOF fails at 9 with `PInvalidUnicodeEscape`.

`Json.number` maps all lexical failures, including whitespace/forbidden starts, to `PInvalidNumber`; scalar/resource failures retain their categories.

| Encode code | Category |
|---|---|
| `EInvalidNumber` | Malformed constructed `Number` lexeme |
| `EInvalidScalar` | Malformed constructed text/key scalar |
| `EDepthLimit` | Container entry exceeds depth |
| `ENumberLimit` | Constructed lexeme exceeds number capacity |
| `EStringLimit` | Key/text exceeds decoded scalar capacity |
| `EValueLimit` | Preorder value count exceeds capacity |
| `EOutputLimit` | Another output codepoint is required without credit |
| `EInvalidLimits` | Any limit exceeds the cap |

Encoder offsets count the prospective compact output prefix at failure; they are neither source offsets nor object paths. Errors return no output. At preparation, recognize completed work before capacity checking, so an exact-capacity result succeeds. Otherwise reject zero output credit before preparing/validating another character. Numbers are fully validated by the shared bounded validator before any of their lexeme is emitted. Depth/value checks occur on value entry; strings charge decoded scalars independently of escape expansion.

## Host ABI and bounds

The real loader returns a default object: call `Core["Json.parse"](text, limits)`, not named imports or `Core.Json.parse`. Nullary defs must be called. Strings/Chars are native JavaScript strings, Bool is a JavaScript Boolean and Nat is a nonnegative BigInt. Lists are `{$:"Nil"}` / `{$:"Con",head,tail}`; results are `{$:"Done",value}` / `{$:"Fail",error}`. Other ADTs use their constructor tag and declared field names; erased parameters are absent.

Host-injected values must be finite, acyclic, correctly tagged/shaped and well-typed. Nats must be within the 48-bit Nat ABI before the tighter public cap is checked. Negative BigInts, arbitrary objects/getters, cycles and wrong types are outside this low-level ABI, not promised structured errors. Lone UTF-16 surrogates in otherwise valid host strings are explicitly in scope. Native invalid-Char construction may have a different upstream rejection boundary; a foreign constructor trap is not an encoder rejection.

## Architecture and termination

The parser has one structural String driver, `Parse.loop(rest, outcome)`. It matches `rest` before outcome; a carried failure returns immediately. Each nonempty active edge calls the driver on the tail with `Parse.consume(state, head)`. Transitions do not call back into the driver. EOF calls the finalizer. Number termination finalizes then dispatches its delimiter exactly once without unchanged-input recursion.

Grammar modes are Value, ArrayFirst, ArrayValue, ArrayAfter, ObjectFirst, ObjectKey, ObjectColon, ObjectValue, ObjectAfter and DocumentEnd. First modes allow immediate closing; post-comma modes do not. Frames retain reversed items/members, pending keys and continuation information. Closing a container reverses and attaches only that frame. Token states cover literal suffixes, string body/escape/hex, surrogate pairing and number DFA. Number states use the `Num` prefix to avoid Base constructor collisions.

The encoder's only output traversal recursion is `Encode.loop(credit, pending, reversed)`. It matches credit first, pending second. `EncodeComplete` reverses and returns even at zero credit; `EncodeFailed` propagates; `EncodeEmit` on successor credit emits one scalar and recurses on its predecessor with `Encode.prepare(predecessor,next)`. Preparation does not recurse back to the driver. Bounded acyclic helpers collapse empty administrative work; punctuation is scheduled directly. A separately bounded shared number validator is allowed.

String tokens/output and completed containers use Base `String.reverse`/`List.reverse` once, not growing-prefix appends. No mutual recursion, parser fuel, host parser, machine-number parsing, unsafe annotations or templates in the proof dependency graph. Tail-recursive drivers avoid known non-tail JS stack limits; their shape alone does not prove measured performance or allocation safety.

## Formal release inventory

Draft origin: agent-authored from the authorized mission. These obligations may not be removed/narrowed for green results.

| ID | Law | Domain/category |
|---|---|---|
| JSON-P001 | Json.bool_roundtrip | All Bool; quantified checked theorem |
| JSON-P002 | Json.null_roundtrip | Public null roundtrip; concrete checked claim |
| JSON-P003 | Json.empty_array_roundtrip | Public empty-array roundtrip; concrete checked claim |
| JSON-P004 | Json.empty_object_roundtrip | Public empty-object roundtrip; concrete checked claim |
| JSON-P005 | Json.string_reverse_accumulator | All structural strings/accumulators; induction |

All five obligations passed the exact safe checker gate in `artifacts/proofs.json`: library and root proof exited 0 with `All terms check.\n`, empty stderr and no timeout/signal. `artifacts/proof-gate-selftest.json` records all 33 enforcement controls passing.

Roundtrips use public encode exactly once and then public parse, fixed `Limits{32n,4n,32n,32n,32n,32n}`, and nested `Result` preserving both failure layers. Conclusions are exactly nested `Done{Done{original}}`, with all Bool values quantified for the Boolean law and closed null/empty-array/empty-object inputs for the concrete claims. No success premise or primitive shortcut is allowed.

The accumulator theorem states `String.reverse.go(s, acc) == String.append(Spec.reverse(s), acc)` for all structural strings/accumulators. Its independent specification is empty to empty, cons to recursively reversed tail appended to a singleton. Append associativity/right identity support induction and the ordinary reversal corollary. The slow specification is proof-only; actual parser/encoder finalizers use Base reversal.

`LAWS.bend` owns claims; root `PROOF.bend` directly imports it and provides qualified `def Laws.Json.<name>` proofs, without `main`. Safe checking requires exit 0, no signal/timeout, stdout exactly `All terms check.\n` after CRLF normalization and empty stderr. Unsafe/template verdicts fail even when the compiler exits 0. Inventory independently requires files, all five ID/name rows, laws and proofs, and compares all release declarations to the table. Simultaneous malicious edits of laws/SPEC/verifier baseline are beyond this same-script guard; contract changes require explicit review.

General number/string/JSON roundtrip, grammar soundness and acceptance theorems remain deferred: grammar, string and list lemmas are missing. Finite tests must not be described as universal proofs; no open future axiom belongs in the release graph.

## Behavioral evidence inventory

Each row names a finite runtime evidence obligation, not a universal theorem. Adequate budgets and well-shaped host inputs are assumed unless the row deliberately tests a boundary. Current status is limited to the observed evidence in the final column.

| ID | Domain and assumptions | Evidence entry point | Status |
|---|---|---|---|
| JSON-R001 | Complete scalar JSON grammar within corpus limits; all 95 y_ inputs succeed | `tests/conformance.ts`, `tests/regressions.ts` | Node/Bun/native canonical campaign passed |
| JSON-R002 | Syntax/suffix rejection and first-error dispatch, including bounded mutation inputs | `tests/regressions.ts`, mutation campaign | Combined Node/Bun/native regressions and all mutations passed |
| JSON-R003 | Exact valid number spelling and standalone lexical/resource validation | `tests/regressions.ts`, `tests/properties.ts` | Node/Bun/native passed |
| JSON-R004 | Scalar strings, all controls/escapes/pairs, no normalization | regressions and decoded corpus | Node/Bun/native passed |
| JSON-R005 | Ordered duplicate decoded names and special/numeric-looking keys | regressions and generated ASTs | Node/Bun/native passed |
| JSON-R006 | Original source codepoint errors, astral/escape/EOF cases | `tests/regressions.ts` | Node/Bun/native passed |
| JSON-R007 | L−1/L/L+1, zero/cap/cap+1 and per-field resource units | regressions and native replay | Node/Bun/native passed |
| JSON-R008 | Invalid constructed number/text/key payloads, no partial success | host regressions and native construction | Node/Bun/native passed |
| JSON-R009 | Exact structural roundtrip for bounded independently generated ASTs | properties and native construction batches | 3,000 generated ASTs per host and native passed |
| JSON-R010 | Real child-directory/host imports and exact primitive/ADT ABI | `scripts/probe.ts`, real host examples | Gate A and actual Bend/Node/Bun JSON examples passed |
| JSON-R011 | Strict UTF-8 boundary, BOM retention and all 318 original names | setup manifest/tree and conformance accounting | Node/Bun/native passed: 293 String calls, 25 byte exclusions each; offline integrity controls passed |
| JSON-R012 | Node/Bun/CPU-native recursive execution, default-size resource tests and measurements | probe, verify, bench | Canonical integrated report passed all six gates; private Ubuntu/macOS CI run `35589618477` passed |

## Measured benchmark evidence

`artifacts/bench.json` (2026-09-21) records 31 deterministic families/sizes × five operations (`parse`, `encode`, `equality`, `materialize-ast`, `materialize-text`) for each Node, Bun and CPU-native lane: 155 measurements per lane, 465 total. Each case used five warmups and 20 samples. Fixture generation, strict UTF-8 decoding, file I/O, loader/compiler/process startup and correctness checks were outside timed calls; host eager ABI conversion was inside core calls. Native parse/encode included full result traversal, with traversal measured separately; equality was the test-only iterative comparator, not a public API.

Representative parse/encode medians (milliseconds) are:

| Fixture | Node | Bun | Native |
|---|---:|---:|---:|
| ASCII, 100,000 scalars, parse | 37.3421 | 85.01744 | 3.890625 |
| ASCII, 100,000 scalars, encode | 32.80702 | 75.30912 | 2.6640625 |
| Wide array, 100,000 values, parse | 99.46131 | 283.04158 | 18.5625 |
| Wide array, 100,000 values, encode | 78.29123 | 167.41731 | 8.375 |

Native `IO.now()` calibration targeted at least 100 ms, capped at 1,024 iterations. The artifact marks 83 of 155 native measurements below target precision and 10 below the native clock resolution; those flags are reported rather than treated as precise throughput. Across the 75 increasing-size pairs per lane, Node and Bun have no greater-than-2× normalized growth signal in any pair; native has 72 such pairs and three depth pairs below clock resolution. These are finite diagnostics, not a universal complexity result. The full campaign elapsed 597,546.447625 ms (about 597.5 s), close to the 600,000 ms campaign deadline.

Host RSS in this benchmark is sampled snapshots, not continuous peak RSS or enforced memory bounds: maxima were 343,228,416 bytes for Node and 331,808,768 bytes for Bun; native benchmark RSS was unmeasured. The shared host evidence has 88 encode cases, while native replay accounting has 92 encode cases, including four native-only extras; these counts must not be conflated. A passing native benchmark lane proves benchmark-driver execution only; the canonical verification report separately establishes the local native gate. The strict replay of the first 64 generated cases passed three times after START/END diagnostic flushing (`897.4 ms`, `26.7 ms`, `23.2 ms`); no timeout was relaxed, no smaller batch was substituted and no 330-second timeout was introduced.

The canonical integrated report (`artifacts/verification.json`) passed `proofs`, `proof-gate-selftest`, `supervisor-selftest`, `host-node`, `host-bun` and `native`, running from `2026-09-21T08:14:53.445Z` to `2026-09-21T08:23:40.858Z` (527.413 s). Native evidence covered 12,458 invocations, 65 builds, 63 construction batches, 3,000 generated ASTs, 92 encode cases (88 shared plus four native-only), 42 number cases, three malformed parses, 259 directed texts, 9,000 generated text transforms, 300 common-oracle cases, 2,048 mutations, seven large cases and the default-depth case. Native corpus accounting was 318 fixtures, 293 calls, 25 byte exclusions, 95 y_ accepts, 176 n_ rejects and 22 decoded i_ cases (11 accepts, 11 rejects). RSS sampling observed 2,047 of 2,048 mutation invocations (one unobserved), 2,047 samples and a maximum 1,392,640 bytes against the 512 MiB ceiling; this is sampled rather than exact continuous peak RSS. Distinct 64 MiB/128 MiB controls passed.

## Source evidence and trust boundary

The source/evidence table, exact revisions, commands and runtime statuses are in [docs/VERIFICATION.md](docs/VERIFICATION.md). The pinned checker establishes only accepted proof terms under its logic/implementation. Base definitions, compiler lowering, runtime representation, host ABI, native IO, allocation, strict decoding, test generation/comparison and harness supervision remain trust boundaries. A safe checker verdict does not prove termination/resource behavior of all external hosts or the harness's own correctness.

## Prioritized roadmap (not v0.1 features)

1. **v0.2, after stable green v0.1:** primitive value decoders, required/optional fields, nullable values, arrays, small object-building combinators and explicit numeric conversions with rounding/precision/range errors. Missing and explicit null remain distinct; typed field lookup rejects duplicate decoded names as ambiguous. Paths are structural field/index segments, rendered for example as `users[3].email`. Acceptance requires a real configuration record, nested-path failures, missing/null distinctions, duplicate ambiguity and numeric range/precision cases. Probe affine callbacks/templates before designing combinators; no reflection or direct TypeScript-validator port.
2. **v0.3, only after real use and benchmarks:** measured encoding ergonomics/performance work.
3. **Later, only with upstream capability and consumers:** bytes, incremental parsing, NDJSON and shared text utilities.

No HTTP/router/TLS/database/schema/JSONPath/derive/LSP/framework or GPU-parsing work is part of this release. Runtime and production-library package dependencies remain forbidden; the locked package-manager scope is limited to the owner-authorized TypeScript compiler and Node declarations used to statically check the host harness.
