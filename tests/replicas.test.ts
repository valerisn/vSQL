import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplicaSet } from '../src/lib/replicas.ts';

function clock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('an empty set hands out nothing', () => {
  const set = new ReplicaSet<string>();
  assert.equal(set.size, 0);
  assert.equal(set.next(), undefined);
});

test('a single replica is returned every time', () => {
  const set = new ReplicaSet<string>();
  set.add('r1', 'r1');
  assert.equal(set.next(), 'r1');
  assert.equal(set.next(), 'r1');
});

test('multiple replicas are handed out round-robin', () => {
  const set = new ReplicaSet<string>();
  set.add('a', 'a');
  set.add('b', 'b');
  set.add('c', 'c');
  assert.deepEqual([set.next(), set.next(), set.next(), set.next()], ['a', 'b', 'c', 'a']);
});

test('a down replica is skipped during its cooldown', () => {
  const c = clock();
  const set = new ReplicaSet<string>(c.now);
  set.configure(5000);
  set.add('a', 'a');
  set.add('b', 'b');
  set.markDown('a');
  // 'a' is out for 5s, so only 'b' is handed out.
  assert.equal(set.next(), 'b');
  assert.equal(set.next(), 'b');
  assert.deepEqual(set.status(), [
    { label: 'a', down: true },
    { label: 'b', down: false }
  ]);
});

test('all replicas down yields undefined (caller falls back to primary)', () => {
  const c = clock();
  const set = new ReplicaSet<string>(c.now);
  set.configure(5000);
  set.add('a', 'a');
  set.add('b', 'b');
  set.markDown('a');
  set.markDown('b');
  assert.equal(set.next(), undefined);
});

test('a replica rejoins rotation after its cooldown elapses', () => {
  const c = clock();
  const set = new ReplicaSet<string>(c.now);
  set.configure(5000);
  set.add('a', 'a');
  set.markDown('a');
  assert.equal(set.next(), undefined); // still in cooldown
  c.t += 5000;
  assert.equal(set.next(), 'a'); // back in rotation
  assert.deepEqual(set.status(), [{ label: 'a', down: false }]);
});

test('all() exposes every pool (for draining on shutdown)', () => {
  const set = new ReplicaSet<string>();
  set.add('a', 'a');
  set.add('b', 'b');
  assert.deepEqual(set.all(), ['a', 'b']);
});
