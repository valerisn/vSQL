import type { Connection } from 'mysql2/promise';
import type { ServerHint } from './config';

export interface ServerInfo {
  type: 'mysql' | 'mariadb' | 'unknown';
  version: string;
  major: number;
  minor: number;
  /** MariaDB can RETURNING from INSERT/UPDATE/DELETE (10.5+), saving a round-trip. */
  supportsReturning: boolean;
}

export async function detectServer(conn: Connection, hint: ServerHint): Promise<ServerInfo> {
  const [rows] = await conn.query('SELECT VERSION() AS version');
  const raw = String((rows as any[])[0]?.version ?? '');

  let type: ServerInfo['type'] = /mariadb/i.test(raw) ? 'mariadb' : 'mysql';
  if (hint === 'mysql' || hint === 'mariadb') type = hint;

  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  const major = m ? parseInt(m[1], 10) : 0;
  const minor = m ? parseInt(m[2], 10) : 0;

  const supportsReturning = type === 'mariadb' && (major > 10 || (major === 10 && minor >= 5));

  return { type, version: raw, major, minor, supportsReturning };
}
