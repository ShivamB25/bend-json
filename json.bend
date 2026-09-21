import Base

# Public representation: lossless numbers and ordered, duplicate-preserving members.
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

type ParseCode is Data:
  PUnexpectedEnd{}
  PUnexpectedCharacter{}
  PExpectedColon{}
  PExpectedCommaOrEnd{}
  PInvalidNumber{}
  PInvalidEscape{}
  PInvalidUnicodeEscape{}
  PUnpairedSurrogate{}
  PInvalidScalar{}
  PLeadingBom{}
  PTrailingContent{}
  PInputLimit{}
  PDepthLimit{}
  PNumberLimit{}
  PStringLimit{}
  PValueLimit{}
  PInvalidLimits{}

type EncodeCode is Data:
  EInvalidNumber{}
  EInvalidScalar{}
  EDepthLimit{}
  ENumberLimit{}
  EStringLimit{}
  EValueLimit{}
  EOutputLimit{}
  EInvalidLimits{}

type ParseError is Data:
  ParseError{code: ParseCode, offset: Nat}

type EncodeError is Data:
  EncodeError{code: EncodeCode, offset: Nat}

def Json.default_limits() -> Limits:
  Limits{1048576n,128n,4096n,262144n,100000n,2097152n}

def Limits.valid(limits: Limits) -> Bool:
  match limits:
    case Limits{i,d,n,s,v,o}:
      Nat.is_le(i,16777216n) && Nat.is_le(d,16777216n) && Nat.is_le(n,16777216n) && Nat.is_le(s,16777216n) && Nat.is_le(v,16777216n) && Nat.is_le(o,16777216n)

def Scalar.valid(char: Char) -> Bool:
  match char:
    case Chr{+c}:
      U32.is_le(c,1114111) && Bool.not(U32.is_ge(c,55296) && U32.is_le(c,57343))

def Json.space(char: Char) -> Bool:
  match char:
    case Chr{+c}:
      U32.is_eq(c,32) || U32.is_eq(c,9) || U32.is_eq(c,10) || U32.is_eq(c,13)

# Shared lexical DFA. No machine-number conversion occurs.
type NumState is Data:
  NumStart{}
  NumSign{}
  NumZero{}
  NumInteger{}
  NumDot{}
  NumFraction{}
  NumExponent{}
  NumExponentSign{}
  NumExponentDigits{}

type NumStep is Data:
  NumNext{state: NumState}
  NumStop{}
  NumInvalid{}

type NumClass is Data:
  NumClassZero{}
  NumClassDigit{}
  NumClassMinus{}
  NumClassPlus{}
  NumClassDot{}
  NumClassExponent{}
  NumClassOther{}

def Num.class_punctuation(minus: Bool, plus: Bool, dot: Bool, exponent: Bool) -> NumClass:
  match minus plus dot exponent:
    case True{} _ _ _:
      NumClassMinus{}
    case False{} True{} _ _:
      NumClassPlus{}
    case False{} False{} True{} _:
      NumClassDot{}
    case False{} False{} False{} True{}:
      NumClassExponent{}
    case False{} False{} False{} False{}:
      NumClassOther{}

def Num.class_zero(zero: Bool) -> NumClass:
  match zero:
    case True{}:
      NumClassZero{}
    case False{}:
      NumClassDigit{}

def Num.class_digit(digit: Bool, +code: U32) -> NumClass:
  match digit:
    case True{}:
      Num.class_zero(U32.is_eq(code,48))
    case False{}:
      Num.class_punctuation(U32.is_eq(code,45),U32.is_eq(code,43),U32.is_eq(code,46),U32.is_eq(code,69) || U32.is_eq(code,101))

def Num.class(char: Char) -> NumClass:
  match char:
    case Chr{+code}:
      Num.class_digit(U32.is_ge(code,48) && U32.is_le(code,57),code)

def Num.accepting(state: NumState) -> Bool:
  match state:
    case NumZero{}:
      True{}
    case NumInteger{}:
      True{}
    case NumFraction{}:
      True{}
    case NumExponentDigits{}:
      True{}
    case other:
      False{}

def Num.other(accepting: Bool, cls: NumClass) -> NumStep:
  match accepting cls:
    case True{} NumClassOther{}:
      NumStop{}
    case _ _:
      NumInvalid{}

def Num.step(+state: NumState, cls: NumClass) -> NumStep:
  match state cls:
    case NumStart{} NumClassMinus{}:
      NumNext{NumSign{}}
    case NumStart{} NumClassZero{}:
      NumNext{NumZero{}}
    case NumStart{} NumClassDigit{}:
      NumNext{NumInteger{}}
    case NumSign{} NumClassZero{}:
      NumNext{NumZero{}}
    case NumSign{} NumClassDigit{}:
      NumNext{NumInteger{}}
    case NumZero{} NumClassDot{}:
      NumNext{NumDot{}}
    case NumZero{} NumClassExponent{}:
      NumNext{NumExponent{}}
    case NumInteger{} NumClassZero{}:
      NumNext{NumInteger{}}
    case NumInteger{} NumClassDigit{}:
      NumNext{NumInteger{}}
    case NumInteger{} NumClassDot{}:
      NumNext{NumDot{}}
    case NumInteger{} NumClassExponent{}:
      NumNext{NumExponent{}}
    case NumDot{} NumClassZero{}:
      NumNext{NumFraction{}}
    case NumDot{} NumClassDigit{}:
      NumNext{NumFraction{}}
    case NumFraction{} NumClassZero{}:
      NumNext{NumFraction{}}
    case NumFraction{} NumClassDigit{}:
      NumNext{NumFraction{}}
    case NumFraction{} NumClassExponent{}:
      NumNext{NumExponent{}}
    case NumExponent{} NumClassMinus{}:
      NumNext{NumExponentSign{}}
    case NumExponent{} NumClassPlus{}:
      NumNext{NumExponentSign{}}
    case NumExponent{} NumClassZero{}:
      NumNext{NumExponentDigits{}}
    case NumExponent{} NumClassDigit{}:
      NumNext{NumExponentDigits{}}
    case NumExponentSign{} NumClassZero{}:
      NumNext{NumExponentDigits{}}
    case NumExponentSign{} NumClassDigit{}:
      NumNext{NumExponentDigits{}}
    case NumExponentDigits{} NumClassZero{}:
      NumNext{NumExponentDigits{}}
    case NumExponentDigits{} NumClassDigit{}:
      NumNext{NumExponentDigits{}}
    case s c:
      Num.other(Num.accepting(s),c)

