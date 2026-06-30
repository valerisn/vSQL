# Benchmarks

Reproducible benchmarks for vSQL. Requires **Node 24+** (same as the test suite).

## Microbenchmarks (no database)

Measures the pure functions that run on every query — parameter binding, read/write
classification, query-shape normalization, and cache lookups.

```bash
node benchmarks/micro.mjs
```

Example output (your numbers will vary by hardware):

```
  bindParams positional                   2,970,633 ops/s      337 ns/op
  bindParams named                        1,314,215 ops/s      761 ns/op
  bindParams IN-list expansion            2,769,120 ops/s      361 ns/op
  isReadQuery                            43,610,229 ops/s       23 ns/op
  normalizeShape                            653,563 ops/s     1530 ns/op
  cache get (hit)                         9,584,254 ops/s      104 ns/op
```

The takeaway: vSQL's per-query overhead is on the order of hundreds of nanoseconds —
negligible next to a network round-trip to the database.

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
