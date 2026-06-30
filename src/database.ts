import { performance } from 'perf_hooks';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { config } from './config';
import { logger } from './logger';
import { bindParams, Params } from './params';
import { ResultCache } from './cache';
import { Profiler, ProfilerStats } from './profiler';
import { detectServer, ServerInfo } from './server';
import { printReady } from './banner';
import {
  backoff,
  connectionHint,
  isFatalConnectionError,
  isLockingRead,
  isReadQuery,
  isRetryableError,
  preview,
  sleep
} from './util';

type Mode = 'query' | 'execute';

// A queryable target: either the pool itself or a single connection (used for
// transactions so every statement runs on the same connection).
type Queryable = Pick<Pool, 'query' | 'execute'>;

// Profiler stats plus the live cache state and resource uptime that the
// getStats export returns.
export interface Stats extends ProfilerStats {
  cacheEnabled: boolean;
  cacheSize: number;
  uptimeMs: number;
}

export interface TransactionApi {
  query(sql: string, params?: Params): Promise<any>;
  execute(sql: string, params?: Params): Promise<any>;
  single(sql: string, params?: Params): Promise<any>;
  scalar(sql: string, params?: Params): Promise<any>;
  insert(sql: string, params?: Params): Promise<number>;
  update(sql: string, params?: Params): Promise<number>;
}

type TransactionQuery = string | [string, Params] | { query?: string; sql?: string; values?: Params; params?: Params };

class Database {
  private pool: Pool | null = null;
  private ready = false;
  private reconnecting = false;
  private shuttingDown = false;
  private waiters: Array<() => void> = [];

  server: ServerInfo = { type: 'unknown', version: '', major: 0, minor: 0, supportsReturning: false };
  cache = new ResultCache();
  profiler = new Profiler();
  private readonly startedAt = Date.now();

  get isConnected(): boolean {
    return this.ready;
  }

  health(): { connected: boolean; reconnecting: boolean; server: ServerInfo } {
    return { connected: this.ready, reconnecting: this.reconnecting, server: this.server };
  }

  // Profiler counters plus live cache state and how long the resource has been
  // running, so a monitor can read everything from a single export.
  stats(): Stats {
    return {
      ...this.profiler.stats(),
      cacheEnabled: this.cache.enabled,
      cacheSize: this.cache.size,
      uptimeMs: Date.now() - this.startedAt
    };
  }

  async start(): Promise<void> {
    this.cache.configure(config.cacheEnabled, config.cacheSize, config.cacheTtl);
    this.profiler.configure(config.slowQueryMs);

    let attempt = 0;
    while (!this.ready) {
      attempt++;
      try {
        this.pool = mysql.createPool(config.poolOptions());
        this.pool.on('connection', (conn) => this.tuneConnection(conn));
        // A handler is required so an idle-connection error doesn't crash the
        // process as an unhandled EventEmitter 'error'; we also use it to kick
        // off a reconnect when the loss happens outside an in-flight query.
        (this.pool as any).on('error', (err: any) => this.handleConnectionLoss(err));

        const conn = await this.pool.getConnection();
        try {
          this.server = await detectServer(conn, config.serverHint);
          // This connection tuned before we knew the server type; re-tune it now
          // so server-specific session setup (e.g. statement timeout) applies.
          this.tuneConnection(conn);
        } finally {
          conn.release();
        }

        const reconnected = this.reconnecting;
        this.ready = true;
        printReady({
          server: prettyServer(this.server),
          target: config.target(),
          pool: config.poolSize,
          cacheEnabled: config.cacheEnabled,
          supportsReturning: this.server.supportsReturning,
          reconnected
        });
        this.flushWaiters();
        // Let dependent resources react without polling isReady()/ready().
        const event = reconnected ? 'vSQL:reconnected' : 'vSQL:ready';
        logger.debug(`emitting ${event}`);
        safeEmit(event, this.server);
      } catch (err: any) {
        if (this.pool) {
          try {
            await this.pool.end();
          } catch {
            /* ignore */
          }
          this.pool = null;
        }
        const delay = backoff(attempt);
        logger.error(
          `connection attempt ${attempt} failed: ${err.message}. retrying in ${(delay / 1000).toFixed(1)}s`
        );
        // Only on the first failure, so the actionable hint isn't repeated on
        // every backoff retry.
        if (attempt === 1) {
          const hint = connectionHint(err);
          if (hint) logger.warn(`hint: ${hint}`);
        }
        await sleep(delay);
      }
    }
  }

