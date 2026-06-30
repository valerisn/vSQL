// Pool saturation benchmark.
//
//   BENCH_DB=mysql://root:pw@host:3306/db node benchmarks/saturation.mjs
//
// Past the pool size, queries queue for a free connection and tail latency
// climbs sharply - the real latency cliff under load. This drives a fixed-size
// pool with rising concurrency and reports throughput + p50/p95/p99 at each
// level, so the cliff is visible. Mirror BENCH_POOL to vSQL's vsql_pool_size to
// reproduce its behaviour; vSQL surfaces the same pressure live as
// peakInFlight / poolSize in getStats() (and `vsql` in the console).
//
// Env: BENCH_POOL (default 8), BENCH_DURATION_MS per level (default 3000).
// Requires Node 24+.

const url = process.env.BENCH_DB;
if (!url) {
  console.error('Set BENCH_DB, e.g. BENCH_DB=mysql://root:pw@localhost:3306/bench node benchmarks/saturation.mjs');
  process.exit(1);
}

const POOL = Number(process.env.BENCH_POOL ?? 8);
const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 3000);

const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ uri: url, connectionLimit: POOL, waitForConnections: true, queueLimit: 0, namedPlaceholders: false });
const tbl = `vsql_sat_bench_${Date.now()}`;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function level(concurrency) {
  const latencies = [];
  let count = 0;
  const deadline = performance.now() + DURATION_MS;
  async function worker() {
    while (performance.now() < deadline) {
      const id = 1 + Math.floor(Math.random() * 1000);
      const start = performance.now();
      await pool.execute(`SELECT id, name, money FROM ${tbl} WHERE id = ?`, [id]);
      latencies.push(performance.now() - start);
      count++;
    }
  }
  const wall0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wall = performance.now() - wall0;
  latencies.sort((a, b) => a - b);
  const qps = Math.round((count / wall) * 1000);
  console.log(
    `  ${String(concurrency).padStart(3)}  ${String(qps).padStart(8)} q/s   ` +
      `p50 ${pct(latencies, 50).toFixed(2)}  p95 ${pct(latencies, 95).toFixed(2)}  p99 ${pct(latencies, 99).toFixed(2)} ms` +
      `${concurrency > POOL ? '   <- past pool size' : ''}`
  );
}

try {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`);
  await pool.query(`CREATE TABLE ${tbl} (id INT PRIMARY KEY, name VARCHAR(64), money INT) ENGINE=InnoDB`);
  for (let i = 1; i <= 1000; i++) await pool.execute(`INSERT INTO ${tbl} (id, name, money) VALUES (?, ?, ?)`, [i, `row${i}`, i]);

  console.log(`\nPool saturation - connectionLimit ${POOL}, ${DURATION_MS}ms per level\n`);
  console.log('  conc   throughput   latency percentiles');
  for (const c of [1, Math.max(2, POOL >> 1), POOL, POOL * 2, POOL * 4, POOL * 8]) {
    await level(c);
  }
  console.log('\n  Throughput plateaus around the pool size; beyond it p95/p99 climb as');
  console.log('  queries queue for a connection. Raise vsql_pool_size, or cap the queue');
  console.log('  with vsql_queue_limit to fast-fail instead of pile up.\n');
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  await pool.end();
}
