export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with full jitter — the jitter matters when several
// resources (or several pool connections) all reconnect at once after the DB
// blips, so they don't stampede it in lockstep.
export function backoff(attempt: number, base = 500, cap = 30_000): number {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export function preview(sql: string, max = 200): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Leading whitespace / parens / comments we skip before reading the first
// keyword, shared by the two checks below.
const LEAD = String.raw`^\s*(?:\(|\/\*[\s\S]*?\*\/|--.*\n|#.*\n|\s)*`;
const READ_LEAD = new RegExp(`${LEAD}(?:select|with|show|describe|desc|explain)\\b`, 'i');
const WITH_LEAD = new RegExp(`${LEAD}with\\b`, 'i');
const DML_VERB = /\b(?:insert|update|delete|replace)\b/i;

export function isReadQuery(sql: string): boolean {
  if (!READ_LEAD.test(sql)) return false;
  // A `WITH ...` (CTE) statement only reads when its top-level statement is a
  // SELECT. CTE bodies are always SELECT, so a standalone INSERT/UPDATE/DELETE/
  // REPLACE verb means the statement mutates — e.g. `WITH x AS (...) DELETE ...`.
  // Treating it as a write keeps it out of the result cache and makes it
  // invalidate like any other write. Erring toward "write" is the safe side:
  // the worst case is a genuine read needlessly skips the cache.
  if (WITH_LEAD.test(sql) && DML_VERB.test(sql)) return false;
  return true;
}

// mysql2 flags unrecoverable connection failures with `fatal: true`; these
// codes cover the cases where it can't (or where we want to be explicit). When
// one of these surfaces the pooled connection is dead and we should reconnect.
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

// Turn a raw driver/socket error into an actionable, plain-language hint so a
// misconfigured server owner isn't left staring at a bare error code. Returns
// an empty string when we have nothing useful to add.
export function connectionHint(err: any): string {
  const code = typeof err?.code === 'string' ? err.code : '';
  switch (code) {
    case 'ECONNREFUSED':
      return 'the database refused the connection — is it running and are vsql_host/vsql_port correct?';
    case 'ENOTFOUND':
      return 'the database host could not be resolved — check vsql_host.';
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return 'the connection timed out or was reset — check the host, port, and any firewall.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'access denied — check vsql_user and vsql_password.';
    case 'ER_BAD_DB_ERROR':
      return 'the database does not exist — check vsql_database.';
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'the user lacks access to that database — check the grants for vsql_user.';
    default:
      return '';
  }
}

// InnoDB raises these when concurrent transactions contend for the same rows.
// They aren't bugs in the query — the transaction simply needs to be replayed,
// which is safe because it was already rolled back whole.
const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

// Wrap a single statement so it is capped server-side for this one call, used
// by the per-call { timeout } option. MariaDB's `SET STATEMENT ... FOR` caps any
// statement in one round trip; MySQL only supports the MAX_EXECUTION_TIME
// optimizer hint, and only inside a leading SELECT (other statements are left
// unwrapped — use the global vsql_query_timeout there).
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

// Locking reads (`SELECT ... FOR UPDATE`, `LOCK IN SHARE MODE`, MySQL 8's
// `FOR SHARE`) acquire row locks and must hit the server every time — serving
// them from the result cache would silently drop the lock and break the
// consistency they were asked for. They're still reads, so isReadQuery passes;
// this guard keeps them out of the cache specifically.
export function isLockingRead(sql: string): boolean {
  return /\bfor\s+(?:update|share)\b|\block\s+in\s+share\s+mode\b/i.test(sql);
}
