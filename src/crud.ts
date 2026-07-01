// Safe SQL builders for the boring CRUD cases, so nobody hand-writes
// `INSERT INTO ... VALUES (?, ?)`. Values become bound `?` placeholders and
// identifiers get backtick-escaped here, so the output stays injection-safe even
// if a column name is attacker-controlled. Past equality/IN, drop to raw query.

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

// Backtick-quote an identifier, doubling any internal backtick; dotted names
// (schema.table) are quoted segment by segment. A hostile name like
// `x`; DROP TABLE y; --` just collapses into one harmless quoted string.
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
        // Let bindParams expand `IN ?` into `IN (?, ?, ...)`.
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
  // Column list comes from the first row; later rows follow it (a missing key
  // binds NULL, same as everywhere else in vSQL).
  const tuples = rows.map(
    (row) => '(' + cols.map((c) => (values.push(row[c]), '?')).join(', ') + ')'
  );
  return { sql: `INSERT INTO ${escapeId(table)} (${colSql}) VALUES ${tuples.join(', ')}`, values };
}

// INSERT ... RETURNING for MariaDB 10.5+: the new row comes back with the insert.
export function buildInsertReturning(
  table: string,
  data: Record<string, any> | Record<string, any>[],
  returning?: string[]
): BuiltQuery {
  const q = buildInsert(table, data);
  const cols = returning && returning.length ? returning.map(escapeId).join(', ') : '*';
  return { sql: `${q.sql} RETURNING ${cols}`, values: q.values };
}

// Fallback for servers without RETURNING: read the just-inserted row back by id.
export function buildSelectById(table: string, idColumn = 'id', returning?: string[]): string {
  const cols = returning && returning.length ? returning.map(escapeId).join(', ') : '*';
  return `SELECT ${cols} FROM ${escapeId(table)} WHERE ${escapeId(idColumn)} = ?`;
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
