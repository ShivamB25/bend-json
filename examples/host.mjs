import assert from 'node:assert/strict';
import Core from '../json.bend';

const limits = Core['Json.default_limits']();
const input = '{"x":[-1.5e+2,"\\u0041"]}';
const parsed = Core['Json.parse'](input, limits);
console.dir({ input, parsed }, { depth: null });
assert.equal(parsed.$, 'Done');
// Objects are ordered linked lists of Member records, not JavaScript maps.
const member = parsed.value.members.head;
assert.equal(member.key, 'x');
assert.equal(member.value.items.head.text, '-1.5e+2');
assert.equal(member.value.items.tail.head.value, 'A');
const encoded = Core['Json.encode'](parsed.value, limits);
console.dir({ encoded }, { depth: null });
assert.deepEqual(encoded, { $: 'Done', value: '{"x":[-1.5e+2,"A"]}' });
const number = Core['Json.number']('281474976710656', limits);
console.dir({ number }, { depth: null });
assert.deepEqual(number, { $: 'Done', value: { $: 'Number', text: '281474976710656' } });
