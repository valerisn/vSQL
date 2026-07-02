import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/lib/breaker.ts';

// A mutable clock so we can drive the cooldown deterministically.
function clock(start = 0) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('a disabled breaker (threshold 0) never opens', () => {
  const b = new CircuitBreaker();
  b.configure(0, 1000);
  for (let i = 0; i < 100; i++) b.onFailure();
  assert.equal(b.isOpen(), false);
  assert.equal(b.state(), 'closed');
});

test('opens after the threshold of consecutive failures', () => {
  const c = clock();
  const b = new CircuitBreaker(c.now);
  b.configure(3, 1000);
  b.onFailure();
  b.onFailure();
  assert.equal(b.isOpen(), false); // 2 < 3
  b.onFailure();
  assert.equal(b.isOpen(), true); // 3 >= 3
  assert.equal(b.state(), 'open');
});

test('a success closes it and resets the failure count', () => {
  const c = clock();
  const b = new CircuitBreaker(c.now);
  b.configure(2, 1000);
  b.onFailure();
  b.onFailure();
  assert.equal(b.isOpen(), true);
  b.onSuccess();
  assert.equal(b.isOpen(), false);
  assert.equal(b.state(), 'closed');
  // counter reset: a single later failure shouldn't immediately re-open.
  b.onFailure();
  assert.equal(b.isOpen(), false);
});

test('after the cooldown it reports half-open (a probe is allowed)', () => {
  const c = clock();
  const b = new CircuitBreaker(c.now);
  b.configure(1, 1000);
  b.onFailure();
  assert.equal(b.state(), 'open');
  c.t += 999;
  assert.equal(b.state(), 'open'); // still inside the window
  c.t += 1; // now 1000ms elapsed
  assert.equal(b.isOpen(), false);
  assert.equal(b.state(), 'half-open');
});

test('a failure while half-open re-opens and restarts the cooldown', () => {
  const c = clock();
  const b = new CircuitBreaker(c.now);
  b.configure(1, 1000);
  b.onFailure(); // open at t=0
  c.t = 1000; // half-open
  assert.equal(b.state(), 'half-open');
  b.onFailure(); // re-open at t=1000
  assert.equal(b.isOpen(), true);
  c.t = 1999;
  assert.equal(b.isOpen(), true); // cooldown restarted from 1000
  c.t = 2000;
  assert.equal(b.isOpen(), false);
});
