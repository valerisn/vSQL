// Pure result-shaping for the query paths, plus the transaction-entry normaliser.
// Dependency-free, so each method's return contract can be tested on its own.

/** single(): the first row of the result set, or null when it is empty. */
export function asSingle(rows: any): any {
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

/** scalar(): the first column of the first row, or null when there is none. */
export function asScalar(rows: any): any {
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  const values = Object.values(row);
  return values.length ? values[0] : null;
}

/** insert(): the AUTO_INCREMENT id from the OK packet, or 0. */
export function asInsertId(header: any): number {
  return header?.insertId ?? 0;
}

/** update()/delete(): the affected-row count from the OK packet, or 0. */
export function asAffected(header: any): number {
  return header?.affectedRows ?? 0;
}

/** The accepted shapes for one entry in the array form of transaction(). */
export type TransactionEntry =
  | string
  | [string, any]
  | { query?: string; sql?: string; values?: any; params?: any };

// Reduce any accepted entry shape to a [sql, params] tuple. The object form takes
// query/sql for the text and values/params for the bindings, so entries written
// against other resources carry over.
export function normalizeEntry(entry: TransactionEntry): [string, any] {
  if (typeof entry === 'string') return [entry, undefined];
  if (Array.isArray(entry)) return [entry[0], entry[1]];
  const sql = entry.query ?? entry.sql;
  if (!sql) throw new Error('vSQL: transaction query entry is missing a "query" string');
  return [sql, entry.values ?? entry.params];
}
