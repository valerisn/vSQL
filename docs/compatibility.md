# Compatibility

vSQL can stand in for the common FiveM MySQL resources, so your existing scripts
keep running untouched. This page is the practical version; the exhaustive
reference (matched against **oxmysql 2.14.1**) lives in
[COMPATIBILITY.md](https://github.com/valerisn/vSQL/blob/main/COMPATIBILITY.md).

## Turning it on

```cfg
set vsql_compat true
```

::: warning
Enable `vsql_compat` **only with the original resource removed.** Running both
`oxmysql` and vSQL-with-compat makes two resources fight over the same export
namespace.
:::

With it on, vSQL answers the export namespaces of these resources and routes them
into itself:

| Namespace | Exports |
|---|---|
| `oxmysql` | `query`, `single`, `scalar`, `update`, `insert`, `prepare`, `rawExecute`, `transaction`, `store`, `isReady`, `awaitConnection`, `execute`, `fetch` - each as the bare name plus its `_async` and `Sync` variants |
| `ghmattimysql` | `execute`, `scalar`, `transaction`, `store` (+ `Sync` variants) |
| `mysql-async` | `mysql_execute`, `mysql_fetch_all`, `mysql_fetch_scalar`, `mysql_insert`, `mysql_transaction`, `mysql_store` |

A resource calling `exports.oxmysql.execute(...)` or
`exports['mysql-async'].mysql_fetch_all(...)` keeps working with no edits. vSQL
also emits **`onMySQLReady`** on connect (always, even with compat off) - the
signal mysql-async / ESX-legacy scripts wait on.

## Calling convention

The base exports follow oxmysql's shape:

```
(query, parameters?, cb?, invokingResource = GetInvokingResource(), isPromise?)
```

- A function in the `parameters` slot is treated as the callback.
- With a callback you get the result there; without one you get a Promise. The
  `_async` / `Sync` variants always return a Promise.
- The trailing `invokingResource` lets a wrapper resource forward the real caller
  for vSQL's per-resource profiling.

## Migrating a connection string

vSQL reads oxmysql's `key=value;` form directly:

```cfg
# old (oxmysql)
set mysql_connection_string "host=localhost;user=root;password=;database=fivem"
# new (vSQL) - same value
set vsql_connection_string "host=localhost;user=root;password=;database=fivem"
```

## Type-casting

oxmysql casts some columns by default; vSQL returns mysql2's native JS types
unless you opt in:

```cfg
set vsql_typecast true
```

| Column | Cast to |
|---|---|
| `DATETIME` / `TIMESTAMP` / `NEWDATE` | epoch milliseconds |
| `DATE` | epoch milliseconds at local midnight |
| `TINYINT(1)` | boolean |
| `BIT(1)` | boolean |

You can also override it per call with `{ typeCast: true | false }`.

## Intentional differences

- **`startTransaction` is not provided.** It's experimental in oxmysql; use
  [`transaction`](/recipes#transfer-money-atomically-transaction) (array or
  callback form) instead.
- **Result caching is opt-in and globally invalidated.** oxmysql has no caching,
  so this only ever makes reads fresher, never staler.
- **A missing *named* parameter throws.** Missing trailing *positional* params
  pad with `NULL` (matching oxmysql), but an absent `@name` / `:name` is treated
  as a real mistake.
- **Binary columns aren't cast to byte arrays** under `vsql_typecast` - that
  relies on a patch to mysql2 that vSQL deliberately doesn't apply.

## No dependency patches needed

oxmysql ships `.patch` files for `mysql2` and `named-placeholders`. vSQL needs
none of them - it does the important behaviours (`undefined` → `NULL`, `@`/`:`
named params with quote-safety, `IN (?)` expansion) in its own parser, so they
survive `npm install` and driver upgrades with no postinstall patch step. The
[full reference](https://github.com/valerisn/vSQL/blob/main/COMPATIBILITY.md)
walks it patch-by-patch.