  // Called when a fatal connection error is seen (mid-query or from the pool's
  // own error event). Drops the dead pool and re-runs start(), whose retry loop
  // reconnects with backoff. Queries arriving in the meantime queue on
  // whenReady() until the new pool is up. Guarded so overlapping errors from
  // several connections only trigger one reconnect.
  private handleConnectionLoss(err: any): void {
    if (this.shuttingDown || this.reconnecting) return;
    if (!isFatalConnectionError(err)) return;
    this.reconnecting = true;
    this.ready = false;
    logger.warn(`lost database connection (${err.code ?? err.message}); reconnecting...`);
    safeEmit('vSQL:connectionLost', { code: err.code ?? null, message: err.message ?? String(err) });
    const dead = this.pool;
    this.pool = null;
    void (async () => {
      if (dead) {
        try {
          await dead.end();
        } catch {
          /* the pool is already broken; nothing to salvage */
        }
      }
      try {
        await this.start();
      } catch (e: any) {
        logger.error(`reconnect failed: ${e.message}`);
      } finally {
        this.reconnecting = false;
      }
    })();
  }

  // Resolves immediately once connected, otherwise queues the caller so queries
  // issued during startup (or a reconnect) wait instead of throwing.
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private flushWaiters(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }

  private tuneConnection(conn: any): void {
    for (const stmt of config.sessionStatements(this.server)) {
      conn.query(stmt, (err: any) => {
        if (err) logger.debug(`session setup failed (${stmt}): ${err.message}`);
      });
    }
  }

  private async exec(sql: string, params: Params, mode: Mode, target?: Queryable): Promise<{ rows: any }> {
    if (!this.pool) throw new Error('vSQL: pool is not initialized');
    const bound = bindParams(sql, params);
    const runner = target ?? this.pool;
    const start = performance.now();
    try {
      const [rows] =
        mode === 'execute'
          ? await runner.execute(bound.sql, bound.values)
          : await runner.query(bound.sql, bound.values);
      const ms = performance.now() - start;
      this.profiler.record(sql, ms);
      logger.query(bound.sql, bound.values, ms);
      if (ms >= config.slowQueryMs) {
        logger.warn(`slow query ${ms.toFixed(1)}ms: ${preview(sql)}`);
      }
      return { rows };
    } catch (err: any) {
      this.profiler.recordError();
      logger.error(`query failed: ${err.message}\n        sql: ${preview(sql)}`);
      this.handleConnectionLoss(err);
      throw err;
    }
  }

