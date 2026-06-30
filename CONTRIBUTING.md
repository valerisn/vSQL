# Contributing to vSQL

Thanks for taking the time to contribute. This guide covers how to get set up, the coding style we follow, and how to get a change merged.

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- Report a bug by opening an [issue](https://github.com/valerisn/vSQL/issues).
- Suggest a feature or improvement.
- Improve the documentation.
- Send a pull request that fixes a bug or adds a feature.

> [!TIP]
> For anything large, please open an issue first so we can agree on the approach before you spend time on it.

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

Please make sure all three pass locally:

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same checks on every pull request, so this saves a round trip.

> [!NOTE]
> `dist/` is built output. If your change affects runtime behavior, rebuild it so the committed bundle stays in sync with `src/`.

## Coding style

- The source is **TypeScript** in `src/`. Match the style of the surrounding code.
- Two space indentation, single quotes, semicolons, and a trailing newline (see `.editorconfig`).
- Keep things small and readable. Prefer clear names over comments, and explain the **why** when a comment is needed.
- All query values must be passed through bound parameters. Never build SQL by string concatenation.
- Add or update tests when you change behavior in the pure modules (`params`, `util`, `cache`).

## Commit and pull request guidelines

- Write clear commit messages. A short summary line, then a body explaining what changed and why.
- Keep each commit focused on one logical change.
- Reference related issues in the description (for example, `Fixes #12`).
- Fill in the pull request template so reviewers have the context they need.

## Reporting bugs

Good bug reports include:

- what you expected to happen and what actually happened,
- steps to reproduce, ideally a minimal example,
- your MySQL or MariaDB version and the relevant `vsql_*` convars,
- any error output from the server console (set `vsql_debug 2` for query level detail).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers the project.
