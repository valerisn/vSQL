import { config } from './config';
import { logger } from './logger';
import { db } from './database';
import { registerExports } from './exports';
import { registerCommands } from './commands';
import { registerCompat } from './compat';
import { migrator } from './migrations';
import { checkVersion, currentVersion } from './version';
import { printBanner } from './banner';

const resourceName = GetCurrentResourceName();

// Register everything at load so other resources can call our exports right away;
// anything issued before the pool is up queues on whenReady().
config.load();
registerExports();
registerCommands();
registerCompat();

printBanner(currentVersion() || '?', config.versionRepo);
logger.debug(`debug logging level ${config.debug}`);
// Dump the effective (redacted) settings, so a debug log is enough to diagnose from.
for (const lineText of config.summary()) logger.debug(lineText);

// Surface likely misconfigurations once, before the pool tries to connect.
for (const issue of config.issues()) logger.warn(issue);

// Best-effort, fire-and-forget: never let an update check delay the pool coming up.
void checkVersion();

db.start()
  .then(async () => {
    if (config.autoMigrate) {
      try {
        await migrator.run();
      } catch (err: any) {
        logger.error(`migrations failed: ${err.message}`);
      }
    }
  })
  .catch((err: any) => logger.error(`startup failed: ${err.message}`));

on('onResourceStop', (res: string) => {
  if (res !== resourceName) return;
  void db.shutdown();
});
