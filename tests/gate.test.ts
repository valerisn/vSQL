import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadyGate } from '../src/gate.ts';

test('starts closed', () => {
  const g = new ReadyGate();
  assert.equal(g.isReady, false);
});

test('whenReady resolves immediately once the gate is open', async () => {
  const g = new ReadyGate();
  g.open();
  assert.equal(g.isReady, true);
  // Should resolve without anything else opening it.
  await g.whenReady();
});

test('callers queued while closed are all released when the gate opens', async () => {
  const g = new ReadyGate();
  const order: number[] = [];
  const a = g.whenReady().then(() => order.push(1));
  const b = g.whenReady().then(() => order.push(2));
  const c = g.whenReady().then(() => order.push(3));

  // Still pending: nothing has resolved yet.
  let resolvedEarly = false;
  await Promise.race([
    Promise.all([a, b, c]).then(() => (resolvedEarly = true)),
    Promise.resolve()
  ]);
  assert.equal(resolvedEarly, false);

  g.open();
  await Promise.all([a, b, c]);
  assert.deepEqual(order, [1, 2, 3]); // released in the order they queued
});

test('closing re-queues new callers until the next open', async () => {
  const g = new ReadyGate();
  g.open();
  await g.whenReady(); // resolves now

  g.close();
  assert.equal(g.isReady, false);

  let resolved = false;
  const pending = g.whenReady().then(() => (resolved = true));
  await Promise.resolve();
  assert.equal(resolved, false); // queues again while closed

  g.open();
  await pending;
  assert.equal(resolved, true);
});

test('open is idempotent and does not double-release a waiter', async () => {
  const g = new ReadyGate();
  let count = 0;
  const p = g.whenReady().then(() => count++);
  g.open();
  g.open(); // second open has no queued waiters left to release
  await p;
  assert.equal(count, 1);
});

test('a waiter that queued before open still only resolves once', async () => {
  const g = new ReadyGate();
  let count = 0;
  const p = g.whenReady().then(() => count++);
  g.open();
  g.close();
  g.open(); // re-opening must not re-fire the already-resolved waiter
  await p;
  await Promise.resolve();
  assert.equal(count, 1);
});
