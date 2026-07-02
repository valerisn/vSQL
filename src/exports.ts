import { db } from './database';
import { logger } from './logger';
import { invokingResource } from './lib/invoker';

type Callback = (result: any, error?: any) => void;

// Serve a call either way: return the promise for `await`, or drive a callback.
// With a callback we don't return the promise, so errors can't become unhandled
// rejections.
function bridge(promise: Promise<any>, cb?: Callback): Promise<any> | void {
  if (typeof cb === 'function') {
    promise.then((r) => cb(r)).catch((e) => {
      logger.error(e.message);
      cb(null, e);
    });
    return;
  }
  return promise;
}

export function registerExports(): void {
  // (sql, params?, opts?, cb?), all optional. A function in the params or opts
  // slot is the callback; an object in the 3rd slot is { timeout, cache }.
  const standard = (method: 'query' | 'execute' | 'single' | 'scalar' | 'insert' | 'update' | 'prepare') => {
    return (sql: string, params?: any, optsOrCb?: any, cb?: any) => {
      // Capture the caller before anything async; it's gone after the first await.
      const resource = invokingResource();
      if (typeof params === 'function') {
        cb = params;
        params = undefined;
      } else if (typeof optsOrCb === 'function') {
        cb = optsOrCb;
        optsOrCb = undefined;
      }
      const userOpts = optsOrCb && typeof optsOrCb === 'object' ? optsOrCb : undefined;
      const opts = (userOpts || resource) ? { ...userOpts, resource } : undefined;
      return bridge(db.whenReady().then(() => (db as any)[method](sql, params, opts)), cb);
    };
  };

  exports('query', standard('query'));
  exports('execute', standard('execute'));
  exports('single', standard('single'));
  exports('scalar', standard('scalar'));
  exports('insert', standard('insert'));
  exports('update', standard('update'));
  exports('prepare', standard('prepare'));

  // oxmysql compatibility aliases so existing call sites keep working.
  exports('rawExecute', standard('query'));
  exports('insert_async', standard('insert'));
  exports('update_async', standard('update'));
  exports('scalar_async', standard('scalar'));
  exports('single_async', standard('single'));

  exports('batch', (sql: string, rows?: any, cb?: any) => {
    if (typeof rows === 'function') {
      cb = rows;
      rows = undefined;
    }
    return bridge(db.whenReady().then(() => db.batch(sql, rows)), cb);
  });

  exports('transaction', (queries: any, params?: any, cb?: any) => {
    if (typeof params === 'function') {
      cb = params;
      params = undefined;
    }
    return bridge(db.whenReady().then(() => db.transaction(queries)), cb);
  });

  // Fold the calling resource into the options, read now before the first await.
  const withResource = (userOpts?: any) => {
    const resource = invokingResource();
    if (userOpts && typeof userOpts === 'object') return { ...userOpts, resource };
    return resource ? { resource } : undefined;
  };

  // CRUD helpers: build a parameterised statement from a table + data/where.
  exports('insertInto', (table: string, data: any, optsOrCb?: any, cb?: any) => {
    if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    const opts = withResource(optsOrCb);
    return bridge(db.whenReady().then(() => db.insertInto(table, data, opts)), cb);
  });
  exports('insertAndFetch', (table: string, data: any, optsOrCb?: any, cb?: any) => {
    if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    const opts = withResource(optsOrCb);
    return bridge(db.whenReady().then(() => db.insertAndFetch(table, data, opts)), cb);
  });
  exports('updateWhere', (table: string, data: any, where: any, optsOrCb?: any, cb?: any) => {
    if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    const opts = withResource(optsOrCb);
    return bridge(db.whenReady().then(() => db.updateWhere(table, data, where, opts)), cb);
  });
  exports('deleteWhere', (table: string, where: any, optsOrCb?: any, cb?: any) => {
    if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    const opts = withResource(optsOrCb);
    return bridge(db.whenReady().then(() => db.deleteWhere(table, where, opts)), cb);
  });
  exports('find', (table: string, where?: any, optsOrCb?: any, cb?: any) => {
    if (typeof where === 'function') {
      cb = where;
      where = undefined;
    } else if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    // optsOrCb is the FindOptions; withResource() carries only the caller for profiling.
    return bridge(db.whenReady().then(() => db.find(table, where, optsOrCb, withResource())), cb);
  });
  exports('findOne', (table: string, where?: any, optsOrCb?: any, cb?: any) => {
    if (typeof where === 'function') {
      cb = where;
      where = undefined;
    } else if (typeof optsOrCb === 'function') {
      cb = optsOrCb;
      optsOrCb = undefined;
    }
    return bridge(db.whenReady().then(() => db.findOne(table, where, optsOrCb, withResource())), cb);
  });

  // Schema introspection.
  exports('tableExists', (table: string, cb?: any) =>
    bridge(db.whenReady().then(() => db.tableExists(table)), cb)
  );
  exports('columnExists', (table: string, column?: any, cb?: any) => {
    if (typeof column === 'function') {
      cb = column;
      column = undefined;
    }
    return bridge(db.whenReady().then(() => db.columnExists(table, column)), cb);
  });
  exports('columns', (table: string, cb?: any) => bridge(db.whenReady().then(() => db.listColumns(table)), cb));
  exports('tables', (cb?: any) => bridge(db.whenReady().then(() => db.listTables()), cb));

  // Cache control + observability.
  exports('cacheClear', (pattern?: string) => db.cache.clear(pattern));
  exports('clearCache', (pattern?: string) => db.cache.clear(pattern));
  exports('getStats', () => db.stats());
  exports('topQueries', (limit?: number) => db.profiler.top(typeof limit === 'number' ? limit : 10));
  exports('serverInfo', () => db.server);
  exports('health', () => db.health());
  exports('isReady', () => db.isConnected);
  exports('ready', (cb?: any) => bridge(db.whenReady().then(() => true), cb));
}
