import Base
import ../json.bend as J

# Test-only explicit traversal. No recursive equality hidden in a value/list field.
type EqualityTask is Data:
  CompareJson{left: J.Json, right: J.Json}
  CompareItems{left: List<&2, J.Json>, right: List<&2, J.Json>}
  CompareMembers{left: List<&2, J.Member<J.Json>>, right: List<&2, J.Member<J.Json>>}
  CompareMember{left: J.Member<J.Json>, right: J.Member<J.Json>}
  CompareString{left: String, right: String}

type EqualityState is Data:
  EqualityPending{tasks: List<&2, EqualityTask>}
  EqualityDifferent{}

type EqualityResult is Data:
  EqualTrees{}
  DifferentTrees{}
  EqualityExhausted{}

def Equality.guard(same: Bool, tasks: List<&2, EqualityTask>) -> EqualityState:
  match same:
    case True{}:
      EqualityPending{tasks}
    case False{}:
      EqualityDifferent{}

def Equality.boolean(left: Bool, right: Bool, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case True{} True{}:
      EqualityPending{tasks}
    case False{} False{}:
      EqualityPending{tasks}
    case _ _:
      EqualityDifferent{}

def Equality.json(left: J.Json, right: J.Json, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case J.Null{} J.Null{}:
      EqualityPending{tasks}
    case J.Boolean{a} J.Boolean{b}:
      Equality.boolean(a, b, tasks)
    case J.Number{a} J.Number{b}:
      EqualityPending{Con{CompareString{a, b}, tasks}}
    case J.Text{a} J.Text{b}:
      EqualityPending{Con{CompareString{a, b}, tasks}}
    case J.Array{a} J.Array{b}:
      EqualityPending{Con{CompareItems{a, b}, tasks}}
    case J.Object{a} J.Object{b}:
      EqualityPending{Con{CompareMembers{a, b}, tasks}}
    case _ _:
      EqualityDifferent{}

def Equality.items(left: List<&2, J.Json>, right: List<&2, J.Json>, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case Nil{} Nil{}:
      EqualityPending{tasks}
    case Con{a, at} Con{b, bt}:
      EqualityPending{Con{CompareJson{a, b}, Con{CompareItems{at, bt}, tasks}}}
    case _ _:
      EqualityDifferent{}

def Equality.members(left: List<&2, J.Member<J.Json>>, right: List<&2, J.Member<J.Json>>, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case Nil{} Nil{}:
      EqualityPending{tasks}
    case Con{a, at} Con{b, bt}:
      EqualityPending{Con{CompareMember{a, b}, Con{CompareMembers{at, bt}, tasks}}}
    case _ _:
      EqualityDifferent{}

def Equality.member(left: J.Member<J.Json>, right: J.Member<J.Json>, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case J.Member{ak, av} J.Member{bk, bv}:
      EqualityPending{Con{CompareString{ak, bk}, Con{CompareJson{av, bv}, tasks}}}

def Equality.string(left: String, right: String, tasks: List<&2, EqualityTask>) -> EqualityState:
  match left right:
    case SNil{} SNil{}:
      EqualityPending{tasks}
    case SCon{Chr{a}, at} SCon{Chr{b}, bt}:
      Equality.guard(U32.is_eq(a, b), Con{CompareString{at, bt}, tasks})
    case _ _:
      EqualityDifferent{}

def Equality.step(task: EqualityTask, tasks: List<&2, EqualityTask>) -> EqualityState:
  match task:
    case CompareJson{a, b}:
      Equality.json(a, b, tasks)
    case CompareItems{a, b}:
      Equality.items(a, b, tasks)
    case CompareMembers{a, b}:
      Equality.members(a, b, tasks)
    case CompareMember{a, b}:
      Equality.member(a, b, tasks)
    case CompareString{a, b}:
      Equality.string(a, b, tasks)

def Equality.loop(credit: Nat, state: EqualityState) -> EqualityResult:
  match credit state:
    case 0n EqualityDifferent{}:
      DifferentTrees{}
    case 0n EqualityPending{Nil{}}:
      EqualTrees{}
    case 0n EqualityPending{Con{h, t}}:
      EqualityExhausted{}
    case 1n+p EqualityDifferent{}:
      DifferentTrees{}
    case 1n+p EqualityPending{Nil{}}:
      EqualTrees{}
    case 1n+p EqualityPending{Con{h, t}}:
      Equality.loop(p, Equality.step(h, t))

# For valid encoded-in-budget trees, node/list/member/string terminator work
# charges to JSON syntax and scalar work to emitted codepoints. 8*max_output+1
# is a conservative bound. Exhaustion is NOT inequality or a library rejection.
def Equality.budget(limits: J.Limits) -> Nat:
  match limits:
    case J.Limits{i, d, n, s, v, o}:
      Nat.add(Nat.mul(8n, o), 1n)

def Equality.trees(left: J.Json, right: J.Json, limits: J.Limits) -> EqualityResult:
  Equality.loop(Equality.budget(limits), EqualityPending{Con{CompareJson{left, right}, Nil{}}})

def Native.parse_code(code: J.ParseCode) -> String:
  match code:
    case J.PUnexpectedEnd{}:
      "PUnexpectedEnd"
    case J.PUnexpectedCharacter{}:
      "PUnexpectedCharacter"
    case J.PExpectedColon{}:
      "PExpectedColon"
    case J.PExpectedCommaOrEnd{}:
      "PExpectedCommaOrEnd"
    case J.PInvalidNumber{}:
      "PInvalidNumber"
    case J.PInvalidEscape{}:
      "PInvalidEscape"
    case J.PInvalidUnicodeEscape{}:
      "PInvalidUnicodeEscape"
    case J.PUnpairedSurrogate{}:
      "PUnpairedSurrogate"
    case J.PInvalidScalar{}:
      "PInvalidScalar"
    case J.PLeadingBom{}:
      "PLeadingBom"
    case J.PTrailingContent{}:
      "PTrailingContent"
    case J.PInputLimit{}:
      "PInputLimit"
    case J.PDepthLimit{}:
      "PDepthLimit"
    case J.PNumberLimit{}:
      "PNumberLimit"
    case J.PStringLimit{}:
      "PStringLimit"
    case J.PValueLimit{}:
      "PValueLimit"
    case J.PInvalidLimits{}:
      "PInvalidLimits"

def Native.encode_code(code: J.EncodeCode) -> String:
  match code:
    case J.EInvalidNumber{}:
      "EInvalidNumber"
    case J.EInvalidScalar{}:
      "EInvalidScalar"
    case J.EDepthLimit{}:
      "EDepthLimit"
    case J.ENumberLimit{}:
      "ENumberLimit"
    case J.EStringLimit{}:
      "EStringLimit"
    case J.EValueLimit{}:
      "EValueLimit"
    case J.EOutputLimit{}:
      "EOutputLimit"
    case J.EInvalidLimits{}:
      "EInvalidLimits"

def Native.parse_failure(error: J.ParseError) -> IO(Unit):
  match error:
    case J.ParseError{code, offset}:
      IO.print("PARSE_FAIL\t" ++ Native.parse_code(code) ++ "\t" ++ Nat.show(offset))

def Native.encode_result(result: Result<&2, &2, J.EncodeError, String>) -> IO(Unit):
  match result:
    case Done{text}:
      IO.print("DONE\t" ++ text)
    case Fail{J.EncodeError{code, offset}}:
      IO.print("ENCODE_FAIL\t" ++ Native.encode_code(code) ++ "\t" ++ Nat.show(offset))

def Native.equality(result: EqualityResult, text: String) -> IO(Unit):
  match result:
    case EqualTrees{}:
      IO.print("DONE\t" ++ text)
    case DifferentTrees{}:
      IO.die(Unit, 71, "HARNESS_AST_MISMATCH")
    case EqualityExhausted{}:
      IO.die(Unit, 72, "HARNESS_EQUALITY_EXHAUSTED")

def Native.reparsed(result: Result<&2, &2, J.ParseError, J.Json>, original: J.Json, limits: J.Limits, text: String) -> IO(Unit):
  match result:
    case Done{value}:
      Native.equality(Equality.trees(original, value, limits), text)
    case Fail{error}:
      IO.die(Unit, 73, "HARNESS_ENCODED_TEXT_REJECTED")

def Native.constructed_result(result: Result<&2, &2, J.EncodeError, String>, original: J.Json, +limits: J.Limits) -> IO(Unit):
  match result:
    case Done{+text}:
      Native.reparsed(J.Json.parse(text, limits), original, limits, text)
    case Fail{error}:
      Native.encode_result(Fail{error})

def Native.constructed(+value: J.Json, +limits: J.Limits) -> IO(Unit):
  Native.constructed_result(J.Json.encode(value, limits), value, limits)

def Native.parsed(result: Result<&2, &2, J.ParseError, J.Json>, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  match result:
    case Fail{error}:
      Native.parse_failure(error)
    case Done{value}:
      match roundtrip:
        case False{}:
          IO.print("PARSE_DONE")
        case True{}:
          Native.constructed(value, limits)

def Native.number_result(result: Result<&2, &2, J.ParseError, J.Json>) -> IO(Unit):
  match result:
    case Fail{error}:
      Native.parse_failure(error)
    case Done{J.Number{text}}:
      IO.print("NUMBER_DONE\t" ++ text)
    case Done{_}:
      IO.die(Unit, 74, "HARNESS_NUMBER_CONSTRUCTOR_KIND")

# This materializes a Char before invoking the library; an upstream constructor
# trap before this marker is recorded as such, never as EInvalidScalar.
def Native.scalar_marker(char: Char) -> IO(Unit):
  match char:
    case Chr{code}:
      IO.print("CONSTRUCTED\t" ++ U32.show(code))

def Native.require(same: Bool, label: String) -> IO(Unit):
  match same:
    case True{}:
      IO.print(label)
    case False{}:
      IO.die(Unit, 75, "HARNESS_COMPARATOR_CONTROL")

def Native.equal_control(result: EqualityResult) -> Bool:
  match result:
    case EqualTrees{}:
      True{}
    case _:
      False{}

def Native.different_control(result: EqualityResult) -> Bool:
  match result:
    case DifferentTrees{}:
      True{}
    case _:
      False{}

def Native.exhausted_control(result: EqualityResult) -> Bool:
  match result:
    case EqualityExhausted{}:
      True{}
    case _:
      False{}
