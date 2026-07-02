<div align="center">

# vSQL

**A fast, modern MySQL / MariaDB layer for FiveM.**

Built on [mysql2](https://github.com/sidorares/node-mysql2), designed as a drop-in successor to oxmysql.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/valerisn/vSQL/actions/workflows/ci.yml/badge.svg)](https://github.com/valerisn/vSQL/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FiveM](https://img.shields.io/badge/FiveM-resource-F40552)](https://fivem.net/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

vSQL is the database resource I wanted for my own servers: quick, predictable, and honest about what it does. You get a real connection pool, prepared-statement and result caching, batched inserts, a built-in migration runner, a live query profiler, and MariaDB tuning that actually uses the features MariaDB gives you. The exports line up with oxmysql wherever it makes sense, so moving over is usually a find-and-replace away.

<div align="center">

<img src="assets/terminal.svg" alt="vSQL console: startup banner, connection status, and vsql top profiler output" width="640">

</div>

## Where to read next

- **[Getting started](docs/getting-started.md)** - install, configure, run your first query.
- **[Recipes](docs/recipes.md)** - copy-paste answers for the things you'll actually do.
- **[Architecture](docs/architecture.md)** - what happens between your `await` and the database.

> Everything renders right here on GitHub, and the same pages build into a [VitePress](https://vitepress.dev) site (`npm run docs:dev`) you can publish to GitHub Pages or any static host. Details in [docs/README.md](docs/README.md).

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Exports](#exports)
- [Events](#events)
- [Migrations](#migrations)
- [Console commands](#console-commands)
- [Coming from oxmysql](#coming-from-oxmysql)
- [MariaDB tuning](#mariadb-tuning)
- [Project layout](#project-layout)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## What you get

| | |
|---|---|
| **A connection pool that heals itself** | Reconnects with exponential backoff and jitter, both at startup and after a mid-session drop. The `health` export tells you where things stand right now. |
| **Two API styles, no wrapper** | Every export takes a trailing callback or returns a Promise. Use whichever reads better at the call site. |
| **Parameters that stay safe** | Positional `?`, named `@name` / `:name`, and automatic `IN (?)` array expansion. Always bound by the driver, never glued into a string. |
| **Caching where it helps** | Prepared-statement caching (mysql2's per-connection LRU) plus an optional TTL + LRU result cache with explicit invalidation. |
| **Bulk writes** | Batched inserts and slow-query logging, so heavy writes and slow reads don't hide. |
| **MariaDB-aware** | utf8mb4 by default, session timeouts, and `RETURNING` detection - with a clean MySQL fallback when it isn't available. |
| **Migrations built in** | Checksum-validated, lock-protected, dry-run capable, with up *and* down support. |
| **A profiler you'll actually check** | Query and error counts, average and p50 / p95 / p99 latency, and the recent slow queries. |
| **First-class TypeScript** | Bundled with esbuild, full `.d.ts` shipped for consumers. |

## Requirements

- FXServer (`server` build 7290 or newer).
- MySQL 5.7+ or MariaDB 10.4+.
- Node.js - only to *build* the resource, never at runtime. See [Development](#development) for the version the tests use.

## Installation

> [!IMPORTANT]
> Put `ensure vSQL` in your `server.cfg` **before** anything that talks to the database.

**1.** Drop this resource into your server's `resources/` folder as `vSQL`.

**2.** Build it:

```bash
cd vSQL
npm install
npm run build      # bundles src into dist/index.js plus type declarations
```

> [!NOTE]
> `dist/` is generated, not committed. Build once before you first `ensure vSQL`, and again whenever you touch `src/`.

**3.** Add the connection settings to `server.cfg` (see [Configuration](#configuration)) and then:

```cfg
ensure vSQL
```

**4.** In each resource that uses the database, declare the dependency - and for Lua, pull in the wrapper:

```lua
-- consumer fxmanifest.lua
dependency 'vSQL'
shared_script '@vSQL/lib/MySQL.lua'   -- only needed for the Lua MySQL.* global
```

## Configuration

Everything lives in `server.cfg` convars, and every one has a sensible default - the only thing you *have* to set is how to reach the database. Use **either** a connection string **or** the discrete options.

```cfg
# Option A: connection string (URL, or oxmysql-style semicolons)
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"
# set vsql_connection_string "host=localhost;user=root;password=pwd;database=fivem"

# Option B: discrete options
set vsql_host "localhost"
set vsql_port 3306
set vsql_user "root"
set vsql_password ""
set vsql_database "fivem"
set vsql_socket ""                 # unix socket / named pipe path (optional)
```

<details>
<summary><b>Full convar reference</b></summary>

| Convar | Default | Description |
|---|---|---|
| `vsql_connection_string` | _(empty)_ | URL (`mysql://...`) or `key=value;...` form. Overrides discrete options. |
| `vsql_host` / `vsql_port` | `localhost` / `3306` | Server address. |
| `vsql_user` / `vsql_password` | `root` / _(empty)_ | Credentials. |
| `vsql_database` | _(empty)_ | Default schema. |
| `vsql_socket` | _(empty)_ | Unix socket or named pipe path (skips TCP). |
| `vsql_pool_size` | `8` | Max pool connections. |
| `vsql_max_idle` | _(pool size)_ | Max idle connections kept open; extras are closed. Set below `vsql_pool_size` to let idle connections drain. |
| `vsql_idle_timeout` | `60000` | Ms an idle connection lingers before being reaped. |
| `vsql_connect_timeout` | `30000` | Connection timeout in ms. |
| `vsql_queue_limit` | `0` | Max requests waiting for a free connection; `0` is unbounded. Set it to fast-fail under extreme load instead of queueing without limit. |
| `vsql_charset` | `utf8mb4` | Connection charset. |
| `vsql_collation` | `utf8mb4_unicode_ci` | Session collation. |
| `vsql_timezone` | `Z` | mysql2 timezone handling. |
| `vsql_wait_timeout` | `0` | If greater than 0, sets session `wait_timeout` and `interactive_timeout`. |
| `vsql_query_timeout` | `0` | If greater than 0, caps statement runtime (ms) server-side. MariaDB caps all statements; MySQL only caps read-only `SELECT`s. |
| `vsql_server_hint` | `auto` | Force server type: `auto`, `mysql`, or `mariadb`. |
| `vsql_slow_query_warning` | `150` | Slow query threshold in ms. |
| `vsql_tx_retries` | `2` | Extra attempts for a transaction/batch that hits a deadlock or lock-wait timeout. `0` disables retrying. |
| `vsql_breaker_threshold` | `10` | Consecutive failed reconnects (after the first successful connect) before the circuit breaker opens and queries fast-fail. `0` disables it. |
| `vsql_breaker_reset` | `30000` | Ms the breaker stays open before allowing a probe. |
| `vsql_read_replicas` | _(empty)_ | Comma-separated replica connection strings; reads round-robin across them, writes stay on the primary. |
| `vsql_replica_hosts` | _(empty)_ | Comma-separated `host[:port]` replicas reusing the primary's user/password/database. |
| `vsql_replica_cooldown` | `10000` | Ms a failed replica stays out of rotation before being retried. |
| `vsql_cache` | `false` | Enable result caching. |
| `vsql_cache_size` | `500` | Max cached result sets. |
| `vsql_cache_ttl` | `30000` | Cache entry TTL in ms. |
| `vsql_migrations` | `true` | Run migrations on resource start. |
| `vsql_migrations_dir` | `migrations` | Migrations directory, relative to the resource. |
| `vsql_version_check` | `true` | Check GitHub for a newer release on start. |
| `vsql_version_repo` | `valerisn/vSQL` | `owner/repo` to check against (for forks). |
| `vsql_compat` | `false` | Claim the `oxmysql` / `ghmattimysql` / `mysql-async` export namespaces so existing scripts route into vSQL. Enable only with those resources removed. See [COMPATIBILITY.md](COMPATIBILITY.md). |
| `vsql_typecast` | `false` | oxmysql-compatible result casting: dates -> epoch ms, `TINYINT(1)`/`BIT(1)` -> boolean. Override per call with `{ typeCast: true \| false }`. |
| `vsql_debug` | `0` | `0` off, `1` lifecycle, `2` logs every query with timing. |

</details>

> [!WARNING]
> **Result caching is opt-in and global.** Any write (`insert`, `update`, a non-`SELECT` `query`, `transaction`, or `batch`) clears the **entire** cache so you never read stale data. Reach for `cacheClear("table_name")` when you want targeted invalidation, and think twice before enabling the cache on a write-heavy workload.

> [!TIP]
> Locking reads (`SELECT ... FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`) are never cached, so their row locks always reach the server.

## Usage

Pick a callback or a Promise - the same export does both.

```js
// Promise
const rows = await exports.vSQL.query('SELECT * FROM players');

// Callback
exports.vSQL.query('SELECT * FROM players', (rows) => { /* ... */ });
```

### Parameters

```js
// positional
await exports.vSQL.query('SELECT * FROM players WHERE money > ?', [1000]);

// named (@name or :name, use either)
await exports.vSQL.single('SELECT * FROM players WHERE citizenid = @id', { id: 'ABC123' });

// IN (?), arrays expand for you
await exports.vSQL.query('SELECT * FROM vehicles WHERE plate IN ?', [['AAA111', 'BBB222']]);
```

> [!CAUTION]
> Always pass values as parameters - never build the query by concatenating strings. vSQL binds every value, which is exactly what keeps you safe from SQL injection.

### Per-call options

Read/write methods take an optional `{ timeout, cache }` object as the third argument.

```js
// Skip the result cache for this one read (always hit the server)
await exports.vSQL.single('SELECT * FROM players WHERE id = ?', [1], { cache: false });

// Cap this statement at 2s server-side (MariaDB caps any statement;
// MySQL caps read-only SELECTs - see vsql_query_timeout)
await exports.vSQL.query('SELECT * FROM big_report', [], { timeout: 2000 });
```

### Transactions

```js
// Array form
await exports.vSQL.transaction([
  ['UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1]],
  ['UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2]],
]);

// Callback form (it all commits, or rolls back on throw)
await exports.vSQL.transaction(async (tx) => {
  const from = await tx.single('SELECT balance FROM accounts WHERE id = ?', [1]);
  if (from.balance < 100) throw new Error('insufficient funds');
  await tx.update('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
  await tx.update('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
});
```

> [!NOTE]
> Transactions and `batch` retry automatically on a deadlock or lock-wait timeout (`vsql_tx_retries`, default `2`) - those just need replaying. The unit rolls back before each retry, so the database stays consistent. The catch: a callback-form transaction with side effects **outside** the database (HTTP calls, events) will see those repeated. Keep such side effects out of the transaction body, or set `vsql_tx_retries 0`.

## Exports

| Export | Signature | Returns |
|---|---|---|
| `query` | `(sql, params?, cb?)` | Rows for reads, `ResultSetHeader` for writes (text protocol). |
| `execute` | `(sql, params?, cb?)` | Same shaping as `query`, via prepared statements. |
| `single` | `(sql, params?, cb?)` | First row, or `null`. |
| `scalar` | `(sql, params?, cb?)` | First column of the first row, or `null`. |
| `insert` | `(sql, params?, cb?)` | `insertId`. |
| `update` | `(sql, params?, cb?)` | `affectedRows` (also covers `DELETE`). |
| `prepare` | `(sql, params?, cb?)` | Prepared execute. An array of arrays runs as a batch. |
| `batch` | `(sql, rows[][], cb?)` | Runs the statement once per row in a transaction. Returns total `affectedRows`. |
| `transaction` | `(queries[] or fn(tx), cb?)` | Atomic, rolls back on error. Returns results array or the callback's return. |
| `cacheClear` / `clearCache` | `(pattern?)` | Clears the cache (all, or entries whose key contains `pattern`). Returns count. |
| `getStats` | `()` | Stats `{ count, errors, cacheHits, avgMs, p50, p95, p99, slow[], byResource[], inFlight, peakInFlight, cacheEnabled, cacheSize, poolSize, uptimeMs }`. |
| `topQueries` | `(limit?)` | Heaviest query *shapes* by total time `{ shape, count, totalMs, avgMs, maxMs }[]`. |
| `serverInfo` | `()` | `{ type, version, major, minor, supportsReturning }`. |
| `health` | `()` | `{ connected, reconnecting, breaker, replicas, server }`, live connection status. |
| `isReady` | `()` | `boolean`, whether the pool is connected. |
| `ready` | `(cb?)` | Resolves once the pool is connected. |

**Lua aliases** (via `@vSQL/lib/MySQL.lua`): `MySQL.query`, `.execute`, `.single`, `.scalar`, `.insert`, `.update`, `.prepare`, `.batch`, `.transaction`, each with a `.await` form, plus legacy `MySQL.Sync.*` and `MySQL.Async.*`.

### Events

vSQL emits server events so dependent resources can react to connection state instead of polling `isReady()`.

| Event | Payload | When |
|---|---|---|
| `vSQL:ready` | `ServerInfo` | The pool connects for the first time. |
| `vSQL:reconnected` | `ServerInfo` | The pool reconnects after a mid-session loss. |
| `vSQL:connectionLost` | `{ code, message }` | A fatal connection error is detected (reconnect begins). |
| `onMySQLReady` | _(none)_ | Emitted on connect for mysql-async / ESX-legacy compatibility. |

```lua
AddEventHandler('vSQL:ready', function(server)
  print(('database up: %s %s'):format(server.type, server.version))
end)
```

## Migrations

Migrations live in `/migrations` and run automatically on resource start (turn it off with `set vsql_migrations false`). What's already applied is tracked in a `vsql_migrations` table (`version`, `name`, `checksum`, `applied_at`).

- **Ordering:** files run in natural filename order (`001_...`, `002_...`).
- **Naming:** `001_create_players.sql` becomes version `001`, name `create_players`. Add a matching `001_create_players.down.sql` to make it reversible.
- **JS migrations:** `003_seed_admin.js` exporting `up(conn)` and optionally `down`.
- **Checksum validation:** editing an already-applied file is caught and aborts the run - write a new migration instead.
- **Concurrency safe:** a `GET_LOCK` advisory lock means two servers booting at once won't double-apply.
- **Idempotent:** safe to run again and again.

## Console commands

Run these from the server console.

```
vsql                     # show profiler stats
vsql top [n]             # heaviest query shapes by total time (pg_stat_statements style)
vsql debug               # dump diagnostics (redacted config, server, pool, cache)
vsql migrate             # apply pending migrations
vsql migrate:status      # show applied / pending / modified
vsql migrate:dry         # dry run (show what would apply)
vsql migrate:rollback    # roll back the most recent migration (needs a .down.sql)
vsql cache clear         # flush the result cache
vsql reset               # reset profiler stats
```

## Coming from oxmysql

- **Convars:** rename `mysql_connection_string` to `vsql_connection_string` (the `key=value;...` form is parsed as-is), or switch to the discrete `vsql_*` options.
- **Lua:** oxmysql exposes a `MySQL` global, and so does vSQL via `shared_script '@vSQL/lib/MySQL.lua'`. The everyday methods (`query`, `single`, `scalar`, `insert`, `update`, `prepare`, `transaction`) and their `.await` forms line up.
- **JS:** swap `exports.oxmysql.<fn>` for `exports.vSQL.<fn>`. Result shapes match: reads return rows, `insert` returns `insertId`, `update` returns `affectedRows`.
- **Worth knowing:** result caching is opt-in and clears globally (see the warning above), slow-query and debug logging are driven by `vsql_slow_query_warning` and `vsql_debug`, and vSQL brings its own migration runner.

### Drop-in compatibility mode

Don't want to touch existing scripts? Set `vsql_compat true`. vSQL then answers the export namespaces of the common MySQL resources and routes them into itself:

| Resource | Exports routed |
|---|---|
| `oxmysql` | `query`, `single`, `scalar`, `update`, `insert`, `prepare`, `rawExecute`, `transaction`, `store`, `isReady`, `awaitConnection`, `execute`/`fetch` - each as the bare name plus its `_async` and `Sync` variants |
| `ghmattimysql` | `execute`, `scalar`, `transaction`, `store` (+ their `Sync` variants) |
| `mysql-async` | `mysql_execute`, `mysql_fetch_all`, `mysql_fetch_scalar`, `mysql_insert`, `mysql_transaction`, `mysql_store` |

The surface mirrors **oxmysql 2.14.1** exactly, right down to the
`(query, parameters, cb, invokingResource, isPromise)` calling convention - so a
resource calling `exports.oxmysql.execute(...)` (or `exports['mysql-async'].mysql_fetch_all(...)`)
keeps working untouched. vSQL also emits **`onMySQLReady`** on connect, the
signal mysql-async / ESX-legacy scripts wait on. The full breakdown and the
handful of deliberate differences are in [COMPATIBILITY.md](COMPATIBILITY.md).

> [!WARNING]
> Turn `vsql_compat` on **only with the original resource removed** - never run both `oxmysql` and vSQL-with-compat, or the two fight over the same export namespace. Compat is off by default.

## MariaDB tuning

On startup vSQL runs `SELECT VERSION()`, works out MySQL vs MariaDB (override with `vsql_server_hint`), and then:

- sets `utf8mb4` charset and collation per connection,
- optionally applies session `wait_timeout` and `interactive_timeout` (`vsql_wait_timeout`),
- detects `RETURNING` support (MariaDB 10.5+) and surfaces it via `serverInfo().supportsReturning`, so you can save a round-trip:

```sql
-- MariaDB 10.5+: get the inserted row back in one statement
INSERT INTO players (citizenid, name) VALUES (?, ?) RETURNING citizenid, created_at;
```

> [!NOTE]
> On MySQL, `RETURNING` reports as unsupported and the usual `insertId` / `affectedRows` behaviour applies.

## Project layout

```
vSQL/
├── fxmanifest.lua
├── package.json
├── tsconfig.json
├── build.js                # esbuild bundler
├── schema.sql              # example baseline schema
├── lib/MySQL.lua           # oxmysql style Lua wrapper
├── migrations/             # 001_*.sql (plus .down.sql), 003_*.js
├── examples/               # server.lua, server.js
├── types/index.d.ts        # exported type definitions
├── tests/                  # unit tests (node --test)
├── src/                    # TypeScript source
│   ├── index.ts            # bootstrap / lifecycle
│   ├── config.ts           # convar parsing
│   ├── database.ts         # pool, query API, transactions
│   ├── migrations.ts       # migration runner
│   ├── exports.ts          # FiveM export registration
│   ├── commands.ts         # vsql console command
│   ├── logger.ts / server.ts / version.ts / banner.ts
│   ├── lib/                # pure, unit-tested helpers (no FiveM natives)
│   │   ├── params.ts       # placeholder binding
│   │   ├── crud.ts         # safe SQL builders
│   │   ├── profiler.ts / cache.ts / util.ts / retry.ts / ...
│   │   └── breaker.ts / gate.ts / replicas.ts / shape.ts / ...
│   └── fivem.d.ts
└── dist/                   # build output (index.js)
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (pure modules, no DB needed)
npm run build       # bundle to dist/index.js
```

> [!IMPORTANT]
> The tests use Node's built-in runner with native TypeScript type-stripping, so you need **Node 24 or newer** (see `.nvmrc`). They cover the pure modules - parameter binding, query classification, caching - and need no database.

Benchmarks live in [`benchmarks/`](benchmarks/): `node benchmarks/micro.mjs` for the pure hot-path functions (no DB), plus database-backed scripts for throughput, caching, RETURNING, batching, replicas, and pool saturation. See [benchmarks/README.md](benchmarks/README.md).

### Releasing

Push a `v*` tag (`git tag v1.1.0 && git push origin v1.1.0`) and the [release workflow](.github/workflows/release.yml) takes over: typecheck, test, build, and publish a ready-to-drop-in `vSQL-vX.Y.Z.zip` as a GitHub release. That release is also what the in-resource version checker compares against.

## Contributing

Contributions are genuinely welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, coding style, and the pull-request process, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) covers how we treat each other.

## Security

Found a vulnerability? Please don't open a public issue - see [SECURITY.md](SECURITY.md) for how to report it privately.

## License

Released under the [MIT License](LICENSE).
