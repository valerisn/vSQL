// Startup UI for the FXServer console - raw lines (no [vSQL] tag) so the banner
// and status box frame cleanly. FiveM colours are `^` + a digit; we strip them
// when measuring width so the box borders line up whatever colours are inside.

const C = {
  reset: '^7',
  red: '^1',
  green: '^2',
  yellow: '^3',
  cyan: '^5',
  magenta: '^6',
  grey: '^8'
};

const line = (s = ''): void => console.log(s + C.reset);

const visibleLen = (s: string): number => s.replace(/\^[0-9]/g, '').length;

const pad = (s: string, width: number): string => {
  const diff = width - visibleLen(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
};

const LOGO = [
  '__   __  ____    ___    _     ',
  '\\ \\ / / / ___|  / _ \\  | |    ',
  ' \\ V /  \\___ \\ | | | | | |    ',
  '  \\_/    ___) || |_| | | |___ ',
  '         |____/  \\__\\_\\ |_____|'
];

export function printBanner(version: string, repo: string): void {
  line();
  for (const l of LOGO) line(`${C.cyan}${l}`);
  line();
  line(`  ${C.reset}High-performance MySQL/MariaDB resource for FiveM`);
  line(`  ${C.grey}v${version}  ${C.cyan}•${C.grey}  github.com/${repo}`);
  line();
}

export interface ReadySummary {
  server: string;
  target: string;
  pool: number;
  cacheEnabled: boolean;
  supportsReturning: boolean;
  reconnected?: boolean;
}

function box(rows: string[]): void {
  const width = Math.max(46, ...rows.map(visibleLen));
  const bar = '─'.repeat(width + 2);
  line(`${C.cyan}╭${bar}╮`);
  for (const r of rows) {
    if (r === '') {
      line(`${C.cyan}│ ${pad('', width)} ${C.cyan}│`);
    } else {
      line(`${C.cyan}│ ${C.reset}${pad(r, width)} ${C.cyan}│`);
    }
  }
  line(`${C.cyan}╰${bar}╯`);
}

const onOff = (v: boolean, on = 'enabled', off = 'disabled'): string =>
  v ? `${C.green}${on}` : `${C.grey}${off}`;

export function printReady(s: ReadySummary): void {
  const title = s.reconnected ? 'Reconnected' : 'Connected';
  box([
    `${C.green}●${C.reset}  ${title} to ${C.green}${s.server}`,
    `${C.grey}   ${s.target}`,
    '',
    `${C.reset}Pool        ${C.cyan}${s.pool}${C.grey} connections`,
    `${C.reset}Cache       ${onOff(s.cacheEnabled)}`,
    `${C.reset}RETURNING   ${onOff(s.supportsReturning, 'enabled', 'unsupported')}`
  ]);
  line();
}
