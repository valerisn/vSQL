# Recipes

Copy-paste solutions for common tasks. All examples use the JS Promise API
(`exports.vSQL.*`); the Lua `MySQL.*` wrapper mirrors them.

> Every value is passed as a **parameter** - never concatenate user input into SQL.

## Fetch one / a column / a list

```js
const player  = await exports.vSQL.single('SELECT * FROM players WHERE id = ?', [id]);   // row or null
const balance = await exports.vSQL.scalar('SELECT money FROM players WHERE id = ?', [id]); // value or null
const all     = await exports.vSQL.query('SELECT * FROM players WHERE job = ?', ['police']); // rows[]
```

## Insert and get the new id

```js
const id = await exports.vSQL.insert(
  'INSERT INTO players (citizenid, name) VALUES (?, ?)',
  [citizenid, name]
);
```

On **MariaDB 10.5+** you can return columns in one round-trip (`serverInfo().supportsReturning`):

```js
const [row] = await exports.vSQL.query(
  'INSERT INTO players (citizenid, name) VALUES (?, ?) RETURNING id, created_at',
  [citizenid, name]
);
```

## Upsert (insert or update on duplicate key)

```js
await exports.vSQL.query(
  `INSERT INTO player_stats (citizenid, kills) VALUES (?, ?)
   ON DUPLICATE KEY UPDATE kills = kills + VALUES(kills)`,
  [citizenid, 1]
);
```

## Update / delete (affected rows)

```js
const changed = await exports.vSQL.update('UPDATE players SET money = money - ? WHERE id = ?', [50, id]);
const removed = await exports.vSQL.update('DELETE FROM inventory WHERE id = ?', [itemId]); // update() covers DELETE
```

## Soft delete

```js
// delete
await exports.vSQL.update('UPDATE players SET deleted_at = NOW() WHERE id = ?', [id]);
// read live rows only
const live = await exports.vSQL.query('SELECT * FROM players WHERE deleted_at IS NULL');
```

## Pagination

```js
const page = 2, perPage = 20;
const rows = await exports.vSQL.query(
  'SELECT * FROM players ORDER BY id LIMIT ? OFFSET ?',
  [perPage, (page - 1) * perPage]
);
```

## IN (...) with an array

```js
// the array expands to (?, ?, ?) automatically
const rows = await exports.vSQL.query('SELECT * FROM vehicles WHERE plate IN ?', [[a, b, c]]);
```

## Named parameters

```js
await exports.vSQL.single(
  'SELECT * FROM players WHERE citizenid = @id AND job = :job',
  { id: citizenid, job: 'police' }
);
```

## Transfer money atomically (transaction)

```js
await exports.vSQL.transaction(async (tx) => {
  const from = await tx.single('SELECT money FROM players WHERE id = ? FOR UPDATE', [fromId]);
  if (from.money < amount) throw new Error('insufficient funds'); // rolls back
  await tx.update('UPDATE players SET money = money - ? WHERE id = ?', [amount, fromId]);
  await tx.update('UPDATE players SET money = money + ? WHERE id = ?', [amount, toId]);
});
```

Transactions auto-retry on deadlock - keep non-DB side effects (HTTP, events) out of the body.

## Bulk insert (one statement per row, atomic)

```js
await exports.vSQL.batch('INSERT INTO logs (player, action) VALUES (?, ?)', [
  [1, 'login'],
  [2, 'logout'],
  [3, 'purchase'],
]);
```

## Bypass the cache for a fresh read

```js
// when result caching is enabled globally but this read must be current
const live = await exports.vSQL.single('SELECT money FROM players WHERE id = ?', [id], { cache: false });
```

## Cap a heavy report query

```js
// cancel server-side if it runs longer than 3s (see vsql_query_timeout)
const report = await exports.vSQL.query('SELECT ... big aggregate ...', [], { timeout: 3000 });
```

## Wait for the database before using it

```js
await exports.vSQL.ready();           // resolves once connected
// or react to events:
AddEventHandler('vSQL:ready', (server) => print('db up: ' + server.type));
```

## Targeted cache invalidation

```js
await exports.vSQL.query('UPDATE players SET ...');  // clears the whole cache (blunt but correct)
exports.vSQL.cacheClear('players');                  // or clear only entries mentioning a table
```
