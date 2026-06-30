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
  bindParams positional                   2,890,470 ops/s      346 ns/op
  bindParams named                        1,363,471 ops/s      733 ns/op
  bindParams IN-list expansion            2,795,138 ops/s      358 ns/op
  isReadQuery                            41,630,933 ops/s       24 ns/op
  normalizeShape                            721,097 ops/s     1387 ns/op
  cache get (hit)                         9,211,487 ops/s      109 ns/op
```

Per-query overhead is a few hundred nanoseconds (binding) down to tens of
nanoseconds (read/write classification) - negligible next to a database round
-trip (hundreds of microseconds or more).

### Side-by-side vs oxmysql (parameter binding)

```bash
node benchmarks/vs-oxmysql.mjs
```

```
  operation                                    vSQL              oxmysql  winner
  ---------------------------- -------------------- --------------------  ----------
  positional (2 params)             3,021,716 ops/s     10,909,825 ops/s  ox 3.61x
  positional + NULL pad             3,554,829 ops/s      5,515,984 ops/s  ox 1.55x
  named (:id, :active)              1,385,602 ops/s      6,662,753 ops/s  ox 4.81x
  IN-list expansion                 2,664,615 ops/s                       (vSQL only)
```

This is an honest comparison of the **binding layer only** (both wrap mysql2, so
once a statement reaches the driver the cost is identical). oxmysql's
`parseArguments` is faster because it does less: it counts `?` with a regex and
pads, then defers `@`/`:` conversion to `named-placeholders` and array expansion
to mysql2. vSQL's `bindParams` is a single quote/comment-aware pass that also
expands `IN ?` -> `IN (?, ?, ...)` itself and lets `?`, `@name` and `:name` be
mixed - more work per call, but it's still ~3M ops/s, i.e. a few hundred
nanoseconds, which is lost in the noise of a network round-trip. The IN-list row
is vSQL-only: oxmysql leaves `IN ?` for mysql2's text-protocol expansion, so
there's no comparable parse-layer cost to race against.

> The named row uses `named-placeholders@1.1.6` (the version oxmysql patches);
> for the `:name` syntax used here the patched and stock builds behave the same.

### Throughput (real database)

```bash
BENCH_DB=mysql://root:pass@localhost:3306/bench node benchmarks/throughput.mjs
```

Measures queries/sec and latency percentiles against a live server using vSQL's
pool settings. Point another resource at the same DB/table to compare like-for
-like. See [`../benchmarks/README.md`](../benchmarks/README.md) for details.
