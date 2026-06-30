import { config } from './config';
import { db } from './database';
import { logger } from './logger';
import { migrator } from './migrations';
import { currentVersion } from './version';

const C = logger.color;

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function showProfiler(): void {
  const s = db.stats();
  logger.raw(
    `${C.cyan}[vSQL]${C.reset} profiler  (server: ${db.server.type} ${db.server.version}, up ${formatUptime(s.uptimeMs)})`
  );
  logger.raw(`  queries: ${s.count}   errors: ${s.errors}   cache hits: ${s.cacheHits}   cache size: ${s.cacheSize}`);
  logger.raw(
    `  latency: avg ${s.avgMs.toFixed(1)}ms   p50 ${s.p50.toFixed(1)}ms   ` +
      `p95 ${s.p95.toFixed(1)}ms   p99 ${s.p99.toFixed(1)}ms`
  );
  if (s.byResource.length) {
    logger.raw(`  ${C.yellow}busiest resources:${C.reset}`);
    for (const r of s.byResource.slice(0, 5)) {
      const errs = r.errors ? `, ${C.red}${r.errors} err${C.reset}` : '';
      logger.raw(`    ${r.resource}  ${C.grey}x${r.count}, ${r.totalMs.toFixed(0)}ms total, avg ${r.avgMs.toFixed(1)}ms${errs}${C.reset}`);
    }
  }
  if (s.slow.length) {
    logger.raw(`  ${C.yellow}slowest recent queries:${C.reset}`);
    for (const q of s.slow) logger.raw(`    ${q.ms.toFixed(1)}ms  ${q.sql}`);
  }
}

// Per-resource breakdown: which resource is actually driving the database.
function showResources(): void {
  const rows = db.stats().byResource;
  logger.raw(`${C.cyan}[vSQL]${C.reset} ${rows.length} resource(s) by total query time`);
  if (rows.length === 0) {
    logger.raw('  (no attributed queries yet)');
    return;
  }
  for (const r of rows) {
    const errs = r.errors ? `, ${C.red}${r.errors} err${C.reset}` : '';
    logger.raw(
      `  ${C.cyan}${r.totalMs.toFixed(0)}ms${C.reset} total  ` +
        `${C.grey}x${r.count}, avg ${r.avgMs.toFixed(1)}ms${errs}${C.reset}  ${r.resource}`
    );
  }
}

// Full diagnostic dump for bug reports / support. Password is never included
// (config.summary() is already redacted).
function showDebug(): void {
  const h = db.health();
  const s = db.stats();
  const state = h.connected ? `${C.green}connected` : h.reconnecting ? `${C.yellow}reconnecting` : `${C.red}down`;
  logger.raw(`${C.cyan}[vSQL]${C.reset} debug  (v${currentVersion() || '?'})`);
  logger.raw(`  state       ${state}${C.reset}`);
  logger.raw(`  server      ${db.server.type} ${db.server.version || '?'} (RETURNING ${db.server.supportsReturning ? 'yes' : 'no'})`);
  for (const lineText of config.summary()) logger.raw(`  ${lineText}`);
  logger.raw(`  live cache  ${s.cacheSize} entr${s.cacheSize === 1 ? 'y' : 'ies'}`);
  logger.raw(`  queries     ${s.count} (errors ${s.errors}, cache hits ${s.cacheHits}), up ${formatUptime(s.uptimeMs)}`);
  logger.raw(`  ${C.grey}set vsql_debug 2 to log every query with timing.`);
}

// Heaviest query shapes by total time consumed - the pg_stat_statements view.
function showTop(limit: number): void {
  const rows = db.profiler.top(limit);
  logger.raw(`${C.cyan}[vSQL]${C.reset} top ${rows.length} query shape(s) by total time`);
  if (rows.length === 0) {
    logger.raw('  (no queries recorded yet)');
    return;
  }
  for (const r of rows) {
    logger.raw(
      `  ${C.cyan}${r.totalMs.toFixed(0)}ms${C.reset} total  ` +
        `${C.grey}x${r.count}, avg ${r.avgMs.toFixed(1)}ms, max ${r.maxMs.toFixed(1)}ms${C.reset}`
    );
    logger.raw(`    ${r.shape}`);
  }
}

export function registerCommands(): void {
  // Single `vsql` command with subcommands, accepting both `vsql migrate:status`
  // and `vsql migrate status` forms.
  RegisterCommand(
    'vsql',
    (_src: number, args: string[]) => {
      const parts = (args[0] ?? '').split(':');
      const cmd = (parts[0] ?? '').toLowerCase();
      const action = (parts[1] ?? args[1] ?? '').toLowerCase();

      void (async () => {
        try {
          switch (cmd) {
            case '':
            case 'stats':
              showProfiler();
              break;
            case 'migrate':
              if (action === 'status') await migrator.status();
              else if (action === 'rollback') await migrator.rollback();
              else if (action === 'dry' || action === 'dry-run') await migrator.run({ dryRun: true });
              else await migrator.run();
              break;
            case 'cache':
              if (action === 'clear') {
                const n = db.cache.clear();
                logger.info(`cleared ${n} cached result(s)`);
              } else {
                logger.info(`cache ${db.cache.enabled ? 'enabled' : 'disabled'}, ${db.cache.size} entries`);
              }
              break;
            case 'top': {
              const n = parseInt(action || args[1] || '10', 10);
              showTop(Number.isNaN(n) ? 10 : n);
              break;
            }
            case 'resources':
            case 'res':
              showResources();
              break;
            case 'debug':
              showDebug();
              break;
            case 'reset':
              db.profiler.reset();
              logger.info('profiler stats reset');
              break;
            default:
              logger.warn(`unknown subcommand "${cmd}". try: vsql | vsql top | vsql resources | vsql debug | vsql migrate[:status|:rollback|:dry] | vsql cache clear`);
          }
        } catch (err: any) {
          logger.error(err.message);
        }
      })();
    },
    true
  );
}
