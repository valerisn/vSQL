import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Profiler, normalizeShape } from '../src/lib/profiler.ts';

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
  assert.equal(p.top().length, 0);
});

test('normalizeShape erases literals, comments and IN-list length', () => {
  assert.equal(
    normalizeShape("SELECT * FROM players WHERE money > 1000 AND name = 'bob'"),
    'SELECT * FROM players WHERE money > ? AND name = ?'
  );
  // calls that differ only by values collapse to one shape
  assert.equal(
    normalizeShape('SELECT * FROM t WHERE id = 5'),
    normalizeShape('SELECT * FROM t WHERE id = 9')
  );
  // IN lists of different lengths collapse together
  assert.equal(
    normalizeShape('SELECT * FROM t WHERE id IN (1, 2, 3)'),
    normalizeShape('SELECT * FROM t WHERE id IN (7, 8)')
  );
});

test('the in-flight gauge tracks concurrent queries and a high-water mark', () => {
  const p = new Profiler();
  p.enter();
  p.enter();
  p.enter();
  assert.equal(p.stats().inFlight, 3);
  assert.equal(p.stats().peakInFlight, 3);
  p.leave();
  p.leave();
  assert.equal(p.stats().inFlight, 1);
  assert.equal(p.stats().peakInFlight, 3); // peak stays at the high-water mark
});

test('leave() never drives the in-flight count negative', () => {
  const p = new Profiler();
  p.leave();
  p.leave();
  assert.equal(p.stats().inFlight, 0);
});

test('reset() keeps the live in-flight count but lowers the peak to it', () => {
  const p = new Profiler();
  p.enter();
  p.enter(); // peak 2, inFlight 2
  p.leave(); // inFlight 1
  p.reset();
  assert.equal(p.stats().inFlight, 1); // a query is still running
  assert.equal(p.stats().peakInFlight, 1); // high-water reset to current
});

test('byResource attributes count and total time to the calling resource', () => {
  const p = new Profiler();
  p.record('SELECT 1', 10, 'esx_banking');
  p.record('SELECT 2', 30, 'esx_banking');
  p.record('SELECT 3', 5, 'qb-garages');
  const by = p.byResource();
  // Heaviest (by total time) first.
  assert.equal(by[0].resource, 'esx_banking');
  assert.equal(by[0].count, 2);
  assert.equal(by[0].totalMs, 40);
  assert.equal(by[0].avgMs, 20);
  assert.equal(by[1].resource, 'qb-garages');
  assert.equal(by[1].count, 1);
});

test('records without a resource are not attributed to anyone', () => {
  const p = new Profiler();
  p.record('SELECT 1', 10); // no resource
  assert.equal(p.byResource().length, 0);
  assert.equal(p.stats().count, 1); // still counted globally
});

test('recordError attributes errors to the resource without inflating count', () => {
  const p = new Profiler();
  p.record('SELECT 1', 10, 'esx_banking');
  p.recordError('esx_banking');
  const r = p.byResource()[0];
  assert.equal(r.errors, 1);
  assert.equal(r.count, 1); // the failed query is not counted as a completed one
});

test('a cache hit counts toward the resource but adds no time', () => {
  const p = new Profiler();
  p.recordCacheHit('esx_banking');
  const r = p.byResource()[0];
  assert.equal(r.count, 1);
  assert.equal(r.totalMs, 0);
  assert.equal(r.avgMs, 0);
});

test('byResource is exposed through stats() and cleared by reset()', () => {
  const p = new Profiler();
  p.record('SELECT 1', 10, 'esx_banking');
  assert.equal(p.stats().byResource.length, 1);
  p.reset();
  assert.equal(p.stats().byResource.length, 0);
});

test('top() ranks shapes by total time, not single-call latency', () => {
  const p = new Profiler();
  // one slow call
  p.record('SELECT * FROM rare WHERE id = 1', 500);
  // many fast calls of the same shape (different literal) -> bigger total
  for (let i = 0; i < 1000; i++) p.record(`SELECT * FROM hot WHERE id = ${i}`, 2);
  const top = p.top(2);
  assert.equal(top.length, 2);
  assert.match(top[0].shape, /hot/); // 2000ms total beats the single 500ms call
  assert.equal(top[0].count, 1000);
  assert.equal(top[0].totalMs, 2000);
});
