import Base
import ../json.bend as J
import ./support.bend as T

# The runtime removes its own options and '--'. Exactly eight application
# arguments remain; no shell parsing, defaults, or ignored trailing arguments.
def Driver.natural(result: Maybe<&2, Nat>) -> IO(Nat):
  match result:
    case Some{value}:
      IO.pure(Nat, value)
    case None{}:
      IO.die(Nat, 64, "HARNESS_ARGUMENT_NOT_DECIMAL_NAT")


def Driver.width_three(three: Bool) -> Nat:
  match three:
    case True{}:
      3n
    case False{}:
      4n
def Driver.width_two(two: Bool, code: U32) -> Nat:
  match two:
    case True{}:
      2n
    case False{}:
      Driver.width_three(U32.is_lt(code, 65536))

def Driver.width_ascii(ascii: Bool, +code: U32) -> Nat:
  match ascii:
    case True{}:
      1n
    case False{}:
      Driver.width_two(U32.is_lt(code, 2048), code)

def Driver.width(+code: U32) -> Nat:
  Driver.width_ascii(U32.is_lt(code, 128), code)

def Driver.bytes(text: String, count: Nat) -> Nat:
  match text:
    case SNil{}:
      count
    case SCon{Chr{code}, tail}:
      Driver.bytes(tail, Nat.add(count, Driver.width(code)))

def Driver.complete(complete: Bool, text: String, roundtrip: Bool, +limits: J.Limits) -> IO(Unit):
  match complete:
    case True{}:
      T.Native.parsed(J.Json.parse(text, limits), roundtrip, limits)
    case False{}:
      IO.die(Unit, 74, "HARNESS_SHORT_FILE_READ")

def Driver.read_result(result: Result<&1, &1, U32 & String, String>, size: U32, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  match result:
    case Fail{(code, message)}:
      IO.die(Unit, 74, "HARNESS_FILE_READ: " ++ U32.show(code) ++ ": " ++ message)
    case Done{+text}:
      Driver.complete(Nat.is_eq(Driver.bytes(text, 0n), U32.to_nat(size)), text, roundtrip, limits)

def Driver.read_closed(pair: File & Result<&1, &1, U32 & String, String>, size: U32, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  (file, result) = pair
  do IO<Unit>:
    File.close(file)
    Driver.read_result(result, size, roundtrip, limits)

def Driver.sized(result: Result<&1, &1, U32 & String, U32>, file: File, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  match result:
    case Fail{(code, message)}:
      do IO<Unit>:
        File.close(file)
        IO.die(Unit, 74, "HARNESS_FILE_SIZE: " ++ U32.show(code) ++ ": " ++ message)
    case Done{+size}:
      do IO<Unit>:
        read : File & Result<&1, &1, U32 & String, String> <- File.read(file, size)
        Driver.read_closed(read, size, roundtrip, limits)

def Driver.size_result(pair: File & Result<&1, &1, U32 & String, U32>, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  (file, result) = pair
  Driver.sized(result, file, roundtrip, limits)

def Driver.opened(result: Result<&1, &1, U32 & String, File>, roundtrip: Bool, limits: J.Limits) -> IO(Unit):
  match result:
    case Fail{(code, message)}:
      IO.die(Unit, 74, "HARNESS_FILE_OPEN: " ++ U32.show(code) ++ ": " ++ message)
    case Done{file}:
      do IO<Unit>:
        sized : File & Result<&1, &1, U32 & String, U32> <- File.size(file)
        Driver.size_result(sized, roundtrip, limits)

def Driver.file(roundtrip: Bool, path: String, limits: J.Limits) -> IO(Unit):
  do IO<Unit>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    Driver.opened(opened, roundtrip, limits)

def Driver.mode_second(roundtrip: Bool, path: String, limits: J.Limits) -> IO(Unit):
  match roundtrip:
    case True{}:
      Driver.file(True{}, path, limits)
    case False{}:
      IO.die(Unit, 64, "HARNESS_UNKNOWN_MODE")

def Driver.mode_first(parse: Bool, mode: String, path: String, limits: J.Limits) -> IO(Unit):
  match parse:
    case True{}:
      Driver.file(False{}, path, limits)
    case False{}:
      Driver.mode_second(String.eq(mode, "roundtrip"), path, limits)

def Driver.arguments(args: List<String>) -> IO(Unit):
  match args:
    case Con{+mode, Con{path, Con{i, Con{d, Con{n, Con{s, Con{v, Con{o, Nil{}}}}}}}}}:
      do IO<Unit>:
        mi : Nat <- Driver.natural(Nat.read(i))
        md : Nat <- Driver.natural(Nat.read(d))
        mn : Nat <- Driver.natural(Nat.read(n))
        ms : Nat <- Driver.natural(Nat.read(s))
        mv : Nat <- Driver.natural(Nat.read(v))
        mo : Nat <- Driver.natural(Nat.read(o))
        Driver.mode_first(String.eq(mode, "parse"), mode, path, J.Limits{mi, md, mn, ms, mv, mo})
    case _:
      IO.die(Unit, 64, "HARNESS_EXPECTED_EIGHT_ARGUMENTS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    Driver.arguments(args)
