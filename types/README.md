# @vsql/types

TypeScript type definitions for the [vSQL](https://github.com/valerisn/vSQL)
FiveM MySQL/MariaDB resource. Gives a consumer resource full autocomplete and
type-checking for `exports.vSQL.*`.

## Install

```bash
npm i -D @vsql/types
```

## Use

```ts
import type { VSql } from '@vsql/types';

const db = exports.vSQL as unknown as VSql;

const players = await db.query<Player[]>('SELECT * FROM players WHERE money > ?', [1000]);
const one = await db.findOne<Player>('players', { id: 1 });
const id = await db.insertInto('players', { citizenid, name });
```

The package ships only `index.d.ts` - there is no runtime code.

## Publishing (maintainers)

These types are versioned alongside the resource. To publish a new release:

```bash
cd types
npm version <patch|minor|major>
npm publish     # publishConfig.access is already "public"
```

Publishing under the `@vsql` scope requires owning that npm organisation; rename
the package if you publish under a different scope.
