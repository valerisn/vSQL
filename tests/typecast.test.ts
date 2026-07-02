import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castValue } from '../src/lib/typecast.ts';

// Minimal stand-in for mysql2's TypeCastField. Only the bits castValue reads.
function field(opts: { type: string; length?: number; string?: string | null; buffer?: number[] | null }): any {
  return {
    type: opts.type,
    length: opts.length ?? 0,
    string: () => opts.string ?? null,
    buffer: () => (opts.buffer == null ? null : Buffer.from(opts.buffer))
  };
}

const NEXT = Symbol('next');
const next = () => NEXT;

test('DATETIME / TIMESTAMP become epoch milliseconds', () => {
  const expected = new Date('2024-01-02 03:04:05').getTime();
  assert.equal(castValue(field({ type: 'DATETIME', string: '2024-01-02 03:04:05' }), next), expected);
  assert.equal(castValue(field({ type: 'TIMESTAMP', string: '2024-01-02 03:04:05' }), next), expected);
});

test('DATE becomes epoch milliseconds at local midnight', () => {
  assert.equal(castValue(field({ type: 'DATE', string: '2024-01-02' }), next), new Date('2024-01-02 00:00:00').getTime());
});

test('a null date string casts to null, not NaN', () => {
  assert.equal(castValue(field({ type: 'DATETIME', string: null }), next), null);
  assert.equal(castValue(field({ type: 'DATE', string: null }), next), null);
});

test('TINYINT(1) casts 0/1 to boolean', () => {
  assert.equal(castValue(field({ type: 'TINY', length: 1, string: '1' }), next), true);
  assert.equal(castValue(field({ type: 'TINY', length: 1, string: '0' }), next), false);
});

test('TINYINT wider than (1) is left numeric (falls through)', () => {
  assert.equal(castValue(field({ type: 'TINY', length: 3, string: '42' }), next), NEXT);
});

test('a TINYINT(1) value other than 0/1 falls through', () => {
  assert.equal(castValue(field({ type: 'TINY', length: 1, string: '2' }), next), NEXT);
});

test('BIT(1) casts to boolean', () => {
  assert.equal(castValue(field({ type: 'BIT', buffer: [1] }), next), true);
  assert.equal(castValue(field({ type: 'BIT', buffer: [0] }), next), false);
});

test('wider BIT or empty buffer falls through', () => {
  assert.equal(castValue(field({ type: 'BIT', buffer: [1, 0] }), next), NEXT);
  assert.equal(castValue(field({ type: 'BIT', buffer: null }), next), NEXT);
});

test('unhandled types fall through to next()', () => {
  assert.equal(castValue(field({ type: 'VAR_STRING', string: 'hello' }), next), NEXT);
  assert.equal(castValue(field({ type: 'LONG', string: '123' }), next), NEXT);
});
