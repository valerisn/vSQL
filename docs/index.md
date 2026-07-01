---
layout: home

hero:
  name: vSQL
  text: MySQL / MariaDB for FiveM
  tagline: The database resource I wanted for my own servers - a real connection pool, result caching, migrations, a live profiler, deadlock-safe transactions, and MariaDB tuning that uses the features MariaDB gives you. A drop-in successor to oxmysql.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Install
      link: /installation
    - theme: alt
      text: Recipes
      link: /recipes
    - theme: alt
      text: GitHub
      link: https://github.com/valerisn/vSQL

features:
  - title: Two API styles
    details: Every export takes a callback or returns a Promise - use whichever reads better at the call site. From JS you don't need a wrapper at all.
  - title: Parameters that stay safe
    details: "Positional ? and named @name / :name, with automatic IN (?) expansion. Always bound by the driver, never interpolated - injection-safe by construction."
  - title: Caching where it helps
    details: Prepared-statement caching plus an optional TTL + LRU result cache. Writes invalidate it for you; clear targeted entries with cacheClear(pattern).
  - title: Migrations built in
    details: Checksum-validated, lock-protected, dry-run capable, with up / down support - found and applied on start, or driven from the vsql console command.
  - title: A profiler you'll check
    details: Latency percentiles, a slow-query log, per-resource attribution, and pg_stat_statements-style query-shape ranking via vsql top.
  - title: MariaDB-aware
    details: utf8mb4 defaults, session + statement timeouts, and RETURNING detection with a clean MySQL fallback. The server type is auto-detected on connect.
  - title: Resilient by default
    details: Auto-reconnect with backoff; queries made during startup or a reconnect wait on whenReady() instead of failing. Transactions retry on deadlock.
  - title: Drop-in compatible
    details: Flip vsql_compat to claim the oxmysql / ghmattimysql / mysql-async export namespaces, and existing scripts route into vSQL with no edits.
  - title: Fast where it counts
    details: A memoised per-query binding plan makes parameter binding ~9x faster than oxmysql on reused queries - which is the common case in a running server.
---
