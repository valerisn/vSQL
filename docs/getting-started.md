# Getting started

The fast path to a working install. For the full walkthrough - prerequisites,
prebuilt vs source, troubleshooting - see [Installation](/installation); for
every setting, see [Configuration](/configuration).

## 1. Add the resource

Drop a [release zip](https://github.com/valerisn/vSQL/releases) into `resources/`
as `vSQL`, or build from source:

```bash
cd resources
git clone https://github.com/valerisn/vSQL
cd vSQL && npm install && npm run build
```

::: tip
`dist/` is generated, not committed. Build once after cloning, or use a prebuilt
release zip that already includes it.
:::

## 2. Configure & start

```cfg
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"
ensure vSQL
```

Put `ensure vSQL` **before** any resource that queries the database.

## 3. First query

From **JavaScript**, call the exports directly - Promise or callback:

```js
// Promise
const players = await exports.vSQL.query('SELECT * FROM players WHERE money > ?', [1000]);

// Callback
exports.vSQL.single('SELECT * FROM players WHERE id = ?', [1], (row) => {
  print(row?.name);
});
```

From **Lua**, load the wrapper in your `fxmanifest.lua` first:

```lua
dependency 'vSQL'
shared_script '@vSQL/lib/MySQL.lua'
```

```lua
local row = MySQL.single.await('SELECT * FROM players WHERE id = ?', { 1 })
print(row and row.name)
```

## Where to next

<div class="vp-doc">

- **[Recipes](/recipes)** - copy-paste solutions for inserts, transactions,
  pagination, upserts, and more.
- **[Architecture](/architecture)** - how a query flows through vSQL and what
  each module owns.
- **[Configuration](/configuration)** - the full convar reference and per-call
  options.
- **[Compatibility](/compatibility)** - drop-in mode for oxmysql / ghmattimysql /
  mysql-async.

</div>

## Console commands

vSQL registers a single `vsql` command with subcommands:

```
vsql              # profiler stats (queries, latency percentiles, busiest resources)
vsql top          # heaviest query shapes by total time
vsql resources    # per-resource query breakdown
vsql debug        # full diagnostics dump (password-redacted)
vsql cache clear  # empty the result cache
vsql migrate      # apply pending migrations (also :status, :rollback, :dry)
```
