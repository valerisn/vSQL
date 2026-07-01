# Contributing to vSQL

Thanks for being here - genuinely. This guide covers getting set up, the coding style we follow, and how to get a change merged, so you can spend your time on the fun part.

By taking part in this project you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

Every one of these is worth doing:

- Report a bug by opening an [issue](https://github.com/valerisn/vSQL/issues).
- Suggest a feature or an improvement.
- Sharpen the documentation.
- Send a pull request that fixes a bug or adds a feature.

> [!TIP]
> For anything large, open an issue first so we can settle on the approach together - it saves you building something we'd want done differently.

## Getting set up

> [!IMPORTANT]
> The test suite uses Node's built in test runner with native TypeScript type stripping, so you need **Node 24 or newer**. The repository pins this in `.nvmrc`.

```bash
git clone https://github.com/valerisn/vSQL.git
cd vSQL
npm install
```

Common scripts:

```bash
npm run typecheck   # type check without emitting (tsc --noEmit)
npm test            # run the unit tests (no database required)
npm run build       # bundle src into dist/index.js plus type declarations
npm run watch       # rebuild on change
```

## Before you open a pull request

Make sure all three pass locally first:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the exact same checks on every pull request, so catching it locally saves you a round trip.

> [!NOTE]
> `dist/` is built output. If your change affects runtime behavior, rebuild it so the committed bundle stays in sync with `src/`.

## Coding style

- The source is **TypeScript** in `src/`. When in doubt, match the code around you.
- Two-space indentation, single quotes, semicolons, and a trailing newline (see `.editorconfig`).
- Keep things small and readable. Reach for a clear name before a comment, and when you do comment, explain the **why**.
- Every query value goes through a bound parameter. Never build SQL by concatenating strings.
- Change behaviour in a pure module (`params`, `util`, `cache`)? Add or update a test for it.

## Commits and pull requests

- Write commit messages that read well: a short summary line, then a body on what changed and why.
- Keep each commit to one logical change.
- Reference related issues in the description (for example, `Fixes #12`).
- Fill in the pull request template - it's there so reviewers have what they need to say yes quickly.

## Reporting bugs

A good bug report includes:

- what you expected to happen and what actually happened,
- steps to reproduce, ideally a minimal example,
- your MySQL or MariaDB version and the relevant `vsql_*` convars,
- any error output from the server console (set `vsql_debug 2` for query level detail).

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE) that covers the rest of the project.
