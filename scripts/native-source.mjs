import assert from 'node:assert/strict';

export const limitFields = ['max_input', 'max_depth', 'max_number', 'max_string', 'max_values', 'max_output'];

// Emit constructors, not a JSON parser call. Explicit Chr also preserves malformed
// scalar payloads which a JS UTF-8 encoder would silently replace with U+FFFD.
export function bendString(text, scalars = new Map()) {
  const chars = [...text];
  let out = 'SNil{}';
  for (let i = chars.length - 1; i >= 0; i--) {
    const code = chars[i].codePointAt(0);
    out = `SCon{${scalars.get(code) || `Chr{${code}}`},${out}}`;
  }
  return out;
}

export function bendLimits(value) {
  return `J.Limits{${limitFields.map(field => {
    assert.equal(typeof value[field], 'bigint');
    assert.ok(value[field] >= 0n && value[field] <= 281474976710655n);
    return `${value[field]}n`;
  }).join(',')}}`;
}

export function bendValue(value, scalars = new Map()) {
  const work = [value], out = [];
  while (work.length) {
    const item = work.pop();
    if (typeof item === 'string') { out.push(item); continue; }
    switch (item.$) {
      case 'Null': out.push('J.Null{}'); break;
      case 'Boolean': out.push(`J.Boolean{${item.value ? 'True' : 'False'}{}}`); break;
      case 'Number': out.push(`J.Number{${bendString(item.text, scalars)}}`); break;
      case 'Text': out.push(`J.Text{${bendString(item.value, scalars)}}`); break;
      case 'Array': out.push('J.Array{'); work.push('}', item.items); break;
      case 'Object': out.push('J.Object{'); work.push('}', item.members); break;
      case 'Nil': out.push('Nil{}'); break;
      case 'Con': out.push('Con{'); work.push('}', item.tail, ',', item.head); break;
      case 'Member': out.push(`J.Member{${bendString(item.key, scalars)},`); work.push('}', item.value); break;
      default: throw new Error(`Unknown native fixture constructor: ${item.$}`);
    }
  }
  return out.join('');
}

export function invalidScalars(item) {
  const found = new Set(), work = item.value === undefined ? [] : [item.value];
  const inspect = text => { for (const ch of text) { const cp = ch.codePointAt(0); if (cp >= 0xd800 && cp <= 0xdfff) found.add(cp); } };
  if (item.text !== undefined) inspect(item.text);
  while (work.length) {
    const value = work.pop();
    switch (value.$) {
      case 'Number': inspect(value.text); break;
      case 'Text': inspect(value.value); break;
      case 'Array': work.push(value.items); break;
      case 'Object': work.push(value.members); break;
      case 'Con': work.push(value.head, value.tail); break;
      case 'Member': inspect(value.key); work.push(value.value); break;
    }
  }
  return [...found];
}

export function constructionSource(items) {
  const defs = ['import Base', 'import ../../json.bend as J', 'import ../../tests/support.bend as T', ''];
  items.forEach((item, index) => {
    const scalars = new Map((item.scalarCodes || invalidScalars(item)).map((code, i) => [code, `bad${i}`]));
    defs.push(`def case_${index}() -> IO(Unit):`);
    for (const [code, name] of scalars) defs.push(`  +${name} = {Chr{${code}} : Char}`);
    defs.push('  do IO<Unit>:');
    for (const name of scalars.values()) defs.push(`    T.Native.scalar_marker(${name})`);
    defs.push(`    IO.write("CASE\\t${index}\\t")`);
    const limits = item.defaultLimits ? 'J.Json.default_limits()' : bendLimits(item.limits);
    const value = item.expression || (item.value === undefined ? undefined : bendValue(item.value, scalars));
    if (item.operation === 'number') defs.push(`    T.Native.number_result(J.Json.number(${bendString(item.text, scalars)}, ${limits}))`);
    else if (item.operation === 'parse') defs.push(`    T.Native.parsed(J.Json.parse(${bendString(item.text, scalars)}, ${limits}), False{}, ${limits})`);
    else if (item.operation === 'encode') defs.push(`    T.Native.encode_result(J.Json.encode(${value}, ${limits}))`);
    else defs.push(`    T.Native.constructed(${value}, ${limits})`);
    defs.push('');
  });
  defs.push('def main() -> IO(Unit):', '  do IO<Unit>:');
  // IO.print_err calls pinned io_errs, which flushes stdout before emitting the
  // stderr marker. Keep START outside case_N so even AST construction is timed.
  items.forEach((_, index) => defs.push(`    IO.print_err("START\\t${index}")`, `    case_${index}()`, `    IO.print_err("END\\t${index}")`));
  return defs.join('\n') + '\n';
}

export const controlsSource = `import Base
import ../../json.bend as J
import ../../tests/support.bend as T

def repeat_items(n: Nat, items: List<&2, J.Json>) -> List<&2, J.Json>:
  match n:
    case 0n:
      items
    case 1n+p:
      repeat_items(p, Con{J.Number{"1"}, items})

def nest(n: Nat, value: J.Json) -> J.Json:
  match n:
    case 0n:
      value
    case 1n+p:
      nest(p, J.Array{Con{value, Nil{}}})

def defaults(limits: J.Limits) -> IO(Unit):
  match limits:
    case J.Limits{i,d,n,s,v,o}:
      IO.print("DEFAULTS\\t" ++ Nat.show(i) ++ "\\t" ++ Nat.show(d) ++ "\\t" ++ Nat.show(n) ++ "\\t" ++ Nat.show(s) ++ "\\t" ++ Nat.show(v) ++ "\\t" ++ Nat.show(o))

def main() -> IO(Unit):
  do IO<Unit>:
    defaults(J.Json.default_limits())
    T.Native.require(T.Native.equal_control(T.Equality.trees(J.Array{repeat_items(100000n, Nil{})}, J.Array{repeat_items(100000n, Nil{})}, J.Json.default_limits())), "EQUAL_WIDE")
    T.Native.require(T.Native.different_control(T.Equality.trees(J.Array{repeat_items(99999n, Con{J.Number{"1"}, Nil{}})}, J.Array{repeat_items(99999n, Con{J.Number{"2"}, Nil{}})}, J.Json.default_limits())), "UNEQUAL_LATE")
    T.Native.require(T.Native.equal_control(T.Equality.trees(nest(10000n, J.Null{}), nest(10000n, J.Null{}), J.Json.default_limits())), "EQUAL_DEEP")
    T.Native.require(T.Native.different_control(T.Equality.trees(J.Number{"-0"}, J.Number{"0"}, J.Json.default_limits())), "UNEQUAL_LEXEME")
    T.Native.require(T.Native.different_control(T.Equality.trees(J.Object{Con{J.Member{"a", J.Null{}}, Con{J.Member{"a", J.Boolean{True{}}}, Nil{}}}}, J.Object{Con{J.Member{"a", J.Boolean{True{}}}, Con{J.Member{"a", J.Null{}}, Nil{}}}}, J.Json.default_limits())), "UNEQUAL_ORDER")
    T.Native.require(T.Native.exhausted_control(T.Equality.loop(0n, T.EqualityPending{Con{T.CompareJson{J.Null{}, J.Null{}}, Nil{}}})), "EXHAUSTION_DISTINCT")
`;
