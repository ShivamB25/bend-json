import Base
import ../json.bend as J

# This executable is an importing consumer; the public module has no main or IO.
def Example.fields(value: J.Json) -> IO(Unit):
  match value:
    case J.Object{Con{J.Member{key,J.Array{Con{J.Number{number},Con{J.Text{text},Nil{}}}}},Nil{}}}:
      do IO<Unit>:
        IO.write("Done: member.key = ")
        IO.print(key)
        IO.write("Done: first value Number.text = ")
        IO.print(number)
        IO.write("Done: second value Text.value = ")
        IO.print(text)
    case _:
      IO.die(Unit,1,"unexpected example AST shape")

def Example.encoded(result: Result<&2,&2,J.EncodeError,String>) -> IO(Unit):
  match result:
    case Done{text}:
      do IO<Unit>:
        IO.write("encode Done: ")
        IO.print(text)
    case Fail{J.EncodeError{code,offset}}:
      do IO<Unit>:
        IO.print_err(String.append("encode Fail at output offset ",Nat.show(offset)))
        IO.die(Unit,1,"example encode failed")

def Example.parsed(result: Result<&2,&2,J.ParseError,J.Json>) -> IO(Unit):
  match result:
    case Done{+value}:
      do IO<Unit>:
        Example.fields(value)
        Example.encoded(J.Json.encode(value,J.Json.default_limits()))
    case Fail{J.ParseError{code,offset}}:
      do IO<Unit>:
        IO.print_err(String.append("parse Fail at source offset ",Nat.show(offset)))
        IO.die(Unit,1,"example parse failed")

def main() -> IO(Unit):
  Example.parsed(J.Json.parse("{\"x\":[-1.5e+2,\"\\u0041\"]}",J.Json.default_limits()))
