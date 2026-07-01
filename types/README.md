# @vsql/types

TypeScript type definitions for the [vSQL](https://github.com/valerisn/vSQL)
FiveM MySQL/MariaDB resource. Drop these in and your consumer resource gets full
autocomplete and type-checking for `exports.vSQL.*`.

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

The package ships only `index.d.ts` - there's no runtime code, nothing to bundle.

## Publishing (maintainers)

These types are versioned right alongside the resource. To cut a new release:

```bash
cd types
npm version <patch|minor|major>
npm publish     # publishConfig.access is already "public"
```

Publishing under the `@vsql` scope needs ownership of that npm organisation - if
you're publishing under a different scope, rename the package first.
