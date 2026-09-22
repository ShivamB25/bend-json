import assert from 'node:assert/strict';
import CoreImport from '../json.bend';
import { expectJsonCore } from '../tests/support.ts';

const Core = expectJsonCore(CoreImport);
const limits = Core['Json.default_limits']();
const input = '{"x":[-1.5e+2,"\\u0041"]}';
const parsed = Core['Json.parse'](input, limits);
console.dir({ input, parsed }, { depth: null });
assert.equal(parsed.$, 'Done');
if (parsed.$ !== 'Done') throw new Error('Expected Json.parse success');
// Objects are ordered linked lists of Member records, not JavaScript maps.
assert.equal(parsed.value.$, 'Object');
if (parsed.value.$ !== 'Object' || parsed.value.members.$ !== 'Con') {
  throw new Error('Expected a non-empty object');
}
const member = parsed.value.members.head;
assert.equal(member.key, 'x');
assert.equal(member.value.$, 'Array');
if (member.value.$ !== 'Array' || member.value.items.$ !== 'Con') {
  throw new Error('Expected a non-empty array');
}
assert.equal(member.value.items.head.$, 'Number');
if (member.value.items.head.$ !== 'Number') throw new Error('Expected number item');
assert.equal(member.value.items.head.text, '-1.5e+2');
const tail = member.value.items.tail;
assert.equal(tail.$, 'Con');
if (tail.$ !== 'Con' || tail.head.$ !== 'Text') throw new Error('Expected text item');
assert.equal(tail.head.value, 'A');
const encoded = Core['Json.encode'](parsed.value, limits);
console.dir({ encoded }, { depth: null });
assert.deepEqual(encoded, { $: 'Done', value: '{"x":[-1.5e+2,"A"]}' });
const number = Core['Json.number']('281474976710656', limits);
console.dir({ number }, { depth: null });
assert.deepEqual(number, { $: 'Done', value: { $: 'Number', text: '281474976710656' } });
