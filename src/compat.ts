import { db } from './database';
import { config } from './config';
import { logger } from './logger';
import { invokingResource } from './invoker';
import {
  COMPAT_METHODS,
  CompatMethod,
  GHMATTI_ALIASES,
  MYSQL_ASYNC_ALIASES
} from './compat-surface';

// Crossover compatibility for resources written against other MySQL resources.
//
// FiveM implements `exports.<resource>.<method>(...)` as an event named
// `__cfx_export_<resource>_<method>`; the owning resource answers it with a
// setter that hands back the function. We answer those events for oxmysql,
// ghmattimysql and mysql-async ourselves, reproducing oxmysql 2.14.1's export
// surface and calling convention so scripts that call `exports.oxmysql.execute(...)`
// (etc.) route into vSQL unchanged.
//
// The convention we mirror: a base export is `(query, parameters, cb,
// invokingResource = GetInvokingResource(), isPromise?)`. The trailing
// invokingResource lets a wrapper resource forward the real caller for
// attribution; isPromise is oxmysql-internal and ignored here. The `_async` /
// `Sync` variants are `(query, parameters, invokingResource?)` and always return
// a promise.
//
// Opt-in via `vsql_compat` and only with the original resource removed, so two
// resources aren't both claiming the same export namespace.

type AnyFn = (...args: any[]) => any;

// One method's two calling forms: the base (callback-or-promise) export and the
// always-promise `_async`/`Sync` export.
interface Handler {
  base: AnyFn;
  async: AnyFn;
}

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

// Attribution: an explicit invokingResource argument (a wrapper forwarding the
// real caller) wins; otherwise read it from the current export call.
function resolveResource(explicit?: unknown): string | undefined {
  return (typeof explicit === 'string' && explicit) || invokingResource();
}

// Forward a method to the matching db.* call, honouring oxmysql's argument shape:
// a function in the parameters slot is the callback (setCallback semantics).
function dbForward(method: string): Handler {
  const opts = (resource?: string) => (resource ? { resource } : undefined);
  return {
    base: (query: string, parameters?: any, cb?: any, invoking?: unknown) => {
      const resource = resolveResource(invoking);
      const callback = typeof cb === 'function' ? cb : typeof parameters === 'function' ? parameters : undefined;
      const params = typeof parameters === 'function' ? undefined : parameters;
      return bridge(db.whenReady().then(() => (db as any)[method](query, params, opts(resource))), callback);
    },
    async: (query: string, parameters?: any, invoking?: unknown) => {
      const resource = resolveResource(invoking);
      const params = typeof parameters === 'function' ? undefined : parameters;
      return db.whenReady().then(() => (db as any)[method](query, params, opts(resource)));
    }
  };
}

// store: oxmysql's store is a pass-through that returns the query as-is (it never
// actually caches), so resources that call store() then pass the result back as
// their query keep working.
const storeHandler: Handler = {
  base: (query: string, cb?: any) => {
    if (typeof cb === 'function') {
      cb(query);
      return;
    }
    return query;
  },
  async: (query: string) => Promise.resolve(query)
};

const isReadyHandler: Handler = {
  base: (cb?: any) => (typeof cb === 'function' ? cb(db.isConnected) : db.isConnected),
  async: () => Promise.resolve(db.isConnected)
};

const awaitConnectionHandler: Handler = {
  base: (cb?: any) => bridge(db.whenReady().then(() => true), typeof cb === 'function' ? cb : undefined),
  async: () => db.whenReady().then(() => true)
};

// Build the handler for each compat method. execute/fetch alias query, exactly
// as oxmysql does; rawExecute maps to prepare so array-of-arrays batches work.
function buildHandlers(): Record<CompatMethod, Handler> {
  const query = dbForward('query');
  const handlers: Record<CompatMethod, Handler> = {
    query,
    single: dbForward('single'),
    scalar: dbForward('scalar'),
    update: dbForward('update'),
    insert: dbForward('insert'),
    prepare: dbForward('prepare'),
    rawExecute: dbForward('prepare'),
    transaction: dbForward('transaction'),
    store: storeHandler,
    isReady: isReadyHandler,
    awaitConnection: awaitConnectionHandler,
    execute: query, // alias of query (text protocol)
    fetch: query // alias of query
  };
  return handlers;
}

// Claim `exports.<resource>.<name>` by answering its export event.
function provide(resource: string, name: string, fn: AnyFn): void {
  on(`__cfx_export_${resource}_${name}`, (setResult: (fn: AnyFn) => void) => setResult(fn));
}

export function registerCompat(): void {
  // mysql-async / ESX-legacy consumers wait on this rather than polling.
  db.whenReady().then(() => emit('onMySQLReady'));

  if (!config.compat) return;

  const handlers = buildHandlers();

  for (const method of COMPAT_METHODS) {
    const h = handlers[method];
    // oxmysql namespace: bare, _async, and the deprecated Sync alias.
    provide('oxmysql', method, h.base);
    provide('oxmysql', `${method}_async`, h.async);
    provide('oxmysql', `${method}Sync`, h.async);

    // ghmattimysql: the aliased name plus its deprecated Sync variant.
    const ghmatti = GHMATTI_ALIASES[method];
    if (ghmatti) {
      provide('ghmattimysql', ghmatti, h.base);
      provide('ghmattimysql', `${ghmatti}Sync`, h.async);
    }

    // mysql-async: only the bare prefixed name.
    const mysqlAsync = MYSQL_ASYNC_ALIASES[method];
    if (mysqlAsync) provide('mysql-async', mysqlAsync, h.base);
  }

  logger.info('compatibility exports registered for oxmysql / ghmattimysql / mysql-async');
}
