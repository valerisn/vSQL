import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoff, isFatalConnectionError, isLockingRead, isReadQuery, preview } from '../src/util.ts';

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

test('backoff grows but stays within [0, cap]', () => {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const d = backoff(attempt, 500, 30_000);
    assert.ok(d >= 0 && d <= 30_000, `attempt ${attempt} -> ${d}`);
  }
  // With full jitter the floor for a given attempt is half the (capped) window.
  assert.ok(backoff(3, 500, 30_000) >= 1000);
});

test('preview collapses whitespace and truncates long sql', () => {
  assert.equal(preview('SELECT\n   1'), 'SELECT 1');
  const long = preview('x'.repeat(500), 200);
  assert.ok(long.length <= 201 && long.endsWith('…'));
});
