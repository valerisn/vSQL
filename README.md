# vSQL

A modern, high-performance MySQL/MariaDB resource for FiveM — an advanced successor to oxmysql.

Built on [mysql2](https://github.com/sidorares/node-mysql2) with a configurable connection pool, prepared-statement and result caching, batched inserts, a built-in migration runner, a query profiler, and first-class MariaDB tuning. The export names mirror oxmysql where it makes sense, so migrating is mostly a find-and-replace.

---

## Features

- **Connection pool** with automatic reconnection (exponential backoff + jitter) and a startup health check.
- **Callback and Promise/async APIs** for every export.
- **`?` positional and `@name` / `:name` named parameters**, plus automatic `IN (?)` array expansion — always bound, never interpolated.
- **Prepared-statement caching** (mysql2 per-connection LRU) and **optional result caching** (TTL + LRU) with explicit invalidation.
- **Batched / pipelined inserts** and **slow-query logging**.
- **MariaDB detection & tuning** — utf8mb4 defaults, session timeouts, `RETURNING` capability detection, with graceful MySQL fallback.
- **Migration runner** — checksum-validated, lock-protected, dry-run capable, with up/down support.
- **Profiler** — query count, avg/p50/p95/p99 latency, and recent slow queries, surfaced via the `vsql` console command and a `getStats` export.
- **TypeScript source** compiled with esbuild, full `.d.ts` for consumers.

---

## Installation

1. Drop this resource into your server's `resources/` folder as `vSQL`.
2. Build it (Node 16+ required):

   ```bash
   cd vSQL
   npm install
   npm run build      # bundles src -> dist/index.js (+ type declarations)
   ```

   The committed resource ships `dist/index.js`; you only need to rebuild after editing `src/`.

3. Configure the connection in `server.cfg` (see below) and add `ensure vSQL` **before** any resource that depends on it.
4. In each resource that uses the database, add a dependency and (for Lua) the wrapper:

   ```lua
   -- consumer fxmanifest.lua
   dependency 'vSQL'
   shared_script '@vSQL/lib/MySQL.lua'   -- only needed for the Lua MySQL.* global
   ```

---

## Configuration (convars)

Set these in `server.cfg`. Use **either** a connection string **or** the discrete options.

```cfg
# Option A — connection string (URL or oxmysql-style semicolons)
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"
# set vsql_connection_string "host=localhost;user=root;password=pwd;database=fivem"

# Option B — discrete options
set vsql_host "localhost"
set vsql_port 3306
set vsql_user "root"
set vsql_password ""
set vsql_database "fivem"
set vsql_socket ""                 # unix socket / named pipe path (optional)
```

| Convar | Default | Description |
| --- | --- | --- |
| `vsql_connection_string` | — | URL (`mysql://…`) or `key=value;…` form. Overrides discrete options. |
| `vsql_host` / `vsql_port` | `localhost` / `3306` | Server address. |
| `vsql_user` / `vsql_password` | `root` / `` | Credentials. |
| `vsql_database` | — | Default schema. |
| `vsql_socket` | — | Unix socket / named-pipe path (skips TCP). |
| `vsql_pool_size` | `8` | Max pool connections. |
| `vsql_connect_timeout` | `30000` | Connection timeout (ms). |
| `vsql_charset` | `utf8mb4` | Connection charset. |
| `vsql_collation` | `utf8mb4_unicode_ci` | Session collation. |
| `vsql_timezone` | `Z` | mysql2 timezone handling. |
| `vsql_wait_timeout` | `0` | If > 0, sets session `wait_timeout`/`interactive_timeout`. |
| `vsql_server_hint` | `auto` | Force server type: `auto` \| `mysql` \| `mariadb`. |
| `vsql_slow_query_warning` | `150` | Slow-query threshold (ms). |
| `vsql_cache` | `false` | Enable result caching. |
| `vsql_cache_size` | `500` | Max cached result sets. |
| `vsql_cache_ttl` | `30000` | Cache entry TTL (ms). |
| `vsql_migrations` | `true` | Run migrations on resource start. |
| `vsql_migrations_dir` | `migrations` | Migrations directory (relative to the resource). |
| `vsql_debug` | `0` | `0` off, `1` lifecycle, `2` log every query with timing. |

> **Result caching note:** caching is opt-in and global. Any write (`insert`/`update`/`query` of a non-SELECT/`transaction`/`batch`) invalidates the **entire** cache to stay correct. Use `cacheClear("table_name")` for targeted invalidation, and avoid enabling it for write-heavy workloads.

---

## Exports

Every export accepts **either** a trailing callback **or** returns a Promise.

```js
// Promise
const rows = await exports.vSQL.query('SELECT * FROM players');
// Callback
exports.vSQL.query('SELECT * FROM players', (rows) => { /* ... */ });
```

| Export | Signature | Returns |
| --- | --- | --- |
| `query` | `(sql, params?, cb?)` | Rows for reads, `ResultSetHeader` for writes (text protocol). |
| `execute` | `(sql, params?, cb?)` | Same shaping as `query`, via prepared statements. |
| `single` | `(sql, params?, cb?)` | First row, or `null`. |
| `scalar` | `(sql, params?, cb?)` | First column of the first row, or `null`. |
| `insert` | `(sql, params?, cb?)` | `insertId`. |
| `update` | `(sql, params?, cb?)` | `affectedRows` (also covers `DELETE`). |
| `prepare` | `(sql, params?, cb?)` | Prepared execute; an array-of-arrays runs as a batch. |
| `batch` | `(sql, rows[][], cb?)` | Runs the statement once per row in a transaction; total `affectedRows`. |
| `transaction` | `(queries[] \| fn(tx), cb?)` | Atomic; rolls back on error. Returns results array or the callback's return. |
| `cacheClear` / `clearCache` | `(pattern?)` | Clears cache (all, or entries whose key contains `pattern`); returns count. |
| `getStats` | `()` | Profiler stats `{ count, errors, cacheHits, avgMs, p50, p95, p99, slow[] }`. |
| `serverInfo` | `()` | `{ type, version, major, minor, supportsReturning }`. |
| `isReady` | `()` | `boolean` — pool connected. |
| `ready` | `(cb?)` | Resolves once the pool is connected. |

**Lua aliases** (via `@vSQL/lib/MySQL.lua`): `MySQL.query`, `.execute`, `.single`, `.scalar`, `.insert`, `.update`, `.prepare`, `.batch`, `.transaction`, each with a `.await` form, plus legacy `MySQL.Sync.*` / `MySQL.Async.*`.

### Parameters

```js
// positional
await exports.vSQL.query('SELECT * FROM players WHERE money > ?', [1000]);
// named (@name or :name, interchangeable)
await exports.vSQL.single('SELECT * FROM players WHERE citizenid = @id', { id: 'ABC123' });
// IN (?) — arrays expand automatically
await exports.vSQL.query('SELECT * FROM vehicles WHERE plate IN ?', [['AAA111', 'BBB222']]);
```

---

## Migration runner

Migrations live in `/migrations` and run automatically on resource start (disable with `set vsql_migrations false`). Applied migrations are tracked in a `vsql_migrations` table (`version`, `name`, `checksum`, `applied_at`).

- **Ordering:** files run in natural filename order (`001_…`, `002_…`).
- **Naming:** `001_create_players.sql` → version `001`, name `create_players`. Optional `001_create_players.down.sql` enables rollback.
- **JS migrations:** `003_seed_admin.js` exporting `up(conn)` (and optionally `down`).
- **Checksum validation:** editing an already-applied file is detected and aborts the run — create a new migration instead.
- **Concurrency-safe:** a `GET_LOCK` advisory lock means two servers booting at once won't double-apply.
- **Idempotent:** safe to run repeatedly.

### Console commands (server console)

```
vsql                     # show profiler stats
vsql migrate             # apply pending migrations
vsql migrate:status      # show applied / pending / modified
vsql migrate:dry         # dry-run (show what would apply)
vsql migrate:rollback    # roll back the most recent migration (needs a .down.sql)
vsql cache clear         # flush the result cache
vsql reset               # reset profiler stats
```

---

## Migrating from oxmysql

- **Convars:** rename `mysql_connection_string` → `vsql_connection_string` (the `key=value;…` form is parsed as-is), or use the discrete `vsql_*` options.
- **Lua:** `oxmysql` exposes a `MySQL` global; so does vSQL via `shared_script '@vSQL/lib/MySQL.lua'`. The common methods (`query`, `single`, `scalar`, `insert`, `update`, `prepare`, `transaction`) and their `.await` forms line up.
- **JS:** replace `exports.oxmysql.<fn>` with `exports.vSQL.<fn>`. Result shapes match: reads return rows, `insert` returns `insertId`, `update` returns `affectedRows`.
- **Differences to know:** result caching is opt-in and global-invalidating (see note above); slow-query and debug logging are controlled by `vsql_slow_query_warning` / `vsql_debug`; vSQL ships its own migration runner.

---

## MariaDB tuning

At startup vSQL runs `SELECT VERSION()`, detects MySQL vs MariaDB (overridable via `vsql_server_hint`), and:

- sets `utf8mb4` charset/collation per connection,
- optionally applies session `wait_timeout`/`interactive_timeout` (`vsql_wait_timeout`),
- detects `RETURNING` support (MariaDB 10.5+) and exposes it via `serverInfo().supportsReturning`, so you can skip the extra round-trip:

  ```sql
  -- MariaDB 10.5+: get the inserted row back in one statement
  INSERT INTO players (citizenid, name) VALUES (?, ?) RETURNING citizenid, created_at;
  ```

When connected to MySQL, RETURNING is reported unsupported and standard `insertId`/`affectedRows` behavior applies.

---

## Project layout

```
vSQL/
├── fxmanifest.lua
├── package.json
├── tsconfig.json
├── build.js                # esbuild bundler
├── schema.sql              # example baseline schema
├── lib/MySQL.lua           # oxmysql-style Lua wrapper
├── migrations/             # 001_*.sql (+ .down.sql), 003_*.js
├── examples/               # server.lua, server.js
├── types/index.d.ts        # exported type definitions
├── src/                    # TypeScript source
│   ├── index.ts            # bootstrap / lifecycle
│   ├── config.ts           # convar parsing
│   ├── database.ts         # pool, query API, transactions
│   ├── params.ts           # placeholder binding
│   ├── migrations.ts       # migration runner
│   ├── exports.ts          # FiveM export registration
│   ├── commands.ts         # vsql console command
│   ├── profiler.ts / cache.ts / logger.ts / server.ts / util.ts
│   └── fivem.d.ts
└── dist/                   # build output (index.js)
```

## License

MIT
