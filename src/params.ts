export type Params = any[] | Record<string, any> | undefined | null;

export interface BoundQuery {
  sql: string;
  values: any[];
}

// We parse placeholders ourselves rather than leaning on mysql2's named-param
// support so that `?`, `@name` and `:name` can all be used (oxmysql accepts a
// mix), and so we can expand arrays into IN (...) lists. Everything still ends
// up as positional `?` with values bound by the driver - never string
// interpolation - so this stays injection-safe.
//
// Hot-path shape: a SQL string's *structure* (how many `?` it has, whether it
// uses named placeholders) never changes between calls, so we analyse it once
// and memoise a Plan. A reused query - the norm in FiveM, where call sites pass
// the same literal every frame - then skips the parse entirely. For a plain
// positional query with no array values the SQL is handed to the driver
// untouched (only the values are shaped); anything needing a rewrite (IN-list
// expansion, named -> ?) falls back to the full single-pass parser below. The
// Plan records structure only, never values, so binding stays positional and
// injection-safe.
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

// Shape a positional param array to the placeholder count: zero-copy when the
// arity matches and nothing is undefined, otherwise pad missing trailing params
// with NULL and coerce any undefined (mysql2 rejects undefined) - identical
// output to the full parser for a plain positional query.
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

    // `--` only opens a comment when followed by whitespace or end-of-input;
    // `5--1` is `5 - -1`, not a comment. `#` always runs to end-of-line. Getting
    // this right matters so a `?` after a no-space `--` is still bound.
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
      // Reading past the end yields `undefined`, which expand() binds as NULL -
      // so a statement with more placeholders than values pads the extras with
      // NULL (matching oxmysql) instead of erroring on the count mismatch.
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
  // Arrays become (?, ?, ...) so `WHERE id IN ?` works. Buffers are scalar
  // values, not lists, so they fall through to a single binding. `undefined` is
  // never a valid bind value (mysql2 rejects it), so it is coerced to NULL at
  // every binding point - this is what turns a missing trailing param into NULL.
  if (Array.isArray(value)) {
    if (value.length === 0) return '(NULL)';
    return `(${value.map((v) => (values.push(v === undefined ? null : v), '?')).join(', ')})`;
  }
  values.push(value === undefined ? null : value);
  return '?';
}

// --- binding-plan memoisation ---------------------------------------------

// What a SQL string needs at bind time, derived once from its structure.
//   none       - no placeholders at all; values are always empty.
//   positional - only `?` placeholders (count known); the SQL is reused as-is.
//   named      - only named placeholders; we pre-compile the rewritten SQL
//                (named -> ?) and the ordered names once, then just read values.
//   other      - mixes `?` and named (or is otherwise rewrite-only); handed to
//                the full parser, which owns the exact array-vs-named errors.
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

// Classify a SQL string by a single quote/comment-aware scan, mirroring the full
// parser's literal-skipping exactly but building no output. Counts `?` and flags
// named placeholders. A query that uses *only* named placeholders is compiled to
// a reusable template; one that mixes `?` and named is 'other' (the full parser
// owns the array-vs-named error semantics).
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

// Build the reusable template for a purely-named query: each `@name`/`:name`
// becomes a positional `?` (still driver-bound, never interpolated) and the
// names are recorded in order. Done once per SQL, then cached.
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
