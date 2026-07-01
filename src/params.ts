export type Params = any[] | Record<string, any> | undefined | null;

export interface BoundQuery {
  sql: string;
  values: any[];
}

// We parse placeholders ourselves (rather than lean on mysql2) so `?`, `@name`,
// and `:name` all work and arrays expand into IN (...) lists. Everything still
// lands as positional `?` bound by the driver, never interpolated.
//
// The trick: a SQL string's *structure* never changes between calls, so we
// analyse it once and cache a Plan. A reused query - the FiveM norm, same literal
// every frame - then skips the parse: a plain positional query goes to the driver
// untouched, and only a rewrite (IN-list, named -> ?) hits the full parser below.
// The Plan records structure only, never values.
export function bindParams(sql: string, params: Params): BoundQuery {
  if (params === undefined || params === null) {
    return { sql, values: [] };
  }

  const plan = getPlan(sql);
  if (plan.kind === 'none') return { sql, values: [] };

  if (Array.isArray(params)) {
    // Plain-positional plan with no array values: SQL unchanged, shape values.
    // An array value needs IN-list expansion, which the full parser handles.
    if (plan.kind === 'positional' && !hasArrayValue(params)) {
      return positionalValues(sql, params, plan.count);
    }
  } else if (plan.kind === 'named' && !refsHaveArray(plan.refs, params as Record<string, any>)) {
    // Pre-compiled named template (named -> ?) with no array values: read the
    // values in placeholder order. An array value needs IN-list expansion -> full.
    return namedValues(plan, params as Record<string, any>);
  }

  return fullBind(sql, params);
}

// Read named values in placeholder order against a pre-compiled template. Mirrors
// the full parser's missing-name error and undefined -> NULL coercion.
function namedValues(plan: NamedPlan, obj: Record<string, any>): BoundQuery {
  const refs = plan.refs;
  const values = new Array(refs.length);
  for (let k = 0; k < refs.length; k++) {
    const ref = refs[k];
    if (!(ref.name in obj)) {
      throw new Error(`vSQL: missing value for named parameter "${ref.raw}"`);
    }
    const v = obj[ref.name];
    values[k] = v === undefined ? null : v;
  }
  return { sql: plan.sql, values };
}

function refsHaveArray(refs: NamedRef[], obj: Record<string, any>): boolean {
  for (let k = 0; k < refs.length; k++) if (Array.isArray(obj[refs[k].name])) return true;
  return false;
}

// Fit a positional array to the placeholder count: zero-copy when the arity
// matches and nothing's undefined, else pad missing trailing params with NULL and
// coerce undefined (mysql2 rejects it).
function positionalValues(sql: string, params: any[], count: number): BoundQuery {
  if (params.length === count) {
    let i = 0;
    while (i < count && params[i] !== undefined) i++;
    if (i === count) return { sql, values: params };
  }
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    const v = params[i];
    values[i] = v === undefined ? null : v;
  }
  return { sql, values };
}

function hasArrayValue(params: any[]): boolean {
  for (let i = 0; i < params.length; i++) if (Array.isArray(params[i])) return true;
  return false;
}

function fullBind(sql: string, params: Params): BoundQuery {
  const isArray = Array.isArray(params);
  const values: any[] = [];
  let positional = 0;
  let out = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // Skip over string/identifier literals untouched so a `?` or `:foo` inside
    // a quoted value is never mistaken for a placeholder.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = sql[i];
        out += c;
        if (c === '\\' && quote !== '`') {
          out += sql[i + 1] ?? '';
          i += 2;
          continue;
        }
        i++;
        if (c === quote) {
          if (sql[i] === quote) {
            out += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    // `--` opens a comment only before whitespace or end-of-input; `5--1` is
    // `5 - -1`, not a comment. Get this wrong and a `?` after `--` goes unbound.
    const dashComment =
      ch === '-' && sql[i + 1] === '-' && (i + 2 >= len || /\s/.test(sql[i + 2]));
    if (dashComment || ch === '#') {
      while (i < len && sql[i] !== '\n') {
        out += sql[i];
        i++;
      }
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      out += '/*';
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i];
        i++;
      }
      if (i < len) {
        out += '*/';
        i += 2;
      }
      continue;
    }

    if (ch === '?') {
      if (!isArray) {
        throw new Error('vSQL: positional "?" used but parameters were passed as a named object');
      }
      // Past the end is `undefined`, which expand() binds as NULL - so extra
      // placeholders pad with NULL (like oxmysql) instead of erroring.
      out += expand((params as any[])[positional++], values);
      i++;
      continue;
    }

    if (ch === '@' || ch === ':') {
      // Leave `@@global.x` system variables and `::` casts alone.
      if (ch === '@' && sql[i + 1] === '@') {
        out += '@@';
        i += 2;
        continue;
      }
      let j = i + 1;
      let name = '';
      while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
        name += sql[j];
        j++;
      }
      if (name.length === 0) {
        out += ch;
        i++;
        continue;
      }
      if (isArray) {
        throw new Error(`vSQL: named parameter "${ch}${name}" used but parameters were passed as an array`);
      }
      const obj = params as Record<string, any>;
      if (!(name in obj)) {
        throw new Error(`vSQL: missing value for named parameter "${ch}${name}"`);
      }
      out += expand(obj[name], values);
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return { sql: out, values };
}

