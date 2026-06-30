// Schema introspection helpers - thin queries against information_schema, scoped
// to the connected database via DATABASE(). Table and column names are passed as
// bound *values* here (compared as strings, never spliced in as identifiers), so
// these stay injection-safe like any other parameterised query. The SQL and the
// row-shaping live here so they can be exercised without a database.

export interface ColumnInfo {
  /** Column name. */
  name: string;
  /** Base data type, e.g. 'int', 'varchar', 'datetime'. */
  type: string;
  /** Whether the column accepts NULL. */
  nullable: boolean;
  /** Key role: '' | 'PRI' | 'UNI' | 'MUL'. */
  key: string;
  /** Declared default, or null. */
  default: string | null;
}

export const SQL_TABLE_EXISTS =
  'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1';

export const SQL_COLUMN_EXISTS =
  'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1';

export const SQL_LIST_COLUMNS =
  'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT ' +
  'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION';

export const SQL_LIST_TABLES =
  "SELECT TABLE_NAME FROM information_schema.TABLES " +
  "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";

export function shapeColumns(rows: any): ColumnInfo[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    name: r.COLUMN_NAME,
    type: r.DATA_TYPE,
    nullable: r.IS_NULLABLE === 'YES',
    key: r.COLUMN_KEY ?? '',
    default: r.COLUMN_DEFAULT ?? null
  }));
}

export function shapeTables(rows: any): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => r.TABLE_NAME);
}
