import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindParams } from '../src/params.ts';

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

test('mixing positional sql with a named object throws', () => {
  assert.throws(() => bindParams('SELECT ?', { a: 1 }), /positional/);
});

test('mixing named sql with an array throws', () => {
  assert.throws(() => bindParams('SELECT @a', [1]), /named parameter/);
});

test('a missing named value throws', () => {
  assert.throws(() => bindParams('SELECT @a', { b: 1 }), /missing value/);
});
