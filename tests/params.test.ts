import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindParams, clearPlanCache } from '../src/params.ts';

test('positional placeholders bind in order', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE a = ? AND b = ?', [1, 'x']);
  assert.equal(sql, 'SELECT * FROM t WHERE a = ? AND b = ?');
  assert.deepEqual(values, [1, 'x']);
});

test('named placeholders (@name and :name) resolve from an object', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE a = @a AND b = :b', { a: 1, b: 2 });
  assert.equal(sql, 'SELECT * FROM t WHERE a = ? AND b = ?');
  assert.deepEqual(values, [1, 2]);
});

test('array values expand into an IN list', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE id IN ?', [[1, 2, 3]]);
  assert.equal(sql, 'SELECT * FROM t WHERE id IN (?, ?, ?)');
  assert.deepEqual(values, [1, 2, 3]);
});

test('an empty array expands to (NULL) so the query stays valid', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE id IN ?', [[]]);
  assert.equal(sql, 'SELECT * FROM t WHERE id IN (NULL)');
  assert.deepEqual(values, []);
});

test('placeholders inside string literals are left untouched', () => {
  const { sql, values } = bindParams("SELECT '? :x @y' AS lit, col = ?", ['v']);
  assert.equal(sql, "SELECT '? :x @y' AS lit, col = ?");
  assert.deepEqual(values, ['v']);
});

test('placeholders inside comments are left untouched', () => {
  const { sql, values } = bindParams('SELECT ? -- not a ? here\n, ?', [1, 2]);
  assert.deepEqual(values, [1, 2]);
  assert.ok(sql.includes('-- not a ? here'));
});

test('a no-space "--" is an operator, not a comment, so a following ? still binds', () => {
  const { sql, values } = bindParams('SELECT 5--?', [9]);
  assert.equal(sql, 'SELECT 5--?');
  assert.deepEqual(values, [9]);
});

test('"-- " (with trailing space) and a trailing "--" still open comments', () => {
  // trailing-space form: the ? after it is inside the comment and not bound
  const withSpace = bindParams('SELECT ? -- trailing ? comment\n, ?', [1, 2]);
  assert.deepEqual(withSpace.values, [1, 2]);
  // "--" at end of input opens a comment that consumes the rest of the line
  const atEnd = bindParams('SELECT ? --', [1]);
  assert.deepEqual(atEnd.values, [1]);
});

test('@@ system variables are not treated as named params', () => {
  const { sql, values } = bindParams('SELECT @@global.max_connections, ?', [1]);
  assert.equal(sql, 'SELECT @@global.max_connections, ?');
  assert.deepEqual(values, [1]);
});

test('no params yields the sql unchanged with no values', () => {
  const { sql, values } = bindParams('SELECT 1', undefined);
  assert.equal(sql, 'SELECT 1');
  assert.deepEqual(values, []);
});

test('missing trailing positional params are padded with NULL (oxmysql parity)', () => {
  // Two placeholders, one value -> the extra binds as NULL rather than erroring.
  const { sql, values } = bindParams('INSERT INTO t (a, b) VALUES (?, ?)', [1]);
  assert.equal(sql, 'INSERT INTO t (a, b) VALUES (?, ?)');
  assert.deepEqual(values, [1, null]);
});

test('an explicit undefined value binds as NULL, never reaching the driver', () => {
  const { values } = bindParams('SELECT ?, ?', [undefined, 2]);
  assert.deepEqual(values, [null, 2]);
});

test('undefined inside an IN list is coerced to NULL too', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE id IN ?', [[1, undefined, 3]]);
  assert.equal(sql, 'SELECT * FROM t WHERE id IN (?, ?, ?)');
  assert.deepEqual(values, [1, null, 3]);
});

test('a missing NAMED param still throws (padding is positional-only)', () => {
  assert.throws(() => bindParams('SELECT @a, @b', { a: 1 }), /missing value/);
});

test('mixing positional sql with a named object throws', () => {
  assert.throws(() => bindParams('SELECT ?', { a: 1 }), /positional/);
});

test('mixing named sql with an array throws', () => {
  assert.throws(() => bindParams('SELECT @a', [1]), /named parameter/);
});

test('a missing named value throws', () => {
  assert.throws(() => bindParams('SELECT @a', { b: 1 }), /missing value/);
});

// --- binding-plan memoisation -------------------------------------------------
// The plan cache keys on the SQL string and stores structure only, so the same
// query reused with different params must never leak values between calls.

test('a reused positional query binds fresh values each call (no leak)', () => {
  const sql = 'SELECT * FROM t WHERE a = ? AND b = ?';
  assert.deepEqual(bindParams(sql, [1, 2]).values, [1, 2]);
  assert.deepEqual(bindParams(sql, [3, 4]).values, [3, 4]); // cache hit
  assert.deepEqual(bindParams(sql, [5]).values, [5, null]); // pad still applies
});

test('a reused named query binds fresh values each call via its template', () => {
  const sql = 'UPDATE t SET a = @a WHERE id = @id';
  const first = bindParams(sql, { a: 1, id: 9 });
  assert.equal(first.sql, 'UPDATE t SET a = ? WHERE id = ?');
  assert.deepEqual(first.values, [1, 9]);
  const second = bindParams(sql, { a: 2, id: 8 });
  assert.equal(second.sql, 'UPDATE t SET a = ? WHERE id = ?');
  assert.deepEqual(second.values, [2, 8]); // template reused, values fresh
});

test('a named query with an array value still expands into an IN list', () => {
  const { sql, values } = bindParams('SELECT * FROM t WHERE id IN :ids', { ids: [1, 2, 3] });
  assert.equal(sql, 'SELECT * FROM t WHERE id IN (?, ?, ?)');
  assert.deepEqual(values, [1, 2, 3]);
});

test('a query mixing ? and named defers to the full parser (throws on the ?)', () => {
  assert.throws(() => bindParams('SELECT ?, @a', { a: 1 }), /positional/);
});

test('cold (uncached) and warm (cached) parses produce identical output', () => {
  const cases = [
    ['SELECT * FROM t WHERE a = ? AND b = ?', [1, 'x']],
    ['SELECT * FROM t WHERE id IN ? AND x = ?', [[1, 2], 5]],
    ['UPDATE t SET a = @a WHERE id = @id', { a: 1, id: 9 }],
    ["SELECT '? :x @y' AS lit, col = ?", ['v']]
  ];
  for (const [sql, params] of cases) {
    const warm = bindParams(sql, params); // populate the cache
    clearPlanCache();
    const cold = bindParams(sql, params); // re-analyze from scratch
    assert.deepEqual(cold, warm, sql);
  }
});
