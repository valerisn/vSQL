import { config } from './config';
import { logger } from './logger';
import { db } from './database';
import { registerExports } from './exports';
import { registerCommands } from './commands';
import { migrator } from './migrations';
import { checkVersion } from './version';

const resourceName = GetCurrentResourceName();

// Register everything synchronously at load so other resources can call our
// exports immediately — calls made before the pool is up queue via whenReady().
config.load();
registerExports();
registerCommands();

logger.raw(`${logger.color.cyan}[vSQL]${logger.color.reset} starting (debug=${config.debug})`);

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
