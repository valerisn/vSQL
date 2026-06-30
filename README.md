<div align="center">

# vSQL

**A modern, high performance MySQL / MariaDB resource for FiveM.**

An advanced successor to oxmysql, built on [mysql2](https://github.com/sidorares/node-mysql2).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/valerisn/vSQL/actions/workflows/ci.yml/badge.svg)](https://github.com/valerisn/vSQL/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FiveM](https://img.shields.io/badge/FiveM-resource-F40552)](https://fivem.net/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

vSQL gives you a configurable connection pool, prepared statement and result caching, batched inserts, a built in migration runner, a query profiler, and first class MariaDB tuning. Export names mirror oxmysql where it makes sense, so migrating is mostly a find and replace.

<div align="center">

<img src="assets/terminal.svg" alt="vSQL console: startup banner, connection status, and vsql top profiler output" width="640">

</div>

## Documentation

- [Getting started](docs/getting-started.md) - install, configure, first query.
- [Recipes / cookbook](docs/recipes.md) - copy-paste solutions for common tasks.
- [Architecture](docs/architecture.md) - how a query flows through vSQL, with a diagram.

> These render right here on GitHub. They're also a [VitePress](https://vitepress.dev) site (`npm run docs:dev`) that can be published to GitHub Pages (workflow included) or any static host - see [docs/README.md](docs/README.md).

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Exports](#exports)
- [Events](#events)
- [Migrations](#migrations)
- [Console commands](#console-commands)
- [Migrating from oxmysql](#migrating-from-oxmysql)
- [MariaDB tuning](#mariadb-tuning)
- [Project layout](#project-layout)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

| | |
|---|---|
| **Connection pool** | Automatic reconnection with exponential backoff and jitter, at startup and after a mid session connection loss. A `health` export reports live status. |
| **Two API styles** | Every export works with a trailing callback or returns a Promise. |
| **Safe parameters** | `?` positional and `@name` / `:name` named parameters, plus automatic `IN (?)` array expansion. Always bound, never string interpolated. |
| **Caching** | Prepared statement caching (mysql2 per connection LRU) and optional result caching (TTL plus LRU) with explicit invalidation. |
| **Bulk writes** | Batched inserts and slow query logging. |
| **MariaDB aware** | utf8mb4 defaults, session timeouts, and `RETURNING` capability detection, with graceful MySQL fallback. |
| **Migrations** | Checksum validated, lock protected, dry run capable, with up and down support. |
| **Profiler** | Query count, error count, average and p50 / p95 / p99 latency, and recent slow queries. |
| **TypeScript** | Compiled with esbuild, full `.d.ts` shipped for consumers. |

## Requirements

- FXServer (`server` build 7290 or newer).
- A MySQL 5.7+ or MariaDB 10.4+ database.
- Node.js (only to build the resource, not at runtime). See [Development](#development) for the version used by tests.

## Installation

> [!IMPORTANT]
> Add `ensure vSQL` to your `server.cfg` **before** any resource that depends on it.

**1.** Drop this resource into your server's `resources/` folder as `vSQL`.

**2.** Build it:

```bash
cd vSQL
npm install
npm run build      # bundles src into dist/index.js plus type declarations
```

> [!NOTE]
> The build output (`dist/`) is generated, not committed. Run the build above before adding `ensure vSQL`, and again after editing anything in `src/`.

**3.** Configure the connection in `server.cfg` (see [Configuration](#configuration)) and add:

```cfg
ensure vSQL
```

**4.** In each resource that uses the database, declare a dependency and, for Lua, load the wrapper:

```lua
-- consumer fxmanifest.lua
dependency 'vSQL'
shared_script '@vSQL/lib/MySQL.lua'   -- only needed for the Lua MySQL.* global
```

## Configuration

Set these convars in `server.cfg`. Use **either** a connection string **or** the discrete options.

```cfg
# Option A: connection string (URL or oxmysql style semicolons)
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
| `vsql_charset` | `utf8mb4` | Connection charset. |
| `vsql_collation` | `utf8mb4_unicode_ci` | Session collation. |
| `vsql_timezone` | `Z` | mysql2 timezone handling. |
| `vsql_wait_timeout` | `0` | If greater than 0, sets session `wait_timeout` and `interactive_timeout`. |
| `vsql_query_timeout` | `0` | If greater than 0, caps statement runtime (ms) server-side. MariaDB caps all statements; MySQL only caps read-only `SELECT`s. |
| `vsql_server_hint` | `auto` | Force server type: `auto`, `mysql`, or `mariadb`. |
| `vsql_slow_query_warning` | `150` | Slow query threshold in ms. |
| `vsql_tx_retries` | `2` | Extra attempts for a transaction/batch that hits a deadlock or lock-wait timeout. `0` disables retrying. |
| `vsql_cache` | `false` | Enable result caching. |
| `vsql_cache_size` | `500` | Max cached result sets. |
| `vsql_cache_ttl` | `30000` | Cache entry TTL in ms. |
| `vsql_migrations` | `true` | Run migrations on resource start. |
| `vsql_migrations_dir` | `migrations` | Migrations directory, relative to the resource. |
| `vsql_version_check` | `true` | Check GitHub for a newer release on start. |
| `vsql_version_repo` | `valerisn/vSQL` | `owner/repo` to check against (for forks). |
| `vsql_debug` | `0` | `0` off, `1` lifecycle, `2` logs every query with timing. |

</details>

> [!WARNING]
> **Result caching is opt in and global.** Any write (`insert`, `update`, a non `SELECT` `query`, `transaction`, or `batch`) clears the **entire** cache to stay correct. Use `cacheClear("table_name")` for targeted invalidation, and avoid enabling the cache for write heavy workloads.

> [!TIP]
> Locking reads (`SELECT ... FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`) are never cached, so their row locks always reach the server.

## Usage

Every export accepts a trailing callback or returns a Promise.

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

// named (@name or :name, interchangeable)
await exports.vSQL.single('SELECT * FROM players WHERE citizenid = @id', { id: 'ABC123' });

// IN (?), arrays expand automatically
await exports.vSQL.query('SELECT * FROM vehicles WHERE plate IN ?', [['AAA111', 'BBB222']]);
```

> [!CAUTION]
> Pass values through parameters, never by string concatenation. vSQL binds every value, which keeps your queries safe from SQL injection.

### Per-call options

Read/write methods take an optional `{ timeout, cache }` object as a third argument.

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

// Callback form (everything commits, or rolls back on throw)
await exports.vSQL.transaction(async (tx) => {
  const from = await tx.single('SELECT balance FROM accounts WHERE id = ?', [1]);
  if (from.balance < 100) throw new Error('insufficient funds');
  await tx.update('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
  await tx.update('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
});
```

> [!NOTE]
> Transactions and `batch` automatically retry on a deadlock or lock-wait timeout (`vsql_tx_retries`, default `2`), since those just need replaying. The unit is rolled back before each retry, so this is safe for the database - but a callback-form transaction with side effects **outside** the database (HTTP calls, events) will see those repeated. Keep such side effects out of the transaction body, or set `vsql_tx_retries 0`.

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
| `getStats` | `()` | Stats `{ count, errors, cacheHits, avgMs, p50, p95, p99, slow[], cacheEnabled, cacheSize, uptimeMs }`. |
| `topQueries` | `(limit?)` | Heaviest query *shapes* by total time `{ shape, count, totalMs, avgMs, maxMs }[]`. |
| `serverInfo` | `()` | `{ type, version, major, minor, supportsReturning }`. |
| `health` | `()` | `{ connected, reconnecting, server }`, live connection status. |
| `isReady` | `()` | `boolean`, whether the pool is connected. |
| `ready` | `(cb?)` | Resolves once the pool is connected. |

**Lua aliases** (via `@vSQL/lib/MySQL.lua`): `MySQL.query`, `.execute`, `.single`, `.scalar`, `.insert`, `.update`, `.prepare`, `.batch`, `.transaction`, each with a `.await` form, plus legacy `MySQL.Sync.*` and `MySQL.Async.*`.

### Events

vSQL emits server events so dependent resources can react to connection state without polling `isReady()`.

| Event | Payload | When |
|---|---|---|
| `vSQL:ready` | `ServerInfo` | The pool connects for the first time. |
| `vSQL:reconnected` | `ServerInfo` | The pool reconnects after a mid-session loss. |
| `vSQL:connectionLost` | `{ code, message }` | A fatal connection error is detected (reconnect begins). |

```lua
AddEventHandler('vSQL:ready', function(server)
  print(('database up: %s %s'):format(server.type, server.version))
end)
```

## Migrations

Migrations live in `/migrations` and run automatically on resource start (disable with `set vsql_migrations false`). Applied migrations are tracked in a `vsql_migrations` table (`version`, `name`, `checksum`, `applied_at`).

- **Ordering:** files run in natural filename order (`001_...`, `002_...`).
- **Naming:** `001_create_players.sql` becomes version `001`, name `create_players`. An optional `001_create_players.down.sql` enables rollback.
- **JS migrations:** `003_seed_admin.js` exporting `up(conn)` and optionally `down`.
- **Checksum validation:** editing an already applied file is detected and aborts the run. Create a new migration instead.
- **Concurrency safe:** a `GET_LOCK` advisory lock means two servers booting at once will not double apply.
- **Idempotent:** safe to run repeatedly.

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

## Migrating from oxmysql

- **Convars:** rename `mysql_connection_string` to `vsql_connection_string` (the `key=value;...` form is parsed as is), or use the discrete `vsql_*` options.
- **Lua:** oxmysql exposes a `MySQL` global, and so does vSQL via `shared_script '@vSQL/lib/MySQL.lua'`. The common methods (`query`, `single`, `scalar`, `insert`, `update`, `prepare`, `transaction`) and their `.await` forms line up.
- **JS:** replace `exports.oxmysql.<fn>` with `exports.vSQL.<fn>`. Result shapes match: reads return rows, `insert` returns `insertId`, `update` returns `affectedRows`.
- **Differences to know:** result caching is opt in and global invalidating (see the warning above), slow query and debug logging are controlled by `vsql_slow_query_warning` and `vsql_debug`, and vSQL ships its own migration runner.

## MariaDB tuning

At startup vSQL runs `SELECT VERSION()`, detects MySQL vs MariaDB (overridable via `vsql_server_hint`), and:

- sets `utf8mb4` charset and collation per connection,
- optionally applies session `wait_timeout` and `interactive_timeout` (`vsql_wait_timeout`),
- detects `RETURNING` support (MariaDB 10.5+) and exposes it via `serverInfo().supportsReturning`, so you can skip an extra round trip:

```sql
-- MariaDB 10.5+: get the inserted row back in one statement
INSERT INTO players (citizenid, name) VALUES (?, ?) RETURNING citizenid, created_at;
```

> [!NOTE]
> On MySQL, `RETURNING` is reported as unsupported and the standard `insertId` / `affectedRows` behavior applies.

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
│   ├── params.ts           # placeholder binding
│   ├── migrations.ts       # migration runner
│   ├── exports.ts          # FiveM export registration
│   ├── commands.ts         # vsql console command
│   ├── profiler.ts / cache.ts / logger.ts / server.ts / util.ts
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
> Tests use Node's built in test runner with native TypeScript type stripping, so **Node 24 or newer** is required (see `.nvmrc`). They cover the pure modules (parameter binding, query classification, caching) and need no database.

Benchmarks live in [`benchmarks/`](benchmarks/): `node benchmarks/micro.mjs` for the pure hot-path functions (no DB), and a database-backed throughput script. See [benchmarks/README.md](benchmarks/README.md).

### Releasing

Pushing a `v*` tag (`git tag v1.1.0 && git push origin v1.1.0`) runs the [release workflow](.github/workflows/release.yml): it typechecks, tests, builds, and publishes a ready-to-drop-in `vSQL-vX.Y.Z.zip` as a GitHub release. That release is also what the in-resource version checker compares against.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, coding style, and pull request process, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before taking part.

## Security

Found a vulnerability? Please do not open a public issue. See [SECURITY.md](SECURITY.md) for how to report it privately.

## License

Released under the [MIT License](LICENSE).
