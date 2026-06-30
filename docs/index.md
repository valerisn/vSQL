---
layout: home

hero:
  name: vSQL
  text: MySQL / MariaDB for FiveM
  tagline: A modern, high-performance database resource — connection pool, caching, migrations, profiler, and first-class MariaDB tuning.
  image:
    src: /logo.svg
    alt: vSQL
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Recipes
      link: /recipes
    - theme: alt
      text: GitHub
      link: https://github.com/valerisn/vSQL

features:
  - title: Two API styles
    details: Every export works with a trailing callback or returns a Promise — use whichever fits.
  - title: Safe parameters
    details: "? positional and @name / :name named params, with automatic IN (?) expansion. Always bound, never interpolated."
  - title: Caching
    details: Prepared-statement caching plus an optional TTL + LRU result cache with targeted invalidation.
  - title: Migrations
    details: Checksum-validated, lock-protected, dry-run capable, with up / down support — built in.
  - title: Profiler
    details: Latency percentiles, a slow-query log, and pg_stat_statements-style query-shape ranking via vsql top.
  - title: MariaDB aware
    details: utf8mb4 defaults, session + statement timeouts, and RETURNING detection with graceful MySQL fallback.
---
