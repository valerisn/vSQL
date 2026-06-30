import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Profiler } from '../src/profiler.ts';

test('counts every recorded query and tracks errors / cache hits', () => {
  const p = new Profiler();
  p.record('SELECT 1', 5);
  p.record('SELECT 2', 7);
  p.recordError();
  p.recordCacheHit();
  const s = p.stats();
  assert.equal(s.count, 3); // two records + one cache hit
  assert.equal(s.errors, 1);
  assert.equal(s.cacheHits, 1);
});

test('average latency reflects only timed (non cache-hit) queries', () => {
  const p = new Profiler();
  p.record('SELECT 1', 10);
  p.record('SELECT 2', 20);
  // avg = total 30 over count 2 = 15
  assert.equal(p.stats().avgMs, 15);
});

test('ring buffer retains at most maxSamples without unbounded growth', () => {
  const p = new Profiler();
  // Push well past the 2000-sample window; percentiles should stay bounded by
  // the most recent window rather than the whole history.
  for (let i = 0; i < 5000; i++) p.record('SELECT 1', i < 3000 ? 1 : 1000);
  const s = p.stats();
  // The last 2000 samples are all 1000ms, so every percentile should be 1000.
  assert.equal(s.p50, 1000);
  assert.equal(s.p95, 1000);
  assert.equal(s.p99, 1000);
});

test('percentiles are ordered p50 <= p95 <= p99', () => {
  const p = new Profiler();
  for (let i = 1; i <= 100; i++) p.record('SELECT 1', i);
  const s = p.stats();
  assert.ok(s.p50 <= s.p95);
  assert.ok(s.p95 <= s.p99);
});

test('reset clears counters and samples', () => {
  const p = new Profiler();
  p.record('SELECT 1', 5);
  p.recordError();
  p.reset();
  const s = p.stats();
  assert.equal(s.count, 0);
  assert.equal(s.errors, 0);
  assert.equal(s.avgMs, 0);
  assert.equal(s.p50, 0);
});
