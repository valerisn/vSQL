import { db } from './database';
import { logger } from './logger';
import { migrator } from './migrations';

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
  if (s.slow.length) {
    logger.raw(`  ${C.yellow}slowest recent queries:${C.reset}`);
    for (const q of s.slow) logger.raw(`    ${q.ms.toFixed(1)}ms  ${q.sql}`);
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
            case 'reset':
              db.profiler.reset();
              logger.info('profiler stats reset');
              break;
            default:
              logger.warn(`unknown subcommand "${cmd}". try: vsql | vsql migrate[:status|:rollback|:dry] | vsql cache clear`);
          }
        } catch (err: any) {
          logger.error(err.message);
        }
      })();
    },
    true
  );
}