  private async read(sql: string, params: Params, mode: Mode, shape: (rows: any) => any): Promise<any> {
    const cacheable = this.cache.enabled && isReadQuery(sql) && !isLockingRead(sql);
    const key = cacheable ? this.cache.key(sql, params) : '';
    if (cacheable) {
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        this.profiler.recordCacheHit();
        return hit;
      }
    }
    const { rows } = await this.exec(sql, params, mode);
    const shaped = shape(rows);
    if (cacheable) this.cache.set(key, shaped);
    return shaped;
  }

  // Any write clears the result cache. It's blunt but always correct; finer
  // invalidation is available via the cacheClear export with a table substring.
  private invalidate(): void {
    if (this.cache.enabled) this.cache.clear();
  }

  // --- public query API ---------------------------------------------------

  async query(sql: string, params?: Params): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'query', (rows) => rows);
    const { rows } = await this.exec(sql, params, 'query');
    this.invalidate();
    return rows;
  }

  async execute(sql: string, params?: Params): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows);
    const { rows } = await this.exec(sql, params, 'execute');
    this.invalidate();
    return rows;
  }

  single(sql: string, params?: Params): Promise<any> {
    return this.read(sql, params, 'execute', (rows) => (Array.isArray(rows) ? rows[0] ?? null : null));
  }

  scalar(sql: string, params?: Params): Promise<any> {
    return this.read(sql, params, 'execute', (rows) => {
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return null;
      const values = Object.values(row);
      return values.length ? values[0] : null;
    });
  }

  async insert(sql: string, params?: Params): Promise<number> {
    const { rows } = await this.exec(sql, params, 'execute');
    this.invalidate();
    return (rows as any)?.insertId ?? 0;
  }

  async update(sql: string, params?: Params): Promise<number> {
    const { rows } = await this.exec(sql, params, 'execute');
    this.invalidate();
    return (rows as any)?.affectedRows ?? 0;
  }

  // Batch-aware prepared execution: an array of arrays runs the same statement
  // once per row inside a transaction; otherwise it's a single execute.
  async prepare(sql: string, params?: Params): Promise<any> {
    if (Array.isArray(params) && params.length > 0 && params.every((p) => Array.isArray(p))) {
      return this.batch(sql, params as any[][]);
    }
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows);
    const { rows } = await this.exec(sql, params, 'execute');
    this.invalidate();
    const header = rows as any;
    return header?.affectedRows ?? header?.insertId ?? rows;
  }

  async batch(sql: string, rows: any[][]): Promise<number> {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    return this.runAtomic(async (conn) => {
      let affected = 0;
      for (const row of rows) {
        const bound = bindParams(sql, row);
        const [res] = await conn.execute(bound.sql, bound.values);
        affected += (res as any)?.affectedRows ?? 0;
      }
      return affected;
    });
  }

  async transaction(arg: TransactionQuery[] | ((tx: TransactionApi) => Promise<any>)): Promise<any> {
    return this.runAtomic(async (conn) => {
      let result: any;
      if (typeof arg === 'function') {
        result = await arg(this.txApi(conn));
      } else if (Array.isArray(arg)) {
        result = [];
        for (const entry of arg) {
          const [sql, params] = normalizeEntry(entry);
          const { rows } = await this.exec(sql, params, 'execute', conn);
          result.push(rows);
        }
      } else {
        throw new Error('vSQL: transaction expects an array of queries or a callback');
      }
      return result ?? true;
    });
  }

  // Runs work() inside a single transaction on one pooled connection, retrying
  // the whole unit when InnoDB reports a deadlock or lock-wait timeout (up to
  // vsql_tx_retries extra attempts). The transaction is rolled back before each
  // retry, so replaying is safe for the database; note a callback-form
  // transaction with side effects *outside* the DB will see those repeated.
  private async runAtomic<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('vSQL: pool is not initialized');
    const attempts = config.txRetries + 1;
    let lastErr: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const conn = await this.pool.getConnection();
      let release = true;
      try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        this.invalidate();
        return result;
      } catch (err: any) {
        try {
          await conn.rollback();
        } catch {
          /* the connection may already be dead; nothing to undo */
        }
        lastErr = err;
        if (attempt < attempts && isRetryableError(err)) {
          conn.release();
          release = false;
          const delay = backoff(attempt, 50, 1000);
          logger.warn(
            `transaction conflict (${err.code ?? err.errno}); retry ${attempt}/${attempts - 1} in ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
        throw err;
      } finally {
        if (release) conn.release();
      }
    }
    throw lastErr;
  }

  private txApi(conn: PoolConnection): TransactionApi {
    const exec = (sql: string, params: Params, shape: (r: any) => any) =>
      this.exec(sql, params, 'execute', conn).then(({ rows }) => shape(rows));
    return {
      query: (sql, params) => this.exec(sql, params, 'query', conn).then(({ rows }) => rows),
      execute: (sql, params) => exec(sql, params, (r) => r),
      single: (sql, params) => exec(sql, params, (r) => (Array.isArray(r) ? r[0] ?? null : null)),
      scalar: (sql, params) =>
        exec(sql, params, (r) => {
          const row = Array.isArray(r) ? r[0] : undefined;
          return row ? Object.values(row)[0] ?? null : null;
        }),
      insert: (sql, params) => exec(sql, params, (r) => r?.insertId ?? 0),
      update: (sql, params) => exec(sql, params, (r) => r?.affectedRows ?? 0)
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.ready = false;
    if (!this.pool) return;
    logger.info('draining connection pool...');
    try {
      await this.pool.end();
    } catch (err: any) {
      logger.debug(`pool drain error: ${err.message}`);
    }
    this.pool = null;
  }
}

// Fire a FiveM event without ever letting a listener's error bubble back into
// our connection lifecycle.
function safeEmit(event: string, payload?: any): void {
  try {
    emit(event, payload);
  } catch {
    /* ignore — an event listener should never break the pool */
  }
}

// A short, readable label for the status box, e.g. "MariaDB 10.11". Falls back
// to the raw VERSION() string when we couldn't parse a major/minor.
function prettyServer(server: ServerInfo): string {
  const name = server.type === 'mariadb' ? 'MariaDB' : server.type === 'mysql' ? 'MySQL' : 'database';
  if (server.major > 0) return `${name} ${server.major}.${server.minor}`;
  return server.version ? `${name} ${server.version}` : name;
}

function normalizeEntry(entry: TransactionQuery): [string, Params] {
  if (typeof entry === 'string') return [entry, undefined];
  if (Array.isArray(entry)) return [entry[0], entry[1]];
  const sql = entry.query ?? entry.sql;
  if (!sql) throw new Error('vSQL: transaction query entry is missing a "query" string');
  return [sql, entry.values ?? entry.params];
}

export const db = new Database();
