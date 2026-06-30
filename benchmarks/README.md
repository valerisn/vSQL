# Benchmarks

Reproducible benchmarks for vSQL. Requires **Node 24+** (same as the test suite).

## Microbenchmarks (no database)

Measures the pure functions that run on every query - parameter binding, read/write
classification, query-shape normalization, and cache lookups.

```bash
node benchmarks/micro.mjs
```

Example output (Node 24, Windows - your numbers will vary by hardware):

```
  bindParams positional                 101,677,682 ops/s       10 ns/op
  bindParams named                       13,894,910 ops/s       72 ns/op
  bindParams IN-list expansion            2,556,782 ops/s      391 ns/op
  isReadQuery                            41,949,124 ops/s       24 ns/op
  normalizeShape                            677,072 ops/s     1477 ns/op
  cache get (hit)                          9,250,951 ops/s      108 ns/op
```

The takeaway: vSQL's per-query overhead is tens of nanoseconds for a reused query
(parameter binding hits a memoised plan) down to nanoseconds for read/write
classification - negligible next to a network round-trip to the database, which is
typically hundreds of microseconds or more. The exception is IN-list expansion, the
one binding path that can't be memoised (the rewritten SQL grows with the array).

> The `MODULE_TYPELESS_PACKAGE_JSON` warning Node prints when running these is harmless
> - it just means Node reparses the imported `.ts` files as ES modules. The project stays
> CommonJS on purpose (the bundler and `build.js` rely on it), so the warning is expected.

## Side-by-side vs oxmysql (parameter binding)

Compares vSQL's `bindParams` against a faithful reproduction of oxmysql 2.14.1's
`parseArguments` - the per-call binding cost, the one pure-JS hot path that
differs between the two (everything downstream is the same mysql2).

```bash
node benchmarks/vs-oxmysql.mjs
```

The `@name`/`:name` row uses `named-placeholders` (oxmysql's converter) when it's
resolvable - it usually is, since mysql2 depends on it; run from inside the
cloned oxmysql repo to exercise oxmysql's exact patched build. The positional and
IN-list rows always run. Results and interpretation are in
[`../tests/README.md`](../tests/README.md#side-by-side-vs-oxmysql-parameter-binding).

## Cache hit path

Measures the cost of a result-cache hit against the *actual* leaf modules the
read path composes, and (with a DB) the round-trip a hit skips.

```bash
node benchmarks/cache.mjs                                   # CPU-only
BENCH_DB=mysql://root:pw@localhost:3306/bench node benchmarks/cache.mjs   # + real miss
```

A hit returns before any binding, plan lookup, or round-trip, so the hit path is
sub-microsecond (~600 ns) - it is dwarfed by the round-trip it replaces. The real
end-to-end lever is the hit *rate* and the skipped trip, not shaving nanoseconds
off an already-fast hit.

## RETURNING (round-trip count)

"Insert and get the inserted row" is two round-trips the classic way and one on
MariaDB 10.5+ via `INSERT ... RETURNING` - what `vSQL.insertAndFetch` uses when
the server supports it.

```bash
BENCH_DB=mysql://root:pw@localhost:3306/bench node benchmarks/returning.mjs
```

Detects the server from `VERSION()`: on MariaDB it times both paths and reports
the speedup; on MySQL it times the two-trip baseline (the fallback). Run it once
per engine to compare.

## Bulk writes (round-trip count)

Inserting N rows three ways - per-row loop, transactional `batch()`, and a single
multi-row `INSERT` - to show where the round-trips go.

```bash
BENCH_DB=mysql://root:pw@localhost:3306/bench BENCH_ROWS=500 node benchmarks/batch.mjs
```

The multi-row `INSERT` (one round-trip) is what `vSQL.insertInto(table, [rows...])`
generates - prefer it for bulk inserts. `batch()` is for N *distinct* statements,
where N round-trips are unavoidable (no `multipleStatements`, by design).

## Read replicas (read throughput)

Concurrent reads, primary-only vs primary + replica round-robin (vSQL's routing).

```bash
BENCH_DB=mysql://u:pw@primary/db BENCH_REPLICA=mysql://u:pw@replica/db \
  node benchmarks/replica-read.mjs
```

A replica raises aggregate read throughput under load (single-read latency is
unchanged) and the script also exercises failover to the primary. Writes always
stay on the primary.

## Pool saturation (latency cliff)

Past the pool size, queries queue for a free connection and tail latency climbs.
This ramps concurrency against a fixed-size pool and reports throughput +
p50/p95/p99 at each level.

```bash
BENCH_DB=mysql://root:pw@localhost:3306/bench BENCH_POOL=8 node benchmarks/saturation.mjs
```

vSQL surfaces the same pressure live as `peakInFlight` / `poolSize` in
`getStats()` (and the `vsql` console command flags it when peak exceeds the pool).
Cap the queue with `vsql_queue_limit` to fast-fail instead of pile up.

## Throughput (real database)

Measures queries/sec and latency percentiles against a live MySQL/MariaDB, using the
same `mysql2` pool settings vSQL uses.

```bash
BENCH_DB=mysql://root:pass@localhost:3306/bench node benchmarks/throughput.mjs
```

Optional env vars: `BENCH_CONCURRENCY` (default `16`), `BENCH_DURATION_MS` (default `5000`).
It creates a temporary `vsql_bench` table, runs the workload, and drops it.

## Comparing against oxmysql

A genuine vSQL-vs-oxmysql comparison has to run **inside FXServer**, because both wrap
`mysql2` and the meaningful differences (caching, prepared-statement reuse, batching)
only show up under the resource's own code path. To compare fairly:

1. Point both resources at the same database and a table with the same shape as
   `vsql_bench` above.
2. Drive an identical workload through each resource's exports from a small test
   resource, timing with `GetGameTimer()`.
3. Keep pool size, server, and machine constant between runs.

The scripts here establish the **baseline** (raw `mysql2` throughput and vSQL's pure
overhead); the in-server comparison shows what each wrapper adds on top.
