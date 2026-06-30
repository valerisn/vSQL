// Throughput benchmark against a real MySQL/MariaDB, using the same mysql2 pool
// settings vSQL uses. Measures queries/sec and latency percentiles for a simple
// read and write workload.
//
//   BENCH_DB=mysql://root:pass@localhost:3306/bench node benchmarks/throughput.mjs
//
// Optional env: BENCH_CONCURRENCY (default 16), BENCH_DURATION_MS (default 5000).
//
// It creates a temporary table `vsql_bench`, runs the workload, prints results,
// and drops the table. Point oxmysql (or any other resource) at the same DB and
// table to compare like-for-like.

import mysql from 'mysql2/promise';

const url = process.env.BENCH_DB;
if (!url) {
  console.error('Set BENCH_DB to a connection string, e.g.');
  console.error('  BENCH_DB=mysql://root:pass@localhost:3306/bench node benchmarks/throughput.mjs');
  process.exit(1);
}

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 16);
const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 5000);

const pool = mysql.createPool({
  uri: url,
  connectionLimit: CONCURRENCY,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  namedPlaceholders: false
});

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function run(label, work) {
  const latencies = [];
  let count = 0;
  const deadline = performance.now() + DURATION_MS;

  async function worker() {
    while (performance.now() < deadline) {
      const start = performance.now();
      await work();
      latencies.push(performance.now() - start);
      count++;
    }
  }

  const wallStart = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wallMs = performance.now() - wallStart;

  latencies.sort((a, b) => a - b);
  console.log(`\n${label}`);
  console.log(`  throughput  ${Math.round((count / wallMs) * 1000).toLocaleString('en-US')} queries/s`);
  console.log(
    `  latency     p50 ${percentile(latencies, 50).toFixed(2)}ms   ` +
      `p95 ${percentile(latencies, 95).toFixed(2)}ms   p99 ${percentile(latencies, 99).toFixed(2)}ms`
  );
}

try {
  await pool.query('DROP TABLE IF EXISTS vsql_bench');
  await pool.query(`
    CREATE TABLE vsql_bench (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      money INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  for (let i = 0; i < 1000; i++) {
    await pool.execute('INSERT INTO vsql_bench (name, money) VALUES (?, ?)', [`row${i}`, i]);
  }

  console.log(`\nThroughput benchmark - concurrency ${CONCURRENCY}, ${DURATION_MS}ms per workload`);

  await run('point SELECT by primary key', async () => {
    const id = 1 + Math.floor(Math.random() * 1000);
    await pool.execute('SELECT id, name, money FROM vsql_bench WHERE id = ?', [id]);
  });

  await run('UPDATE by primary key', async () => {
    const id = 1 + Math.floor(Math.random() * 1000);
    await pool.execute('UPDATE vsql_bench SET money = money + 1 WHERE id = ?', [id]);
  });
} finally {
  await pool.query('DROP TABLE IF EXISTS vsql_bench').catch(() => {});
  await pool.end();
  console.log('');
}