type NumOutcome is Data:
  NumActive{state: NumState, offset: Nat}
  NumFailed{error: ParseError}

def Num.advance(step: NumStep, offset: Nat) -> NumOutcome:
  match step:
    case NumNext{state}:
      NumActive{state,1n+offset}
    case _:
      NumFailed{ParseError{PInvalidNumber{},offset}}

def Num.bounded(input_ok: Bool, scalar_ok: Bool, number_ok: Bool, value_ok: Bool, state: NumState, char: Char, offset: Nat) -> NumOutcome:
  match input_ok scalar_ok number_ok value_ok:
    case False{} _ _ _:
      NumFailed{ParseError{PInputLimit{},offset}}
    case True{} False{} _ _:
      NumFailed{ParseError{PInvalidScalar{},offset}}
    case True{} True{} False{} _:
      NumFailed{ParseError{PNumberLimit{},offset}}
    case True{} True{} True{} False{}:
      NumFailed{ParseError{PValueLimit{},offset}}
    case True{} True{} True{} True{}:
      Num.advance(Num.step(state,Num.class(char)),offset)

def Num.consume(state: NumState, +offset: Nat, +char: Char, limits: Limits) -> NumOutcome:
  match limits:
    case Limits{i,d,n,s,v,o}:
      Num.bounded(Nat.is_lt(offset,i),Scalar.valid(char),Nat.is_lt(offset,n),Nat.is_gt(v,0n),state,char,offset)

def Num.end(accepting: Bool, offset: Nat) -> Result<&2,&2,ParseError,Unit>:
  match accepting:
    case False{}:
      Fail{ParseError{PInvalidNumber{},offset}}
    case True{}:
      Done{Unit{}}

def Num.loop(rest: String, outcome: NumOutcome, +limits: Limits) -> Result<&2,&2,ParseError,Unit>:
  match rest outcome:
    case SNil{} NumFailed{error}:
      Fail{error}
    case SNil{} NumActive{state,offset}:
      Num.end(Num.accepting(state),offset)
    case SCon{h,t} NumFailed{error}:
      Fail{error}
    case SCon{h,t} NumActive{state,offset}:
      Num.loop(t,Num.consume(state,offset,h,limits),limits)

def Json.number_result(result: Result<&2,&2,ParseError,Unit>, text: String) -> Result<&2,&2,ParseError,Json>:
  match result:
    case Fail{error}:
      Fail{error}
    case Done{u}:
      Done{Number{text}}

def Json.number_checked(valid: Bool, +text: String, limits: Limits) -> Result<&2,&2,ParseError,Json>:
  match valid:
    case False{}:
      Fail{ParseError{PInvalidLimits{},0n}}
    case True{}:
      Json.number_result(Num.loop(text,NumActive{NumStart{},0n},limits),text)

def Json.number(text: String, +limits: Limits) -> Result<&2,&2,ParseError,Json>:
  Json.number_checked(Limits.valid(limits),text,limits)

type ParseMode is Data:
  Value{}
  ArrayFirst{}
  ArrayValue{}
  ArrayAfter{}
  ObjectFirst{}
  ObjectKey{}
  ObjectColon{}
  ObjectValue{}
  ObjectAfter{}
  DocumentEnd{}

type ParseFrame is Data:
  ArrayFrame{items: List<&2,Json>}
  ObjectFrame{members: List<&2,Member<Json>>, key: Maybe<&2,String>}

type ParseContext is Data:
  ParseContext{limits: Limits, offset: Nat, depth: Nat, values: Nat, frames: List<&2,ParseFrame>, mode: ParseMode}

type StringData is Data:
  StringData{reversed: String, count: Nat, key: Bool}

type ParseToken is Data:
  Idle{}
  Finished{value: Json}
  Literal{rest: String, value: Json}
  Numeric{state: NumState, reversed: String, count: Nat}
  StringBody{data: StringData}
  StringEscape{data: StringData, start: Nat}
  StringHex{data: StringData, start: Nat, remaining: Nat, code: U32, high: U32}
  LowSlash{data: StringData, start: Nat, high: U32}
  LowU{data: StringData, start: Nat, high: U32}

type ParseState is Data:
  ParseState{context: ParseContext, token: ParseToken}

type ParseOutcome is Data:
  ParseActive{state: ParseState}
  ParseFailed{error: ParseError}

def Parse.active(context: ParseContext, token: ParseToken) -> ParseOutcome:
  ParseActive{ParseState{context,token}}

def Parse.fail(context: ParseContext, code: ParseCode) -> ParseOutcome:
  match context:
    case ParseContext{l,o,d,v,f,m}:
      ParseFailed{ParseError{code,o}}

def Parse.at(code: ParseCode, offset: Nat) -> ParseOutcome:
  ParseFailed{ParseError{code,offset}}

def Parse.offset(context: ParseContext) -> Nat:
  match context:
    case ParseContext{l,o,d,v,f,m}:
      o

def Parse.mode(context: ParseContext, mode: ParseMode) -> ParseContext:
  match context:
    case ParseContext{l,o,d,v,f,m}:
      ParseContext{l,o,d,v,f,mode}

