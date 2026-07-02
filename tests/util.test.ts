import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoff,
  connectionHint,
  isCacheable,
  isCacheableRead,
  isFatalConnectionError,
  isLockingRead,
  isReadQuery,
  isRetryableError,
  preview,
  withStatementTimeout
} from '../src/lib/util.ts';

test('isReadQuery recognises read statements (incl. leading comments/parens)', () => {
  for (const sql of [
    'SELECT 1',
    '  select * from t',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'SHOW TABLES',
    'EXPLAIN SELECT 1',
    '/* c */ SELECT 1',
    '-- lead\nSELECT 1',
    '(SELECT 1)'
  ]) {
    assert.ok(isReadQuery(sql), `expected read: ${sql}`);
  }
});

test('isReadQuery rejects writes', () => {
  for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)']) {
    assert.ok(!isReadQuery(sql), `expected write: ${sql}`);
  }
});

test('isReadQuery treats a CTE that ends in DML as a write', () => {
  for (const sql of [
    'WITH x AS (SELECT id FROM t) DELETE FROM t WHERE id IN (SELECT id FROM x)',
    'WITH x AS (SELECT 1 AS a) UPDATE t SET a = 1',
    'WITH x AS (SELECT id FROM src) INSERT INTO dst SELECT id FROM x',
    'WITH x AS (SELECT 1) REPLACE INTO t SELECT * FROM x'
  ]) {
    assert.ok(!isReadQuery(sql), `expected write: ${sql}`);
  }
  // A CTE feeding a SELECT is still a read.
  assert.ok(isReadQuery('WITH x AS (SELECT 1) SELECT * FROM x'));
});

test('isLockingRead detects FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE', () => {
  assert.ok(isLockingRead('SELECT * FROM t WHERE id = 1 FOR UPDATE'));
  assert.ok(isLockingRead('SELECT * FROM t FOR SHARE'));
  assert.ok(isLockingRead('SELECT * FROM t LOCK IN SHARE MODE'));
  assert.ok(!isLockingRead('SELECT * FROM t WHERE id = 1'));
});

test('isFatalConnectionError honours the fatal flag and known codes', () => {
  assert.ok(isFatalConnectionError({ fatal: true }));
  assert.ok(isFatalConnectionError({ code: 'PROTOCOL_CONNECTION_LOST' }));
  assert.ok(isFatalConnectionError({ code: 'ECONNREFUSED' }));
  assert.ok(!isFatalConnectionError({ code: 'ER_DUP_ENTRY' }));
  assert.ok(!isFatalConnectionError(null));
  assert.ok(!isFatalConnectionError(undefined));
});

test('isRetryableError matches deadlock / lock-wait by code or errno', () => {
  assert.ok(isRetryableError({ code: 'ER_LOCK_DEADLOCK' }));
  assert.ok(isRetryableError({ code: 'ER_LOCK_WAIT_TIMEOUT' }));
  assert.ok(isRetryableError({ errno: 1213 }));
  assert.ok(isRetryableError({ errno: 1205 }));
  assert.ok(!isRetryableError({ code: 'ER_DUP_ENTRY', errno: 1062 }));
  assert.ok(!isRetryableError(null));
});

test('backoff grows but stays within [0, cap]', () => {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const d = backoff(attempt, 500, 30_000);
    assert.ok(d >= 0 && d <= 30_000, `attempt ${attempt} -> ${d}`);
  }
  // With full jitter the floor for a given attempt is half the (capped) window.
  assert.ok(backoff(3, 500, 30_000) >= 1000);
});

test('connectionHint maps known codes and stays quiet otherwise', () => {
  assert.match(connectionHint({ code: 'ECONNREFUSED' }), /refused/i);
  assert.match(connectionHint({ code: 'ER_ACCESS_DENIED_ERROR' }), /access denied/i);
  assert.match(connectionHint({ code: 'ER_BAD_DB_ERROR' }), /does not exist/i);
  assert.equal(connectionHint({ code: 'ER_DUP_ENTRY' }), '');
  assert.equal(connectionHint(null), '');
  assert.equal(connectionHint({}), '');
});

test('withStatementTimeout wraps per server type and is a no-op when off', () => {
  // MariaDB: SET STATEMENT ... FOR caps any statement, ms -> seconds
  assert.equal(
    withStatementTimeout('UPDATE t SET a = 1', 500, 'mariadb'),
    'SET STATEMENT max_statement_time=0.5 FOR UPDATE t SET a = 1'
  );
  // MySQL: optimizer hint injected into a leading SELECT
  assert.equal(
    withStatementTimeout('SELECT * FROM t', 1000, 'mysql'),
    'SELECT /*+ MAX_EXECUTION_TIME(1000) */ * FROM t'
  );
  // MySQL: non-SELECT is left unwrapped (hint only valid in a SELECT)
  assert.equal(withStatementTimeout('UPDATE t SET a = 1', 1000, 'mysql'), 'UPDATE t SET a = 1');
  // zero / negative timeout is a no-op
  assert.equal(withStatementTimeout('SELECT 1', 0, 'mariadb'), 'SELECT 1');
});

test('isCacheable: a plain read with caching on is cacheable', () => {
  assert.ok(isCacheable('SELECT * FROM players WHERE id = ?', true, false));
});

test('isCacheable: caching off is never cacheable', () => {
  assert.ok(!isCacheable('SELECT 1', false, false));
});

test('isCacheable: a per-call opt-out ({ cache: false }) bypasses the cache', () => {
  assert.ok(!isCacheable('SELECT 1', true, true));
});

test('isCacheable: locking reads are never cached even with caching on', () => {
  assert.ok(!isCacheable('SELECT * FROM t WHERE id = 1 FOR UPDATE', true, false));
  assert.ok(!isCacheable('SELECT * FROM t FOR SHARE', true, false));
  assert.ok(!isCacheable('SELECT * FROM t LOCK IN SHARE MODE', true, false));
});

test('isCacheable: writes are never cached', () => {
  for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t']) {
    assert.ok(!isCacheable(sql, true, false), sql);
  }
});

test('isCacheableRead matches isCacheable when given the right classification', () => {
  for (const sql of [
    'SELECT * FROM t WHERE id = ?',
    'SELECT * FROM t FOR UPDATE',
    'UPDATE t SET a = 1',
    'INSERT INTO t VALUES (1)'
  ]) {
    for (const enabled of [true, false]) {
      for (const optedOut of [true, false]) {
        const ref = isCacheable(sql, enabled, optedOut);
        const fast = isCacheableRead(sql, enabled, optedOut, isReadQuery(sql));
        assert.equal(fast, ref, `${sql} enabled=${enabled} optedOut=${optedOut}`);
      }
    }
  }
});

test('isCacheableRead trusts the passed classification (no re-parse)', () => {
  // A locking read is still excluded even when isRead is true.
  assert.ok(!isCacheableRead('SELECT * FROM t FOR UPDATE', true, false, true));
  // A plain read is cacheable; the cheap guards short-circuit first.
  assert.ok(isCacheableRead('SELECT 1', true, false, true));
  assert.ok(!isCacheableRead('SELECT 1', false, false, true));
  assert.ok(!isCacheableRead('SELECT 1', true, true, true));
  assert.ok(!isCacheableRead('SELECT 1', true, false, false));
});

test('preview collapses whitespace and truncates long sql', () => {
  assert.equal(preview('SELECT\n   1'), 'SELECT 1');
  const long = preview('x'.repeat(500), 200);
  assert.ok(long.length <= 201 && long.endsWith('…'));
});
