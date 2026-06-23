import { config } from './config';

// FiveM console color codes (^1 red, ^2 green, ^3 yellow, ^5 cyan, ^8 grey...).
const C = {
  reset: '^7',
  red: '^1',
  green: '^2',
  yellow: '^3',
  cyan: '^5',
  magenta: '^6',
  grey: '^8'
};

const TAG = `${C.cyan}[vSQL]${C.reset}`;

function out(line: string): void {
  console.log(`${TAG} ${line}${C.reset}`);
}

export const logger = {
  info(msg: string): void {
    out(`${C.green}${msg}`);
  },
  warn(msg: string): void {
    out(`${C.yellow}WARN  ${msg}`);
  },
  error(msg: string): void {
    out(`${C.red}ERROR ${msg}`);
  },
  // vsql_debug >= 1: lifecycle/diagnostic detail.
  debug(msg: string): void {
    if (config.debug >= 1) out(`${C.grey}${msg}`);
  },
  // vsql_debug >= 2: every executed query with timing and bound values.
  query(sql: string, values: any[], ms: number): void {
    if (config.debug < 2) return;
    const args = values.length ? ` ${JSON.stringify(values)}` : '';
    out(`${C.grey}${ms.toFixed(1)}ms  ${sql}${args}`);
  },
  raw: out,
  color: C
};
