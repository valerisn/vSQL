import { performance } from 'perf_hooks';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { config } from './config';
import { logger } from './logger';
import { bindParams, Params } from './lib/params';
import { ResultCache } from './lib/cache';
import { Profiler, ProfilerStats } from './lib/profiler';
import { detectServer, ServerInfo } from './server';
import { printReady } from './banner';
import { asAffected, asInsertId, asScalar, asSingle, normalizeEntry, TransactionEntry } from './lib/shape';
import {
  ColumnInfo,
  shapeColumns,
  shapeTables,
  SQL_COLUMN_EXISTS,
  SQL_LIST_COLUMNS,
  SQL_LIST_TABLES,
  SQL_TABLE_EXISTS
} from './lib/schema';
import { castValue } from './lib/typecast';
import {
  buildDelete,
  buildInsert,
  buildInsertReturning,
  buildSelect,
  buildSelectById,
  buildUpdate,
  FindOptions,
  Where
} from './lib/crud';
import { runAtomic } from './lib/retry';
import { ReadyGate } from './lib/gate';
import { CircuitBreaker } from './lib/breaker';
import { ReplicaSet, ReplicaStatus } from './lib/replicas';
import {
  backoff,
  connectionHint,
  isCacheableRead,
  isFatalConnectionError,
  isLockingRead,
  isReadQuery,
  isRetryableError,
  preview,
  sleep,
  withStatementTimeout
} from './lib/util';

type Mode = 'query' | 'execute';

/** Per-call overrides, passed as the optional 3rd argument to read/write methods. */
export interface QueryOptions {
  /** Server-side statement timeout in ms for this call (see vsql_query_timeout). */
  timeout?: number;
  /** Set false to bypass the result cache for this call (always hit the server). */
  cache?: boolean;
  /** Columns to return from insertAndFetch (default all). */
  returning?: string[];
  /** The id column used by insertAndFetch's MySQL fallback SELECT (default 'id'). */
  idColumn?: string;
  /** Force type-casting on/off for this call, ignoring the vsql_typecast default. */
  typeCast?: boolean;
  /** Internal: the invoking resource, set by the export layer for profiling. */
  resource?: string;
}

// The pool, or one connection (transactions pin every statement to the same one).
type Queryable = Pick<Pool, 'query' | 'execute'>;

// What getStats returns: profiler stats plus live cache state and uptime.
export interface Stats extends ProfilerStats {
  cacheEnabled: boolean;
  cacheSize: number;
  /** Configured max pool connections; compare to peakInFlight for saturation. */
  poolSize: number;
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

