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

export function isReadQuery(sql: string): boolean {
  return /^\s*(?:\(|\/\*[\s\S]*?\*\/|--.*\n|#.*\n|\s)*(?:select|with|show|describe|desc|explain)\b/i.test(sql);
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

// Locking reads (`SELECT ... FOR UPDATE`, `LOCK IN SHARE MODE`, MySQL 8's
// `FOR SHARE`) acquire row locks and must hit the server every time — serving
// them from the result cache would silently drop the lock and break the
// consistency they were asked for. They're still reads, so isReadQuery passes;
// this guard keeps them out of the cache specifically.
export function isLockingRead(sql: string): boolean {
  return /\bfor\s+(?:update|share)\b|\block\s+in\s+share\s+mode\b/i.test(sql);
}
