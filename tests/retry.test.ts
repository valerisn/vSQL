import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAtomic } from '../src/retry.ts';
import type { AtomicConn } from '../src/retry.ts';

// A fake pooled connection that records every lifecycle call, so each test can
// assert exactly what the retry loop did to it.
class FakeConn implements AtomicConn {
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;
  rollbackThrows = false;

  async beginTransaction() {
    this.began++;
  }
  async commit() {
    this.committed++;
  }
  async rollback() {
    this.rolledBack++;
    if (this.rollbackThrows) throw new Error('rollback failed');
  }
  release() {
    this.released++;
  }
}

const deadlock = { code: 'ER_LOCK_DEADLOCK' };
const isDeadlock = (e: any) => e?.code === 'ER_LOCK_DEADLOCK';

// Build an acquire() that hands out the given connections in order.
function acquirer(conns: FakeConn[]) {
  let i = 0;
  return async () => conns[i++];
}

test('commits once and runs onCommit when the work succeeds first try', async () => {
  const conn = new FakeConn();
  let commits = 0;
  const result = await runAtomic({
    attempts: 3,
    acquire: acquirer([conn]),
    work: async () => 'ok',
    isRetryable: isDeadlock,
    onCommit: () => commits++
  });
  assert.equal(result, 'ok');
  assert.equal(conn.began, 1);
  assert.equal(conn.committed, 1);
  assert.equal(conn.rolledBack, 0);
  assert.equal(conn.released, 1); // released exactly once
  assert.equal(commits, 1);
});

test('retries a deadlock on a fresh connection, then succeeds', async () => {
  const a = new FakeConn();
  const b = new FakeConn();
  const retries: number[] = [];
  let commits = 0;
  let work = 0;
  const result = await runAtomic({
    attempts: 3,
    acquire: acquirer([a, b]),
    work: async () => {
      work++;
      if (work === 1) throw deadlock;
      return 'second';
    },
    isRetryable: isDeadlock,
    onCommit: () => commits++,
    onRetry: (attempt) => {
      retries.push(attempt);
    }
  });
  assert.equal(result, 'second');
  assert.deepEqual(retries, [1]); // onRetry fired once, for attempt 1
  // First connection rolled back and released, never committed.
  assert.equal(a.committed, 0);
  assert.equal(a.rolledBack, 1);
  assert.equal(a.released, 1);
  // Second connection committed and released.
  assert.equal(b.committed, 1);
  assert.equal(b.released, 1);
  assert.equal(commits, 1); // onCommit only on the successful attempt
});

test('rolls back on every attempt and throws the last error when retries are exhausted', async () => {
  const conns = [new FakeConn(), new FakeConn(), new FakeConn()];
  const retries: number[] = [];
  let commits = 0;
  let n = 0;
  await assert.rejects(
    runAtomic({
      attempts: 3, // 1 try + 2 retries
      acquire: acquirer(conns),
      work: async () => {
        n++;
        throw { code: 'ER_LOCK_DEADLOCK', errno: 1213, attempt: n };
      },
      isRetryable: isDeadlock,
      onCommit: () => commits++,
      onRetry: (attempt) => {
        retries.push(attempt);
      }
    }),
    (err: any) => err.attempt === 3 // the error from the final attempt propagates
  );
  assert.deepEqual(retries, [1, 2]); // onRetry between attempts, not after the last
  assert.equal(commits, 0); // never committed
  for (const c of conns) {
    assert.equal(c.began, 1);
    assert.equal(c.committed, 0);
    assert.equal(c.rolledBack, 1); // each attempt rolled back exactly once
    assert.equal(c.released, 1); // and released exactly once, no double-release
  }
});

test('a non-retryable error throws immediately without replaying', async () => {
  const a = new FakeConn();
  const b = new FakeConn();
  const retries: number[] = [];
  let work = 0;
  await assert.rejects(
    runAtomic({
      attempts: 3,
      acquire: acquirer([a, b]),
      work: async () => {
        work++;
        throw { code: 'ER_DUP_ENTRY', errno: 1062 };
      },
      isRetryable: isDeadlock,
      onRetry: (attempt) => {
        retries.push(attempt);
      }
    }),
    (err: any) => err.code === 'ER_DUP_ENTRY'
  );
  assert.equal(work, 1); // ran the unit just once
  assert.deepEqual(retries, []); // never retried
  assert.equal(a.rolledBack, 1);
  assert.equal(a.released, 1);
  assert.equal(b.began, 0); // second connection never acquired/used
});

test('a failing rollback does not mask the original error', async () => {
  const conn = new FakeConn();
  conn.rollbackThrows = true;
  await assert.rejects(
    runAtomic({
      attempts: 1,
      acquire: acquirer([conn]),
      work: async () => {
        throw new Error('original failure');
      },
      isRetryable: isDeadlock
    }),
    /original failure/ // not "rollback failed"
  );
  assert.equal(conn.rolledBack, 1);
  assert.equal(conn.released, 1); // still released despite the rollback throwing
});

test('attempts is floored at 1 so a unit always runs once', async () => {
  const conn = new FakeConn();
  const result = await runAtomic({
    attempts: 0,
    acquire: acquirer([conn]),
    work: async () => 42,
    isRetryable: isDeadlock
  });
  assert.equal(result, 42);
  assert.equal(conn.committed, 1);
});