  // Everything a monitor needs from one export.
  stats(): Stats {
    return {
      ...this.profiler.stats(),
      cacheEnabled: this.cache.enabled,
      cacheSize: this.cache.size,
      poolSize: config.poolSize,
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
        // Needed so an idle-connection error doesn't crash the process as an
        // unhandled 'error'. Doubles as the reconnect trigger for losses that
        // happen outside an in-flight query.
        (this.pool as any).on('error', (err: any) => this.handleConnectionLoss(err));

        const conn = await this.pool.getConnection();
        try {
          this.server = await detectServer(conn, config.serverHint);
          // First tune ran before we knew the server type; redo it now that
          // server-specific session setup applies.
          this.tuneConnection(conn);
        } finally {
          conn.release();
        }

        const reconnected = this.reconnecting;
        this.breaker.onSuccess();
        this.connectedOnce = true;
        // Open the gate (releases queued callers) before announcing, so anything
        // awaiting whenReady() resumes the instant we're connected.
        this.gate.open();
        printReady({
          server: prettyServer(this.server),
          target: config.target(),
          pool: config.poolSize,
          cacheEnabled: config.cacheEnabled,
          supportsReturning: this.server.supportsReturning,
          reconnected
        });
        // So dependent resources can react without polling isReady().
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
        // If we'd connected before and the outage trips the breaker, reject the
        // queued callers with a clear error rather than hang them. The retry loop
        // keeps probing regardless.
        if (this.connectedOnce && this.breaker.isOpen()) {
          this.gate.fail(new Error('vSQL: database unavailable (circuit breaker open)'));
        }
        const delay = backoff(attempt);
        logger.error(
          `connection attempt ${attempt} failed: ${err.message}. retrying in ${(delay / 1000).toFixed(1)}s`
        );
        // First failure only, so the hint doesn't repeat on every retry.
        if (attempt === 1) {
          const hint = connectionHint(err);
          if (hint) logger.warn(`hint: ${hint}`);
        }
        await sleep(delay);
      }
    }
  }

  // On a fatal connection error (mid-query or from the pool's error event), drop
  // the dead pool and re-run start(), which reconnects with backoff. Queries in
  // the meantime queue on whenReady(). Guarded so overlapping errors from several
  // connections only trigger one reconnect.
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

  // Resolves at once if connected; otherwise queues the caller so queries during
  // startup or a reconnect wait instead of throwing. If the breaker has tripped,
  // fail fast instead so callers get a prompt error.
  whenReady(): Promise<void> {
    if (this.gate.isReady) return Promise.resolve();
    if (this.connectedOnce && this.breaker.isOpen()) {
      return Promise.reject(new Error('vSQL: database unavailable (circuit breaker open)'));
    }
    return this.gate.whenReady();
  }

  // Build the replica pools once (start() may re-run on reconnect). Health is
  // tracked lazily by ReplicaSet, not a connect handshake, so a down replica
  // never blocks startup.
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
        // Swallow idle errors; the read path handles query-time failures (mark
        // the replica down, fall back to primary).
        (pool as any).on('error', () => {});
        this.replicas.add(pool, label);
      } catch (err: any) {
        logger.error(`failed to create read replica ${label}: ${err.message}`);
      }
    }
    if (this.replicas.size > 0) logger.info(`read replicas: ${this.replicas.size} configured`);
  }

  // Which pool a read runs on: a healthy replica if there is one, else primary.
  // Locking reads always take the primary - they need read-after-write consistency.
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
    // In flight across both the connection wait and the execution, so peakInFlight
    // reflects real contention.
    this.profiler.enter();
    try {
      // With a per-call typeCast override, hand mysql2 an options object; the
      // common no-override path keeps the plain (sql, values) call.
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
      // A replica failure must not reconnect the primary; the read path drops the
      // replica and retries on the primary itself.
      if (!fromReplica) this.handleConnectionLoss(err);
      throw err;
    } finally {
      this.profiler.leave();
    }
  }

  private async read(
    sql: string,
    params: Params,
    mode: Mode,
    shape: (rows: any) => any,
    isRead: boolean,
    opts?: QueryOptions
  ): Promise<any> {
    // isRead came from routing - don't re-classify. On a hit this is the whole
    // cost before returning: cacheability check, key, map get. No binding, no trip.
    const cacheable = isCacheableRead(sql, this.cache.enabled, opts?.cache === false, isRead);
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

  // Read from a healthy replica if there is one, else the primary. If the chosen
  // replica fails on a connection error, mark it down and retry on the primary.
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

  // Any write clears the whole cache. Blunt, but always correct - cacheClear
  // does finer, table-scoped invalidation when you want it.
  private invalidate(): void {
    if (this.cache.enabled) this.cache.clear();
  }

  // --- public query API ---------------------------------------------------

  async query(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'query', (rows) => rows, true, opts);
    const { rows } = await this.exec(sql, params, 'query', undefined, opts);
    this.invalidate();
    return rows;
  }

  async execute(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows, true, opts);
    const { rows } = await this.exec(sql, params, 'execute', undefined, opts);
    this.invalidate();
    return rows;
  }

  single(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    return this.read(sql, params, 'execute', asSingle, isReadQuery(sql), opts);
  }

  scalar(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    return this.read(sql, params, 'execute', asScalar, isReadQuery(sql), opts);
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
  // Build a safe statement (identifiers escaped, values bound) via ./crud and run
  // it through the normal path. Past equality/IN, use raw SQL.

  insertInto(table: string, data: Record<string, any> | Record<string, any>[], opts?: QueryOptions): Promise<number> {
    const q = buildInsert(table, data);
    return this.insert(q.sql, q.values, opts);
  }

  // Insert one row and hand it back. One round-trip on MariaDB 10.5+ (INSERT ...
  // RETURNING), else insert-then-select by id. Both run on the primary and skip
  // the read cache, so you always get the row you just wrote.
  async insertAndFetch(table: string, data: Record<string, any>, opts?: QueryOptions): Promise<any> {
    if (this.server.supportsReturning) {
      const q = buildInsertReturning(table, data, opts?.returning);
      const { rows } = await this.exec(q.sql, q.values, 'execute', undefined, opts);
      this.invalidate();
      return asSingle(rows);
    }
    const ins = buildInsert(table, data);
    const { rows: header } = await this.exec(ins.sql, ins.values, 'execute', undefined, opts);
    this.invalidate();
    const id = asInsertId(header);
    if (!id) return null;
    const sel = buildSelectById(table, opts?.idColumn ?? 'id', opts?.returning);
    const { rows } = await this.exec(sel, [id], 'execute', undefined, opts);
    return asSingle(rows);
  }

  updateWhere(table: string, data: Record<string, any>, where: Where, opts?: QueryOptions): Promise<number> {
    const q = buildUpdate(table, data, where);
    return this.update(q.sql, q.values, opts);
  }

  deleteWhere(table: string, where: Where, opts?: QueryOptions): Promise<number> {
    const q = buildDelete(table, where);
    return this.update(q.sql, q.values, opts);
  }

  // queryOpts carries the invoking resource (set by the export layer) so finds are
  // attributed in the profiler like every other CRUD helper; FindOptions stays the
  // public shaping arg.
  find(table: string, where?: Where, opts?: FindOptions, queryOpts?: QueryOptions): Promise<any[]> {
    const q = buildSelect(table, where, opts);
    return this.query(q.sql, q.values, queryOpts);
  }

  findOne(table: string, where?: Where, opts?: FindOptions, queryOpts?: QueryOptions): Promise<any> {
    const q = buildSelect(table, where, { ...opts, limit: 1 });
    return this.single(q.sql, q.values, queryOpts);
  }

  // An array of arrays runs the statement once per row in a transaction (batch);
  // anything else is a single execute.
  async prepare(sql: string, params?: Params, opts?: QueryOptions): Promise<any> {
    if (Array.isArray(params) && params.length > 0 && params.every((p) => Array.isArray(p))) {
      return this.batch(sql, params as any[][]);
    }
    if (isReadQuery(sql)) return this.read(sql, params, 'execute', (rows) => rows, true, opts);
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

  // Run work() in one transaction on one connection, replaying the whole unit on
  // a deadlock / lock-wait timeout (up to vsql_tx_retries times). It rolls back
  // before each retry, so replaying is safe for the DB - but a callback with side
  // effects *outside* the DB will see them repeated. The loop lives in ./retry;
  // this wires it to the pool, cache invalidation, and logging.
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

// Fire a FiveM event; a listener throwing must never break the connection lifecycle.
function safeEmit(event: string, payload?: any): void {
  try {
    emit(event, payload);
  } catch {
    /* a listener should never break the pool */
  }
}

// Short label for the status box, e.g. "MariaDB 10.11"; falls back to the raw
// VERSION() string when we couldn't parse a major/minor.
function prettyServer(server: ServerInfo): string {
  const name = server.type === 'mariadb' ? 'MariaDB' : server.type === 'mysql' ? 'MySQL' : 'database';
  if (server.major > 0) return `${name} ${server.major}.${server.minor}`;
  return server.version ? `${name} ${server.version}` : name;
}

export const db = new Database();
