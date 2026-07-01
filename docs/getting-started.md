# Getting started

The short path to a working install. If you want the full walkthrough -
prerequisites, prebuilt vs source, troubleshooting - head to
[Installation](/installation); for every knob, see [Configuration](/configuration).

## 1. Add the resource

Drop a [release zip](https://github.com/valerisn/vSQL/releases) into `resources/`
as `vSQL`, or build it from source:

```bash
cd resources
git clone https://github.com/valerisn/vSQL
cd vSQL && npm install && npm run build
```

::: tip
`dist/` is generated, not committed. Build it once after cloning - or grab a
prebuilt release zip that already has it.
:::

## 2. Configure and start

```cfg
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"
ensure vSQL
```

Keep `ensure vSQL` **above** anything that queries the database.

## 3. Your first query

From **JavaScript**, call the exports directly - Promise or callback, your choice:

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

That's it - you're querying. From here, pick whatever's next.

## Where to go from here

<div class="vp-doc">

- **[Recipes](/recipes)** - ready-made answers for inserts, transactions,
  pagination, upserts, and the rest of the everyday stuff.
- **[Architecture](/architecture)** - how a query flows through vSQL and what
  each module owns.
- **[Configuration](/configuration)** - the full convar reference and per-call
  options.
- **[Compatibility](/compatibility)** - drop-in mode for oxmysql / ghmattimysql /
  mysql-async.

</div>

## Console commands

vSQL registers one `vsql` command with a handful of subcommands:

```
vsql              # profiler stats (queries, latency percentiles, busiest resources)
vsql top          # heaviest query shapes by total time
vsql resources    # per-resource query breakdown
vsql debug        # full diagnostics dump (password-redacted)
vsql cache clear  # empty the result cache
vsql migrate      # apply pending migrations (also :status, :rollback, :dry)
```
