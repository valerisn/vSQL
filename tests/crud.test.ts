import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDelete,
  buildInsert,
  buildInsertReturning,
  buildSelect,
  buildSelectById,
  buildUpdate,
  escapeId
} from '../src/crud.ts';

test('escapeId backtick-wraps and doubles internal backticks', () => {
  assert.equal(escapeId('players'), '`players`');
  assert.equal(escapeId('a`b'), '`a``b`');
  assert.equal(escapeId('schema.table'), '`schema`.`table`');
});

test('escapeId neutralises an injection attempt in an identifier', () => {
  // The whole thing collapses to one quoted identifier - no statement break-out.
  assert.equal(escapeId('x`; DROP TABLE y; --'), '`x``; DROP TABLE y; --`');
});

test('escapeId rejects a non-string / empty identifier', () => {
  assert.throws(() => escapeId(''), /non-empty string/);
  assert.throws(() => escapeId(undefined as any), /non-empty string/);
});

test('buildInsert builds a single-row parameterised insert', () => {
  const q = buildInsert('players', { citizenid: 'ABC', name: 'bob' });
  assert.equal(q.sql, 'INSERT INTO `players` (`citizenid`, `name`) VALUES (?, ?)');
  assert.deepEqual(q.values, ['ABC', 'bob']);
});

test('buildInsert builds a multi-row insert from an array, columns from the first row', () => {
  const q = buildInsert('logs', [
    { player: 1, action: 'login' },
    { player: 2, action: 'logout' }
  ]);
  assert.equal(q.sql, 'INSERT INTO `logs` (`player`, `action`) VALUES (?, ?), (?, ?)');
  assert.deepEqual(q.values, [1, 'login', 2, 'logout']);
});

test('buildInsert rejects empty input', () => {
  assert.throws(() => buildInsert('t', []), /at least one row/);
  assert.throws(() => buildInsert('t', {}), /at least one column/);
});

test('buildUpdate builds SET + WHERE with values in order', () => {
  const q = buildUpdate('players', { money: 100, job: 'police' }, { id: 7 });
  assert.equal(q.sql, 'UPDATE `players` SET `money` = ?, `job` = ? WHERE `id` = ?');
  assert.deepEqual(q.values, [100, 'police', 7]);
});

test('buildUpdate refuses an empty WHERE (no accidental full-table update)', () => {
  assert.throws(() => buildUpdate('players', { money: 0 }, {}), /requires a WHERE/);
});

test('where conditions handle equality, NULL, and IN (array)', () => {
  const q = buildSelect('players', { job: 'police', deleted_at: null, id: [1, 2, 3] });
  assert.equal(q.sql, 'SELECT * FROM `players` WHERE `job` = ? AND `deleted_at` IS NULL AND `id` IN ?');
  // NULL contributes no bound value; the array is bound whole for bindParams to expand.
  assert.deepEqual(q.values, ['police', [1, 2, 3]]);
});

test('buildSelect supports columns, order, limit and offset', () => {
  const q = buildSelect('players', { job: 'police' }, {
    columns: ['id', 'name'],
    orderBy: 'name',
    order: 'DESC',
    limit: 20,
    offset: 40
  });
  assert.equal(q.sql, 'SELECT `id`, `name` FROM `players` WHERE `job` = ? ORDER BY `name` DESC LIMIT ? OFFSET ?');
  assert.deepEqual(q.values, ['police', 20, 40]);
});

test('buildSelect with no where omits the WHERE clause', () => {
  const q = buildSelect('players');
  assert.equal(q.sql, 'SELECT * FROM `players`');
  assert.deepEqual(q.values, []);
});

test('a raw [sql, params] where is passed through with its params', () => {
  const q = buildSelect('players', ['money > ? AND job = ?', [1000, 'police']]);
  assert.equal(q.sql, 'SELECT * FROM `players` WHERE money > ? AND job = ?');
  assert.deepEqual(q.values, [1000, 'police']);
});

test('buildInsertReturning appends RETURNING * by default', () => {
  const q = buildInsertReturning('players', { citizenid: 'ABC', name: 'bob' });
  assert.equal(q.sql, 'INSERT INTO `players` (`citizenid`, `name`) VALUES (?, ?) RETURNING *');
  assert.deepEqual(q.values, ['ABC', 'bob']);
});

test('buildInsertReturning escapes an explicit column list', () => {
  const q = buildInsertReturning('players', { name: 'bob' }, ['id', 'created_at']);
  assert.equal(q.sql, 'INSERT INTO `players` (`name`) VALUES (?) RETURNING `id`, `created_at`');
});

test('buildSelectById fetches the inserted row by id (default id column)', () => {
  assert.equal(buildSelectById('players'), 'SELECT * FROM `players` WHERE `id` = ?');
  assert.equal(
    buildSelectById('players', 'citizenid', ['name', 'money']),
    'SELECT `name`, `money` FROM `players` WHERE `citizenid` = ?'
  );
});

test('buildDelete builds a parameterised delete and refuses an empty WHERE', () => {
  const q = buildDelete('inventory', { id: 9 });
  assert.equal(q.sql, 'DELETE FROM `inventory` WHERE `id` = ?');
  assert.deepEqual(q.values, [9]);
  assert.throws(() => buildDelete('inventory', {}), /requires a WHERE/);
});
