import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultCache } from '../src/cache.ts';

function freshCache(max = 100, ttl = 1000): ResultCache {
  const c = new ResultCache();
  c.configure(true, max, ttl);
  return c;
}

test('stores and retrieves a value by key', () => {
  const c = freshCache();
  const k = c.key('SELECT 1', [1]);
  c.set(k, 42);
  assert.equal(c.get(k), 42);
});

test('a disabled cache never stores or serves', () => {
  const c = new ResultCache();
  c.configure(false, 100, 1000);
  const k = c.key('SELECT 1', null);
  c.set(k, 'v');
  assert.equal(c.get(k), undefined);
  assert.equal(c.size, 0);
});

test('expired entries are dropped on read', () => {
  const c = freshCache(100, -1); // ttl in the past -> already expired
  const k = c.key('SELECT 1', null);
  c.set(k, 'v');
  assert.equal(c.get(k), undefined);
});

test('LRU eviction removes the least-recently-used key past max', () => {
  const c = freshCache(2, 10_000);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // touch 'a' so 'b' becomes the LRU
  c.set('c', 3); // exceeds max -> evicts 'b'
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('c'), 3);
});

test('clear() empties the cache and returns the count removed', () => {
  const c = freshCache();
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.clear(), 2);
  assert.equal(c.size, 0);
});

test('clear(pattern) only removes matching keys', () => {
  const c = freshCache();
  c.set('SELECT * FROM players', 1);
  c.set('SELECT * FROM vehicles', 2);
  assert.equal(c.clear('players'), 1);
  assert.equal(c.get('SELECT * FROM vehicles'), 2);
});

test('key() is stable for equal sql + params and distinct otherwise', () => {
  const c = freshCache();
  assert.equal(c.key('SELECT ?', [1]), c.key('SELECT ?', [1]));
  assert.notEqual(c.key('SELECT ?', [1]), c.key('SELECT ?', [2]));
});
