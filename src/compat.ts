import { db } from './database';
import { config } from './config';
import { logger } from './logger';
import { invokingResource } from './invoker';

// Crossover compatibility for resources written against other MySQL resources.
//
// FiveM implements `exports.<resource>.<method>(...)` as an event named
// `__cfx_export_<resource>_<method>`; the owning resource answers it with a
// setter that hands back the function. We answer those events for oxmysql,
// ghmattimysql and mysql-async ourselves, so scripts that call
// `exports.oxmysql.execute(...)` (etc.) get routed into vSQL unchanged.
//
// Opt-in via `vsql_compat` and only with the original resource removed, so two
// resources aren't both claiming the same export namespace.

type AnyFn = (...args: any[]) => any;
type Method = 'query' | 'execute' | 'single' | 'scalar' | 'insert' | 'update' | 'prepare' | 'transaction';

function bridge(promise: Promise<any>, cb?: any): Promise<any> | void {
  if (typeof cb === 'function') {
    promise.then((r) => cb(r)).catch((e) => {
      logger.error(e.message);
      cb(null, e);
    });
    return;
  }
  return promise;
}

// (query, params?, cb?) - the shape oxmysql/ghmatti/mysql-async callers use.
function forward(method: Method): AnyFn {
  return (query: string, params?: any, cb?: any) => {
    // Attribute the compat-routed call to its caller, same as a native export.
    const resource = invokingResource();
    if (typeof params === 'function') {
      cb = params;
      params = undefined;
    }
    const opts = resource ? { resource } : undefined;
    return bridge(db.whenReady().then(() => (db as any)[method](query, params, opts)), cb);
  };
}

// Claim `exports.<resource>.<name>` by answering its export event.
function registerNamespace(resource: string, map: Record<string, AnyFn>): void {
  for (const name of Object.keys(map)) {
    on(`__cfx_export_${resource}_${name}`, (setResult: (fn: AnyFn) => void) => setResult(map[name]));
  }
}

export function registerCompat(): void {
  // mysql-async / ESX-legacy consumers wait on this rather than polling.
  db.whenReady().then(() => emit('onMySQLReady'));

  if (!config.compat) return;

  const query = forward('query');
  const execute = forward('execute');
  const single = forward('single');
  const scalar = forward('scalar');
  const insert = forward('insert');
  const update = forward('update');
  const prepare = forward('prepare');
  const transaction = forward('transaction');

  // oxmysql - method names line up with vSQL, plus its async aliases.
  registerNamespace('oxmysql', {
    query,
    execute,
    single,
    scalar,
    prepare,
    insert,
    update,
    transaction,
    rawExecute: query,
    insert_async: insert,
    update_async: update,
    scalar_async: scalar,
    single_async: single
  });

  // ghmattimysql - a subset with the same shapes.
  registerNamespace('ghmattimysql', { execute, scalar, insert, transaction, query });

  // mysql-async - its prefixed export names mapped onto vSQL.
  registerNamespace('mysql-async', {
    mysql_execute: update,
    mysql_fetch_all: query,
    mysql_fetch_scalar: scalar,
    mysql_insert: insert,
    mysql_transaction: transaction
  });

  logger.info('compatibility exports registered for oxmysql / ghmattimysql / mysql-async');
}
