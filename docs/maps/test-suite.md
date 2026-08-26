# Test suite map

What the automated suites own, what they cost, and what they cannot establish.
The policy for *which* of them to run is here too; `AGENTS.md` routes to it.

## Shape

56 test files, 782 tests, in two halves that need different tsconfigs — the root
maps `@/*` to `src/*`, the server maps it to `server/*`.

| Half | Files | Tests | Command |
|---|---|---|---|
| Server | 39 | 520 | `npm run test:server` |
| Client | 17 | 262 | `npm run test:client` |

Server tests concentrate where the contracts are: `providers` (13 files),
`projects` (3), `websocket` (3), `database` (2), most other modules one. Client
tests hold one file per feature area per layer — `chat` and `settings` each have
hooks, utils and view files; stores, contexts, and single-purpose components hold
one apiece.

## Which checks to run

Match the checks to what changed. The full gate is opt-in, not the default
ending of a task.

| Change | Run |
|---|---|
| Copy, CSS, one component | that component's test file, `build:client` |
| Client logic, store, hook | its test file(s), `typecheck:client`, `build:client` |
| One backend module | that module's tests, `build:server` (type-checks it too) |
| Session ids, providers, auth, database, protocol | `npm test` — contracts span modules |
| Dependency bump, upstream rebase, pre-merge | `npm test`, `typecheck`, `lint`, `build` |

One file: `npm run test:client:one <path>` / `test:server:one <path>`. A bare
`--test` fails on the `@/` alias, and a directory argument fails even with the
right tsconfig.

## Measured cost

Taken on the maintainer's Pi (4 GB, microSD), 2026-08-26:

| Path | Cost |
|---|---|
| `check:tests` | 1s |
| One server test file | ~2s |
| One client test file | ~7s |
| `lint` (warm cache) | 12s |
| `typecheck:server` / `typecheck:client` | 14s / 17s |
| `build:server` / `build:client` | 29s / 61s |
| `test:server` / `test:client` | 56s / 61s |
| **Complete gate** (`test`, `typecheck`, `lint`, `build`) | **251s**, the sum of the rows |

**Cost is per test *file*, not per test.** Each file pays process spawn, tsx
type-stripping, and — on the client — JSDOM setup before its first assertion, and
the runner spreads files across cores. So wall time tracks the file count, not the
assertion count: adding cases to an existing file is nearly free, and a new
near-empty file is not.

## The gate that holds this

`npm run check:tests` runs ahead of `npm test` and on staged test files.

- **A per-half file budget.** Adding a file fails the check until the budget is
  raised deliberately in `scripts/check-tests.mjs`. Merge first; justify the
  number in the commit message.
- **No orphans.** A test file the runner's glob cannot match — a `.test.js` under
  `src/` — fails. It looks like coverage and asserts nothing.
- It also names the cheapest merges still available: files under three cases
  sitting beside a larger file in the same directory. A module's sole test file
  is never flagged, because moving it would cross a module boundary to save
  seconds.

Each merged file's body sits in its own `describe`, which scopes that group's
helpers and `before`/`afterEach` hooks so they cannot collide or leak. Path
literals resolved against `import.meta.url` do not move themselves — recheck any
`new URL('../…')` after a merge.

`codex-app-server-chat.test.ts` stays unmerged: it embeds a fake server's source
in a template literal that mechanical import-rewriting corrupts.

## What the suite does not establish

Passing tests are not acceptance. None of these is covered:

- Visual fidelity, layout, and theming.
- Installed-PWA behaviour — safe areas, standalone mode, the status bar. A Vite
  dev tab cannot show these.
- Touch behaviour on a real device, including long-press press-state.
- Real provider execution against live Claude, Codex, Cursor, or OpenCode
  runtimes and their credentials.
- Running-service state: what the deployed service is actually serving.
- Whether the change is what the maintainer wanted.

The suite protects contracts a reader cannot hold in their head — session id
addressing, provider parity, token accounting, starring and ordering, pagination
authority. It does not tell anyone the app looks right or works on the phone.
