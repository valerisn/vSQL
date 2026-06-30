# Architecture

How a query travels through vSQL, and what each module owns.

## Query lifecycle

```mermaid
flowchart TD
    A["Consumer resource<br/>exports.vSQL.query(...)"] --> B["exports.ts<br/>callback ↔ promise bridge<br/>parse params / opts / cb"]
    B --> C{"whenReady()"}
    C -- "pool down" --> C1["queue caller<br/>(resolves on connect)"]
    C1 --> C
    C -- "ready" --> D["database.ts<br/>read or write?"]

    D -- "read<br/>(SELECT / WITH-select / SHOW…)" --> E{"cacheable?<br/>cache on, not locking,<br/>opts.cache !== false"}
    E -- "hit" --> F["return cached rows<br/>(profiler: cache hit)"]
    E -- "miss" --> G["exec()"]
    D -- "write<br/>(INSERT / UPDATE / DML-CTE…)" --> G

    G --> H["params.ts<br/>bind ? / @name / :name<br/>expand IN (?)"]
    H --> I["per-call timeout?<br/>util.withStatementTimeout"]
    I --> J["mysql2 pool<br/>query() or execute()"]
    J --> K["profiler.ts<br/>record latency + shape"]
    K --> L{"was a write?"}
    L -- "yes" --> M["cache.invalidate()"]
    L -- "no" --> N["cache.set() if cacheable"]
    M --> O["shape result &<br/>return to caller"]
    N --> O
    F --> O

    J -. "fatal error" .-> P["handleConnectionLoss()<br/>emit vSQL:connectionLost<br/>reconnect w/ backoff"]
    P -. "reconnected" .-> C
```

## Modules

| Module | Responsibility |
|---|---|
| `index.ts` | Bootstrap: load config, register exports/commands, print banner, start the pool, run migrations, wire `onResourceStop`. |
| `config.ts` | Parse convars (URL / semicolon / discrete), build `PoolOptions`, session statements, redacted summary, and validation warnings. |
| `exports.ts` | Register FiveM exports; bridge promise ↔ callback styles; normalize `(sql, params?, opts?, cb?)`. |
| `database.ts` | The pool, connection lifecycle (connect / reconnect / drain), the query API, transactions + deadlock retry, cache wiring. |
| `params.ts` | Placeholder binding — `?`, `@name`, `:name`, and `IN (?)` array expansion. Always bound, never interpolated. |
| `cache.ts` | TTL + LRU result cache with substring invalidation. |
| `profiler.ts` | Counters, latency ring buffer + percentiles, slow-query log, and per-shape aggregation (`vsql top`). |
| `util.ts` | Pure helpers: read/write classification, backoff, fatal/retryable error detection, connection hints, statement-timeout wrapping. |
| `server.ts` | Detect MySQL vs MariaDB and `RETURNING` support. |
| `migrations.ts` | Discover, checksum, lock, apply / rollback / status. |
| `commands.ts` | The `vsql` console command and its subcommands. |
| `version.ts` | Best-effort GitHub release check on startup. |
| `banner.ts` / `logger.ts` | Console UI — startup banner, status box, tagged/colored logging. |

## Design choices

- **Bind, never interpolate.** Every value goes through `params.ts` as a bound `?`, so queries are injection-safe by construction.
- **Queue, don't fail, during startup/reconnect.** Calls made before the pool is up wait on `whenReady()` instead of throwing.
- **Blunt but correct cache invalidation.** Any write clears the whole result cache; targeted clears are opt-in via `cacheClear(pattern)`.
- **Pure core, testable.** The hot-path logic (`params`, `util`, `cache`, `profiler`) has no FiveM or DB dependencies, so it runs under `node --test`.