def Parse.attach(value: Json, context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{l,o,d,v,Nil{},m}:
      Parse.active(ParseContext{l,o,d,v,Nil{},DocumentEnd{}},Finished{value})
    case ParseContext{l,o,d,v,Con{ArrayFrame{items},tail},m}:
      Parse.active(ParseContext{l,o,d,v,Con{ArrayFrame{Con{value,items}},tail},ArrayAfter{}},Idle{})
    case ParseContext{l,o,d,v,Con{ObjectFrame{members,Some{key}},tail},m}:
      Parse.active(ParseContext{l,o,d,v,Con{ObjectFrame{Con{Member{key,value},members},None{}},tail},ObjectAfter{}},Idle{})
    case ParseContext{l,o,d,v,Con{ObjectFrame{members,None{}},tail},m}:
      Parse.at(PUnexpectedCharacter{},o)

def Parse.close_array(context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{l,o,d,v,Con{ArrayFrame{items},tail},m}:
      Parse.attach(Array{List.reverse(&2,Json,items)},ParseContext{l,o,Nat.sub(d,1n),v,tail,Value{}})
    case c:
      Parse.fail(c,PUnexpectedCharacter{})

def Parse.close_object(context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{l,o,d,v,Con{ObjectFrame{members,key},tail},m}:
      Parse.attach(Object{List.reverse(&2,Member<Json>,members)},ParseContext{l,o,Nat.sub(d,1n),v,tail,Value{}})
    case c:
      Parse.fail(c,PUnexpectedCharacter{})

def Parse.open_allowed(allowed: Bool, object: Bool, context: ParseContext) -> ParseOutcome:
  match allowed object context:
    case False{} _ c:
      Parse.fail(c,PDepthLimit{})
    case True{} False{} ParseContext{l,o,d,v,f,m}:
      Parse.active(ParseContext{l,o,1n+d,v,Con{ArrayFrame{Nil{}},f},ArrayFirst{}},Idle{})
    case True{} True{} ParseContext{l,o,d,v,f,m}:
      Parse.active(ParseContext{l,o,1n+d,v,Con{ObjectFrame{Nil{},None{}},f},ObjectFirst{}},Idle{})

def Parse.open(object: Bool, context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{Limits{i,+max,n,s,v,o},pos,+depth,count,frames,mode}:
      Parse.open_allowed(Nat.is_lt(depth,max),object,ParseContext{Limits{i,max,n,s,v,o},pos,depth,count,frames,mode})

def Parse.number_add(allowed: Bool, state: NumState, reversed: String, count: Nat, char: Char, context: ParseContext) -> ParseOutcome:
  match allowed:
    case False{}:
      Parse.fail(context,PNumberLimit{})
    case True{}:
      Parse.active(context,Numeric{state,SCon{char,reversed},1n+count})

def Parse.number_put(state: NumState, reversed: String, +count: Nat, char: Char, context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{Limits{i,d,+n,s,v,o},pos,depth,values,frames,mode}:
      Parse.number_add(Nat.is_lt(count,n),state,reversed,count,char,ParseContext{Limits{i,d,n,s,v,o},pos,depth,values,frames,mode})

def Parse.start_number(cls: NumClass, char: Char, context: ParseContext) -> ParseOutcome:
  match cls:
    case NumClassMinus{}:
      Parse.number_put(NumSign{},"",0n,char,context)
    case NumClassZero{}:
      Parse.number_put(NumZero{},"",0n,char,context)
    case NumClassDigit{}:
      Parse.number_put(NumInteger{},"",0n,char,context)
    case _:
      Parse.fail(context,PUnexpectedCharacter{})

def Parse.start_ready(null: Bool, truth: Bool, falsity: Bool, quote: Bool, array: Bool, object: Bool, +char: Char, context: ParseContext) -> ParseOutcome:
  match null truth falsity quote array object:
    case True{} _ _ _ _ _:
      Parse.active(context,Literal{"ull",Null{}})
    case False{} True{} _ _ _ _:
      Parse.active(context,Literal{"rue",Boolean{True{}}})
    case False{} False{} True{} _ _ _:
      Parse.active(context,Literal{"alse",Boolean{False{}}})
    case False{} False{} False{} True{} _ _:
      Parse.active(context,StringBody{StringData{"",0n,False{}}})
    case False{} False{} False{} False{} True{} _:
      Parse.open(False{},context)
    case False{} False{} False{} False{} False{} True{}:
      Parse.open(True{},context)
    case False{} False{} False{} False{} False{} False{}:
      Parse.start_number(Num.class(char),char,context)

def Parse.start_kind(char: Char, context: ParseContext) -> ParseOutcome:
  match char:
    case Chr{+code}:
      Parse.start_ready(U32.is_eq(code,110),U32.is_eq(code,116),U32.is_eq(code,102),U32.is_eq(code,34),U32.is_eq(code,91),U32.is_eq(code,123),Chr{code},context)


def Parse.start_allowed(allowed: Bool, char: Char, context: ParseContext) -> ParseOutcome:
  match allowed context:
    case False{} c:
      Parse.fail(c,PValueLimit{})
    case True{} ParseContext{l,o,d,v,f,m}:
      Parse.start_kind(char,ParseContext{l,o,d,1n+v,f,m})

def Parse.start(char: Char, context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{Limits{i,d,n,s,+v,o},pos,depth,+values,frames,mode}:
      Parse.start_allowed(Nat.is_lt(values,v),char,ParseContext{Limits{i,d,n,s,v,o},pos,depth,values,frames,mode})

def Parse.key(quote: Bool, context: ParseContext) -> ParseOutcome:
  match quote:
    case True{}:
      Parse.active(context,StringBody{StringData{"",0n,True{}}})
    case False{}:
      Parse.fail(context,PUnexpectedCharacter{})

def Parse.array_first(close: Bool, char: Char, context: ParseContext) -> ParseOutcome:
  match close:
    case True{}:
      Parse.close_array(context)
    case False{}:
      Parse.start(char,context)

def Parse.array_after(comma: Bool, close: Bool, context: ParseContext) -> ParseOutcome:
  match comma close:
    case True{} _:
      Parse.active(Parse.mode(context,ArrayValue{}),Idle{})
    case False{} True{}:
      Parse.close_array(context)
    case False{} False{}:
      Parse.fail(context,PExpectedCommaOrEnd{})

def Parse.object_first(close: Bool, code: U32, context: ParseContext) -> ParseOutcome:
  match close:
    case True{}:
      Parse.close_object(context)
    case False{}:
      Parse.key(U32.is_eq(code,34),context)

def Parse.object_colon(colon: Bool, context: ParseContext) -> ParseOutcome:
  match colon:
    case True{}:
      Parse.active(Parse.mode(context,ObjectValue{}),Idle{})
    case False{}:
      Parse.fail(context,PExpectedColon{})

def Parse.object_after(comma: Bool, close: Bool, context: ParseContext) -> ParseOutcome:
  match comma close:
    case True{} _:
      Parse.active(Parse.mode(context,ObjectKey{}),Idle{})
    case False{} True{}:
      Parse.close_object(context)
    case False{} False{}:
      Parse.fail(context,PExpectedCommaOrEnd{})

def Parse.grammar(mode: ParseMode, char: Char, context: ParseContext) -> ParseOutcome:
  match mode char:
    case Value{} c:
      Parse.start(c,context)
    case ArrayFirst{} Chr{+code}:
      Parse.array_first(U32.is_eq(code,93),Chr{code},context)
    case ArrayValue{} c:
      Parse.start(c,context)
    case ArrayAfter{} Chr{+code}:
      Parse.array_after(U32.is_eq(code,44),U32.is_eq(code,93),context)
    case ObjectFirst{} Chr{+code}:
      Parse.object_first(U32.is_eq(code,125),code,context)
    case ObjectKey{} Chr{code}:
      Parse.key(U32.is_eq(code,34),context)
    case ObjectColon{} Chr{code}:
      Parse.object_colon(U32.is_eq(code,58),context)
    case ObjectValue{} c:
      Parse.start(c,context)
    case ObjectAfter{} Chr{+code}:
      Parse.object_after(U32.is_eq(code,44),U32.is_eq(code,125),context)
    case DocumentEnd{} c:
      Parse.fail(context,PTrailingContent{})

def Parse.idle_space(space: Bool, char: Char, context: ParseContext) -> ParseOutcome:
  match space context:
    case True{} c:
      Parse.active(c,Idle{})
    case False{} ParseContext{l,o,d,v,f,+mode}:
      Parse.grammar(mode,char,ParseContext{l,o,d,v,f,mode})

def Parse.literal_done(rest: String, value: Json, context: ParseContext) -> ParseOutcome:
  match rest:
    case SNil{}:
      Parse.attach(value,context)
    case SCon{h,t}:
      Parse.active(context,Literal{SCon{h,t},value})

def Parse.literal_same(same: Bool, rest: String, value: Json, context: ParseContext) -> ParseOutcome:
  match same:
    case False{}:
      Parse.fail(context,PUnexpectedCharacter{})
    case True{}:
      Parse.literal_done(rest,value,context)

def Parse.literal(rest: String, value: Json, char: Char, context: ParseContext) -> ParseOutcome:
  match rest:
    case SNil{}:
      Parse.fail(context,PUnexpectedCharacter{})
    case SCon{h,t}:
      Parse.literal_same(Char.is_eq(h,char),t,value,context)

def Parse.finish_key(text: String, context: ParseContext) -> ParseOutcome:
  match context:
    case ParseContext{l,o,d,v,Con{ObjectFrame{members,key},tail},m}:
      Parse.active(ParseContext{l,o,d,v,Con{ObjectFrame{members,Some{text}},tail},ObjectColon{}},Idle{})
    case c:
      Parse.fail(c,PUnexpectedCharacter{})

def Parse.string_done(key: Bool, text: String, context: ParseContext) -> ParseOutcome:
  match key:
    case False{}:
      Parse.attach(Text{text},context)
    case True{}:
      Parse.finish_key(text,context)

def Parse.string_add(allowed: Bool, char: Char, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match allowed data:
    case False{} d:
      Parse.at(PStringLimit{},start)
    case True{} StringData{reversed,count,key}:
      Parse.active(context,StringBody{StringData{SCon{char,reversed},1n+count,key}})

def Parse.string_put(char: Char, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match data context:
    case StringData{reversed,+count,key} ParseContext{Limits{i,d,n,+s,v,o},pos,depth,values,frames,mode}:
      Parse.string_add(Nat.is_lt(count,s),char,StringData{reversed,count,key},start,ParseContext{Limits{i,d,n,s,v,o},pos,depth,values,frames,mode})

def Parse.string_control(control: Bool, char: Char, data: StringData, +context: ParseContext) -> ParseOutcome:
  match control:
    case True{}:
      Parse.fail(context,PUnexpectedCharacter{})
    case False{}:
      Parse.string_put(char,data,Parse.offset(context),context)

def Parse.string_ready(quote: Bool, escape: Bool, +code: U32, data: StringData, +context: ParseContext) -> ParseOutcome:
  match quote escape data:
    case True{} _ StringData{reversed,count,key}:
      Parse.string_done(key,String.reverse(reversed),context)
    case False{} True{} d:
      Parse.active(context,StringEscape{d,Parse.offset(context)})
    case False{} False{} d:
      Parse.string_control(U32.is_lt(code,32),Chr{code},d,context)

def Parse.string(char: Char, data: StringData, context: ParseContext) -> ParseOutcome:
  match char:
    case Chr{+code}:
      Parse.string_ready(U32.is_eq(code,34),U32.is_eq(code,92),code,data,context)

def Parse.escape_ready(copy: Bool, backspace: Bool, formfeed: Bool, newline: Bool, carriage: Bool, tab: Bool, unicode: Bool, char: Char, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match copy backspace formfeed newline carriage tab unicode:
    case True{} _ _ _ _ _ _:
      Parse.string_put(char,data,start,context)
    case False{} True{} _ _ _ _ _:
      Parse.string_put(Chr{8},data,start,context)
    case False{} False{} True{} _ _ _ _:
      Parse.string_put(Chr{12},data,start,context)
    case False{} False{} False{} True{} _ _ _:
      Parse.string_put(Chr{10},data,start,context)
    case False{} False{} False{} False{} True{} _ _:
      Parse.string_put(Chr{13},data,start,context)
    case False{} False{} False{} False{} False{} True{} _:
      Parse.string_put(Chr{9},data,start,context)
    case False{} False{} False{} False{} False{} False{} True{}:
      Parse.active(context,StringHex{data,start,4n,0,0})
    case False{} False{} False{} False{} False{} False{} False{}:
      Parse.fail(context,PInvalidEscape{})

def Parse.escape(char: Char, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match char:
    case Chr{+code}:
      Parse.escape_ready(U32.is_eq(code,34) || U32.is_eq(code,92) || U32.is_eq(code,47),U32.is_eq(code,98),U32.is_eq(code,102),U32.is_eq(code,110),U32.is_eq(code,114),U32.is_eq(code,116),U32.is_eq(code,117),Chr{code},data,start,context)

def Hex.range(digit: Bool, lower: Bool, upper: Bool, c: U32) -> Maybe<&2,U32>:
  match digit lower upper:
    case True{} _ _:
      Some{U32.sub(c,48)}
    case False{} True{} _:
      Some{U32.sub(c,87)}
    case False{} False{} True{}:
      Some{U32.sub(c,55)}
    case False{} False{} False{}:
      None{}

def Hex.digit(char: Char) -> Maybe<&2,U32>:
  match char:
    case Chr{+c}:
      Hex.range(U32.is_ge(c,48) && U32.is_le(c,57),U32.is_ge(c,97) && U32.is_le(c,102),U32.is_ge(c,65) && U32.is_le(c,70),c)

def Parse.unicode_single(high: Bool, low: Bool, code: U32, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match high low:
    case True{} _:
      Parse.active(context,LowSlash{data,start,code})
    case False{} True{}:
      Parse.at(PUnpairedSurrogate{},start)
    case False{} False{}:
      Parse.string_put(Chr{code},data,start,context)

def Parse.unicode_pair(valid: Bool, high: U32, low: U32, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match valid:
    case False{}:
      Parse.at(PUnpairedSurrogate{},start)
    case True{}:
      Parse.string_put(Chr{(65536 + (high - 55296) * 1024 + (low - 56320) : U32)},data,start,context)

def Parse.unicode_ready(single: Bool, high: U32, +code: U32, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match single:
    case True{}:
      Parse.unicode_single(U32.is_ge(code,55296) && U32.is_le(code,56319),U32.is_ge(code,56320) && U32.is_le(code,57343),code,data,start,context)
    case False{}:
      Parse.unicode_pair(U32.is_ge(code,56320) && U32.is_le(code,57343),high,code,data,start,context)

def Parse.hex_more(remaining: Nat, code: U32, +high: U32, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match remaining:
    case 0n:
      Parse.unicode_ready(U32.is_eq(high,0),high,code,data,start,context)
    case 1n+p:
      Parse.active(context,StringHex{data,start,1n+p,code,high})

def Parse.hex_digit(digit: Maybe<&2,U32>, remaining: Nat, code: U32, high: U32, data: StringData, start: Nat, context: ParseContext) -> ParseOutcome:
  match digit remaining:
    case None{} _:
      Parse.fail(context,PInvalidUnicodeEscape{})
    case Some{d} 0n:
      Parse.fail(context,PInvalidUnicodeEscape{})
    case Some{d} 1n+p:
      Parse.hex_more(p,(code * 16 + d : U32),high,data,start,context)

def Parse.finished_space(space: Bool, value: Json, context: ParseContext) -> ParseOutcome:
  match space:
    case False{}:
      Parse.fail(context,PTrailingContent{})
    case True{}:
      Parse.active(context,Finished{value})
# Finishing a number redispatches one delimiter, never the remaining String.
def Parse.delimiter(outcome: ParseOutcome, +char: Char) -> ParseOutcome:
  match outcome:
    case ParseFailed{error}:
      ParseFailed{error}
    case ParseActive{ParseState{context,Idle{}}}:
      Parse.idle_space(Json.space(char),char,context)
    case ParseActive{ParseState{context,Finished{value}}}:
      Parse.finished_space(Json.space(char),value,context)
    case ParseActive{ParseState{context,other}}:
      Parse.fail(context,PUnexpectedCharacter{})

def Parse.number_step(step: NumStep, reversed: String, count: Nat, char: Char, context: ParseContext) -> ParseOutcome:
  match step:
    case NumInvalid{}:
      Parse.fail(context,PInvalidNumber{})
    case NumNext{state}:
      Parse.number_put(state,reversed,count,char,context)
    case NumStop{}:
      Parse.delimiter(Parse.attach(Number{String.reverse(reversed)},context),char)


def Parse.low_slash_ready(slash: Bool, data: StringData, start: Nat, high: U32, context: ParseContext) -> ParseOutcome:
  match slash:
    case True{}:
      Parse.active(context,LowU{data,start,high})
    case False{}:
      Parse.at(PUnpairedSurrogate{},start)

def Parse.low_slash(char: Char, data: StringData, start: Nat, high: U32, context: ParseContext) -> ParseOutcome:
  match char:
    case Chr{code}:
      Parse.low_slash_ready(U32.is_eq(code,92),data,start,high,context)

def Parse.low_u_ready(unicode: Bool, data: StringData, start: Nat, high: U32, context: ParseContext) -> ParseOutcome:
  match unicode:
    case True{}:
      Parse.active(context,StringHex{data,start,4n,0,high})
    case False{}:
      Parse.at(PUnpairedSurrogate{},start)

def Parse.low_u(char: Char, data: StringData, start: Nat, high: U32, context: ParseContext) -> ParseOutcome:
  match char:
    case Chr{code}:
      Parse.low_u_ready(U32.is_eq(code,117),data,start,high,context)
def Parse.dispatch(token: ParseToken, +char: Char, context: ParseContext) -> ParseOutcome:
  match token:
    case Idle{}:
      Parse.idle_space(Json.space(char),char,context)
    case Finished{value}:
      Parse.finished_space(Json.space(char),value,context)
    case Literal{rest,value}:
      Parse.literal(rest,value,char,context)
    case Numeric{state,reversed,count}:
      Parse.number_step(Num.step(state,Num.class(char)),reversed,count,char,context)
    case StringBody{data}:
      Parse.string(char,data,context)
    case StringEscape{data,start}:
      Parse.escape(char,data,start,context)
    case StringHex{data,start,remaining,code,high}:
      Parse.hex_digit(Hex.digit(char),remaining,code,high,data,start,context)
    case LowSlash{data,start,high}:
      Parse.low_slash(char,data,start,high,context)
    case LowU{data,start,high}:
      Parse.low_u(char,data,start,high,context)


def Parse.bump(outcome: ParseOutcome) -> ParseOutcome:
  match outcome:
    case ParseFailed{error}:
      ParseFailed{error}
    case ParseActive{ParseState{ParseContext{l,o,d,v,f,m},token}}:
      Parse.active(ParseContext{l,1n+o,d,v,f,m},token)

def Parse.consume_allowed(input_ok: Bool, scalar_ok: Bool, bom: Bool, token: ParseToken, char: Char, context: ParseContext) -> ParseOutcome:
  match input_ok scalar_ok bom:
    case False{} _ _:
      Parse.fail(context,PInputLimit{})
    case True{} False{} _:
      Parse.fail(context,PInvalidScalar{})
    case True{} True{} True{}:
      Parse.fail(context,PLeadingBom{})
    case True{} True{} False{}:
      Parse.bump(Parse.dispatch(token,char,context))

def Parse.consume(state: ParseState, +char: Char) -> ParseOutcome:
  match state:
    case ParseState{ParseContext{Limits{+i,d,n,s,v,o},+pos,depth,values,frames,mode},token}:
      Parse.consume_allowed(Nat.is_lt(pos,i),Scalar.valid(char),Nat.is_eq(pos,0n) && Char.is_eq(char,Chr{65279}),token,char,ParseContext{Limits{i,d,n,s,v,o},pos,depth,values,frames,mode})

def Parse.finish_attached(outcome: ParseOutcome) -> Result<&2,&2,ParseError,Json>:
  match outcome:
    case ParseFailed{error}:
      Fail{error}
    case ParseActive{ParseState{context,Finished{value}}}:
      Done{value}
    case ParseActive{ParseState{context,token}}:
      Fail{ParseError{PUnexpectedEnd{},Parse.offset(context)}}

def Parse.finish_number(accepting: Bool, reversed: String, context: ParseContext) -> Result<&2,&2,ParseError,Json>:
  match accepting:
    case False{}:
      Fail{ParseError{PInvalidNumber{},Parse.offset(context)}}
    case True{}:
      Parse.finish_attached(Parse.attach(Number{String.reverse(reversed)},context))

def Parse.finish_token(token: ParseToken, context: ParseContext) -> Result<&2,&2,ParseError,Json>:
  match token:
    case Finished{value}:
      Done{value}
    case Numeric{state,reversed,count}:
      Parse.finish_number(Num.accepting(state),reversed,context)
    case StringHex{data,start,remaining,code,high}:
      Fail{ParseError{PInvalidUnicodeEscape{},Parse.offset(context)}}
    case LowSlash{data,start,high}:
      Fail{ParseError{PUnpairedSurrogate{},start}}
    case LowU{data,start,high}:
      Fail{ParseError{PUnpairedSurrogate{},start}}
    case other:
      Fail{ParseError{PUnexpectedEnd{},Parse.offset(context)}}

def Parse.finish(state: ParseState) -> Result<&2,&2,ParseError,Json>:
  match state:
    case ParseState{context,token}:
      Parse.finish_token(token,context)

def Parse.loop(rest: String, outcome: ParseOutcome) -> Result<&2,&2,ParseError,Json>:
  match rest outcome:
    case SNil{} ParseFailed{error}:
      Fail{error}
    case SNil{} ParseActive{state}:
      Parse.finish(state)
    case SCon{h,t} ParseFailed{error}:
      Fail{error}
    case SCon{h,t} ParseActive{state}:
      Parse.loop(t,Parse.consume(state,h))

def Json.parse_checked(valid: Bool, text: String, limits: Limits) -> Result<&2,&2,ParseError,Json>:
  match valid:
    case False{}:
      Fail{ParseError{PInvalidLimits{},0n}}
    case True{}:
      Parse.loop(text,Parse.active(ParseContext{limits,0n,0n,0n,Nil{},Value{}},Idle{}))

def Json.parse(text: String, +limits: Limits) -> Result<&2,&2,ParseError,Json>:
  Json.parse_checked(Limits.valid(limits),text,limits)

# Encoder continuations retain ordered tails, never growing output prefixes.
type EncodeFrame is Data:
  EncodeArrayFrame{items: List<&2,Json>}
  EncodeObjectFrame{members: List<&2,Member<Json>>}

type EncodeContext is Data:
  EncodeContext{limits: Limits, offset: Nat, depth: Nat, values: Nat, frames: List<&2,EncodeFrame>}

type EncodeWork is Data:
  EncodeFinished{}
  EncodeValue{value: Json}
  EncodeSuffix{rest: String}
  EncodeString{rest: String, count: Nat, key_value: Maybe<&2,Json>}
  EncodeEscape{suffix: String, rest: String, count: Nat, key_value: Maybe<&2,Json>}
  EncodeArrayNext{items: List<&2,Json>}
  EncodeArrayAfter{items: List<&2,Json>}
  EncodeObjectNext{members: List<&2,Member<Json>>}
  EncodeObjectAfter{members: List<&2,Member<Json>>}
  EncodeColon{value: Json}

type EncodeState is Data:
  EncodeState{context: EncodeContext, work: EncodeWork}

type EncodeStep is Data:
  EncodeComplete{}
  EncodeFailed{error: EncodeError}
  EncodeEmit{character: Char, next: EncodeState}

def Encode.offset(context: EncodeContext) -> Nat:
  match context:
    case EncodeContext{l,o,d,v,f}:
      o

def Encode.fail(code: EncodeCode, context: EncodeContext) -> EncodeStep:
  EncodeFailed{EncodeError{code,Encode.offset(context)}}

def Encode.emit(char: Char, work: EncodeWork, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{l,o,d,v,f}:
      EncodeEmit{char,EncodeState{EncodeContext{l,1n+o,d,v,f},work}}

# Completing a value pops one continuation; its punctuation is the next output.
def Encode.after(context: EncodeContext) -> EncodeState:
  match context:
    case EncodeContext{l,o,d,v,Nil{}}:
      EncodeState{EncodeContext{l,o,d,v,Nil{}},EncodeFinished{}}
    case EncodeContext{l,o,d,v,Con{EncodeArrayFrame{items},tail}}:
      EncodeState{EncodeContext{l,o,d,v,tail},EncodeArrayAfter{items}}
    case EncodeContext{l,o,d,v,Con{EncodeObjectFrame{members},tail}}:
      EncodeState{EncodeContext{l,o,d,v,tail},EncodeObjectAfter{members}}

def Encode.emit_state(char: Char, state: EncodeState) -> EncodeStep:
  match state:
    case EncodeState{context,work}:
      Encode.emit(char,work,context)

def Encode.last(char: Char, context: EncodeContext) -> EncodeStep:
  Encode.emit_state(char,Encode.after(context))

def Encode.push(frame: EncodeFrame, context: EncodeContext) -> EncodeContext:
  match context:
    case EncodeContext{l,o,d,v,f}:
      EncodeContext{l,o,d,v,Con{frame,f}}

def Encode.close(char: Char, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{l,o,d,v,f}:
      Encode.last(char,EncodeContext{l,o,Nat.sub(d,1n),v,f})

def Encode.suffix_tail(tail: String, char: Char, context: EncodeContext) -> EncodeStep:
  match tail:
    case SNil{}:
      Encode.last(char,context)
    case SCon{h,t}:
      Encode.emit(char,EncodeSuffix{SCon{h,t}},context)

def Encode.suffix(rest: String, context: EncodeContext) -> EncodeStep:
  match rest:
    case SNil{}:
      Encode.fail(EInvalidNumber{},context)
    case SCon{h,t}:
      Encode.suffix_tail(t,h,context)

def Encode.number_error(code: ParseCode, context: EncodeContext) -> EncodeStep:
  match code:
    case PNumberLimit{}:
      Encode.fail(ENumberLimit{},context)
    case PInputLimit{}:
      Encode.fail(ENumberLimit{},context)
    case PInvalidScalar{}:
      Encode.fail(EInvalidScalar{},context)
    case other:
      Encode.fail(EInvalidNumber{},context)

def Encode.number_result(result: Result<&2,&2,ParseError,Unit>, text: String, context: EncodeContext) -> EncodeStep:
  match result:
    case Fail{ParseError{code,offset}}:
      Encode.number_error(code,context)
    case Done{u}:
      Encode.suffix(text,context)

def Encode.number(+text: String, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{Limits{i,d,+n,s,v,o},offset,depth,values,frames}:
      Encode.number_result(Num.loop(text,NumActive{NumStart{},0n},Limits{16777216n,0n,n,0n,1n,0n}),text,EncodeContext{Limits{i,d,n,s,v,o},offset,depth,values,frames})

def Encode.container_allowed(allowed: Bool, char: Char, work: EncodeWork, context: EncodeContext) -> EncodeStep:
  match allowed context:
    case False{} c:
      Encode.fail(EDepthLimit{},c)
    case True{} EncodeContext{l,o,d,v,f}:
      Encode.emit(char,work,EncodeContext{l,o,1n+d,v,f})

def Encode.container(char: Char, work: EncodeWork, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{Limits{i,+d,n,s,v,o},offset,+depth,values,frames}:
      Encode.container_allowed(Nat.is_lt(depth,d),char,work,EncodeContext{Limits{i,d,n,s,v,o},offset,depth,values,frames})

def Encode.boolean(value: Bool, context: EncodeContext) -> EncodeStep:
  match value:
    case False{}:
      Encode.emit('f',EncodeSuffix{"alse"},context)
    case True{}:
      Encode.emit('t',EncodeSuffix{"rue"},context)

def Encode.value_kind(value: Json, context: EncodeContext) -> EncodeStep:
  match value:
    case Null{}:
      Encode.emit('n',EncodeSuffix{"ull"},context)
    case Boolean{b}:
      Encode.boolean(b,context)
    case Number{text}:
      Encode.number(text,context)
    case Text{text}:
      Encode.emit(Chr{34},EncodeString{text,0n,None{}},context)
    case Array{items}:
      Encode.container('[',EncodeArrayNext{items},context)
    case Object{members}:
      Encode.container('{',EncodeObjectNext{members},context)

def Encode.value_allowed(allowed: Bool, value: Json, context: EncodeContext) -> EncodeStep:
  match allowed context:
    case False{} c:
      Encode.fail(EValueLimit{},c)
    case True{} EncodeContext{l,o,d,v,f}:
      Encode.value_kind(value,EncodeContext{l,o,d,1n+v,f})

def Encode.value(value: Json, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{Limits{i,d,n,s,+v,o},offset,depth,+values,frames}:
      Encode.value_allowed(Nat.is_lt(values,v),value,EncodeContext{Limits{i,d,n,s,v,o},offset,depth,values,frames})

def Encode.string_end(key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match key_value:
    case None{}:
      Encode.last(Chr{34},context)
    case Some{value}:
      Encode.emit(Chr{34},EncodeColon{value},context)

def Encode.hex_char(low: Bool, code: U32) -> Char:
  match low:
    case True{}:
      Chr{(48 + code : U32)}
    case False{}:
      Chr{(87 + code : U32)}

def Encode.hex(+code: U32) -> Char:
  Encode.hex_char(U32.is_lt(code,10),code)

def Encode.control_named(backspace: Bool, formfeed: Bool, newline: Bool, carriage: Bool, tab: Bool, +code: U32, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match backspace formfeed newline carriage tab:
    case True{} _ _ _ _:
      Encode.emit(Chr{92},EncodeEscape{"b",rest,count,key_value},context)
    case False{} True{} _ _ _:
      Encode.emit(Chr{92},EncodeEscape{"f",rest,count,key_value},context)
    case False{} False{} True{} _ _:
      Encode.emit(Chr{92},EncodeEscape{"n",rest,count,key_value},context)
    case False{} False{} False{} True{} _:
      Encode.emit(Chr{92},EncodeEscape{"r",rest,count,key_value},context)
    case False{} False{} False{} False{} True{}:
      Encode.emit(Chr{92},EncodeEscape{"t",rest,count,key_value},context)
    case False{} False{} False{} False{} False{}:
      Encode.emit(Chr{92},EncodeEscape{SCon{'u',SCon{'0',SCon{'0',SCon{Encode.hex(U32.div(code,16)),SCon{Encode.hex(U32.mod(code,16)),SNil{}}}}}},rest,count,key_value},context)

def Encode.control(control: Bool, +code: U32, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match control:
    case False{}:
      Encode.emit(Chr{code},EncodeString{rest,count,key_value},context)
    case True{}:
      Encode.control_named(U32.is_eq(code,8),U32.is_eq(code,12),U32.is_eq(code,10),U32.is_eq(code,13),U32.is_eq(code,9),code,rest,count,key_value,context)

def Encode.string_ready(escaped: Bool, +code: U32, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match escaped:
    case True{}:
      Encode.emit(Chr{92},EncodeEscape{SCon{Chr{code},SNil{}},rest,count,key_value},context)
    case False{}:
      Encode.control(U32.is_lt(code,32),code,rest,count,key_value,context)

def Encode.string_char(char: Char, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match char:
    case Chr{+code}:
      Encode.string_ready(U32.is_eq(code,34) || U32.is_eq(code,92),code,rest,count,key_value,context)

def Encode.string_allowed(scalar_ok: Bool, string_ok: Bool, char: Char, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match scalar_ok string_ok:
    case False{} _:
      Encode.fail(EInvalidScalar{},context)
    case True{} False{}:
      Encode.fail(EStringLimit{},context)
    case True{} True{}:
      Encode.string_char(char,rest,1n+count,key_value,context)

def Encode.string_put(+char: Char, rest: String, +count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match context:
    case EncodeContext{Limits{i,d,n,+s,v,o},offset,depth,values,frames}:
      Encode.string_allowed(Scalar.valid(char),Nat.is_lt(count,s),char,rest,count,key_value,EncodeContext{Limits{i,d,n,s,v,o},offset,depth,values,frames})

def Encode.string(rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match rest:
    case SNil{}:
      Encode.string_end(key_value,context)
    case SCon{h,t}:
      Encode.string_put(h,t,count,key_value,context)

def Encode.escape_tail(tail: String, char: Char, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match tail:
    case SNil{}:
      Encode.emit(char,EncodeString{rest,count,key_value},context)
    case SCon{h,t}:
      Encode.emit(char,EncodeEscape{SCon{h,t},rest,count,key_value},context)

def Encode.escape(suffix: String, rest: String, count: Nat, key_value: Maybe<&2,Json>, context: EncodeContext) -> EncodeStep:
  match suffix:
    case SNil{}:
      Encode.string(rest,count,key_value,context)
    case SCon{h,t}:
      Encode.escape_tail(t,h,rest,count,key_value,context)

def Encode.array_next(items: List<&2,Json>, context: EncodeContext) -> EncodeStep:
  match items:
    case Nil{}:
      Encode.close(']',context)
    case Con{value,tail}:
      Encode.value(value,Encode.push(EncodeArrayFrame{tail},context))

def Encode.array_after(items: List<&2,Json>, context: EncodeContext) -> EncodeStep:
  match items:
    case Nil{}:
      Encode.close(']',context)
    case Con{value,tail}:
      Encode.emit(',',EncodeArrayNext{Con{value,tail}},context)

def Encode.object_next(members: List<&2,Member<Json>>, context: EncodeContext) -> EncodeStep:
  match members:
    case Nil{}:
      Encode.close('}',context)
    case Con{Member{key,value},tail}:
      Encode.emit(Chr{34},EncodeString{key,0n,Some{value}},Encode.push(EncodeObjectFrame{tail},context))

def Encode.object_after(members: List<&2,Member<Json>>, context: EncodeContext) -> EncodeStep:
  match members:
    case Nil{}:
      Encode.close('}',context)
    case Con{member,tail}:
      Encode.emit(',',EncodeObjectNext{Con{member,tail}},context)

def Encode.step(work: EncodeWork, context: EncodeContext) -> EncodeStep:
  match work:
    case EncodeFinished{}:
      EncodeComplete{}
    case EncodeValue{value}:
      Encode.value(value,context)
    case EncodeSuffix{rest}:
      Encode.suffix(rest,context)
    case EncodeString{rest,count,key_value}:
      Encode.string(rest,count,key_value,context)
    case EncodeEscape{suffix,rest,count,key_value}:
      Encode.escape(suffix,rest,count,key_value,context)
    case EncodeArrayNext{items}:
      Encode.array_next(items,context)
    case EncodeArrayAfter{items}:
      Encode.array_after(items,context)
    case EncodeObjectNext{members}:
      Encode.object_next(members,context)
    case EncodeObjectAfter{members}:
      Encode.object_after(members,context)
    case EncodeColon{value}:
      Encode.emit(':',EncodeValue{value},context)

# Capacity is checked before any next character or value is inspected. A fully
# finished document is nevertheless accepted when its budget was exact.
def Encode.prepare(credit: Nat, state: EncodeState) -> EncodeStep:
  match credit state:
    case 0n EncodeState{context,EncodeFinished{}}:
      EncodeComplete{}
    case 0n EncodeState{context,work}:
      Encode.fail(EOutputLimit{},context)
    case 1n+p EncodeState{context,EncodeFinished{}}:
      EncodeComplete{}
    case 1n+p EncodeState{context,work}:
      Encode.step(work,context)

# The only encoder recursion emits one codepoint and shrinks public capacity.
# All preparation helpers above are acyclic, including continuation dispatch.
def Encode.loop(+credit: Nat, pending: EncodeStep, reversed: String) -> Result<&2,&2,EncodeError,String>:
  match credit pending:
    case 0n EncodeComplete{}:
      Done{String.reverse(reversed)}
    case 0n EncodeFailed{error}:
      Fail{error}
    case 0n EncodeEmit{char,EncodeState{context,work}}:
      Fail{EncodeError{EOutputLimit{},Nat.sub(Encode.offset(context),1n)}}
    case 1n+p EncodeComplete{}:
      Done{String.reverse(reversed)}
    case 1n+p EncodeFailed{error}:
      Fail{error}
    case 1n+p EncodeEmit{char,next}:
      Encode.loop(p,Encode.prepare(p,next),SCon{char,reversed})

def Encode.start(value: Json, limits: Limits) -> Result<&2,&2,EncodeError,String>:
  match limits:
    case Limits{i,d,n,s,v,+o}:
      Encode.loop(o,Encode.prepare(o,EncodeState{EncodeContext{Limits{i,d,n,s,v,o},0n,0n,0n,Nil{}},EncodeValue{value}}),"")

def Json.encode_checked(valid: Bool, value: Json, limits: Limits) -> Result<&2,&2,EncodeError,String>:
  match valid:
    case False{}:
      Fail{EncodeError{EInvalidLimits{},0n}}
    case True{}:
      Encode.start(value,limits)

def Json.encode(value: Json, +limits: Limits) -> Result<&2,&2,EncodeError,String>:
  Json.encode_checked(Limits.valid(limits),value,limits)
