import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeColumns, shapeTables } from '../src/lib/schema.ts';

test('shapeColumns maps information_schema rows to a clean shape', () => {
  const rows = [
    { COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_DEFAULT: null },
    { COLUMN_NAME: 'name', DATA_TYPE: 'varchar', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_DEFAULT: 'anon' }
  ];
  assert.deepEqual(shapeColumns(rows), [
    { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null },
    { name: 'name', type: 'varchar', nullable: true, key: '', default: 'anon' }
  ]);
});

test('shapeColumns: IS_NULLABLE maps to a boolean and missing key/default default cleanly', () => {
  const [col] = shapeColumns([{ COLUMN_NAME: 'x', DATA_TYPE: 'bit', IS_NULLABLE: 'NO' }]);
  assert.equal(col.nullable, false);
  assert.equal(col.key, '');
  assert.equal(col.default, null);
});

test('shapeColumns returns [] for a non-array (e.g. an OK packet)', () => {
  assert.deepEqual(shapeColumns(undefined), []);
  assert.deepEqual(shapeColumns({ affectedRows: 0 }), []);
});

test('shapeTables pulls TABLE_NAME from each row', () => {
  assert.deepEqual(shapeTables([{ TABLE_NAME: 'players' }, { TABLE_NAME: 'vehicles' }]), ['players', 'vehicles']);
  assert.deepEqual(shapeTables(null), []);
});