function expand(value: any, values: any[]): string {
  // Arrays become (?, ?, ...) so `WHERE id IN ?` works; a Buffer is a scalar, not
  // a list, so it binds once. undefined -> NULL everywhere (mysql2 rejects it),
  // which is also how a missing trailing param becomes NULL.
  if (Array.isArray(value)) {
    if (value.length === 0) return '(NULL)';
    return `(${value.map((v) => (values.push(v === undefined ? null : v), '?')).join(', ')})`;
  }
  values.push(value === undefined ? null : value);
  return '?';
}

// --- binding-plan memoisation ---------------------------------------------

// What a SQL string needs at bind time, derived once from its structure.
//   none       - no placeholders; values always empty.
//   positional - only `?` (count known); SQL reused as-is.
//   named       - only named; pre-compiled to `?` with the names in order.
//   other       - a mix of `?` and named; handed to the full parser.
interface NamedRef {
  name: string; // bare name, for the params-object lookup
  raw: string; // original token incl. `@`/`:`, for error messages
}
interface NamedPlan {
  kind: 'named';
  sql: string; // SQL with each named placeholder rewritten to `?`
  refs: NamedRef[];
}
type Plan = { kind: 'none' } | { kind: 'positional'; count: number } | NamedPlan | { kind: 'other' };

const NAME_CHAR = /[A-Za-z0-9_]/;
const planCache = new Map<string, Plan>();
const MAX_PLANS = 1000;

function getPlan(sql: string): Plan {
  const cached = planCache.get(sql);
  if (cached !== undefined) return cached;
  const plan = analyze(sql);
  // Bounded LRU-ish: Map keeps insertion order, so dropping the first key evicts
  // the oldest. Query shapes are few, so this almost never fires.
  if (planCache.size >= MAX_PLANS) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  planCache.set(sql, plan);
  return plan;
}

// One quote/comment-aware scan that counts `?` and flags named placeholders,
// skipping literals exactly like the full parser but producing no output. Purely
// named -> a reusable template; a mix of `?` and named -> 'other' (full parser).
function analyze(sql: string): Plan {
  let count = 0;
  let named = false;
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < len) {
        const c = sql[i];
        if (c === '\\' && quote !== '`') {
          i += 2;
          continue;
        }
        i++;
        if (c === quote) {
          if (sql[i] === quote) {
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    const dashComment = ch === '-' && sql[i + 1] === '-' && (i + 2 >= len || /\s/.test(sql[i + 2]));
    if (dashComment || ch === '#') {
      while (i < len && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i < len) i += 2;
      continue;
    }

    if (ch === '?') {
      count++;
      i++;
      continue;
    }

    if (ch === '@' || ch === ':') {
      if (ch === '@' && sql[i + 1] === '@') {
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < len && NAME_CHAR.test(sql[j])) j++;
      if (j > i + 1) {
        named = true;
        i = j;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }

  if (named) {
    // A mix of `?` and named is left to the full parser (it throws the right way
    // depending on whether params arrive as an array or an object).
    return count > 0 ? { kind: 'other' } : compileNamed(sql);
  }
  return count === 0 ? { kind: 'none' } : { kind: 'positional', count };
}

// Compile a purely-named query into a reusable template: each `@name`/`:name`
// becomes a `?` and the names are recorded in order. Once per SQL, then cached.
function compileNamed(sql: string): Plan {
  const refs: NamedRef[] = [];
  let out = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = sql[i];
        out += c;
        if (c === '\\' && quote !== '`') {
          out += sql[i + 1] ?? '';
          i += 2;
          continue;
        }
        i++;
        if (c === quote) {
          if (sql[i] === quote) {
            out += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    const dashComment = ch === '-' && sql[i + 1] === '-' && (i + 2 >= len || /\s/.test(sql[i + 2]));
    if (dashComment || ch === '#') {
      while (i < len && sql[i] !== '\n') {
        out += sql[i];
        i++;
      }
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      out += '/*';
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i];
        i++;
      }
      if (i < len) {
        out += '*/';
        i += 2;
      }
      continue;
    }

    // analyze() guarantees no `?` here, but guard anyway: a stray `?` means the
    // query actually mixes styles, so defer to the full parser.
    if (ch === '?') return { kind: 'other' };

    if (ch === '@' || ch === ':') {
      if (ch === '@' && sql[i + 1] === '@') {
        out += '@@';
        i += 2;
        continue;
      }
      let j = i + 1;
      let name = '';
      while (j < len && NAME_CHAR.test(sql[j])) {
        name += sql[j];
        j++;
      }
      if (name.length === 0) {
        out += ch;
        i++;
        continue;
      }
      refs.push({ name, raw: ch + name });
      out += '?';
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return { kind: 'named', sql: out, refs };
}

// Exposed for tests/benchmarks that want to measure a cold parse.
export function clearPlanCache(): void {
  planCache.clear();
}
