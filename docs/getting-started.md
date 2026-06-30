# Getting started

## Install

Drop the resource into your server's `resources/` folder as `vSQL`, then build it:

```bash
cd vSQL
npm install
npm run build      # bundles src into dist/index.js plus type declarations
```

> The build output (`dist/`) is generated, not committed - build before first use, or grab a prebuilt zip from the [releases](https://github.com/valerisn/vSQL/releases).

## Configure

Set the connection in `server.cfg`, using **either** a connection string **or** discrete options:

```cfg
# Option A: connection string (URL or oxmysql-style semicolons)
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"

# Option B: discrete options
set vsql_host "localhost"
set vsql_port 3306
set vsql_user "root"
set vsql_password ""
set vsql_database "fivem"

ensure vSQL
```

Add `ensure vSQL` **before** any resource that depends on it. The full convar
reference lives in the [README](https://github.com/valerisn/vSQL#configuration).

## First query

In a consumer resource, declare the dependency and (for Lua) load the wrapper:

```lua
-- fxmanifest.lua
dependency 'vSQL'
shared_script '@vSQL/lib/MySQL.lua'
```

Then query - Promise or callback, your choice:

```js
// Promise
const players = await exports.vSQL.query('SELECT * FROM players WHERE money > ?', [1000]);

// Callback
exports.vSQL.single('SELECT * FROM players WHERE id = ?', [1], (row) => {
  print(row?.name);
});
```

From here, the [Recipes](/recipes) page has copy-paste solutions for the common
tasks, and [Architecture](/architecture) explains how a query flows through vSQL.

## Console commands

```
vsql              # profiler stats
vsql top          # heaviest query shapes by total time
vsql debug        # diagnostics dump (redacted)
vsql migrate      # apply pending migrations
```
