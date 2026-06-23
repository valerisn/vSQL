import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mysql, { Connection } from 'mysql2/promise';
import { config } from './config';
import { logger } from './logger';

interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  path: string;
  checksum: string;
  isJs: boolean;
  downPath?: string;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

interface RunOptions {
  dryRun?: boolean;
}

class Migrator {
  private dir(): string {
    const base = GetResourcePath(GetCurrentResourceName());
    return path.isAbsolute(config.migrationsDir)
      ? config.migrationsDir
      : path.join(base, config.migrationsDir);
  }

  // Migrations get a dedicated connection with multipleStatements enabled so a
  // single .sql file can hold several statements — the pool deliberately keeps
  // that off for normal queries.
  private connect(): Promise<Connection> {
    return mysql.createConnection({ ...config.base, multipleStatements: true });
  }

  private discover(): MigrationFile[] {
    const dir = this.dir();
    if (!fs.existsSync(dir)) return [];

    const all = fs.readdirSync(dir).filter((f) => /\.(sql|js)$/i.test(f) && !/\.down\.sql$/i.test(f));
    const downs = new Set(fs.readdirSync(dir).filter((f) => /\.down\.sql$/i.test(f)));

    return all
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((filename) => {
        const full = path.join(dir, filename);
        const content = fs.readFileSync(full);
        const base = filename.replace(/\.(sql|js)$/i, '');
        const underscore = base.indexOf('_');
        const version = underscore === -1 ? base : base.slice(0, underscore);
        const name = underscore === -1 ? base : base.slice(underscore + 1);
        const downName = `${base}.down.sql`;
        return {
          version,
          name,
          filename,
          path: full,
          checksum: crypto.createHash('sha256').update(content).digest('hex'),
          isJs: /\.js$/i.test(filename),
          downPath: downs.has(downName) ? path.join(dir, downName) : undefined
        };
      });
  }

  private async ensureTable(conn: Connection): Promise<void> {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS vsql_migrations (
        version    VARCHAR(191) NOT NULL PRIMARY KEY,
        name       VARCHAR(191) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  private async applied(conn: Connection): Promise<Map<string, AppliedRow>> {
    const [rows] = await conn.query('SELECT version, name, checksum, applied_at FROM vsql_migrations');
    const map = new Map<string, AppliedRow>();
    for (const row of rows as AppliedRow[]) map.set(row.version, row);
    return map;
  }

  // Advisory lock so two servers booting against the same DB don't both try to
  // apply the same migration. GET_LOCK is available on both MySQL and MariaDB.
  private async withLock<T>(conn: Connection, fn: () => Promise<T>): Promise<T> {
    const [rows] = await conn.query("SELECT GET_LOCK('vsql_migrations', 30) AS ok");
    if ((rows as any[])[0]?.ok !== 1) {
      throw new Error('could not acquire migration lock (another instance may be migrating)');
    }
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK('vsql_migrations')");
    }
  }

  async run(opts: RunOptions = {}): Promise<void> {
    const files = this.discover();
    if (files.length === 0) {
      logger.debug(`no migrations found in ${this.dir()}`);
      return;
    }

    const conn = await this.connect();
    try {
      await this.ensureTable(conn);
      await this.withLock(conn, async () => {
        const applied = await this.applied(conn);
        let ran = 0;

        for (const file of files) {
          const prev = applied.get(file.version);
          if (prev) {
            if (prev.checksum !== file.checksum) {
              throw new Error(
                `migration ${file.filename} was modified after being applied ` +
                  `(checksum mismatch). Revert the file or create a new migration instead.`
              );
            }
            continue;
          }

          if (opts.dryRun) {
            logger.info(`[dry-run] would apply ${file.filename}`);
            ran++;
            continue;
          }

          await this.apply(conn, file);
          logger.info(`applied ${file.filename}`);
          ran++;
        }

        if (ran === 0) logger.info('database is up to date, no migrations to apply');
        else if (opts.dryRun) logger.info(`[dry-run] ${ran} migration(s) pending`);
        else logger.info(`applied ${ran} migration(s)`);
      });
    } finally {
      await conn.end();
    }
  }

  private async apply(conn: Connection, file: MigrationFile): Promise<void> {
    if (file.isJs) {
      const mod = require(file.path);
      const up = mod.up ?? mod.default?.up;
      if (typeof up !== 'function') {
        throw new Error(`JS migration ${file.filename} does not export an "up" function`);
      }
      await up(conn);
    } else {
      const sql = fs.readFileSync(file.path, 'utf8');
      await conn.query(sql);
    }
    await conn.query('INSERT INTO vsql_migrations (version, name, checksum) VALUES (?, ?, ?)', [
      file.version,
      file.name,
      file.checksum
    ]);
  }

  async status(): Promise<void> {
    const files = this.discover();
    const conn = await this.connect();
    try {
      await this.ensureTable(conn);
      const applied = await this.applied(conn);
      logger.raw(`${logger.color.cyan}[vSQL]${logger.color.reset} migration status:`);
      for (const file of files) {
        const row = applied.get(file.version);
        if (!row) {
          logger.raw(`  ${logger.color.yellow}pending${logger.color.reset}  ${file.filename}`);
        } else if (row.checksum !== file.checksum) {
          logger.raw(`  ${logger.color.red}MODIFIED${logger.color.reset} ${file.filename} (checksum mismatch)`);
        } else {
          const when = new Date(row.applied_at).toISOString().replace('T', ' ').slice(0, 19);
          logger.raw(`  ${logger.color.green}applied${logger.color.reset}  ${file.filename}  (${when})`);
        }
      }
      // Surface orphaned rows whose file is gone — usually a deleted migration.
      for (const version of applied.keys()) {
        if (!files.some((f) => f.version === version)) {
          logger.raw(`  ${logger.color.grey}orphan${logger.color.reset}   version ${version} (no file)`);
        }
      }
    } finally {
      await conn.end();
    }
  }

  async rollback(): Promise<void> {
    const files = this.discover();
    const conn = await this.connect();
    try {
      await this.ensureTable(conn);
      await this.withLock(conn, async () => {
        const [rows] = await conn.query(
          'SELECT version FROM vsql_migrations ORDER BY applied_at DESC, version DESC LIMIT 1'
        );
        const latest = (rows as any[])[0]?.version;
        if (!latest) {
          logger.info('nothing to roll back');
          return;
        }
        const file = files.find((f) => f.version === latest);
        if (!file?.downPath) {
          logger.error(`no down migration found for version ${latest}; cannot roll back`);
          return;
        }
        const sql = fs.readFileSync(file.downPath, 'utf8');
        await conn.query(sql);
        await conn.query('DELETE FROM vsql_migrations WHERE version = ?', [latest]);
        logger.info(`rolled back ${file.filename}`);
      });
    } finally {
      await conn.end();
    }
  }
}

export const migrator = new Migrator();
