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

// Let resources written against oxmysql / ghmattimysql / mysql-async run on vSQL
// unchanged. FiveM implements `exports.<resource>.<method>(...)` as an event,
// `__cfx_export_<resource>_<method>`, that the owning resource answers with a
// setter; we answer those events ourselves, reproducing oxmysql 2.14.1's surface.
//
// The base export's shape is `(query, parameters, cb, invokingResource, isPromise)`:
// the trailing invokingResource lets a wrapper forward the real caller, isPromise
// is oxmysql-internal and ignored. The `_async`/`Sync` variants drop cb and always
// return a promise. Opt-in via vsql_compat, and only with the original removed.

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

// An explicit invokingResource arg (a wrapper forwarding the real caller) wins;
// otherwise read it from the current export call.
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

// oxmysql's store never really caches - it just returns the query. Mirror that,
// so resources that call store() and pass the result back as their query work.
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
