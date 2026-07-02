import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPAT_METHODS,
  GHMATTI_ALIASES,
  MYSQL_ASYNC_ALIASES,
  ghmattiExports,
  mysqlAsyncExports,
  oxmysqlExports
} from '../src/lib/compat-surface.ts';

// These expectations are transcribed directly from oxmysql 2.14.1's source
// (src/index.ts + src/compatibility/*). They lock vSQL's claimed export surface
// to the reference so it can't silently drift. The one deliberate omission is
// oxmysql's experimental `startTransaction` (see COMPATIBILITY.md).

test('the oxmysql namespace exposes bare, _async and Sync for every method', () => {
  const names = oxmysqlExports();
  // 13 methods x 3 forms.
  assert.equal(names.length, COMPAT_METHODS.length * 3);
  for (const m of ['query', 'single', 'scalar', 'update', 'insert', 'prepare', 'rawExecute', 'transaction', 'store', 'execute', 'fetch']) {
    assert.ok(names.includes(m), `missing ${m}`);
    assert.ok(names.includes(`${m}_async`), `missing ${m}_async`);
    assert.ok(names.includes(`${m}Sync`), `missing ${m}Sync`);
  }
  // isReady / awaitConnection are part of the surface too.
  assert.ok(names.includes('isReady') && names.includes('awaitConnection'));
});

test('ghmattimysql maps exactly query->execute, scalar, transaction, store (+Sync)', () => {
  assert.deepEqual(GHMATTI_ALIASES, {
    query: 'execute',
    scalar: 'scalar',
    transaction: 'transaction',
    store: 'store'
  });
  assert.deepEqual(ghmattiExports().sort(), [
    'execute',
    'executeSync',
    'scalar',
    'scalarSync',
    'store',
    'storeSync',
    'transaction',
    'transactionSync'
  ].sort());
});

test('mysql-async maps exactly the mysql_* names with no Sync variants', () => {
  assert.deepEqual(MYSQL_ASYNC_ALIASES, {
    update: 'mysql_execute',
    insert: 'mysql_insert',
    query: 'mysql_fetch_all',
    scalar: 'mysql_fetch_scalar',
    transaction: 'mysql_transaction',
    store: 'mysql_store'
  });
  assert.deepEqual(mysqlAsyncExports().sort(), [
    'mysql_execute',
    'mysql_fetch_all',
    'mysql_fetch_scalar',
    'mysql_insert',
    'mysql_store',
    'mysql_transaction'
  ].sort());
  // No Sync variants on mysql-async.
  assert.ok(!mysqlAsyncExports().some((n) => n.endsWith('Sync')));
});

test('every aliased method is also a real served method', () => {
  for (const m of Object.keys(GHMATTI_ALIASES)) assert.ok((COMPAT_METHODS as readonly string[]).includes(m), m);
  for (const m of Object.keys(MYSQL_ASYNC_ALIASES)) assert.ok((COMPAT_METHODS as readonly string[]).includes(m), m);
});
