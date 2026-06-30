import { performance } from 'perf_hooks';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { config } from './config';
import { logger } from './logger';
import { bindParams, Params } from './params';
import { ResultCache } from './cache';
import { Profiler, ProfilerStats } from './profiler';
import { detectServer, ServerInfo } from './server';
import { printReady } from './banner';
import { asAffected, asInsertId, asScalar, asSingle, normalizeEntry, TransactionEntry } from './shape';
import {
  ColumnInfo,
  shapeColumns,
  shapeTables,
  SQL_COLUMN_EXISTS,
  SQL_LIST_COLUMNS,
  SQL_LIST_TABLES,
  SQL_TABLE_EXISTS
} from './schema';
import { castValue } from './typecast';
import { buildDelete, buildInsert, buildSelect, buildUpdate, FindOptions, Where } from './crud';
import { runAtomic } from './retry';
import { ReadyGate } from './gate';
import { CircuitBreaker } from './breaker';
import { ReplicaSet, ReplicaStatus } from './replicas';
import {
  backoff,
  connectionHint,
  isCacheable,
  isFatalConnectionError,
  isLockingRead,
  isReadQuery,
  isRetryableError,
  preview,
  sleep,
  withStatementTimeout
} from './util';

type Mode = 'query' | 'execute';

/** Per-call overrides, passed as the optional 3rd argument to read/write methods. */
export interface QueryOptions {
  /** Server-side statement timeout in ms for this call (see vsql_query_timeout). */
  timeout?: number;
  /** Set false to bypass the result cache for this call (always hit the server). */
  cache?: boolean;
  /**
   * Override oxmysql-compatible type-casting for this call: true forces it on,
   * false forces it off, regardless of the vsql_typecast default.
   */
  typeCast?: boolean;
  /**
   * Internal: the resource that invoked the export, captured by the export layer
   * via GetInvokingResource() for per-resource profiling. Not part of the public
   * call options - callers don't set this.
   */
  resource?: string;
}

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

class Database {
  private pool: Pool | null = null;
  private gate = new ReadyGate();
  private breaker = new CircuitBreaker();
  private replicas = new ReplicaSet<Pool>();
  private replicasReady = false;
  private connectedOnce = false;
  private reconnecting = false;
  private shuttingDown = false;

  server: ServerInfo = { type: 'unknown', version: '', major: 0, minor: 0, supportsReturning: false };
  cache = new ResultCache();
  profiler = new Profiler();
  private readonly startedAt = Date.now();

  get isConnected(): boolean {
    return this.gate.isReady;
  }

