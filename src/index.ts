import { config } from './config';
import { logger } from './logger';
import { db } from './database';
import { registerExports } from './exports';
import { registerCommands } from './commands';
import { migrator } from './migrations';
import { checkVersion, currentVersion } from './version';
import { printBanner } from './banner';

const resourceName = GetCurrentResourceName();

// Register everything synchronously at load so other resources can call our
// exports immediately — calls made before the pool is up queue via whenReady().
config.load();
registerExports();
registerCommands();

printBanner(currentVersion() || '?', config.versionRepo);
logger.debug(`debug logging level ${config.debug}`);

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
