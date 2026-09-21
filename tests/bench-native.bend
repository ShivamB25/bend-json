import Base
import ../json.bend as J
import ./support.bend as S

# The host supplies a strictly decoded compact fixture file. Arguments after --
# are PATH, unary operation (1..5 x's), unary batch (1..1024 x's), raised-value flag.
# IO.now is the pinned millisecond clock. Process/file/parse setup is outside timing.
type ForceTask is Data:
  ForceJson{value: J.Json}
  ForceItems{items: List<&2, J.Json>}
  ForceMembers{members: List<&2, J.Member<J.Json>>}
  ForceText{text: String}

type ForceState is Data:
  ForceState{tasks: List<&2, ForceTask>, count: Nat}

def Bench.length(text: String, count: Nat) -> Nat:
  match text:
    case SNil{}:
      count
    case SCon{h,t}:
      Bench.length(t,1n+count)

def Bench.force_json(value: J.Json, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match value:
    case J.Null{}:
      ForceState{tasks,1n+count}
    case J.Boolean{b}:
      ForceState{tasks,1n+count}
    case J.Number{text}:
      ForceState{Con{ForceText{text},tasks},1n+count}
    case J.Text{text}:
      ForceState{Con{ForceText{text},tasks},1n+count}
    case J.Array{items}:
      ForceState{Con{ForceItems{items},tasks},1n+count}
    case J.Object{members}:
      ForceState{Con{ForceMembers{members},tasks},1n+count}

def Bench.force_items(items: List<&2, J.Json>, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match items:
    case Nil{}:
      ForceState{tasks,1n+count}
    case Con{h,t}:
      ForceState{Con{ForceJson{h},Con{ForceItems{t},tasks}},1n+count}

def Bench.force_member(member: J.Member<J.Json>, tail: List<&2, J.Member<J.Json>>, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match member:
    case J.Member{key,value}:
      ForceState{Con{ForceText{key},Con{ForceJson{value},Con{ForceMembers{tail},tasks}}},2n+count}

def Bench.force_members(members: List<&2, J.Member<J.Json>>, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match members:
    case Nil{}:
      ForceState{tasks,1n+count}
    case Con{h,t}:
      Bench.force_member(h,t,tasks,count)

def Bench.force_text(text: String, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match text:
    case SNil{}:
      ForceState{tasks,count}
    case SCon{h,t}:
      ForceState{Con{ForceText{t},tasks},1n+count}

def Bench.force_step(task: ForceTask, tasks: List<&2, ForceTask>, count: Nat) -> ForceState:
  match task:
    case ForceJson{v}:
      Bench.force_json(v,tasks,count)
    case ForceItems{xs}:
      Bench.force_items(xs,tasks,count)
    case ForceMembers{xs}:
      Bench.force_members(xs,tasks,count)
    case ForceText{s}:
      Bench.force_text(s,tasks,count)

def Bench.force_loop(credit: Nat, state: ForceState) -> IO(Nat):
  match credit state:
    case 0n ForceState{Nil{},count}:
      IO.pure(Nat,count)
    case 0n ForceState{Con{h,t},count}:
      IO.die(Nat,1,"benchmark traversal budget exhausted")
    case 1n+p ForceState{Nil{},count}:
      IO.pure(Nat,count)
    case 1n+p ForceState{Con{h,t},count}:
      Bench.force_loop(p,Bench.force_step(h,t,count))

def Bench.force(value: J.Json, limits: J.Limits) -> IO(Nat):
  Bench.force_loop(S.Equality.budget(limits),ForceState{Con{ForceJson{value},Nil{}},0n})

def Bench.parsed(result: Result<&2,&2,J.ParseError,J.Json>) -> IO(J.Json):
  match result:
    case Fail{e}:
      IO.die(J.Json,1,"benchmark parse failed")
    case Done{v}:
      IO.pure(J.Json,v)

def Bench.encoded(result: Result<&2,&2,J.EncodeError,String>) -> IO(String):
  match result:
    case Fail{e}:
      IO.die(String,1,"benchmark encode failed")
    case Done{s}:
      IO.pure(String,s)

def Bench.equal(result: S.EqualityResult) -> IO(Nat):
  match result:
    case S.EqualTrees{}:
      IO.pure(Nat,1n)
    case S.DifferentTrees{}:
      IO.die(Nat,1,"benchmark tree mismatch")
    case S.EqualityExhausted{}:
      IO.die(Nat,1,"benchmark equality budget exhausted")

def Bench.operation(mode: Nat, +text: String, +value: J.Json, other: J.Json, +limits: J.Limits) -> IO(Nat):
  match mode:
    case 1n:
      do IO<Nat>:
        parsed : J.Json <- Bench.parsed(J.Json.parse(text,limits))
        Bench.force(parsed,limits)
    case 2n:
      do IO<Nat>:
        encoded : String <- Bench.encoded(J.Json.encode(value,limits))
        IO.pure(Nat,Bench.length(encoded,0n))
    case 3n:
      Bench.equal(S.Equality.trees(value,other,limits))
    case 4n:
      Bench.force(value,limits)
    case 5n:
      IO.pure(Nat,Bench.length(text,0n))
    case _:
      IO.die(Nat,1,"invalid benchmark operation")

def Bench.repeat(times: Nat, +mode: Nat, +text: String, +value: J.Json, +other: J.Json, +limits: J.Limits, sum: Nat) -> IO(Nat):
  match times:
    case 0n:
      IO.pure(Nat,sum)
    case 1n+p:
      do IO<Nat>:
        observed : Nat <- Bench.operation(mode,text,value,other,limits)
        Bench.repeat(p,mode,text,value,other,limits,Nat.add(sum,observed))

def Bench.run(+text: String, mode: Nat, batch: Nat, +limits: J.Limits) -> IO(Unit):
  do IO<Unit>:
    +value : J.Json <- Bench.parsed(J.Json.parse(text,limits))
    +other : J.Json <- Bench.parsed(J.Json.parse(text,limits))
    checked : Nat <- Bench.equal(S.Equality.trees(value,other,limits))
    encoded : String <- Bench.encoded(J.Json.encode(value,limits))
    IO.write("CHECK\t")
    IO.print(encoded)
    IO.print("START")
    # The native stdout pipe is buffered. Parking at this effect flushes START
    # through io_wait/io_sync before the clock and timed computation begin.
    IO.sleep(0)
    start : Nat <- IO.now()
    sum : Nat <- Bench.repeat(batch,mode,text,value,other,limits,0n)
    finish : Nat <- IO.now()
    IO.write("TIME\t")
    IO.write(Nat.show(Nat.sub(finish,start)))
    IO.write("\t")
    IO.print(Nat.show(sum))

def Bench.read_result(result: Result<&1,&1,U32 & String,String>, mode: Nat, batch: Nat, limits: J.Limits) -> IO(Unit):
  do IO<Unit>:
    text : String <- IO.pass(String,result)
    Bench.run(text,mode,batch,limits)

def Bench.read_pair(pair: File & Result<&1,&1,U32 & String,String>, mode: Nat, batch: Nat, limits: J.Limits) -> IO(Unit):
  (file,result) = pair
  do IO<Unit>:
    File.close(file)
    Bench.read_result(result,mode,batch,limits)

def Bench.sized(file: File, size: Result<&1,&1,U32 & String,U32>, mode: Nat, batch: Nat, limits: J.Limits) -> IO(Unit):
  match size:
    case Fail{error}:
      do IO<Unit>:
        File.close(file)
        IO.die(Unit,1,"benchmark file size failed")
    case Done{bytes}:
      do IO<Unit>:
        pair : File & Result<&1,&1,U32 & String,String> <- File.read(file,bytes)
        Bench.read_pair(pair,mode,batch,limits)

def Bench.size_pair(pair: File & Result<&1,&1,U32 & String,U32>, mode: Nat, batch: Nat, limits: J.Limits) -> IO(Unit):
  (file,size) = pair
  Bench.sized(file,size,mode,batch,limits)

def Bench.open(path: String, mode: Nat, batch: Nat, limits: J.Limits) -> IO(Unit):
  do IO<Unit>:
    file : File <- IO.try(File,File.open(path,"r"))
    pair : File & Result<&1,&1,U32 & String,U32> <- File.size(file)
    Bench.size_pair(pair,mode,batch,limits)

def Bench.args(args: List<String>) -> IO(Unit):
  match args:
    case Con{path,Con{mode,Con{batch,Con{raised,Nil{}}}}}:
      Bench.open(path,Bench.length(mode,0n),Bench.length(batch,0n),J.Limits{1048576n,128n,4096n,262144n,Nat.add(100000n,Bench.length(raised,0n)),2097152n})
    case _:
      IO.die(Unit,1,"expected PATH MODE_UNARY BATCH_UNARY RAISED_VALUE_UNARY")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    Bench.args(args)
