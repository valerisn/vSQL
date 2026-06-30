# Tests & benchmarks

Run everything with **Node 24+** (the suite and benchmarks rely on Node's native
TypeScript type-stripping, so the `.ts` sources are imported directly).

## Test suite

```bash
npm test            # node --test "tests/**/*.test.ts"
npm run typecheck   # tsc --noEmit
```

**88 tests** across 11 files, **87 passing + 1 skipped** (the skipped one is the
integration suite, which only runs when a database DSN is set - see below).

| File | Covers |
|---|---|
| `params.test.ts` | placeholder parsing: `?` / `@name` / `:name`, IN-list expansion, quote/comment skipping, NULL padding |
| `shape.test.ts` | result shapes: `single` -> row\|null, `scalar` -> first column, `insert` -> insertId, `update` -> affectedRows, `normalizeEntry` |
| `retry.test.ts` | transaction deadlock/lock-wait replay: commit, rollback-per-attempt, non-retryable throws, single release |
| `gate.test.ts` | `whenReady` queueing - callers queued while closed are released in order on open |
| `cache.test.ts` | TTL + LRU result cache, pattern clear |
| `util.test.ts` | read/write classification, locking-read + cacheability, retryable/fatal errors, backoff, statement-timeout wrapping |
| `profiler.test.ts` | latency percentiles, query-shape aggregation, per-resource breakdown |
| `typecast.test.ts` | oxmysql-compatible casting: dates -> epoch ms, `TINYINT(1)`/`BIT(1)` -> bool |
| `invoker.test.ts` | best-effort `GetInvokingResource()` capture |
| `compat-surface.test.ts` | the exact oxmysql / ghmattimysql / mysql-async export surface |
| `integration/db.test.ts` | the above against a **real** MySQL/MariaDB (skips without a DSN) |

### Integration tests (opt-in)

```bash
# any one (or more) of these enables the integration suite
VSQL_TEST_MYSQL_DSN="mysql://root:pass@127.0.0.1:3306/vsql_test" npm test
VSQL_TEST_MARIADB_DSN="mysql://root:pass@127.0.0.1:3307/vsql_test" npm test
```

See [`integration/README.md`](integration/README.md) for what they cover and why
the `Database` singleton's lifecycle stays unit-tested.

## Benchmarks

The benchmark scripts live in [`../benchmarks`](../benchmarks). Numbers below are
from a Node 24 run on Windows - **your hardware will differ**; reproduce with the
commands shown.

### Per-query overhead (vSQL pure functions, no DB)

```bash
node benchmarks/micro.mjs
```

```
  bindParams positional                 101,677,682 ops/s       10 ns/op
  bindParams named                       13,894,910 ops/s       72 ns/op
  bindParams IN-list expansion            2,556,782 ops/s      391 ns/op
  isReadQuery                            41,949,124 ops/s       24 ns/op
  normalizeShape                            677,072 ops/s     1477 ns/op
  cache get (hit)                         9,250,951 ops/s      108 ns/op
```

Per-query overhead is tens of nanoseconds for a reused query (binding hits the
memoised plan) - negligible next to a database round-trip (hundreds of
microseconds or more). IN-list expansion is the one binding path that can't be
memoised (the rewritten SQL grows with the array), so it stays a full parse.

### Side-by-side vs oxmysql (parameter binding)

```bash
node benchmarks/vs-oxmysql.mjs
```

```
  operation                                    vSQL              oxmysql  winner
  ---------------------------- -------------------- --------------------  ----------
  positional (2 params)           100,460,107 ops/s     10,660,890 ops/s  vSQL 9.42x
  positional + NULL pad            41,665,451 ops/s      4,802,968 ops/s  vSQL 8.67x
  named (:id, :active)             18,415,087 ops/s      6,442,502 ops/s  vSQL 2.86x
  IN-list expansion                 2,446,657 ops/s                       (vSQL only)
```

This is an honest comparison of the **binding layer only** (both wrap mysql2, so
once a statement reaches the driver the cost is identical). vSQL wins because it
**memoises a binding plan per SQL string** and FiveM reuses the same query
literals on every call: after the first parse, a positional query hands the SQL
to the driver untouched and only shapes the values, and a named query reads from
a pre-compiled template. oxmysql re-parses every call - counting `?` with a regex
(and running `named-placeholders` for `@`/`:`) each time. The plan stores
structure only, never values, so binding stays positional and injection-safe.
The IN-list row is vSQL-only and the one path vSQL can't memoise (the rewritten
SQL grows with the array); oxmysql leaves `IN ?` for mysql2's text-protocol
expansion, so there's no comparable parse-layer cost to race against. All of
these are millions of ops/s either way - the point isn't the absolute speed (a
network round-trip dwarfs it) but that vSQL's richer parser is no longer the
price.

> The named row uses `named-placeholders@1.1.6` (the version oxmysql patches);
> for the `:name` syntax used here the patched and stock builds behave the same.

### Throughput (real database)

```bash
BENCH_DB=mysql://root:pass@localhost:3306/bench node benchmarks/throughput.mjs
```

Measures queries/sec and latency percentiles against a live server using vSQL's
pool settings. Point another resource at the same DB/table to compare like-for
-like. See [`../benchmarks/README.md`](../benchmarks/README.md) for details.
