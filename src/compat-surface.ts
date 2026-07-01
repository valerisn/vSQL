// The exact compat surface vSQL claims, mirroring oxmysql 2.14.1: every method as
// `name`, `name_async`, and the deprecated `nameSync`, plus a subset on the
// ghmattimysql and mysql-async namespaces. Plain data in a leaf module so a test
// can pin it and it can't silently drift from the reference.
//
// One deliberate gap: oxmysql's experimental `startTransaction` (a manual
// commit/rollback handle) has no vSQL equivalent, so it's omitted - see COMPATIBILITY.md.

/** The methods vSQL serves on the `oxmysql` namespace. */
export const COMPAT_METHODS = [
  'query',
  'single',
  'scalar',
  'update',
  'insert',
  'prepare',
  'rawExecute',
  'transaction',
  'store',
  'isReady',
  'awaitConnection',
  'execute', // oxmysql aliases execute -> query (text protocol)
  'fetch' // oxmysql aliases fetch -> query
] as const;

export type CompatMethod = (typeof COMPAT_METHODS)[number];

/** ghmattimysql export name for each method it supports. */
export const GHMATTI_ALIASES: Partial<Record<CompatMethod, string>> = {
  query: 'execute',
  scalar: 'scalar',
  transaction: 'transaction',
  store: 'store'
};

/** mysql-async export name for each method it supports (no Sync variants). */
export const MYSQL_ASYNC_ALIASES: Partial<Record<CompatMethod, string>> = {
  update: 'mysql_execute',
  insert: 'mysql_insert',
  query: 'mysql_fetch_all',
  scalar: 'mysql_fetch_scalar',
  transaction: 'mysql_transaction',
  store: 'mysql_store'
};

// Every method is exposed three ways: bare, `_async`, and the deprecated `Sync`.
export function oxmysqlExports(methods: readonly string[] = COMPAT_METHODS): string[] {
  return methods.flatMap((m) => [m, `${m}_async`, `${m}Sync`]);
}

// ghmattimysql exposes each aliased name plus its deprecated `Sync` variant.
export function ghmattiExports(aliases: Partial<Record<string, string>> = GHMATTI_ALIASES): string[] {
  return Object.values(aliases).flatMap((a) => [a as string, `${a}Sync`]);
}

// mysql-async exposes only the bare prefixed names.
export function mysqlAsyncExports(aliases: Partial<Record<string, string>> = MYSQL_ASYNC_ALIASES): string[] {
  return Object.values(aliases) as string[];
}
