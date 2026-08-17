# Test suite map

What the automated suites own, what they cost, and what they cannot establish.
The policy for *which* of them to run is in [`AGENTS.md`](../../AGENTS.md); this
map is the evidence behind it.

## Shape

82 test files, 629 tests, in two halves that need different tsconfigs — the root
maps `@/*` to `src/*`, the server maps it to `server/*`.

| Half | Files | Tests | Command |
|---|---|---|---|
| Server | 63 | 456 | `npm run test:server` |
| Client | 19 | 173 | `npm run test:client` |

Server tests concentrate where the contracts are: `providers` (25 files),
`projects` (9), `websocket` (5), `database` (4), with most other modules holding
one. Client tests are thinner and cover stores, hooks, sidebar and chat
subcomponents, the settings registry, and formatting utilities.

## Measured cost

Taken on the maintainer's Pi (4 GB, microSD), 2026-08-15, after consolidation:

| Path | Cost |
|---|---|
| One server test file | ~4s |
| One client logic file | ~6s |
| One client component file | ~9s |
| `typecheck:server` / `typecheck:client` | 9s / 12s |
| `build:server` / `build:client` | 28s / 50s |
| `lint` | 9s |
| `test:server` / `test:client` | 66s / 49s |
| **Complete gate** (`test`, `typecheck`, `lint`, `build`) | **217s** |

**Cost is per test *file*, not per test.** Each file pays ~3s of process spawn,
tsx type-stripping, and JSDOM setup before its first assertion; a 9-test client
file runs 7.7s wall of which ~0.2s is the tests. So the lever on suite time is
the number of files, not the number of assertions — adding cases to an existing
file is nearly free, and a new near-empty file is not.

Consolidation on 2026-08-15 merged ten clusters, 99 files to 82, with the test
count unchanged at 456/173. Each merged file's body sits in its own `describe`,
which scopes its helpers and `before`/`afterEach` hooks so they cannot collide
or leak between groups.

Two shapes are deliberately left unmerged: modules holding a single test file,
where merging would move tests across module boundaries for ~3s, and
`codex-app-server-chat.test.ts`, which embeds a fake server's source in a
template literal that mechanical import-rewriting corrupts.

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
