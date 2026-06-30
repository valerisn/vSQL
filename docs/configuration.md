# Configuration

Everything vSQL reads is a FiveM **convar** set in `server.cfg`. Nothing here is
required beyond the connection itself - every option has a sensible default.

## Connecting

You can point vSQL at the database two ways. A connection string wins if both
are set.

### Connection string

```cfg
# URL form
set vsql_connection_string "mysql://user:password@host:3306/database"

# oxmysql-style key=value form (copy your old string across verbatim)
set vsql_connection_string "host=localhost;user=root;password=;database=fivem"
```

### Discrete options

```cfg
set vsql_host "localhost"
set vsql_port 3306
set vsql_user "root"
set vsql_password ""
set vsql_database "fivem"
# optional: connect over a unix socket / named pipe instead of TCP
set vsql_socket "/var/run/mysqld/mysqld.sock"
```

::: tip
No `vsql_database`? vSQL still starts, but every query must fully-qualify table
names (`schema.table`). It warns about this once on startup.
:::

## Full convar reference

### Connection

| Convar | Default | Description |
|---|---|---|
| `vsql_connection_string` | _(empty)_ | URL (`mysql://...`) or `key=value;...` form. Overrides the discrete options below. |
| `vsql_host` / `vsql_port` | `localhost` / `3306` | Server address. |
| `vsql_user` / `vsql_password` | `root` / _(empty)_ | Credentials. |
| `vsql_database` | _(empty)_ | Default schema. |
| `vsql_socket` | _(empty)_ | Unix socket or named-pipe path (skips TCP). |
| `vsql_server_hint` | `auto` | Force the server type: `auto`, `mysql`, or `mariadb`. |

### Pool

| Convar | Default | Description |
|---|---|---|
| `vsql_pool_size` | `8` | Max pool connections. |
| `vsql_max_idle` | _(pool size)_ | Max idle connections kept open; extras are closed. Set below `vsql_pool_size` to let idle connections drain. |
| `vsql_idle_timeout` | `60000` | Ms an idle connection lingers before being reaped. |
| `vsql_connect_timeout` | `30000` | Connection timeout in ms. |

### Session

| Convar | Default | Description |
|---|---|---|
| `vsql_charset` | `utf8mb4` | Connection charset. |
| `vsql_collation` | `utf8mb4_unicode_ci` | Session collation. |
| `vsql_timezone` | `Z` | mysql2 timezone handling. |
| `vsql_wait_timeout` | `0` | If `> 0`, sets session `wait_timeout` and `interactive_timeout`. |
| `vsql_query_timeout` | `0` | If `> 0`, caps statement runtime (ms) server-side. MariaDB caps all statements; MySQL only caps read-only `SELECT`s. |

### Caching

| Convar | Default | Description |
|---|---|---|
| `vsql_cache` | `false` | Enable the TTL + LRU result cache. |
| `vsql_cache_size` | `500` | Max cached result sets. |
| `vsql_cache_ttl` | `30000` | Cache entry TTL in ms. |

### Reliability & profiling

| Convar | Default | Description |
|---|---|---|
| `vsql_tx_retries` | `2` | Extra attempts for a transaction/batch that hits a deadlock or lock-wait timeout. `0` disables retrying. |
| `vsql_breaker_threshold` | `10` | Consecutive failed reconnects (after the first successful connect) before the circuit breaker opens and queries fast-fail instead of queueing. `0` disables it. |
| `vsql_breaker_reset` | `30000` | Ms the breaker stays open before allowing a probe. |
| `vsql_slow_query_warning` | `150` | Slow-query threshold in ms (logged and surfaced in `vsql top`). |
| `vsql_debug` | `0` | `0` off, `1` lifecycle events, `2` logs every query with timing. |

### Read replicas

| Convar | Default | Description |
|---|---|---|
| `vsql_read_replicas` | _(empty)_ | Comma-separated replica connection strings. Reads round-robin across them; writes, locking reads, and transactions stay on the primary. |
| `vsql_replica_hosts` | _(empty)_ | Comma-separated `host[:port]` replicas reusing the primary's user/password/database (the common "same creds, different host" case). |
| `vsql_replica_cooldown` | `10000` | Ms a replica that failed a query stays out of rotation before being retried. |

```cfg
# reuse the primary's credentials, just point at the replica hosts
set vsql_replica_hosts "10.0.0.2,10.0.0.3:3307"
```

A replica that errors with a connection failure is dropped from rotation for the
cooldown and the read transparently falls back to the primary - a replica being
down never blocks reads or trips the primary's reconnect.

### Migrations

| Convar | Default | Description |
|---|---|---|
| `vsql_migrations` | `true` | Run pending migrations on resource start. |
| `vsql_migrations_dir` | `migrations` | Migrations directory, relative to the resource. |

### Compatibility & casting

| Convar | Default | Description |
|---|---|---|
| `vsql_compat` | `false` | Claim the `oxmysql` / `ghmattimysql` / `mysql-async` export namespaces so existing scripts route into vSQL. Enable **only** with those resources removed. See [Compatibility](/compatibility). |
| `vsql_typecast` | `false` | oxmysql-compatible result casting: dates → epoch ms, `TINYINT(1)` / `BIT(1)` → boolean. Override per call with `{ typeCast: true \| false }`. |

### Updates

| Convar | Default | Description |
|---|---|---|
| `vsql_version_check` | `true` | Check GitHub for a newer release on start. |
| `vsql_version_repo` | `valerisn/vSQL` | `owner/repo` to check against (useful for forks). |

## Per-call options

A few settings can be overridden for a single query by passing an options object
as the last data argument (before any callback):

```js
// skip the result cache for this read even if caching is on globally
await exports.vSQL.single('SELECT money FROM players WHERE id = ?', [id], { cache: false });

// cancel server-side if this report runs longer than 3s
await exports.vSQL.query('SELECT ... big aggregate ...', [], { timeout: 3000 });

// force oxmysql-style casting on (or off) just here
await exports.vSQL.query('SELECT created_at FROM players', [], { typeCast: true });
```

## Recommended starting points

::: code-group

```cfg [Small server]
set vsql_connection_string "mysql://root:pw@localhost:3306/fivem"
set vsql_pool_size 8
```

```cfg [Busy server]
set vsql_connection_string "mysql://root:pw@localhost:3306/fivem"
set vsql_pool_size 16
set vsql_max_idle 4          # let idle connections drain between peaks
set vsql_slow_query_warning 100
set vsql_cache true          # only if your read/write mix benefits - see the warning below
```

```cfg [Debugging]
set vsql_connection_string "mysql://root:pw@localhost:3306/fivem"
set vsql_debug 2             # log every query with timing
set vsql_slow_query_warning 50
```

:::

::: warning
Result caching is **opt-in and global**: any write clears the entire cache to
stay correct. It helps read-heavy workloads with repeated identical reads, and
hurts write-heavy ones. Measure before enabling it in production, and reach for
`cacheClear("table")` for targeted invalidation.
:::
