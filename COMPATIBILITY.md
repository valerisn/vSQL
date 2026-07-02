# Compatibility with oxmysql / ghmattimysql / mysql-async

vSQL can stand in for the common FiveM MySQL resources so your existing scripts
keep running untouched. Set `vsql_compat true` (with the original resource
removed) and vSQL answers their export namespaces. This is the exhaustive
reference - exactly what's matched, the calling convention, and the deliberate
differences - all measured against **oxmysql 2.14.1** (`src/index.ts`,
`src/compatibility/*`, `patches/*`).

> Enable `vsql_compat` **only with the original resource removed.** Running both
> `oxmysql` and vSQL-with-compat makes two resources fight over the same export
> namespace.

## Export surface

oxmysql exposes every method on its own namespace three ways - the bare name, a
promise-returning `_async`, and a deprecated (but still promise-returning) `Sync`
alias - and answers a subset on the `ghmattimysql` and `mysql-async` namespaces.
vSQL reproduces all of it. The mapping lives as plain data in
[`src/lib/compat-surface.ts`](src/lib/compat-surface.ts) and is pinned to this reference
by `tests/compat-surface.test.ts`, so the two can't drift apart.

| Namespace | Exports |
|---|---|
| `oxmysql` | `query`, `single`, `scalar`, `update`, `insert`, `prepare`, `rawExecute`, `transaction`, `store`, `isReady`, `awaitConnection`, `execute`, `fetch` - each as `name`, `name_async`, and `nameSync` |
| `ghmattimysql` | `execute` (= query), `scalar`, `transaction`, `store` - each plus a `Sync` variant |
| `mysql-async` | `mysql_execute` (= update), `mysql_insert`, `mysql_fetch_all` (= query), `mysql_fetch_scalar` (= scalar), `mysql_transaction`, `mysql_store` |

Notes:

- `execute` and `fetch` are aliases of `query` (text protocol), exactly as in
  oxmysql. `rawExecute` maps to vSQL's `prepare`, so array-of-arrays batches work.
- `store` is a pass-through that returns the query as-is - matching oxmysql, which
  never actually caches the string; resources that call `store()` and pass the
  result back as their query keep working.
- `onMySQLReady` is emitted on connect (always, even with compat off), the signal
  mysql-async / ESX-legacy scripts wait on.

## Calling convention

Base exports follow oxmysql's shape:

```
(query, parameters?, cb?, invokingResource = GetInvokingResource(), isPromise?)
```

- A function in the `parameters` slot is treated as the callback (oxmysql's
  `setCallback` behaviour).
- With a callback, the result is delivered to it; without one, a promise is
  returned. The `_async` / `Sync` variants are `(query, parameters?, invokingResource?)`
  and always return a promise.
- The trailing **`invokingResource`** lets a wrapper resource forward the real
  caller; vSQL uses it (or `GetInvokingResource()`) to attribute the query in its
  per-resource profiler. `isPromise` is an oxmysql-internal flag and is ignored.

## Intentional differences

- **`startTransaction` is not provided.** oxmysql ships it as an *experimental*
  manual commit/rollback handle; vSQL has no equivalent contract. Use
  `transaction` (array or callback form) instead.
- **Result caching is opt-in and globally invalidated.** Any write clears the
  whole cache. oxmysql has no caching at all, so this only ever makes reads
  fresher, never staler. See the README warning.
- **A missing *named* parameter throws.** vSQL pads missing trailing *positional*
  params with `NULL` (matching oxmysql), but a missing `@name` / `:name` is a
  genuine mistake and raises an error rather than binding `NULL` silently.
- **Binary columns are not cast to byte arrays** under `vsql_typecast` (see below).

## Type-casting (`vsql_typecast`)

Off by default - vSQL returns mysql2's native JS types. Set `vsql_typecast true`
(or override per call with `{ typeCast: true | false }`) for oxmysql /
mysql-async-compatible casting:

| Column | Cast to |
|---|---|
| `DATETIME` / `TIMESTAMP` / `NEWDATE` | epoch milliseconds (number) |
| `DATE` | epoch milliseconds at local midnight |
| `TINYINT(1)` | boolean |
| `BIT(1)` | boolean |

**Not reproduced:** oxmysql also returns binary columns as a byte array. That
relies on its patch to mysql2 that exposes `field.charset` to the type-cast
callback. vSQL deliberately does not patch the driver (see below), so binary
columns fall through to mysql2's default (a `Buffer`).

## On oxmysql's dependency patches

oxmysql ships `.patch` files for `mysql2` and `named-placeholders`. vSQL does
**not** patch its dependencies - it does the important behaviours in its own code,
which holds up far better across driver upgrades.

| oxmysql patch | What it does | vSQL equivalent |
|---|---|---|
| `mysql2` - bind `undefined` | Coerces `undefined` bind values to `NULL` instead of throwing | vSQL's param binder coerces `undefined` -> `NULL` at every binding point (`src/lib/params.ts`). |
| `mysql2` - `field.charset` + binary parser | Exposes charset to type-cast and returns binary as a byte array | Not reproduced (see type-casting above); needs a driver patch. |
| `named-placeholders` - `@`/`:` names, quote-safety, missing -> null | Adds `@name` support, ignores placeholders inside quotes, binds missing named params to null | vSQL has its own placeholder parser (`src/lib/params.ts`) that already supports `?`, `@name`, `:name`, skips string/identifier literals and comments, and expands arrays into `IN (...)` lists. The one difference: a missing named param throws (see above). |

Because these behaviours live in vSQL's own parser instead of in patched
`node_modules`, they survive `npm install` and mysql2 version bumps with no
postinstall patch step to babysit.
