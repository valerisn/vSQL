# Recipes

The stuff you'll actually reach for, ready to copy. Examples use the JS Promise
API (`exports.vSQL.*`); the Lua `MySQL.*` wrapper mirrors every method - append
`.await` inside a thread, or pass a callback as the last argument.

::: danger Always parameterise
Every value goes in as a bound `?` / `@name` parameter. **Never** paste user
input into a query string - that's exactly how SQL injection happens, and vSQL's
parameters mean you never have to.
:::

## Reading

### One row, one value, or a list

```js
const player  = await exports.vSQL.single('SELECT * FROM players WHERE id = ?', [id]);   // row or null
const balance = await exports.vSQL.scalar('SELECT money FROM players WHERE id = ?', [id]); // value or null
const all     = await exports.vSQL.query('SELECT * FROM players WHERE job = ?', ['police']); // rows[]
```

| Method | Returns |
|---|---|
| `single` | the first row, or `null` |
| `scalar` | the first column of the first row, or `null` |
| `query` | an array of rows |

### `IN (...)` with an array

```js
// the array expands to (?, ?, ?) automatically - one binding per element
const rows = await exports.vSQL.query('SELECT * FROM vehicles WHERE plate IN ?', [[a, b, c]]);
```

### Named parameters

```js
await exports.vSQL.single(
  'SELECT * FROM players WHERE citizenid = @id AND job = :job',
  { id: citizenid, job: 'police' }
);
```

Both `@name` and `:name` work, and you can mix them. Pass the values as an object.

### Pagination

```js
const page = 2, perPage = 20;
const rows = await exports.vSQL.query(
  'SELECT * FROM players ORDER BY id LIMIT ? OFFSET ?',
  [perPage, (page - 1) * perPage]
);
```

## Writing

### Insert and get the new id

```js
const id = await exports.vSQL.insert(
  'INSERT INTO players (citizenid, name) VALUES (?, ?)',
  [citizenid, name]
);
```

::: tip MariaDB 10.5+
You can return columns in a single round-trip - check
`exports.vSQL.serverInfo().supportsReturning`:

```js
const [row] = await exports.vSQL.query(
  'INSERT INTO players (citizenid, name) VALUES (?, ?) RETURNING id, created_at',
  [citizenid, name]
);
```
:::

### Update / delete (affected rows)

```js
const changed = await exports.vSQL.update('UPDATE players SET money = money - ? WHERE id = ?', [50, id]);
const removed = await exports.vSQL.update('DELETE FROM inventory WHERE id = ?', [itemId]); // update() covers DELETE
```

`update` returns the affected-row count and works for both `UPDATE` and `DELETE`.

### Upsert (insert or update on duplicate key)

```js
await exports.vSQL.query(
  `INSERT INTO player_stats (citizenid, kills) VALUES (?, ?)
   ON DUPLICATE KEY UPDATE kills = kills + VALUES(kills)`,
  [citizenid, 1]
);
```

### Soft delete

```js
// "delete"
await exports.vSQL.update('UPDATE players SET deleted_at = NOW() WHERE id = ?', [id]);
// read live rows only
const live = await exports.vSQL.query('SELECT * FROM players WHERE deleted_at IS NULL');
```

## CRUD helpers (no SQL)

For the boring cases, don't write SQL at all - these build a parameterised
statement for you (values bound, identifiers escaped). The moment you need
anything past equality / `IN` / `NULL` conditions, drop back to raw `query`.

```js
// insert one row (or pass an array of objects for a bulk insert)
const id = await exports.vSQL.insertInto('players', { citizenid, name });

// insert and get the whole row back - one round-trip on MariaDB 10.5+
// (INSERT ... RETURNING), insert-then-select on MySQL
const row = await exports.vSQL.insertAndFetch('players', { citizenid, name });
// pick columns / set a non-'id' key column for the MySQL fallback:
const row2 = await exports.vSQL.insertAndFetch('players', { citizenid, name }, {
  returning: ['id', 'created_at'],
  idColumn: 'id'
});

// update / delete by a WHERE object (a WHERE is required - no accidental
// full-table writes)
await exports.vSQL.updateWhere('players', { money: 500 }, { id });
await exports.vSQL.deleteWhere('inventory', { id: itemId });

// read: find() returns rows, findOne() the first row or null
const police = await exports.vSQL.find('players', { job: 'police' }, { orderBy: 'name', limit: 20 });
const player = await exports.vSQL.findOne('players', { id });
```

