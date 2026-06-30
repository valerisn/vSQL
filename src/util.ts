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

// Locking reads (`SELECT ... FOR UPDATE`, `LOCK IN SHARE MODE`, MySQL 8's
// `FOR SHARE`) acquire row locks and must hit the server every time — serving
// them from the result cache would silently drop the lock and break the
// consistency they were asked for. They're still reads, so isReadQuery passes;
// this guard keeps them out of the cache specifically.
export function isLockingRead(sql: string): boolean {
  return /\bfor\s+(?:update|share)\b|\block\s+in\s+share\s+mode\b/i.test(sql);
}
