# Fast, understandable test and validation workflow

- Status: complete
- Next: nothing; superseded by the test suite map and `AGENTS.md`.
- Context: [agent guide](../../AGENTS.md) · [package scripts](../../package.json)

## Measured baseline

Taken on the maintainer's Pi, 2026-08-15, on `main`, before and after phase 4:

| Command | Before | After | Size after |
|---|---|---|---|
| `test:server` | 75s | 66s | 456 tests, 63 files |
| `test:client` | 83s | 49s | 173 tests, 19 files |
| `typecheck` | 22s | — | both projects |
| `build:client` | 51s | — | |

Consolidation removed 17 files and zero assertions: 99 → 82 files, with the test
count identical at 456 server and 173 client.

The dominant cost is **per-file startup, not per-test work**: a 9-test client file
takes 7.7s wall, of which ~0.2s is the tests. The rest is process spawn, tsx
type-stripping, and JSDOM setup, paid once per file. 99 files therefore cost roughly
five minutes of startup regardless of what they assert.

The suite grew as a side effect, not a decision: upstream has 57 test files, the fork
99, and only two of the 42 fork-added files came from a commit whose purpose was
testing. Every other one rode along with a feature.

## Phases

- [x] **1. Measure.** Baseline above.
- [x] **2. Define proportionate gates.** Change/check matrix in `AGENTS.md` —
      localized changes run one test file and one build; cross-module contracts
      (session ids, providers, auth, database, protocol) run `npm test`; the full
      gate is explicit and pre-merge, not the default end of a task.
- [x] **3. Make the fast path a real command.** `test:client:one`, `test:server:one`,
      `typecheck:client`, `typecheck:server`. Existing full-suite commands unchanged.
      `build:server` already type-checks the server; documented so it isn't paired
      with a redundant `typecheck`.
- [x] **4. Cut per-file startup by consolidating files.** Ten clusters merged, 17
      files removed, no assertion touched. Each source file's body is wrapped in its
      own `describe`, which scopes per-file helpers and `before`/`afterEach` hooks so
      they cannot collide or leak between groups — that, not renaming, is what makes
      merging safe. Files left alone deliberately: the one-test-file-per-module cases
      (`assets`, `cli`, `git`, `notifications`, `plugins`, `settings`, `user`), where
      merging would move tests across module boundaries, and
      `codex-app-server-chat.test.ts`, which embeds a fake server's source in a
      template literal — mechanical import-stripping corrupts it.
- [x] **5. Re-measure and close.** Focused paths land at 4–12s against a 217s
      complete gate. Suite ownership, measured costs, and the limits of what
      automated tests can establish moved to
      [the test suite map](../../maps/test-suite.md); the gate matrix and focused
      commands live in `AGENTS.md`, which both Claude and Codex read.

## Done when

- A routine localized change has one documented validation path costing about a
  minute, and does not invoke either full suite.
- Full tests and builds have explicit risk-based triggers, and handoffs say which
  focused, broad, build, and live checks actually ran.
- Consolidation has removed files without removing assertions, and the full suite
  still passes.

## Not doing

- Deleting passing tests to reduce the count — it buys milliseconds and loses a
  guarantee. Consolidation is the lever; deletion is not.
- Replacing Node's test runner, adding packages, or reintroducing shared TypeScript
  caches across worktrees.
- Treating automated checks as a substitute for installed-PWA or provider-live
  acceptance.
