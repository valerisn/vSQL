import { db } from './database';
import { logger } from './logger';

type Callback = (result: any, error?: any) => void;

// Bridges a promise to either Promise-style (JS `await`) or callback-style
// usage. When a node-style callback is supplied we never return the promise, so
// errors don't surface as unhandled rejections.
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
  // (sql, params, cb) where params or cb may be omitted.
  const standard = (method: 'query' | 'execute' | 'single' | 'scalar' | 'insert' | 'update' | 'prepare') => {
    return (sql: string, params?: any, cb?: any) => {
      if (typeof params === 'function') {
        cb = params;
        params = undefined;
      }
      return bridge(db.whenReady().then(() => (db as any)[method](sql, params)), cb);
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

  // Cache control + observability.
  exports('cacheClear', (pattern?: string) => db.cache.clear(pattern));
  exports('clearCache', (pattern?: string) => db.cache.clear(pattern));
  exports('getStats', () => db.profiler.stats());
  exports('serverInfo', () => db.server);
  exports('isReady', () => db.isConnected);
  exports('ready', (cb?: any) => bridge(db.whenReady().then(() => true), cb));
}
