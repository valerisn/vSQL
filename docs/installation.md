# Installation

This page is the full, step-by-step setup. If you just want the three-line
version, see [Getting started](/getting-started).

## Prerequisites

| You need | Why |
|---|---|
| **FXServer** build 7290 or newer | vSQL targets the modern server scripting runtime. |
| **MySQL 5.7+** or **MariaDB 10.4+** | The database itself. MariaDB 10.5+ additionally unlocks `RETURNING`. |
| **Node.js 18+** | Only to *build* the resource from source. Not needed if you use a prebuilt release zip. |

You do **not** need Node.js on the production server if you deploy a prebuilt
zip - FXServer runs the bundled `dist/index.js` directly.

## Step 1 - Get the resource

Choose one:

### Option A - Prebuilt release (recommended)

1. Download the latest `vSQL.zip` from the [releases page](https://github.com/valerisn/vSQL/releases).
2. Extract it into your server's `resources/` folder.
3. Rename the folder to **`vSQL`** if it isn't already.

The release ships with `dist/` already built, so there's nothing to compile.

### Option B - Build from source

```bash
cd resources
git clone https://github.com/valerisn/vSQL
cd vSQL
npm install
npm run build      # bundles src/ into dist/index.js + type declarations
```

> `dist/` is generated, not committed. If you cloned the repo you **must** run
> `npm run build` once before starting the server, or FXServer will fail to find
> `dist/index.js`.

## Step 2 - Configure the connection

Add the connection settings to your `server.cfg`. Use **either** a single
connection string **or** discrete options - see [Configuration](/configuration)
for every convar.

```cfg
# Option A: one connection string (URL or oxmysql-style key=value;)
set vsql_connection_string "mysql://root:password@localhost:3306/fivem"

# Option B: discrete options
set vsql_host "localhost"
set vsql_port 3306
set vsql_user "root"
set vsql_password ""
set vsql_database "fivem"
```

## Step 3 - Start it before its dependents

```cfg
ensure vSQL
ensure my_other_resource   # anything that queries the DB comes after
```

`ensure vSQL` must appear **before** any resource that calls it. Queries made
before the pool is up don't fail - they queue on [`whenReady()`](/architecture#design-choices)
and resolve once connected - but ordering still keeps your startup logs clean.

## Step 4 - Verify

Start the server and watch the console. On success vSQL prints a status box with
the detected server and version:

```
vsql              # print profiler stats / confirm it's up
vsql debug        # full (password-redacted) diagnostics dump
```

If the pool can't connect, vSQL logs the attempt, an actionable hint (wrong
host, access denied, unknown database, ...), and retries with backoff - it won't
crash the server.

## Using vSQL from another resource

### From Lua

Declare the dependency and load the `MySQL` wrapper in the consumer resource's
`fxmanifest.lua`:

```lua
dependency 'vSQL'
shared_script '@vSQL/lib/MySQL.lua'
```

```lua
local players = MySQL.query.await('SELECT * FROM players WHERE money > ?', { 1000 })
```

### From JavaScript / TypeScript

No wrapper needed - call the exports directly:

```js
const players = await exports.vSQL.query('SELECT * FROM players WHERE money > ?', [1000]);
```

TypeScript users can pull in the published types for autocomplete:

```ts
import type { VSql } from '@vSQL/types';
const db = exports.vSQL as unknown as VSql;
```

## Updating

- **Prebuilt:** replace the folder with the new release zip.
- **From source:** `git pull && npm install && npm run build`, then restart the
  resource.

vSQL checks GitHub for a newer release on startup (disable with
`set vsql_version_check false`).

## Migrating from oxmysql

vSQL accepts oxmysql's `mysql_connection_string` format and exports the same
methods, so most servers swap the resource and rename the connection convar. For
a zero-edit transition, enable [compatibility mode](/compatibility) and keep
your existing `exports.oxmysql.*` call sites. Remove the old resource first so
two resources don't fight over the same export namespace.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Could not find dist/index.js` | Built from source but skipped `npm run build`. |
| `connection refused` on start | Wrong `vsql_host` / `vsql_port`, or the DB isn't running. |
| `access denied` | Wrong `vsql_user` / `vsql_password`. |
| `Unknown database` | `vsql_database` doesn't exist yet - create the schema first. |
| Another resource errors with "oxmysql not found" | Enable `vsql_compat` (see [Compatibility](/compatibility)). |

Still stuck? `vsql debug` prints everything (redacted) needed for a bug report.
