import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asAffected, asInsertId, asScalar, asSingle, normalizeEntry } from '../src/lib/shape.ts';

test('single() returns the first row, or null on an empty result set', () => {
  assert.deepEqual(asSingle([{ id: 1 }, { id: 2 }]), { id: 1 });
  assert.equal(asSingle([]), null);
  // A non-array (e.g. an OK packet) is treated as "no row".
  assert.equal(asSingle(undefined), null);
  assert.equal(asSingle({ affectedRows: 1 }), null);
});

test('scalar() returns the first column of the first row, or null', () => {
  assert.equal(asScalar([{ total: 42, other: 9 }]), 42);
  // Column order follows object insertion order, not name.
  assert.equal(asScalar([{ name: 'bob', id: 7 }]), 'bob');
  assert.equal(asScalar([]), null);
  assert.equal(asScalar(undefined), null);
  // A row with no columns has no first value.
  assert.equal(asScalar([{}]), null);
});

test('scalar() preserves a falsy-but-present first column', () => {
  assert.equal(asScalar([{ n: 0 }]), 0);
  assert.equal(asScalar([{ flag: false }]), false);
  assert.equal(asScalar([{ v: null }]), null);
});

test('insert() returns insertId from the OK packet, or 0', () => {
  assert.equal(asInsertId({ insertId: 17, affectedRows: 1 }), 17);
  assert.equal(asInsertId({ affectedRows: 1 }), 0);
  assert.equal(asInsertId(undefined), 0);
  // insertId 0 (no AUTO_INCREMENT column) passes through, not coerced away.
  assert.equal(asInsertId({ insertId: 0 }), 0);
});

test('update() returns affectedRows from the OK packet, or 0', () => {
  assert.equal(asAffected({ affectedRows: 5 }), 5);
  assert.equal(asAffected({ affectedRows: 0 }), 0);
  assert.equal(asAffected({ insertId: 9 }), 0);
  assert.equal(asAffected(undefined), 0);
});

test('normalizeEntry accepts a bare string (no params)', () => {
  assert.deepEqual(normalizeEntry('DELETE FROM t'), ['DELETE FROM t', undefined]);
});

test('normalizeEntry accepts a [sql, params] tuple', () => {
  assert.deepEqual(normalizeEntry(['UPDATE t SET a = ?', [1]]), ['UPDATE t SET a = ?', [1]]);
});

test('normalizeEntry accepts the object form (query/sql + values/params)', () => {
  assert.deepEqual(normalizeEntry({ query: 'SELECT ?', values: [1] }), ['SELECT ?', [1]]);
  assert.deepEqual(normalizeEntry({ sql: 'SELECT ?', params: [2] }), ['SELECT ?', [2]]);
  // query wins over sql; values wins over params when both are present.
  assert.deepEqual(normalizeEntry({ query: 'A', sql: 'B', values: [1], params: [2] }), ['A', [1]]);
});

test('normalizeEntry throws when the object form has no query text', () => {
  assert.throws(() => normalizeEntry({ values: [1] } as any), /missing a "query" string/);
});
