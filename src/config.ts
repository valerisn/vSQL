import type { PoolOptions } from 'mysql2/promise';
import type { ServerInfo } from './server';

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
  connectTimeout = 30_000;
  charset = 'utf8mb4';
  collation = 'utf8mb4_unicode_ci';
  timezone = 'Z';
  waitTimeout = 0; // 0 = leave the server default alone
  serverHint: ServerHint = 'auto';

  debug = 0;
  slowQueryMs = 150;

  cacheEnabled = false;
  cacheSize = 500;
  cacheTtl = 30_000;

  autoMigrate = true;
  migrationsDir = 'migrations';

  versionCheck = true;
  versionRepo = 'valerisn/vSQL';

  load(): void {
    this.base = this.parseConnection();
    this.poolSize = int('vsql_pool_size', 8);
    this.connectTimeout = int('vsql_connect_timeout', 30_000);
    this.charset = str('vsql_charset', 'utf8mb4');
    this.collation = str('vsql_collation', 'utf8mb4_unicode_ci');
    this.timezone = str('vsql_timezone', 'Z');
    this.waitTimeout = int('vsql_wait_timeout', 0);
    this.serverHint = (str('vsql_server_hint', 'auto').toLowerCase() as ServerHint) || 'auto';

    this.debug = int('vsql_debug', 0);
    this.slowQueryMs = int('vsql_slow_query_warning', 150);

    this.cacheEnabled = bool('vsql_cache', false);
    this.cacheSize = int('vsql_cache_size', 500);
    this.cacheTtl = int('vsql_cache_ttl', 30_000);

    this.autoMigrate = bool('vsql_migrations', true);
    this.migrationsDir = str('vsql_migrations_dir', 'migrations');

    this.versionCheck = bool('vsql_version_check', true);
    this.versionRepo = str('vsql_version_repo', 'valerisn/vSQL');
  }

  poolOptions(): PoolOptions {
    return {
      ...this.base,
      connectionLimit: this.poolSize,
      connectTimeout: this.connectTimeout,
      charset: this.charset,
      timezone: this.timezone,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      multipleStatements: false,
      namedPlaceholders: false,
      // mysql2 keeps an LRU of prepared statements per connection; this is the
      // "prepared-statement caching" knob for the execute() path.
      maxPreparedStatements: 1000,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false
    };
  }

  // Per-connection session setup. Run for every new physical pool connection so
  // charset/timeouts are consistent regardless of the server's global defaults.
  sessionStatements(server: ServerInfo): string[] {
    const stmts = [`SET NAMES ${this.charset} COLLATE ${this.collation}`];
    if (this.waitTimeout > 0) {
      stmts.push(`SET SESSION wait_timeout = ${this.waitTimeout}, interactive_timeout = ${this.waitTimeout}`);
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
