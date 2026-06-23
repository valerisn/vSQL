// Example JS migration. Useful when a change needs logic a plain .sql file can't
// express (computed values, conditional backfills, reading then writing rows).
// It receives the migration connection (a mysql2/promise Connection).
module.exports.up = async (conn) => {
  const [rows] = await conn.query("SELECT COUNT(*) AS n FROM players WHERE citizenid = 'ADMIN0001'");
  if (rows[0].n > 0) return;

  await conn.query(
    'INSERT INTO players (citizenid, license, name, bank) VALUES (?, ?, ?, ?)',
    ['ADMIN0001', 'license:seed', 'Server Admin', 1_000_000]
  );
};
