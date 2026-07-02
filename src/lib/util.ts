export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff, half fixed + half jitter. The jitter stops a bunch of
// connections that dropped together from all retrying on the same beat.
export function backoff(attempt: number, base = 500, cap = 30_000): number {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export function preview(sql: string, max = 200): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Skip leading whitespace, parens, and comments before the first keyword.
const LEAD = String.raw`^\s*(?:\(|\/\*[\s\S]*?\*\/|--.*\n|#.*\n|\s)*`;
const READ_LEAD = new RegExp(`${LEAD}(?:select|with|show|describe|desc|explain)\\b`, 'i');
const WITH_LEAD = new RegExp(`${LEAD}with\\b`, 'i');
const DML_VERB = /\b(?:insert|update|delete|replace)\b/i;

export function isReadQuery(sql: string): boolean {
  if (!READ_LEAD.test(sql)) return false;
  // A CTE reads only if it ends in a SELECT; `WITH x AS (...) DELETE ...` writes.
  // When in doubt call it a write - worst case a real read skips the cache.
  if (WITH_LEAD.test(sql) && DML_VERB.test(sql)) return false;
  return true;
}

// mysql2 marks most dead connections with `fatal: true`; these codes catch the
// rest. Any of them means the pooled connection is gone and we should reconnect.
const FATAL_CONNECTION_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_PACKETS_OUT_OF_ORDER',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'POOL_CLOSED'
]);

export function isFatalConnectionError(err: any): boolean {
  if (!err) return false;
  if (err.fatal === true) return true;
  return typeof err.code === 'string' && FATAL_CONNECTION_CODES.has(err.code);
}

// Turn a bare driver error code into a plain-language hint, so a misconfigured
// owner isn't left googling ECONNREFUSED. Empty string when we've nothing to add.
export function connectionHint(err: any): string {
  const code = typeof err?.code === 'string' ? err.code : '';
  switch (code) {
    case 'ECONNREFUSED':
      return 'the database refused the connection - is it running and are vsql_host/vsql_port correct?';
    case 'ENOTFOUND':
      return 'the database host could not be resolved - check vsql_host.';
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return 'the connection timed out or was reset - check the host, port, and any firewall.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'access denied - check vsql_user and vsql_password.';
    case 'ER_BAD_DB_ERROR':
      return 'the database does not exist - check vsql_database.';
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'the user lacks access to that database - check the grants for vsql_user.';
    default:
      return '';
  }
}

// InnoDB throws these when transactions fight over the same rows. Not a bug in
// the query - just replay it, which is safe since it already rolled back whole.
const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

// Cap one statement server-side, for the per-call { timeout } option. MariaDB
// can cap anything via SET STATEMENT; MySQL only has the MAX_EXECUTION_TIME hint
// and only on a leading SELECT - other statements fall through unwrapped.
export function withStatementTimeout(
  sql: string,
  ms: number,
  serverType: 'mysql' | 'mariadb' | 'unknown'
): string {
  if (!ms || ms <= 0) return sql;
  if (serverType === 'mariadb') {
    return `SET STATEMENT max_statement_time=${ms / 1000} FOR ${sql}`;
  }
  const lead = sql.match(/^(\s*)(select)\b/i);
  if (!lead) return sql;
  const hint = `/*+ MAX_EXECUTION_TIME(${Math.round(ms)}) */`;
  return `${sql.slice(0, lead[0].length)} ${hint}${sql.slice(lead[0].length)}`;
}

export function isRetryableError(err: any): boolean {
  if (!err) return false;
  if (typeof err.code === 'string' && RETRYABLE_CODES.has(err.code)) return true;
  return err.errno === 1213 || err.errno === 1205; // deadlock / lock wait timeout
}

// Locking reads (FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE) take row locks, so
// they have to reach the server - caching one would quietly drop the lock.
export function isLockingRead(sql: string): boolean {
  return /\bfor\s+(?:update|share)\b|\block\s+in\s+share\s+mode\b/i.test(sql);
}

// Can this result live in the cache? Only a plain, non-locking read with caching
// on and not opted out. When unsure, don't cache - the cost is a round-trip, not
// a stale row.
export function isCacheable(sql: string, cacheEnabled: boolean, optedOut: boolean): boolean {
  return isCacheableRead(sql, cacheEnabled, optedOut, isReadQuery(sql));
}

// Same call, but the read path already classified the query for routing, so pass
// that in rather than re-running isReadQuery. Cheap checks first, so a disabled
// cache short-circuits before the isLockingRead regex.
export function isCacheableRead(sql: string, cacheEnabled: boolean, optedOut: boolean, isRead: boolean): boolean {
  return cacheEnabled && !optedOut && isRead && !isLockingRead(sql);
}
