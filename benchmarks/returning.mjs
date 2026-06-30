// RETURNING round-trip benchmark.
//
//   BENCH_DB=mysql://root:pw@host:3306/db node benchmarks/returning.mjs
//
// "Insert and get the inserted row" costs two round-trips the classic way
// (INSERT, then SELECT by id) but one on MariaDB 10.5+ (INSERT ... RETURNING).
// This measures both against a real server and reports the speedup. It detects
// the server from VERSION(): on MariaDB it runs both paths; on MySQL it runs only
// the two-trip path (no RETURNING) so you can still see the baseline. Run it once
// against a MariaDB DSN and once against a MySQL DSN to compare engines.
//
// Requires Node 24+.

const url = process.env.BENCH_DB;
if (!url) {
  console.error('Set BENCH_DB to a connection string, e.g.');
  console.error('  BENCH_DB=mysql://root:pw@localhost:3306/bench node benchmarks/returning.mjs');
  process.exit(1);
}

const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ uri: url, connectionLimit: 1, namedPlaceholders: false });
const tbl = `vsql_returning_bench_${Date.now()}`;

function avgMs(samples) {
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

async function time(label, n, fn) {
  for (let i = 0; i < 50; i++) await fn(i); // warm
  const samples = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn(i + 1_000_000);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const ms = avgMs(samples);
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(3).padStart(8)} ms avg   p95 ${samples[Math.floor(n * 0.95)].toFixed(3)} ms`);
  return ms;
}

try {
  const [verRows] = await pool.query('SELECT VERSION() AS v');
  const version = String(verRows[0].v);
  const isMaria = /mariadb/i.test(version);
  const m = version.match(/(\d+)\.(\d+)/);
  const supportsReturning = isMaria && m && (Number(m[1]) > 10 || (Number(m[1]) === 10 && Number(m[2]) >= 5));

  console.log(`\nRETURNING benchmark - ${version} (RETURNING ${supportsReturning ? 'supported' : 'not supported'})\n`);

  await pool.query(`DROP TABLE IF EXISTS ${tbl}`);
  await pool.query(
    `CREATE TABLE ${tbl} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`
  );

  const N = 2000;

  // Two round-trips: insert, then select the row back by its new id.
  const twoTrip = await time('insert + select (2 round-trips)', N, async (i) => {
    const [res] = await pool.execute(`INSERT INTO ${tbl} (name) VALUES (?)`, [`row${i}`]);
    await pool.execute(`SELECT id, name, created_at FROM ${tbl} WHERE id = ?`, [res.insertId]);
  });

  if (supportsReturning) {
    const oneTrip = await time('INSERT ... RETURNING (1 round-trip)', N, async (i) => {
      await pool.execute(`INSERT INTO ${tbl} (name) VALUES (?) RETURNING id, name, created_at`, [`row${i}`]);
    });
    console.log(`\n  RETURNING is ${(twoTrip / oneTrip).toFixed(2)}x faster (one round-trip instead of two)\n`);
  } else {
    console.log('\n  No RETURNING on this server; vSQL.insertAndFetch falls back to the 2-trip path above.\n');
  }
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  await pool.end();
}
