import assert from 'node:assert/strict';
import { limitFields } from '../tests/support.ts';
import type { AstNode, Expectation, Json, Limits } from '../tests/support.ts';

export { limitFields };

export interface InvalidScalarItem {
  text?: string;
  value?: Json;
}
export interface ConstructionItem extends InvalidScalarItem {
  id: string;
  limits: Limits;
  expect: Expectation;
  operation?: 'number' | 'parse' | 'encode';
  scalarCodes?: readonly number[];
  defaultLimits?: boolean;
  expression?: string;
}

// Emit constructors, not a JSON parser call. Explicit Chr also preserves malformed
// scalar payloads which a JS UTF-8 encoder would silently replace with U+FFFD.
export function bendString(text: string, scalars: ReadonlyMap<number, string> = new Map()): string {
  const chars = [...text];
  let output = 'SNil{}';
  for (let index = chars.length - 1; index >= 0; index--) {
    const character = chars[index];
    assert.ok(character !== undefined);
    const code = character.codePointAt(0);
    assert.ok(code !== undefined);
    output = `SCon{${scalars.get(code) || `Chr{${code}}`},${output}}`;
  }
  return output;
}

export function bendLimits(value: Limits): string {
  return `J.Limits{${limitFields.map(field => {
    assert.ok(value[field] >= 0n && value[field] <= 281474976710655n);
    return `${value[field]}n`;
  }).join(',')}}`;
}

export function bendValue(value: Json, scalars: ReadonlyMap<number, string> = new Map()): string {
  const work: Array<AstNode | string> = [value];
  const output: string[] = [];
  while (work.length > 0) {
    const item = work.pop();
    assert.ok(item !== undefined);
    if (typeof item === 'string') {
      output.push(item);
      continue;
    }
    switch (item.$) {
      case 'Null':
        output.push('J.Null{}');
        break;
      case 'Boolean':
        output.push(`J.Boolean{${item.value ? 'True' : 'False'}{}}`);
        break;
      case 'Number':
        output.push(`J.Number{${bendString(item.text, scalars)}}`);
        break;
      case 'Text':
        output.push(`J.Text{${bendString(item.value, scalars)}}`);
        break;
      case 'Array':
        output.push('J.Array{');
        work.push('}', item.items);
        break;
      case 'Object':
        output.push('J.Object{');
        work.push('}', item.members);
        break;
      case 'Nil':
        output.push('Nil{}');
        break;
      case 'Con':
        output.push('Con{');
        work.push('}', item.tail, ',', item.head);
        break;
      case 'Member':
        output.push(`J.Member{${bendString(item.key, scalars)},`);
        work.push('}', item.value);
        break;
    }
  }
  return output.join('');
}

export function invalidScalars(item: InvalidScalarItem): number[] {
  const found = new Set<number>();
  const work: AstNode[] = item.value === undefined ? [] : [item.value];
  const inspect = (text: string): void => {
    for (const character of text) {
      const codepoint = character.codePointAt(0);
      assert.ok(codepoint !== undefined);
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) found.add(codepoint);
    }
  };
  if (item.text !== undefined) inspect(item.text);
  while (work.length > 0) {
    const value = work.pop();
    assert.ok(value);
    switch (value.$) {
      case 'Number':
        inspect(value.text);
        break;
      case 'Text':
        inspect(value.value);
        break;
      case 'Array':
        work.push(value.items);
        break;
      case 'Object':
        work.push(value.members);
        break;
      case 'Con':
        work.push(value.head, value.tail);
        break;
      case 'Member':
        inspect(value.key);
        work.push(value.value);
        break;
      case 'Null':
      case 'Boolean':
      case 'Nil':
        break;
    }
  }
  return [...found];
}

export function constructionSource(items: readonly ConstructionItem[]): string {
  const definitions = ['import Base', 'import ../../json.bend as J', 'import ../../tests/support.bend as T', ''];
  items.forEach((item, index) => {
    const scalarCodes = item.scalarCodes ?? invalidScalars(item);
    const scalars = new Map(scalarCodes.map((code, scalarIndex) => [code, `bad${scalarIndex}`]));
    definitions.push(`def case_${index}() -> IO(Unit):`);
    for (const [code, name] of scalars) definitions.push(`  +${name} = {Chr{${code}} : Char}`);
    definitions.push('  do IO<Unit>:');
    for (const name of scalars.values()) definitions.push(`    T.Native.scalar_marker(${name})`);
    definitions.push(`    IO.write("CASE\\t${index}\\t")`);
    const bounds = item.defaultLimits ? 'J.Json.default_limits()' : bendLimits(item.limits);
    const value = item.expression ?? (item.value === undefined ? undefined : bendValue(item.value, scalars));
    if (item.operation === 'number' || item.operation === 'parse') {
      assert.ok(item.text !== undefined);
      const text = bendString(item.text, scalars);
      if (item.operation === 'number') {
        definitions.push(`    T.Native.number_result(J.Json.number(${text}, ${bounds}))`);
      } else {
        definitions.push(`    T.Native.parsed(J.Json.parse(${text}, ${bounds}), False{}, ${bounds})`);
      }
    } else {
      assert.ok(value !== undefined);
      if (item.operation === 'encode') {
        definitions.push(`    T.Native.encode_result(J.Json.encode(${value}, ${bounds}))`);
      } else {
        definitions.push(`    T.Native.constructed(${value}, ${bounds})`);
      }
    }
    definitions.push('');
  });
  definitions.push('def main() -> IO(Unit):', '  do IO<Unit>:');
  // IO.print_err calls pinned io_errs, which flushes stdout before emitting the
  // stderr marker. Keep START outside case_N so even AST construction is timed.
  items.forEach((_item, index) => definitions.push(
    `    IO.print_err("START\\t${index}")`,
    `    case_${index}()`,
    `    IO.print_err("END\\t${index}")`,
  ));
  return `${definitions.join('\n')}\n`;
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
