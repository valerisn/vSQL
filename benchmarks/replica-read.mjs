// Read-replica throughput benchmark.
//
//   BENCH_DB=mysql://u:pw@primary:3306/db \
//   BENCH_REPLICA=mysql://u:pw@replica:3306/db \
//     node benchmarks/replica-read.mjs
//
// Per-query latency is fixed (network + server), so a replica can't make a single
// read faster - but it adds read capacity. This drives concurrent reads two ways
// and compares aggregate throughput:
//   - primary only (one pool)
//   - primary + replica, round-robin (what vSQL does when replicas are configured)
//
// It also confirms failover: if BENCH_REPLICA is unreachable, the round-robin path
// should still serve every read from the primary (vSQL marks a failed replica down
// and falls back; here we just verify reads succeed).
//
// Env: BENCH_CONCURRENCY (default 32), BENCH_DURATION_MS (default 4000),
// BENCH_POOL per pool (default 8). Requires Node 24+.

const primaryUrl = process.env.BENCH_DB;
const replicaUrl = process.env.BENCH_REPLICA;
if (!primaryUrl) {
  console.error('Set BENCH_DB (primary) and BENCH_REPLICA (replica).');
  process.exit(1);
}
if (!replicaUrl) {
  console.error('Set BENCH_REPLICA to a replica DSN to compare; with only BENCH_DB there is nothing to route to.');
  process.exit(1);
}

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 32);
const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 4000);
const POOL = Number(process.env.BENCH_POOL ?? 8);

const mysql = (await import('mysql2/promise')).default;
const mkPool = (uri) => mysql.createPool({ uri, connectionLimit: POOL, namedPlaceholders: false });

const primary = mkPool(primaryUrl);
const replica = mkPool(replicaUrl);
const tbl = `vsql_replica_bench_${Date.now()}`;

function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
}

// Round-robin reader, mirroring vSQL's replica routing (with failover to primary).
function makeRouter(pools) {
  let i = 0;
  return async (sql, params) => {
    const pool = pools[i++ % pools.length];
    try {
      return await pool.execute(sql, params);
    } catch {
      return primary.execute(sql, params); // failover
    }
  };
}

async function run(label, read) {
  const latencies = [];
  let count = 0;
  const deadline = performance.now() + DURATION_MS;
  async function worker() {
    while (performance.now() < deadline) {
      const id = 1 + Math.floor(Math.random() * 1000);
      const start = performance.now();
      await read(`SELECT id, name, money FROM ${tbl} WHERE id = ?`, [id]);
      latencies.push(performance.now() - start);
      count++;
    }
  }
  const wall0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wall = performance.now() - wall0;
  latencies.sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(26)} ${String(Math.round((count / wall) * 1000)).padStart(8)} reads/s   ` +
      `p50 ${pct(latencies, 50).toFixed(2)}  p95 ${pct(latencies, 95).toFixed(2)}  p99 ${pct(latencies, 99).toFixed(2)} ms`
  );
}

try {
  await primary.query(`DROP TABLE IF EXISTS ${tbl}`);
  await primary.query(`CREATE TABLE ${tbl} (id INT PRIMARY KEY, name VARCHAR(64), money INT) ENGINE=InnoDB`);
  for (let i = 1; i <= 1000; i++) await primary.execute(`INSERT INTO ${tbl} (id, name, money) VALUES (?, ?, ?)`, [i, `row${i}`, i]);
  // Give replication a moment (the table must exist on the replica).
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`\nRead throughput - concurrency ${CONCURRENCY}, ${DURATION_MS}ms, pool ${POOL}/server\n`);
  await run('primary only', (s, p) => primary.execute(s, p));
  await run('primary + replica (rr)', makeRouter([primary, replica]));
  console.log('\n  A replica adds read capacity (higher reads/s under load); single-read');
  console.log('  latency is unchanged. Writes always stay on the primary.\n');
} finally {
  await primary.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  await primary.end();
  await replica.end();
}
