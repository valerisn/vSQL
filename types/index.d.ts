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

export interface Stats {
  count: number;
  errors: number;
  cacheHits: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  slow: SlowEntry[];
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
  query<T = any>(sql: string, params?: Params): Promise<T>;
  query<T = any>(sql: string, params: Params, cb: Callback<T>): void;
  query<T = any>(sql: string, cb: Callback<T>): void;

  /** Prepared-statement (binary protocol) query. Same shaping as query(). */
  execute<T = any>(sql: string, params?: Params): Promise<T>;
  execute<T = any>(sql: string, params: Params, cb: Callback<T>): void;

  /** First row, or null. */
  single<T = any>(sql: string, params?: Params): Promise<T | null>;
  single<T = any>(sql: string, params: Params, cb: Callback<T | null>): void;

  /** First column of the first row, or null. */
  scalar<T = any>(sql: string, params?: Params): Promise<T | null>;
  scalar<T = any>(sql: string, params: Params, cb: Callback<T | null>): void;

  /** Returns insertId. */
  insert(sql: string, params?: Params): Promise<number>;
  insert(sql: string, params: Params, cb: Callback<number>): void;

  /** Returns affectedRows (works for UPDATE and DELETE). */
  update(sql: string, params?: Params): Promise<number>;
  update(sql: string, params: Params, cb: Callback<number>): void;

  /** Prepared execute; an array of arrays runs as a batch. */
  prepare<T = any>(sql: string, params?: Params | any[][]): Promise<T>;

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
  serverInfo(): ServerInfo;
  /** Connection/reconnection status plus detected server info. */
  health(): Health;
  isReady(): boolean;
  ready(): Promise<true>;
  ready(cb: Callback<true>): void;
}
