// The transaction-with-retry loop, lifted out of Database so it runs without a
// live pool. It runs a unit of work in one transaction on one connection and, on
// a retryable error (InnoDB deadlock / lock-wait timeout), rolls back and replays
// the whole unit on a fresh connection up to `attempts` times. Safe for the DB
// since each attempt rolls back whole first - but side effects *outside* the DB
// repeat, so a callback unit is the caller's job to keep idempotent.

/** The slice of a pooled connection the retry loop drives. */
export interface AtomicConn {
  beginTransaction(): Promise<any>;
  commit(): Promise<any>;
  rollback(): Promise<any>;
  release(): void;
}

export interface RunAtomicOptions<T, C extends AtomicConn> {
  /** Total attempts, including the first try (must be >= 1). */
  attempts: number;
  /** Acquire a fresh connection - called once per attempt. */
  acquire: () => Promise<C>;
  /** The transactional unit; runs between beginTransaction and commit. */
  work: (conn: C) => Promise<T>;
  /** Whether a thrown error should trigger a rollback-and-replay. */
  isRetryable: (err: any) => boolean;
  /** Ran after a successful commit (e.g. cache invalidation). */
  onCommit?: () => void;
  /** Ran before a replay (e.g. backoff + log); awaited so it can delay. */
  onRetry?: (attempt: number, err: any) => Promise<void> | void;
}

export async function runAtomic<T, C extends AtomicConn>(opts: RunAtomicOptions<T, C>): Promise<T> {
  const attempts = Math.max(1, opts.attempts);
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const conn = await opts.acquire();
    let release = true;
    try {
      await conn.beginTransaction();
      const result = await opts.work(conn);
      await conn.commit();
      opts.onCommit?.();
      return result;
    } catch (err: any) {
      try {
        await conn.rollback();
      } catch {
        /* the connection may already be dead; nothing to undo */
      }
      lastErr = err;
      if (attempt < attempts && opts.isRetryable(err)) {
        // Hand the connection back before sleeping so it isn't held idle across
        // the backoff; the next attempt acquires a fresh one.
        conn.release();
        release = false;
        await opts.onRetry?.(attempt, err);
        continue;
      }
      throw err;
    } finally {
      if (release) conn.release();
    }
  }
  // Unreachable - the loop always returns or throws - but keeps TS happy.
  throw lastErr;
}
