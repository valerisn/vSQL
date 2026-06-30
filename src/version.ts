import { config } from './config';
import { logger } from './logger';

// On startup we compare the version declared in fxmanifest.lua against the
// latest GitHub release, so server owners notice when an update is available
// without having to check the repo by hand. The check is best-effort: any
// network/parse problem is logged at debug level and never blocks boot.

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parse(raw: string): SemVer | null {
  const m = String(raw).trim().replace(/^v/i, '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

// Negative if a < b, 0 if equal, positive if a > b.
function compare(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function currentVersion(): string {
  try {
    return GetResourceMetadata(GetCurrentResourceName(), 'version', 0) || '';
  } catch {
    return '';
  }
}

interface LatestRelease {
  version: string;
  url: string;
}

function fetchLatest(repo: string): Promise<LatestRelease | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  return new Promise((resolve) => {
    try {
      PerformHttpRequest(
        url,
        (status, body) => {
          if (status !== 200 || !body) return resolve(null);
          try {
            const json = JSON.parse(body);
            const tag = json.tag_name ?? json.name;
            if (!tag) return resolve(null);
            resolve({
              version: String(tag),
              url: json.html_url ?? `https://github.com/${repo}/releases/latest`
            });
          } catch {
            resolve(null);
          }
        },
        'GET',
        '',
        { 'User-Agent': 'vSQL-version-check', Accept: 'application/vnd.github+json' }
      );
    } catch {
      // PerformHttpRequest can be unavailable in some contexts; degrade quietly.
      resolve(null);
    }
  });
}

export async function checkVersion(): Promise<void> {
  if (!config.versionCheck) return;

  const currentRaw = currentVersion();
  const current = parse(currentRaw);
  const latest = await fetchLatest(config.versionRepo);

  if (!latest) {
    logger.debug('version check skipped (could not reach GitHub)');
    return;
  }

  const latestParsed = parse(latest.version);
  if (!current || !latestParsed) {
    logger.debug(`version check inconclusive (current=${currentRaw || '?'}, latest=${latest.version})`);
    return;
  }

  const diff = compare(current, latestParsed);
  if (diff < 0) {
    logger.warn(`a new version is available: ${currentRaw} -> ${latest.version}`);
    logger.warn(`  update at ${latest.url}`);
  } else if (diff > 0) {
    logger.info(`running ${currentRaw} (ahead of the latest release ${latest.version})`);
  } else {
    logger.info(`running the latest version (${currentRaw})`);
  }
}