  health(): {
    connected: boolean;
    reconnecting: boolean;
    breaker: string;
    replicas: ReplicaStatus[];
    server: ServerInfo;
  } {
    return {
      connected: this.gate.isReady,
      reconnecting: this.reconnecting,
      breaker: this.breaker.state(),
      replicas: this.replicas.status(),
      server: this.server
    };
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
    this.breaker.configure(config.breakerThreshold, config.breakerResetMs);
    this.setupReplicas();

    let attempt = 0;
    while (!this.gate.isReady) {
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
        this.breaker.onSuccess();
        this.connectedOnce = true;
        // Open the gate (sets ready + releases queued callers) before announcing,
        // so anything awaiting whenReady() resumes the moment we're connected.
        this.gate.open();
        printReady({
          server: prettyServer(this.server),
          target: config.target(),
          pool: config.poolSize,
          cacheEnabled: config.cacheEnabled,
          supportsReturning: this.server.supportsReturning,
          reconnected
        });
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
        this.breaker.onFailure();
        // Once we've connected before, a prolonged outage trips the breaker: stop
        // hanging callers and reject anyone already queued with a clear error. The
        // reconnect loop keeps probing regardless.
        if (this.connectedOnce && this.breaker.isOpen()) {
          this.gate.fail(new Error('vSQL: database unavailable (circuit breaker open)'));
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
    this.gate.close();
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
  // issued during startup (or a reconnect) wait instead of throwing. If the
  // breaker has tripped (a sustained outage after we'd connected before), fail
  // fast instead of queueing, so dependent resources get a prompt error.
  whenReady(): Promise<void> {
    if (this.gate.isReady) return Promise.resolve();
    if (this.connectedOnce && this.breaker.isOpen()) {
      return Promise.reject(new Error('vSQL: database unavailable (circuit breaker open)'));
    }
    return this.gate.whenReady();
  }

  // Build the read-replica pools once (start() may run again on reconnect). Each
  // replica is an independent pool; their health is tracked lazily by ReplicaSet
  // rather than a connect handshake, so a replica being down never blocks startup.
  private setupReplicas(): void {
    if (this.replicasReady) return;
    this.replicasReady = true;
    this.replicas.configure(config.replicaCooldownMs);
    for (let i = 0; i < config.replicas.length; i++) {
      const conn = config.replicas[i];
      const label = conn.host ? `${conn.host}:${conn.port}` : `replica${i + 1}`;
      try {
        const pool = mysql.createPool(config.poolOptions(conn));
        pool.on('connection', (c) => this.tuneConnection(c));
        // Swallow idle-connection errors; query-time failures are handled by the
        // read path (mark down + fall back to primary).
        (pool as any).on('error', () => {});
        this.replicas.add(pool, label);
      } catch (err: any) {
        logger.error(`failed to create read replica ${label}: ${err.message}`);
      }
    }
    if (this.replicas.size > 0) logger.info(`read replicas: ${this.replicas.size} configured`);
  }

  // The pool a read should run on: a healthy replica when one is available, else
  // the primary. Locking reads (FOR UPDATE / SHARE) always go to the primary -
  // they take row locks and need read-after-write consistency.
  private readTarget(sql: string): Pool | undefined {
    if (this.replicas.size === 0 || isLockingRead(sql)) return undefined;
    return this.replicas.next();
  }

  private tuneConnection(conn: any): void {
    for (const stmt of config.sessionStatements(this.server)) {
      conn.query(stmt, (err: any) => {
        if (err) logger.debug(`session setup failed (${stmt}): ${err.message}`);
      });
    }
  }

  private async exec(
    sql: string,
    params: Params,
    mode: Mode,
    target?: Queryable,
    opts?: QueryOptions,
    fromReplica = false
  ): Promise<{ rows: any }> {
    if (!this.pool) throw new Error('vSQL: pool is not initialized');
    const bound = bindParams(sql, params);
    const text =
      opts?.timeout && opts.timeout > 0
        ? withStatementTimeout(bound.sql, opts.timeout, this.server.type)
        : bound.sql;
    const runner = target ?? this.pool;
    const start = performance.now();
    try {
      // Per-call typeCast override: when set, pass mysql2 an options object so
      // this one call casts (or doesn't) regardless of the pool default. The
      // common path (no override) keeps the plain (sql, values) call unchanged.
      const [rows] =
        opts?.typeCast !== undefined
          ? mode === 'execute'
            ? await runner.execute({ sql: text, values: bound.values, typeCast: opts.typeCast ? castValue : false })
            : await runner.query({ sql: text, values: bound.values, typeCast: opts.typeCast ? castValue : false })
          : mode === 'execute'
            ? await runner.execute(text, bound.values)
            : await runner.query(text, bound.values);
      const ms = performance.now() - start;
      this.profiler.record(sql, ms, opts?.resource);
      logger.query(text, bound.values, ms);
      if (ms >= config.slowQueryMs) {
        const who = opts?.resource ? ` [${opts.resource}]` : '';
        logger.warn(`slow query ${ms.toFixed(1)}ms${who}: ${preview(sql)}`);
      }
      return { rows };
    } catch (err: any) {
      this.profiler.recordError(opts?.resource);
      logger.error(`query failed: ${err.message}\n        sql: ${preview(sql)}`);
      // A replica failure must not trigger a *primary* reconnect; the read path
      // takes the replica out of rotation and retries on the primary instead.
      if (!fromReplica) this.handleConnectionLoss(err);
      throw err;
    }
  }

  private async read(
    sql: string,
    params: Params,
    mode: Mode,
    shape: (rows: any) => any,
    opts?: QueryOptions
  ): Promise<any> {
    const cacheable = isCacheable(sql, this.cache.enabled, opts?.cache === false);
    const key = cacheable ? this.cache.key(sql, params) : '';
    if (cacheable) {
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        this.profiler.recordCacheHit(opts?.resource);
        return hit;
      }
    }
    const rows = await this.runRead(sql, params, mode, opts);
    const shaped = shape(rows);
    if (cacheable) this.cache.set(key, shaped);
    return shaped;
  }

  // Run a read on a healthy replica when available, falling back to the primary
  // if there's no replica or the chosen one fails with a connection error (it's
  // then taken out of rotation for a cooldown).
  private async runRead(sql: string, params: Params, mode: Mode, opts?: QueryOptions): Promise<any> {
    const replica = this.readTarget(sql);
    if (!replica) {
      const { rows } = await this.exec(sql, params, mode, undefined, opts);
      return rows;
    }
    try {
      const { rows } = await this.exec(sql, params, mode, replica, opts, true);
      return rows;
    } catch (err: any) {
      if (!isFatalConnectionError(err)) throw err;
      this.replicas.markDown(replica);
      logger.warn(`read replica failed (${err.code ?? err.message}); falling back to primary`);
      const { rows } = await this.exec(sql, params, mode, undefined, opts);
      return rows;
    }
  }

  // Any write clears the result cache. It's blunt but always correct; finer
  // invalidation is available via the cacheClear export with a table substring.
  private invalidate(): void {
    if (this.cache.enabled) this.cache.clear();
  }

  // --- public query API ---------------------------------------------------

  async query(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'query', (rows) => rows, opts);
    const { rows } = await this.exec(sql, params, 'query', undefined, opts);
    this.invalidate();
    return rows;
  }

  async execute(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows, opts);
    const { rows } = await this.exec(sql, params, 'execute', undefined, opts);
    this.invalidate();
    return rows;
  }

  single(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    return this.read(sql, params, 'execute', asSingle, opts);
  }

