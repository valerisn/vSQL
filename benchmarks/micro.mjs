// Microbenchmarks for vSQL's pure hot-path functions — no database required.
// These are the bits that run on *every* query (parameter binding, read/write
// classification, cache lookups, shape normalization), so their cost matters.
//
//   node benchmarks/micro.mjs
//
// Requires Node 24+ (native TypeScript type stripping, same as the test suite).

import { bindParams } from '../src/params.ts';
import { isReadQuery } from '../src/util.ts';
import { normalizeShape } from '../src/profiler.ts';
import { ResultCache } from '../src/cache.ts';

function bench(name, fn, iterations = 1_000_000) {
  // Warm up so the JIT has compiled the hot path before we measure.
  for (let i = 0; i < 10_000; i++) fn(i);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(i);
  const ms = performance.now() - start;
  const opsPerSec = (iterations / ms) * 1000;
  const nsPerOp = (ms * 1e6) / iterations;
  console.log(
    `  ${name.padEnd(34)} ${formatNum(opsPerSec).padStart(14)} ops/s   ${nsPerOp.toFixed(0).padStart(6)} ns/op`
  );
}

function formatNum(n) {
  return Math.round(n).toLocaleString('en-US');
}

console.log('\nvSQL microbenchmarks (pure functions, no DB)\n');

bench('bindParams positional', () =>
  bindParams('SELECT * FROM players WHERE money > ? AND job = ?', [1000, 'police'])
);

bench('bindParams named', () =>
  bindParams('SELECT * FROM players WHERE citizenid = @id AND active = @active', { id: 'ABC123', active: 1 })
);

bench('bindParams IN-list expansion', () =>
  bindParams('SELECT * FROM vehicles WHERE plate IN ?', [['AAA111', 'BBB222', 'CCC333', 'DDD444']])
);

bench('isReadQuery', (i) => isReadQuery(i % 2 ? 'SELECT * FROM t WHERE id = 1' : 'UPDATE t SET a = 1'));

bench('normalizeShape', () =>
  normalizeShape("SELECT * FROM players WHERE money > 1000 AND name = 'bob' AND id IN (1, 2, 3)")
);

const cache = new ResultCache();
cache.configure(true, 1000, 30_000);
const key = cache.key('SELECT * FROM players WHERE id = ?', [1]);
cache.set(key, [{ id: 1, name: 'bob' }]);
bench('cache get (hit)', () => cache.get(key));

console.log('');
