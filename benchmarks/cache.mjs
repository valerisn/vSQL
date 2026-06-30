// Cache-hit path benchmark.
//
//   node benchmarks/cache.mjs                         # CPU-only (hit path cost)
//   BENCH_DB=mysql://root:pw@host:3306/db node benchmarks/cache.mjs   # + real miss
//
// A cache hit returns before any binding, plan lookup, or round-trip - so the
// only question is (a) how cheap the hit path itself is and (b) how big the
// round-trip it skips is. The hit path is measured against the *actual* leaf
// modules read() composes (isReadQuery / isLockingRead / ResultCache), so the
// numbers reflect production code, not a mock. With BENCH_DB set, a real
// point-SELECT gives the miss/round-trip cost the hit avoids.
//
// Requires Node 24+ (native TypeScript type stripping).

import { isReadQuery, isLockingRead, isCacheable, isCacheableRead } from '../src/util.ts';
import { ResultCache } from '../src/cache.ts';

function bench(name, fn, iterations = 2_000_000) {
  for (let i = 0; i < 20_000; i++) fn(i); // warm
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(i);
  const ms = performance.now() - start;
  const opsPerSec = (iterations / ms) * 1000;
  const nsPerOp = (ms * 1e6) / iterations;
  console.log(`  ${name.padEnd(40)} ${fmt(opsPerSec).padStart(14)} ops/s   ${nsPerOp.toFixed(1).padStart(7)} ns/op`);
  return nsPerOp;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// A primed cache holding one entry, exactly as read() would after a miss.
const cache = new ResultCache();
cache.configure(true, 1000, 30_000);
const SQL = 'SELECT id, name, money FROM players WHERE id = ?';
const PARAMS = [42];
cache.set(cache.key(SQL, PARAMS), [{ id: 42, name: 'bob', money: 1000 }]);

console.log('\nCache hit path (pure CPU, no DB)\n');

// Before: read() re-classified (query() ran isReadQuery for routing, then
// isCacheable ran it again) before checking the cache.
const oldHitNs = bench('hit path - before (classify twice)', () => {
  isReadQuery(SQL); // routing
  if (isCacheable(SQL, true, false)) {
    const k = cache.key(SQL, PARAMS);
    cache.get(k);
  }
});

// After: classification is reused, so the read path runs isReadQuery once.
const newHitNs = bench('hit path - after (classify once)', () => {
  const isRead = isReadQuery(SQL); // routing
  if (isCacheableRead(SQL, true, false, isRead)) {
    const k = cache.key(SQL, PARAMS);
    cache.get(k);
  }
});

console.log(`\n  trim: ${(oldHitNs - newHitNs).toFixed(1)} ns/hit (${(((oldHitNs - newHitNs) / oldHitNs) * 100).toFixed(0)}%)`);

if (!process.env.BENCH_DB) {
  console.log('\n  Set BENCH_DB to also measure the real round-trip a hit avoids.\n');
  process.exit(0);
}

// --- the round-trip a hit skips -------------------------------------------
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ uri: process.env.BENCH_DB, connectionLimit: 1, namedPlaceholders: false });
const tbl = `vsql_cache_bench_${Date.now()}`;

try {
  await pool.query(`CREATE TABLE ${tbl} (id INT PRIMARY KEY, name VARCHAR(64), money INT) ENGINE=InnoDB`);
  await pool.execute(`INSERT INTO ${tbl} (id, name, money) VALUES (?, ?, ?)`, [42, 'bob', 1000]);

  // Warm, then time many point reads.
  for (let i = 0; i < 50; i++) await pool.execute(`SELECT id, name, money FROM ${tbl} WHERE id = ?`, [42]);
  const N = 2000;
  const start = performance.now();
  for (let i = 0; i < N; i++) await pool.execute(`SELECT id, name, money FROM ${tbl} WHERE id = ?`, [42]);
  const missNs = ((performance.now() - start) / N) * 1e6;

  console.log('\nReal round-trip (the miss a hit skips)\n');
  console.log(`  point SELECT by PK                       ${(missNs / 1000).toFixed(1).padStart(7)} us/op`);
  console.log(`\n  a cache hit is ~${Math.round(missNs / newHitNs).toLocaleString('en-US')}x faster than the round-trip it replaces`);
  console.log('  (the lever is skipping the trip; the hit path itself is already sub-microsecond)\n');
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  await pool.end();
}
