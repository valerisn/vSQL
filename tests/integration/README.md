# Integration tests

These run vSQL's query logic against a **real** MySQL and/or MariaDB server.
They're part of the normal `npm test` run, but **skip cleanly** unless you hand
them a connection DSN - so CI and contributors without a database see them as
skipped, never failed.

## Running

Point one or more env vars at a throwaway database. The suite creates and drops
its own table, but use a scratch schema anyway - never a real one:

```bash
# MySQL only
VSQL_TEST_MYSQL_DSN="mysql://root:pass@127.0.0.1:3306/vsql_test" npm test

# MariaDB only
VSQL_TEST_MARIADB_DSN="mysql://root:pass@127.0.0.1:3307/vsql_test" npm test

# Both engines in one run
VSQL_TEST_MYSQL_DSN="mysql://root:pass@127.0.0.1:3306/vsql_test" \
VSQL_TEST_MARIADB_DSN="mysql://root:pass@127.0.0.1:3307/vsql_test" \
  npm test

# A single generic target
VSQL_TEST_DSN="mysql://root:pass@127.0.0.1:3306/vsql_test" npm test
```

On Windows PowerShell, set the variable first:

```powershell
$env:VSQL_TEST_MARIADB_DSN = "mysql://root:pass@127.0.0.1:3307/vsql_test"; npm test
```

## What they cover

Against a live engine, end to end, they check:

- positional `?`, named `@name` / `:name`, and array -> `IN (...)` expansion from
  `bindParams`, including the empty-list `(NULL)` case;
- the result-shape helpers (`single`, `scalar`, `insert` -> insertId,
  `update` -> affectedRows) against real result sets and OK packets;
- `runAtomic` committing a real transaction and rolling a failed one back.

## What they deliberately leave out

The `Database` singleton leans on FiveM natives (`GetConvar`, `emit`, `on`,
`exports`), so it can't load under `node --test` at all. Its connection lifecycle -
reconnect/backoff, the readiness gate, and write-triggered cache invalidation -
is covered instead by the unit suites (`gate`, `retry`, `util`, `cache`) against
the extracted leaf modules, which need no FiveM runtime.
