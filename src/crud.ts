// Lightweight, safe SQL builders for the boring CRUD cases, so callers don't
// hand-write `INSERT INTO ... VALUES (?, ?)` for simple inserts/updates. The
// output is always a parameterised statement: *values* become bound `?`
// placeholders (the driver binds them, exactly as for raw queries), and
// *identifiers* (table / column names) are backtick-escaped here - never spliced
// in raw. This keeps the helpers injection-safe even if a column name is
// attacker-controlled. For anything beyond equality/IN conditions, use raw query.

export interface BuiltQuery {
  sql: string;
  values: any[];
}

/** A WHERE: an object of ANDed conditions, or a raw [sql, params] escape hatch. */
export type Where = Record<string, any> | [string, any[]?];

export interface FindOptions {
  /** Columns to select; defaults to *. */
  columns?: string[];
  /** Single column to order by (escaped as an identifier). */
  orderBy?: string;
  /** Order direction; anything other than 'DESC' is treated as 'ASC'. */
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

// MySQL identifier escaping: wrap in backticks and double any internal backtick.
// Dotted names (schema.table) are escaped segment-by-segment. This is the canonical
// safe form - a malicious name like `x`; DROP TABLE y; --` collapses to a single
// harmless quoted identifier.
export function escapeId(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('vSQL: identifier must be a non-empty string');
  }
  return name
    .split('.')
    .map((part) => '`' + part.replace(/`/g, '``') + '`')
    .join('.');
}

function buildWhere(where: Where, values: any[]): string {
  // Raw escape hatch: [sql, params].
  if (Array.isArray(where)) {
    const [sql, params] = where;
    if (params) for (const p of params) values.push(p);
    return sql;
  }
  const keys = Object.keys(where);
  return keys
    .map((k) => {
      const v = where[k];
      if (v === null || v === undefined) return `${escapeId(k)} IS NULL`;
      if (Array.isArray(v)) {
        // Bind the array and let bindParams expand `IN ?` -> `IN (?, ?, ...)`.
        values.push(v);
        return `${escapeId(k)} IN ?`;
      }
      values.push(v);
      return `${escapeId(k)} = ?`;
    })
    .join(' AND ');
}

export function buildInsert(table: string, data: Record<string, any> | Record<string, any>[]): BuiltQuery {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) throw new Error('vSQL: insert needs at least one row');
  const cols = Object.keys(rows[0]);
  if (cols.length === 0) throw new Error('vSQL: insert needs at least one column');
  const colSql = cols.map(escapeId).join(', ');
  const values: any[] = [];
  // Columns are taken from the first row; later rows are read in the same order
  // (a missing key binds NULL, like the rest of vSQL).
  const tuples = rows.map(
    (row) => '(' + cols.map((c) => (values.push(row[c]), '?')).join(', ') + ')'
  );
  return { sql: `INSERT INTO ${escapeId(table)} (${colSql}) VALUES ${tuples.join(', ')}`, values };
}

export function buildUpdate(table: string, data: Record<string, any>, where: Where): BuiltQuery {
  const cols = Object.keys(data);
  if (cols.length === 0) throw new Error('vSQL: update needs at least one column to set');
  const values: any[] = [];
  const setSql = cols.map((c) => (values.push(data[c]), `${escapeId(c)} = ?`)).join(', ');
  const whereSql = buildWhere(where, values);
  if (!whereSql) throw new Error('vSQL: update requires a WHERE (refusing to update every row)');
  return { sql: `UPDATE ${escapeId(table)} SET ${setSql} WHERE ${whereSql}`, values };
}

export function buildDelete(table: string, where: Where): BuiltQuery {
  const values: any[] = [];
  const whereSql = buildWhere(where, values);
  if (!whereSql) throw new Error('vSQL: delete requires a WHERE (refusing to delete every row)');
  return { sql: `DELETE FROM ${escapeId(table)} WHERE ${whereSql}`, values };
}

export function buildSelect(table: string, where?: Where, opts: FindOptions = {}): BuiltQuery {
  const values: any[] = [];
  const cols = opts.columns && opts.columns.length ? opts.columns.map(escapeId).join(', ') : '*';
  let sql = `SELECT ${cols} FROM ${escapeId(table)}`;

  const hasWhere = where && (Array.isArray(where) ? where.length > 0 : Object.keys(where).length > 0);
  if (hasWhere) {
    const whereSql = buildWhere(where as Where, values);
    if (whereSql) sql += ` WHERE ${whereSql}`;
  }
  if (opts.orderBy) {
    const dir = opts.order === 'DESC' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ${escapeId(opts.orderBy)} ${dir}`;
  }
  if (opts.limit != null) {
    sql += ' LIMIT ?';
    values.push(opts.limit);
  }
  if (opts.offset != null) {
    sql += ' OFFSET ?';
    values.push(opts.offset);
  }
  return { sql, values };
}
