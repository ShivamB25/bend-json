import Base
import ./json.bend as J

# Agent-authored obligations from the approved JSON v0.1 contract.
# These endpoints are release requirements, not examples to weaken for a pass.

def Spec.limits() -> J.Limits:
  J.Limits{32n,4n,32n,32n,32n,32n}

def Spec.RoundTrip() -> Data:
  Result<&2, &2, J.EncodeError, Result<&2, &2, J.ParseError, J.Json>>

def Spec.roundtrip.fin(encoded: Result<&2, &2, J.EncodeError, String>) -> Spec.RoundTrip():
  match encoded:
    case Fail{error}:
      Fail{error}
    case Done{text}:
      Done{J.Json.parse(text, Spec.limits())}

def Spec.roundtrip(value: J.Json) -> Spec.RoundTrip():
  Spec.roundtrip.fin(J.Json.encode(value, Spec.limits()))

# Deliberately independent, slow structural specification; never a runtime helper.
def Spec.reverse(s: String) -> String:
  match s:
    case SNil{}:
      SNil{}
    case SCon{h, t}:
      String.append(Spec.reverse(t), SCon{h, SNil{}})

# JSON-P001: quantified public Boolean roundtrip, including both constructors.
law Json.bool_roundtrip:
  for +b: Bool
  {Spec.roundtrip(J.Boolean{b}) == Done{Done{J.Boolean{b}}} : Spec.RoundTrip()}

# JSON-P002: concrete public null roundtrip.
law Json.null_roundtrip:
  {Spec.roundtrip(J.Null{}) == Done{Done{J.Null{}}} : Spec.RoundTrip()}

# JSON-P003: concrete public empty-array roundtrip.
law Json.empty_array_roundtrip:
  {Spec.roundtrip(J.Array{Nil{}}) == Done{Done{J.Array{Nil{}}}} : Spec.RoundTrip()}

# JSON-P004: concrete public empty-object roundtrip.
law Json.empty_object_roundtrip:
  {Spec.roundtrip(J.Object{Nil{}}) == Done{Done{J.Object{Nil{}}}} : Spec.RoundTrip()}

# JSON-P005: the actual Base accumulator used by parsing and encoding.
law Json.string_reverse_accumulator:
  for +s: String
  for +acc: String
  {String.reverse.go(s, acc) == String.append(Spec.reverse(s), acc) : String}
