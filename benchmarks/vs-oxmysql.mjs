// Side-by-side microbenchmark: vSQL's parameter binder vs oxmysql's.
//
//   node benchmarks/vs-oxmysql.mjs
//
// Both resources wrap mysql2, so once a query reaches the driver the cost is
// identical - the meaningful pure-JS difference is the per-call parameter
// parsing that runs on every single query. This pits vSQL's bindParams
// (src/lib/params.ts) against a faithful reproduction of oxmysql 2.14.1's
// parseArguments (src/utils/parseArguments.ts, transcribed below with its NULL
// padding and `?`-count logic intact).
//
// oxmysql delegates @name/:name conversion to a *patched* `named-placeholders`
// (require('named-placeholders')()). That package isn't a vSQL dependency, so
// the named-parameter row only runs when it's resolvable - e.g. run this script
// from inside the cloned oxmysql repo after its install, and it picks up the
// real (patched) converter. Otherwise the named row is skipped with a note. The
// positional and IN-list rows always run.
//
// Requires Node 24+ (native TypeScript type stripping, same as the test suite).

import { createRequire } from 'node:module';
import { bindParams } from '../src/lib/params.ts';

const require = createRequire(import.meta.url);

// oxmysql uses require('named-placeholders')() for @/: conversion. Pick it up if
// it's installed in the resolution path; otherwise the named row is skipped.
let convertNamedPlaceholders = null;
let namedPlaceholdersSource = 'unavailable (named row skipped)';
try {
  convertNamedPlaceholders = require('named-placeholders')();
  // This usually resolves to mysql2's own copy. oxmysql ships a *patched* build
  // that adds @-syntax and quote-safety; for the :name syntax used here the
  // behaviour is identical, so the comparison is fair. Run from inside the
  // installed oxmysql repo to exercise its exact patched converter.
  const pkg = require('named-placeholders/package.json');
  namedPlaceholdersSource = `named-placeholders@${pkg.version} (oxmysql ships a patched build of the same)`;
} catch {
  /* not installed here - named row will be skipped */
}

// --- oxmysql 2.14.1 parseArguments, transcribed faithfully -----------------
// Source: oxmysql/src/utils/parseArguments.ts. Only the type annotations are
// dropped; the control flow, the `\?(?!\?)` placeholder count, the
// object->positional mapping, and the NULL padding are unchanged.
function oxmysqlParseArguments(query, parameters) {
  if (typeof query !== 'string') throw new Error(`Expected query to be a string but received ${typeof query} instead.`);

  if (convertNamedPlaceholders && parameters && typeof parameters === 'object' && !Array.isArray(parameters))
    if (query.includes(':') || query.includes('@')) {
      [query, parameters] = convertNamedPlaceholders(query, parameters);
    }

  if (!parameters || typeof parameters === 'function') parameters = [];

  const placeholders = query.match(/\?(?!\?)/g)?.length ?? 0;

  if (parameters && !Array.isArray(parameters)) {
    const arr = [];
    for (let i = 0; i < placeholders; i++) arr[i] = parameters[i + 1] ?? null;
    parameters = arr;
  } else {
    if (placeholders) {
      const diff = placeholders - parameters.length;
      if (diff > 0) parameters = [...parameters, ...new Array(diff).fill(null)];
      else if (diff < 0) throw new Error(`Expected ${placeholders} parameters, but received ${parameters.length}.`);
    }
  }

  return [query, parameters];
}

// --- harness ---------------------------------------------------------------
function opsPerSec(fn, iterations = 1_000_000) {
  for (let i = 0; i < 10_000; i++) fn(i); // warm the JIT
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(i);
  const ms = performance.now() - start;
  return (iterations / ms) * 1000;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function row(label, vsqlFn, oxFn) {
  const vsql = opsPerSec(vsqlFn);
  if (!oxFn) {
    console.log(`  ${label.padEnd(28)} ${(fmt(vsql) + ' ops/s').padStart(20)} ${''.padStart(20)}  ${'(vSQL only)'}`);
    return;
  }
  const ox = opsPerSec(oxFn);
  const ratio = vsql / ox;
  const faster = ratio >= 1 ? `vSQL ${ratio.toFixed(2)}x` : `ox ${(1 / ratio).toFixed(2)}x`;
  console.log(
    `  ${label.padEnd(28)} ${(fmt(vsql) + ' ops/s').padStart(20)} ${(fmt(ox) + ' ops/s').padStart(20)}  ${faster}`
  );
}

console.log('\nvSQL vs oxmysql - parameter binding (pure functions, no DB)\n');
console.log(`  named-param converter: ${namedPlaceholdersSource}\n`);
console.log(`  ${'operation'.padEnd(28)} ${'vSQL'.padStart(20)} ${'oxmysql'.padStart(20)}  winner`);
console.log(`  ${'-'.repeat(28)} ${'-'.repeat(20)} ${'-'.repeat(20)}  ${'-'.repeat(10)}`);

// Positional: the dominant case in ESX/QBCore code. Apples to apples.
row(
  'positional (2 params)',
  () => bindParams('SELECT * FROM players WHERE money > ? AND job = ?', [1000, 'police']),
  () => oxmysqlParseArguments('SELECT * FROM players WHERE money > ? AND job = ?', [1000, 'police'])
);

// Missing-trailing-param padding: both pad to NULL.
row(
  'positional + NULL pad',
  () => bindParams('INSERT INTO t (a, b, c) VALUES (?, ?, ?)', [1]),
  () => oxmysqlParseArguments('INSERT INTO t (a, b, c) VALUES (?, ?, ?)', [1])
);

// Named params: only runs when a named-placeholders converter is resolvable.
if (convertNamedPlaceholders) {
  row(
    'named (:id, :active)',
    () => bindParams('SELECT * FROM players WHERE citizenid = :id AND active = :active', { id: 'ABC123', active: 1 }),
    () => oxmysqlParseArguments('SELECT * FROM players WHERE citizenid = :id AND active = :active', { id: 'ABC123', active: 1 })
  );
} else {
  console.log(`  ${'named (:id, :active)'.padEnd(28)} ${'-'.padStart(20)} ${'-'.padStart(20)}  (named-placeholders not installed)`);
}

// IN-list expansion: a vSQL parser feature. oxmysql leaves `IN ?` for mysql2's
// text-protocol array expansion at the driver, so there's no comparable parse
// -layer cost - it's listed as vSQL-only rather than a mismatched race.
row(
  'IN-list expansion',
  () => bindParams('SELECT * FROM vehicles WHERE plate IN ?', [['AAA111', 'BBB222', 'CCC333', 'DDD444']]),
  null
);

console.log('\n  Note: both wrap mysql2, so end-to-end query latency is dominated by the');
console.log('  network round-trip; this measures only the per-call binding overhead.\n');