  scalar(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    return this.read(sql, params, 'execute', asScalar, opts);
  }

  async insert(sql: string, params?: Params, opts?: QueryOptions): Promise<number> {
    const { rows } = await this.exec(sql, params, 'execute', undefined, opts);
    this.invalidate();
    return asInsertId(rows);
  }

  async update(sql: string, params?: Params, opts?: QueryOptions): Promise<number> {
    const { rows } = await this.exec(sql, params, 'execute', undefined, opts);
    this.invalidate();
    return asAffected(rows);
  }

  // --- schema introspection -----------------------------------------------
  // All scoped to the connected database via DATABASE(); names are bound values.

  async tableExists(table: string): Promise<boolean> {
    return (await this.scalar(SQL_TABLE_EXISTS, [table])) != null;
  }

  async columnExists(table: string, column: string): Promise<boolean> {
    return (await this.scalar(SQL_COLUMN_EXISTS, [table, column])) != null;
  }

  async listColumns(table: string): Promise<ColumnInfo[]> {
    return shapeColumns(await this.query(SQL_LIST_COLUMNS, [table]));
  }

  async listTables(): Promise<string[]> {
    return shapeTables(await this.query(SQL_LIST_TABLES));
  }

  // --- CRUD helpers --------------------------------------------------------
  // Build a parameterised statement (identifiers escaped, values bound) and run
  // it through the normal query path. For anything past equality/IN, use raw SQL.

  insertInto(table: string, data: Record<string, any> | Record<string, any>[], opts?: QueryOptions): Promise<number> {
    const q = buildInsert(table, data);
    return this.insert(q.sql, q.values, opts);
  }

  updateWhere(table: string, data: Record<string, any>, where: Where, opts?: QueryOptions): Promise<number> {
    const q = buildUpdate(table, data, where);
    return this.update(q.sql, q.values, opts);
  }

  deleteWhere(table: string, where: Where, opts?: QueryOptions): Promise<number> {
    const q = buildDelete(table, where);
    return this.update(q.sql, q.values, opts);
  }

  find(table: string, where?: Where, opts?: FindOptions): Promise<any[]> {
    const q = buildSelect(table, where, opts);
    return this.query(q.sql, q.values);
  }

  findOne(table: string, where?: Where, opts?: FindOptions): Promise<any> {
    const q = buildSelect(table, where, { ...opts, limit: 1 });
    return this.single(q.sql, q.values);
  }

  // Batch-aware prepared execution: an array of arrays runs the same statement
  // once per row inside a transaction; otherwise it's a single execute.
  async prepare(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (Array.isArray(params) && params.length > 0 && params.every((p) => Array.isArray(p))) {
      return this.batch(sql, params as any[][]);
    }
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows, opts);
    const { rows } = await this.exec(sql, params, 'execute', undefined, opts);
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

  async transaction(arg: TransactionEntry[] | ((tx: TransactionApi) => Promise<any>)): Promise<any> {
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
  // The loop itself lives in ./retry; this wires it to the pool, the retry
  // policy, cache invalidation, and backoff/logging.
  private async runAtomic<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('vSQL: pool is not initialized');
    const pool = this.pool;
    const retries = config.txRetries;
    return runAtomic<T, PoolConnection>({
      attempts: retries + 1,
      acquire: () => pool.getConnection(),
      work,
      isRetryable: isRetryableError,
      onCommit: () => this.invalidate(),
      onRetry: async (attempt, err) => {
        const delay = backoff(attempt, 50, 1000);
        logger.warn(`transaction conflict (${err.code ?? err.errno}); retry ${attempt}/${retries} in ${delay}ms`);
        await sleep(delay);
      }
    });
  }

  private txApi(conn: PoolConnection): TransactionApi {
    const exec = (sql: string, params: Params, shape: (r: any) => any) =>
      this.exec(sql, params, 'execute', conn).then(({ rows }) => shape(rows));
    return {
      query: (sql, params) => this.exec(sql, params, 'query', conn).then(({ rows }) => rows),
      execute: (sql, params) => exec(sql, params, (r) => r),
      single: (sql, params) => exec(sql, params, asSingle),
      scalar: (sql, params) => exec(sql, params, asScalar),
      insert: (sql, params) => exec(sql, params, asInsertId),
      update: (sql, params) => exec(sql, params, asAffected)
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.gate.close();
    // Drain the replica pools alongside the primary.
    for (const replica of this.replicas.all()) {
      try {
        await replica.end();
      } catch (err: any) {
        logger.debug(`replica drain error: ${err.message}`);
      }
    }
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
    /* ignore - an event listener should never break the pool */
  }
}

// A short, readable label for the status box, e.g. "MariaDB 10.11". Falls back
// to the raw VERSION() string when we couldn't parse a major/minor.
function prettyServer(server: ServerInfo): string {
  const name = server.type === 'mariadb' ? 'MariaDB' : server.type === 'mysql' ? 'MySQL' : 'database';
  if (server.major > 0) return `${name} ${server.major}.${server.minor}`;
  return server.version ? `${name} ${server.version}` : name;
}

export const db = new Database();
