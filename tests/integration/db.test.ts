import { test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { bindParams } from '../../src/params.ts';
import { asAffected, asInsertId, asScalar, asSingle } from '../../src/shape.ts';
import { runAtomic } from '../../src/retry.ts';

// Integration coverage for the importable query logic - the param parser, the
// result-shape helpers, and the transaction retry loop - against a *real*
// engine. The Database singleton itself can't run here (it depends on FiveM
// natives), so the connection lifecycle stays unit-tested; this verifies the
// pieces that touch SQL behave the same against MySQL and MariaDB.
//
// Set one or more of these to a DSN to run, otherwise the suite skips cleanly:
//   VSQL_TEST_MYSQL_DSN   = mysql://user:pass@host:3306/db
//   VSQL_TEST_MARIADB_DSN = mysql://user:pass@host:3307/db
//   VSQL_TEST_DSN         = a single generic target
const targets = [
  ['mysql', process.env.VSQL_TEST_MYSQL_DSN],
  ['mariadb', process.env.VSQL_TEST_MARIADB_DSN],
  ['db', process.env.VSQL_TEST_DSN]
].filter((t): t is [string, string] => Boolean(t[1]));

if (targets.length === 0) {
  test('integration suite skipped (no VSQL_TEST_*_DSN set)', {
    skip: 'set VSQL_TEST_DSN, VSQL_TEST_MYSQL_DSN or VSQL_TEST_MARIADB_DSN to run'
  });
}

for (const [label, dsn] of targets) {
  test(`[${label}] vSQL query logic against a real server`, async (t) => {
    const pool = mysql.createPool(dsn);
    const tbl = `vsql_it_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const run = (sql: string, params?: any) => {
      const b = bindParams(sql, params);
      return pool.query(b.sql, b.values).then(([rows]) => rows);
    };

    try {
      await pool.query(
        `CREATE TABLE ${tbl} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64), money INT) ENGINE=InnoDB`
      );

      await t.test('insert binds positionally and returns a real insertId', async () => {
        const header = await run(`INSERT INTO ${tbl} (name, money) VALUES (?, ?)`, ['alice', 100]);
        assert.ok(asInsertId(header) > 0, 'expected a positive AUTO_INCREMENT id');
      });

      await t.test('named params (@name / :name) resolve against a real server', async () => {
        await run(`INSERT INTO ${tbl} (name, money) VALUES (@name, :money)`, { name: 'bob', money: 250 });
        const rows = await run(`SELECT money FROM ${tbl} WHERE name = @name`, { name: 'bob' });
        assert.equal(asScalar(rows), 250);
      });

      await t.test('array values expand into a working IN (...) list', async () => {
        await run(`INSERT INTO ${tbl} (name, money) VALUES (?, ?)`, ['carol', 75]);
        const rows = await run(`SELECT name FROM ${tbl} WHERE name IN ? ORDER BY name`, [['alice', 'carol']]);
        assert.deepEqual((rows as any[]).map((r) => r.name), ['alice', 'carol']);
      });

      await t.test('an empty IN list matches nothing rather than erroring', async () => {
        const rows = await run(`SELECT name FROM ${tbl} WHERE name IN ?`, [[]]);
        assert.equal((rows as any[]).length, 0);
      });

      await t.test('single() / scalar() shape real result sets', async () => {
        const one = asSingle(await run(`SELECT name, money FROM ${tbl} WHERE name = ?`, ['alice']));
        assert.equal(one.name, 'alice');
        const none = asSingle(await run(`SELECT name FROM ${tbl} WHERE name = ?`, ['nobody']));
        assert.equal(none, null);
        const sum = asScalar(await run(`SELECT SUM(money) AS s FROM ${tbl}`));
        assert.equal(Number(sum), 425); // 100 + 250 + 75
      });

      await t.test('update() reflects a real affected-row count', async () => {
        const header = await run(`UPDATE ${tbl} SET money = money + ? WHERE name = ?`, [50, 'alice']);
        assert.equal(asAffected(header), 1);
      });

      await t.test('runAtomic commits a real transaction', async () => {
        await runAtomic({
          attempts: 1,
          acquire: () => pool.getConnection(),
          work: async (conn) => {
            const b = bindParams(`INSERT INTO ${tbl} (name, money) VALUES (?, ?)`, ['dave', 10]);
            await conn.execute(b.sql, b.values);
          },
          isRetryable: () => false
        });
        const cnt = asScalar(await run(`SELECT COUNT(*) AS c FROM ${tbl} WHERE name = ?`, ['dave']));
        assert.equal(Number(cnt), 1);
      });

      await t.test('runAtomic rolls a failed transaction back', async () => {
        await assert.rejects(
          runAtomic({
            attempts: 1,
            acquire: () => pool.getConnection(),
            work: async (conn) => {
              const b = bindParams(`INSERT INTO ${tbl} (name, money) VALUES (?, ?)`, ['ghost', 1]);
              await conn.execute(b.sql, b.values);
              throw new Error('boom'); // abort after the insert
            },
            isRetryable: () => false
          }),
          /boom/
        );
        const cnt = asScalar(await run(`SELECT COUNT(*) AS c FROM ${tbl} WHERE name = ?`, ['ghost']));
        assert.equal(Number(cnt), 0, 'the rolled-back insert must not persist');
      });
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${tbl}`).catch(() => {});
      await pool.end();
    }
  });
}
