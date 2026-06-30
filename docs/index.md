---
layout: home

hero:
  name: vSQL
  text: MySQL / MariaDB for FiveM
  tagline: A modern, high-performance database resource - connection pooling, result caching, migrations, a built-in profiler, deadlock-safe transactions, and first-class MariaDB tuning. A drop-in successor to oxmysql.
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
    details: Every export works with a trailing callback or returns a Promise - use whichever fits the call site. No wrapper required from JS.
  - title: Safe parameters
    details: "Positional ? and named @name / :name, with automatic IN (?) expansion. Always bound by the driver, never interpolated - injection-safe by construction."
  - title: Result caching
    details: Prepared-statement caching plus an optional TTL + LRU result cache. Writes invalidate it automatically; clear targeted entries with cacheClear(pattern).
  - title: Migrations
    details: Checksum-validated, lock-protected, dry-run capable, with up / down support - discovered and applied on start, or driven from the vsql console command.
  - title: Profiler
    details: Latency percentiles, a slow-query log, per-resource attribution, and pg_stat_statements-style query-shape ranking via vsql top.
  - title: MariaDB aware
    details: utf8mb4 defaults, session + statement timeouts, and RETURNING detection with a graceful MySQL fallback. Auto-detects the server on connect.
  - title: Resilient
    details: Auto-reconnect with backoff; queries issued during startup or a reconnect queue on whenReady() instead of failing. Transactions auto-retry on deadlock.
  - title: Drop-in compatible
    details: Set vsql_compat to claim the oxmysql / ghmattimysql / mysql-async export namespaces, so existing scripts route into vSQL with no edits.
  - title: Fast by default
    details: A memoised per-query binding plan makes parameter binding ~9x faster than oxmysql on reused queries - the common case in a running server.
---
