import type { PoolOptions } from 'mysql2/promise';
import type { ServerInfo } from './server';
import { castValue } from './lib/typecast';

export type ServerHint = 'auto' | 'mysql' | 'mariadb';

interface BaseConnection {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  socketPath?: string;
}

function str(name: string, def = ''): string {
  return GetConvar(name, def);
}

function int(name: string, def: number): number {
  const v = GetConvar(name, '');
  if (v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

function bool(name: string, def: boolean): boolean {
  const v = GetConvar(name, '').toLowerCase();
  if (v === '') return def;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

class Config {
  base: BaseConnection = {};
  poolSize = 8;
  maxIdle = 8; // defaults to poolSize; idle connections beyond this are closed
  idleTimeout = 60_000; // ms an idle connection lingers before being reaped
  queueLimit = 0; // max queued connection requests; 0 = unbounded (mysql2 default)
  connectTimeout = 30_000;
  charset = 'utf8mb4';
  collation = 'utf8mb4_unicode_ci';
  timezone = 'Z';
  waitTimeout = 0; // 0 = leave the server default alone
  queryTimeout = 0; // ms; 0 = no server-side statement timeout
  serverHint: ServerHint = 'auto';

  debug = 0;
  slowQueryMs = 150;
  txRetries = 2; // extra attempts for a transaction/batch that hits a deadlock
  breakerThreshold = 10; // consecutive failed reconnects before fast-failing; 0 = off
  breakerResetMs = 30_000; // how long the breaker stays open before a probe

  cacheEnabled = false;
  cacheSize = 500;
  cacheTtl = 30_000;

  autoMigrate = true;
  migrationsDir = 'migrations';

  versionCheck = true;
  versionRepo = 'valerisn/vSQL';

  compat = false; // claim oxmysql/ghmattimysql/mysql-async export namespaces
  typeCast = false; // oxmysql-compatible casting (dates->ms, TINYINT(1)/BIT(1)->bool)

  replicas: BaseConnection[] = []; // read replicas; reads round-robin across them
  replicaCooldownMs = 10_000; // how long a failed replica stays out of rotation

  load(): void {
    this.base = this.parseConnection();
    this.poolSize = int('vsql_pool_size', 8);
    this.maxIdle = int('vsql_max_idle', this.poolSize);
    this.idleTimeout = int('vsql_idle_timeout', 60_000);
    this.queueLimit = Math.max(0, int('vsql_queue_limit', 0));
    this.connectTimeout = int('vsql_connect_timeout', 30_000);
    this.charset = str('vsql_charset', 'utf8mb4');
    this.collation = str('vsql_collation', 'utf8mb4_unicode_ci');
    this.timezone = str('vsql_timezone', 'Z');
    this.waitTimeout = int('vsql_wait_timeout', 0);
    this.queryTimeout = int('vsql_query_timeout', 0);
    this.serverHint = (str('vsql_server_hint', 'auto').toLowerCase() as ServerHint) || 'auto';

    this.debug = int('vsql_debug', 0);
    this.slowQueryMs = int('vsql_slow_query_warning', 150);
    this.txRetries = Math.max(0, int('vsql_tx_retries', 2));
    this.breakerThreshold = Math.max(0, int('vsql_breaker_threshold', 10));
    this.breakerResetMs = int('vsql_breaker_reset', 30_000);

    this.cacheEnabled = bool('vsql_cache', false);
    this.cacheSize = int('vsql_cache_size', 500);
    this.cacheTtl = int('vsql_cache_ttl', 30_000);

    this.autoMigrate = bool('vsql_migrations', true);
    this.migrationsDir = str('vsql_migrations_dir', 'migrations');

    this.versionCheck = bool('vsql_version_check', true);
    this.versionRepo = str('vsql_version_repo', 'valerisn/vSQL');

    this.compat = bool('vsql_compat', false);
    this.typeCast = bool('vsql_typecast', false);

    this.replicas = this.parseReplicas();
    this.replicaCooldownMs = int('vsql_replica_cooldown', 10_000);
  }

  // Read-replica connections, from either (or both) convar:
  //   vsql_read_replicas - full connection strings, comma-separated
  //   vsql_replica_hosts - host[:port], reusing the primary's creds/database
  private parseReplicas(): BaseConnection[] {
    const out: BaseConnection[] = [];
    const list = str('vsql_read_replicas', '');
    if (list) {
      for (const part of list.split(',')) {
        const cs = part.trim();
        if (cs) out.push(/^(mysql|mariadb):\/\//i.test(cs) ? this.parseUrl(cs) : this.parseSemicolon(cs));
      }
    }
    const hosts = str('vsql_replica_hosts', '');
    if (hosts) {
      for (const entry of hosts.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const [host, port] = trimmed.split(':');
        out.push({ ...this.base, host, port: port ? parseInt(port, 10) : this.base.port });
      }
    }
    return out;
  }

  // The connection target for logs - never includes the password.
  target(): string {
    if (this.base.socketPath) return this.base.socketPath;
    return `${this.base.host}:${this.base.port}/${this.base.database || '(none)'}`;
  }

  // Human-readable view of the effective settings for `vsql debug`. No password.
  summary(): string[] {
    return [
      `target      ${this.target()}`,
      `pool        size ${this.poolSize}, maxIdle ${this.maxIdle}, idleTimeout ${this.idleTimeout}ms, connectTimeout ${this.connectTimeout}ms, queueLimit ${this.queueLimit || 'unbounded'}`,
      `charset     ${this.charset} / ${this.collation}, timezone ${this.timezone}`,
      `timeouts    wait ${this.waitTimeout || 'default'}, query ${this.queryTimeout ? `${this.queryTimeout}ms` : 'off'}`,
      `cache       ${this.cacheEnabled ? `on (size ${this.cacheSize}, ttl ${this.cacheTtl}ms)` : 'off'}`,
      `migrations  ${this.autoMigrate ? 'on' : 'off'} (${this.migrationsDir})`,
      `serverHint  ${this.serverHint}, slowQuery ${this.slowQueryMs}ms, debug ${this.debug}`,
      `breaker     ${this.breakerThreshold > 0 ? `after ${this.breakerThreshold} failed reconnects, reset ${this.breakerResetMs}ms` : 'off'}`,
      `compat      ${this.compat ? 'on (oxmysql / ghmattimysql / mysql-async)' : 'off'}`,
      `typeCast    ${this.typeCast ? 'on (oxmysql-compatible)' : 'off'}`,
      `replicas    ${this.replicas.length ? `${this.replicas.length} (${this.replicas.map((r) => `${r.host}:${r.port}`).join(', ')})` : 'none'}`
    ];
  }

  // Warnings for a config that loads but is probably a mistake, shown once at
  // startup before it turns into a confusing query error.
  issues(): string[] {
    const out: string[] = [];
    if (!this.base.database) {
      out.push('no database set (vsql_database / connection string) - queries must fully-qualify table names.');
    }
    if (this.poolSize < 1) {
      out.push(`vsql_pool_size is ${this.poolSize}; it must be at least 1.`);
    }
    if (this.maxIdle > this.poolSize) {
      out.push(`vsql_max_idle (${this.maxIdle}) is above vsql_pool_size (${this.poolSize}); it will be capped to the pool size.`);
    }
    return out;
  }

  poolOptions(base: BaseConnection = this.base): PoolOptions {
    return {
      ...base,
      connectionLimit: this.poolSize,
      maxIdle: this.maxIdle,
      idleTimeout: this.idleTimeout,
      connectTimeout: this.connectTimeout,
      charset: this.charset,
      timezone: this.timezone,
      waitForConnections: true,
      queueLimit: this.queueLimit,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      multipleStatements: false,
      namedPlaceholders: false,
      // Pool-level casting; per-call overrides are applied in Database.exec.
      ...(this.typeCast ? { typeCast: castValue } : {}),
      // mysql2's per-connection prepared-statement LRU - the caching for execute().
      maxPreparedStatements: 1000,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false
    };
  }

  // Session setup run on every new pool connection, so charset/timeouts don't
  // depend on the server's global defaults.
  sessionStatements(server: ServerInfo): string[] {
    const stmts = [`SET NAMES ${this.charset} COLLATE ${this.collation}`];
    if (this.waitTimeout > 0) {
      stmts.push(`SET SESSION wait_timeout = ${this.waitTimeout}, interactive_timeout = ${this.waitTimeout}`);
    }
    if (this.queryTimeout > 0 && server.type !== 'unknown') {
      // Cap statement runtime so a runaway query can't hold a connection forever.
      // MariaDB's max_statement_time is seconds and caps everything; MySQL's
      // max_execution_time is ms and caps only read-only SELECTs. Skipped until
      // the server is known - the first connection tunes before detection, then
      // Database.start re-tunes it.
      stmts.push(
        server.type === 'mariadb'
          ? `SET SESSION max_statement_time = ${this.queryTimeout / 1000}`
          : `SET SESSION max_execution_time = ${Math.round(this.queryTimeout)}`
      );
    }
    return stmts;
  }

  private parseConnection(): BaseConnection {
    const cs = str('vsql_connection_string', '');
    if (cs) {
      if (/^(mysql|mariadb):\/\//i.test(cs)) return this.parseUrl(cs);
      return this.parseSemicolon(cs);
    }
    const socket = str('vsql_socket', '');
    return {
      host: str('vsql_host', 'localhost'),
      port: int('vsql_port', 3306),
      user: str('vsql_user', 'root'),
      password: str('vsql_password', ''),
      database: str('vsql_database', ''),
      socketPath: socket || undefined
    };
  }

  private parseUrl(cs: string): BaseConnection {
    const url = new URL(cs);
    return {
      host: decodeURIComponent(url.hostname) || 'localhost',
      port: url.port ? parseInt(url.port, 10) : 3306,
      user: decodeURIComponent(url.username) || 'root',
      password: decodeURIComponent(url.password) || '',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || ''
    };
  }

  // oxmysql's legacy `host=localhost;user=root;...` form, so existing configs
  // can be copied across verbatim.
  private parseSemicolon(cs: string): BaseConnection {
    const out: Record<string, string> = {};
    for (const pair of cs.split(';')) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      out[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
    }
    return {
      host: out.host || out.server || 'localhost',
      port: out.port ? parseInt(out.port, 10) : 3306,
      user: out.user || out.userid || out.uid || 'root',
      password: out.password || out.pwd || '',
      database: out.database || out.db || '',
      socketPath: out.socket || out.socketpath || undefined
    };
  }
}

export const config = new Config();
