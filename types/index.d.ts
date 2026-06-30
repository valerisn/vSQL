/**
 * Type definitions for the vSQL FiveM resource exports.
 *
 * In a TypeScript consumer resource you can treat `exports.vSQL` as a `VSql`:
 *
 *   import type { VSql } from '@vSQL/types';
 *   const db = (global as any).exports.vSQL as VSql;
 *   const users = await db.query<User[]>('SELECT * FROM users WHERE id = ?', [1]);
 */

export type Params = any[] | Record<string, any>;
export type Callback<T> = (result: T, error?: Error) => void;

/** Per-call overrides, passed as the optional 3rd argument to read/write methods. */
export interface QueryOptions {
  /** Server-side statement timeout in ms for this call. */
  timeout?: number;
  /** Set false to bypass the result cache for this call. */
  cache?: boolean;
}

export interface ResultSetHeader {
  affectedRows: number;
  insertId: number;
  warningStatus: number;
  changedRows?: number;
}

export interface ServerInfo {
  type: 'mysql' | 'mariadb' | 'unknown';
  version: string;
  major: number;
  minor: number;
  supportsReturning: boolean;
}

export interface Health {
  /** True once the pool is connected and serving queries. */
  connected: boolean;
  /** True while a fatal connection loss is being recovered from. */
  reconnecting: boolean;
  server: ServerInfo;
}

export interface SlowEntry {
  sql: string;
  ms: number;
  at: number;
}

/** Aggregated query activity for a single calling resource. */
export interface ResourceStat {
  resource: string;
  count: number;
  totalMs: number;
  avgMs: number;
  errors: number;
}

export interface Stats {
  count: number;
  errors: number;
  cacheHits: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  slow: SlowEntry[];
  /** Query activity broken down by calling resource, heaviest first. */
  byResource: ResourceStat[];
  /** Whether result caching is currently enabled. */
  cacheEnabled: boolean;
  /** Number of result sets currently held in the cache. */
  cacheSize: number;
  /** Milliseconds since the resource started. */
  uptimeMs: number;
}

export interface ShapeStat {
  /** The query with literals/comments erased, so calls that differ only by values group together. */
  shape: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface TransactionApi {
  query<T = any>(sql: string, params?: Params): Promise<T>;
  execute<T = any>(sql: string, params?: Params): Promise<T>;
  single<T = any>(sql: string, params?: Params): Promise<T | null>;
  scalar<T = any>(sql: string, params?: Params): Promise<T | null>;
  insert(sql: string, params?: Params): Promise<number>;
  update(sql: string, params?: Params): Promise<number>;
}

export type TransactionQuery =
  | string
  | [string, Params]
  | { query?: string; sql?: string; values?: Params; params?: Params };

export interface VSql {
  /** Text-protocol query. Returns rows for reads, a ResultSetHeader for writes. */
  query<T = any>(sql: string, params?: Params, opts?: QueryOptions): Promise<T>;
  query<T = any>(sql: string, params: Params, cb: Callback<T>): void;
  query<T = any>(sql: string, cb: Callback<T>): void;

  /** Prepared-statement (binary protocol) query. Same shaping as query(). */
  execute<T = any>(sql: string, params?: Params, opts?: QueryOptions): Promise<T>;
  execute<T = any>(sql: string, params: Params, cb: Callback<T>): void;

  /** First row, or null. */
  single<T = any>(sql: string, params?: Params, opts?: QueryOptions): Promise<T | null>;
  single<T = any>(sql: string, params: Params, cb: Callback<T | null>): void;

  /** First column of the first row, or null. */
  scalar<T = any>(sql: string, params?: Params, opts?: QueryOptions): Promise<T | null>;
  scalar<T = any>(sql: string, params: Params, cb: Callback<T | null>): void;

  /** Returns insertId. */
  insert(sql: string, params?: Params, opts?: QueryOptions): Promise<number>;
  insert(sql: string, params: Params, cb: Callback<number>): void;

  /** Returns affectedRows (works for UPDATE and DELETE). */
  update(sql: string, params?: Params, opts?: QueryOptions): Promise<number>;
  update(sql: string, params: Params, cb: Callback<number>): void;

  /** Prepared execute; an array of arrays runs as a batch. */
  prepare<T = any>(sql: string, params?: Params | any[][], opts?: QueryOptions): Promise<T>;

  /** Runs the same statement once per row inside a transaction; returns affectedRows. */
  batch(sql: string, rows: any[][]): Promise<number>;
  batch(sql: string, rows: any[][], cb: Callback<number>): void;

  /** Array of queries or a callback that runs atomically (rollback on throw). */
  transaction(queries: TransactionQuery[]): Promise<any[]>;
  transaction<T>(handler: (tx: TransactionApi) => Promise<T>): Promise<T>;
  transaction(queries: TransactionQuery[], cb: Callback<any[]>): void;

  cacheClear(pattern?: string): number;
  clearCache(pattern?: string): number;
  getStats(): Stats;
  /** Heaviest query shapes by total time consumed (pg_stat_statements style). */
  topQueries(limit?: number): ShapeStat[];
  serverInfo(): ServerInfo;
  /** Connection/reconnection status plus detected server info. */
  health(): Health;
  isReady(): boolean;
  ready(): Promise<true>;
  ready(cb: Callback<true>): void;
}
