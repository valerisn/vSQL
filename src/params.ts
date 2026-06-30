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
export function bindParams(sql: string, params: Params): BoundQuery {
  if (params === undefined || params === null) {
    return { sql, values: [] };
  }

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
  // values, not lists, so they fall through to a single binding.
  if (Array.isArray(value)) {
    if (value.length === 0) return '(NULL)';
    return `(${value.map((v) => (values.push(v), '?')).join(', ')})`;
  }
  values.push(value);
  return '?';
}
