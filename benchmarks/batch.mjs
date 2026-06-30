// Batch / bulk-write round-trip benchmark.
//
//   BENCH_DB=mysql://root:pw@host:3306/db node benchmarks/batch.mjs
//
// Inserting N rows three ways, to show where the round-trips go:
//   - per-row loop (oxmysql rawExecute style): N executes, N round-trips
//   - transactional batch (vSQL batch()):       BEGIN + N executes + COMMIT
//   - multi-row INSERT (vSQL insertInto([...])): ONE statement, one round-trip
//
// The point: vSQL's batch() of *distinct* statements is inherently N round-trips
// (a transaction can't pipeline them safely without multipleStatements, which we
// keep off for injection safety) - but the common bulk-insert case already
// collapses to a single round-trip through insertInto with an array. Use that for
// bulk inserts; reserve batch() for N genuinely different statements.
//
// Env: BENCH_ROWS (default 500). Requires Node 24+.

const url = process.env.BENCH_DB;
if (!url) {
  console.error('Set BENCH_DB, e.g. BENCH_DB=mysql://root:pw@localhost:3306/bench node benchmarks/batch.mjs');
  process.exit(1);
}

const ROWS = Number(process.env.BENCH_ROWS ?? 500);
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ uri: url, connectionLimit: 4, namedPlaceholders: false });
const tbl = `vsql_batch_bench_${Date.now()}`;

const rows = Array.from({ length: ROWS }, (_, i) => [`row${i}`, i]);

async function timed(label, runs, fn) {
  for (let i = 0; i < 3; i++) await fn(); // warm
  const samples = [];
  for (let i = 0; i < runs; i++) {
    await pool.query(`TRUNCATE ${tbl}`);
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`  ${label.padEnd(42)} ${(samples[Math.floor(runs / 2)]).toFixed(2).padStart(9)} ms (median, ${ROWS} rows)`);
}

try {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`);
  await pool.query(`CREATE TABLE ${tbl} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64), n INT) ENGINE=InnoDB`);

  console.log(`\nBulk write of ${ROWS} rows - three strategies\n`);

  await timed('per-row loop (N round-trips)', 5, async () => {
    for (const r of rows) await pool.execute(`INSERT INTO ${tbl} (name, n) VALUES (?, ?)`, r);
  });

  await timed('transactional batch (BEGIN + N + COMMIT)', 5, async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) await conn.execute(`INSERT INTO ${tbl} (name, n) VALUES (?, ?)`, r);
      await conn.commit();
    } finally {
      conn.release();
    }
  });

  await timed('multi-row INSERT (1 round-trip)', 5, async () => {
    const placeholders = rows.map(() => '(?, ?)').join(', ');
    await pool.execute(`INSERT INTO ${tbl} (name, n) VALUES ${placeholders}`, rows.flat());
  });

  console.log('\n  Multi-row INSERT wins by collapsing N trips into one - exactly what');
  console.log('  vSQL.insertInto(table, [rows...]) generates. batch() is for N distinct');
  console.log('  statements, where N trips are unavoidable.\n');
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
  await pool.end();
}
