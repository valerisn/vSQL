// Schema introspection - information_schema queries scoped to the current
// database via DATABASE(). Table/column names go in as bound *values* (compared
// as strings, never as identifiers), so it's injection-safe. SQL and row-shaping
// live here so they can be tested without a database.

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