The WHERE object ANDs its conditions; an array value becomes `IN (...)`, and
`null` becomes `IS NULL`. Need `OR` or a comparison? There's a raw escape hatch:

```js
const rich = await exports.vSQL.find('players', ['money > ? AND job = ?', [1000, 'police']]);
```

## Transactions & batches

### Transfer money atomically (transaction)

```js
await exports.vSQL.transaction(async (tx) => {
  const from = await tx.single('SELECT money FROM players WHERE id = ? FOR UPDATE', [fromId]);
  if (from.money < amount) throw new Error('insufficient funds'); // throwing rolls back
  await tx.update('UPDATE players SET money = money - ? WHERE id = ?', [amount, fromId]);
  await tx.update('UPDATE players SET money = money + ? WHERE id = ?', [amount, toId]);
});
```

::: warning
Transactions **auto-retry on deadlock**, so the callback may run more than once.
Keep non-DB side effects (HTTP calls, events, in-memory mutation) **out** of the
body - put them after the transaction resolves.
:::

You can also pass an array of statements instead of a callback:

```js
await exports.vSQL.transaction([
  ['UPDATE players SET money = money - ? WHERE id = ?', [amount, fromId]],
  ['UPDATE players SET money = money + ? WHERE id = ?', [amount, toId]],
]);
```

### Bulk insert (one statement per row, atomic)

```js
await exports.vSQL.batch('INSERT INTO logs (player, action) VALUES (?, ?)', [
  [1, 'login'],
  [2, 'logout'],
  [3, 'purchase'],
]);
```

`batch` runs the same statement once per row inside a single transaction and
returns the total affected-row count.

## Performance & control

### Bypass the cache for a fresh read

```js
// when result caching is enabled globally but this read must be current
const live = await exports.vSQL.single('SELECT money FROM players WHERE id = ?', [id], { cache: false });
```

### Cap a heavy report query

```js
// cancel server-side if it runs longer than 3s (see vsql_query_timeout)
const report = await exports.vSQL.query('SELECT ... big aggregate ...', [], { timeout: 3000 });
```

### Targeted cache invalidation

```js
await exports.vSQL.query('UPDATE players SET ...'); // any write clears the whole cache (blunt but correct)
exports.vSQL.cacheClear('players');                  // or clear only entries mentioning a table
```

## Lifecycle

### Wait for the database before using it

```js
await exports.vSQL.ready();           // resolves once connected
// or react to events:
AddEventHandler('vSQL:ready', (server) => print('db up: ' + server.type));
```

| Event | Fires when |
|---|---|
| `vSQL:ready` | the pool first connects |
| `vSQL:reconnected` | the pool reconnects after a drop |
| `vSQL:connectionLost` | a fatal connection error is detected |
| `onMySQLReady` | on connect (oxmysql / mysql-async compatibility signal) |

### Probe the schema

Handy when a resource migrates itself or has to adapt to a database it didn't
create:

```js
if (!(await exports.vSQL.tableExists('players'))) { /* create it */ }
if (!(await exports.vSQL.columnExists('players', 'discord'))) { /* add it */ }

const cols = await exports.vSQL.columns('players'); // [{ name, type, nullable, key, default }]
const all  = await exports.vSQL.tables();           // ['players', 'vehicles', ...]
```

### Inspect what's happening

```js
const stats = exports.vSQL.getStats();   // counts, latency percentiles, per-resource breakdown
const top   = exports.vSQL.topQueries(); // heaviest query shapes by total time
```

Or from the server console: `vsql`, `vsql top`, `vsql resources`, `vsql debug`.
