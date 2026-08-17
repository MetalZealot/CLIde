# CLIde agent guide

CLIde is Grayson's personal fork of `siteboon/claudecodeui`.  Use **CLIde** when
talking about the product.  Do not rename the checkout, package, or systemd service:
their existing names and paths are intentional, and renaming them breaks hardcoded
deployment paths.

**This file is the canonical shared guide for every agent working in this repo.**  It
is a map, not a manual: it states what is true across all work, and routes to the
document that owns the detail.  See "Keeping the guides honest" at the end before you
record a new fact anywhere.

## Start here

Before changing code:

1. Run `git status --short`, inspect active worktrees/branches when relevant, and
   preserve unrelated user changes.
2. Read the relevant open item in `docs/TODO.md`.  It is the tracked backlog.  Items
   are one line and point elsewhere; follow the pointer only for the item you are
   working on.  Read the section you need, not the whole file — it is 23 KB.
3. Read relevant ADRs in `docs/decisions/` — especially before "fixing" anything that
   looks odd but deliberate.
4. Load the task-specific context below.

**Read indexes before documents.**  The READMEs in `docs/plans/`, `docs/maps/`, and
`docs/decisions/` say what each document covers and where it stands.  Open a document
only once an index says it is the one you need; never read a directory to find out.

### Task-specific context

| If the work touches | Read first |
|---|---|
| Backend code under `server/modules/` | `.agents/skills/backend-module-standards/SKILL.md` |
| Token usage, the context ring, or session identity | `docs/maps/code-anchors.md` |
| Provider behaviour, capability parity, or a runtime adapter | `docs/maps/README.md`, then that provider's map |
| Abort, approval replay, resume, rewind, or fork | ADRs 0008, 0012, 0013 |
| The model picker | "Model picker follow-ups" in `docs/TODO.md`, ADRs 0003 and 0025 |
| Any file listed in the code anchors | `docs/maps/code-anchors.md` — grep the symbol, don't blind-read |
| Adding, merging, or timing tests | `docs/maps/test-suite.md` |
| An upstream-shared defect | `docs/upstream-candidates.md` |
| Multi-session work with phases | its plan in `docs/plans/` — the board in that README first |

## Glossary

- **`session_id`** is the id CLIde mints and owns: stable across resume and fork, and
  **the only id a runtime is addressed by**.  **`provider_session_id`** is the
  provider's own on-disk id for the same conversation — a lookup key, never an
  address.  Confusing them caused three separate v1.37 merge defects; before passing
  an id to a runtime, confirm which one you hold (`docs/maps/code-anchors.md`).
- **"default"** — never write it bare.  It can mean the model Anthropic recommends,
  Claude Code's fallback, the last model picked, or CLIde's stored preference.  Name
  which.  ADRs 0003 and 0025 fix the behaviour; this fixes the vocabulary.
- **"done"** — merged is not verified.  Say which.

## Architecture and compatibility

- The backend is Express + WebSocket under `server/`, fully migrated into
  `server/modules/` as of upstream 1.37; the frontend is React 18, Vite, and Tailwind
  under `src/`.  Shared types and utilities live in `shared/`.  `server/routes/`,
  `server/utils/`, `server/services/`, `server/middleware/`, and the flat adapter files
  at `server/`'s root are gone — be suspicious of any doc or memory that names them.
  `ls server/modules/` lists the 19 current ones.
- Providers are adapters.  Claude is the daily driver, but shared UI, protocol,
  database, and provider-interface work must continue to work for Codex, Cursor, and
  OpenCode.  Prototype against Claude first, then check how each other adapter
  implements the equivalent behaviour and design the integration point so each can plug
  in or explicitly no-op.  Add capability flags or clean degradation instead of leaking
  Claude-only concepts into shared code.  Purely Claude-specific files are exempt.
- The app owns stable `session_id`s; `provider_session_id` is the provider's native ID.
  **Runtimes are addressed by the app id, never the provider one** — this flipped in
  v1.37 and caused three separate merge defects.  Details and commits:
  `docs/maps/code-anchors.md`.
- The user database is SQLite, outside the repo, so working-tree changes cannot destroy
  it.  Back it up before any schema/auth/data write.  Treat live-session tests as
  stateful: clean any test data from the filesystem before its database rows, so the
  watcher cannot rediscover it.

### Backend module standards

Upstream 1.37 ships `.agents/skills/backend-module-standards/SKILL.md`.  Use it as a
**directory-shape reference** for backend work under `server/modules/`; it does not
replace this guide.  Where the two disagree, this guide wins.  Known exceptions:
runtime adapters that remain JavaScript are a deliberate migration exception, shared
`types.ts`/`utils.ts` are not cross-module dumping grounds, and provider-specific
behaviour stays behind adapter interfaces.

## Development and verification

- **Match the checks to what changed.  The full gate is opt-in, not the default ending
  of a task** — everything together costs 217s on the maintainer's hardware against
  ~10s for a focused path, and running it after every edit is a session's largest
  avoidable cost ([test suite map](docs/maps/test-suite.md)).

  | Change | Run |
  |---|---|
  | Copy, CSS, one component | that component's test file, `build:client` |
  | Client logic, store, hook | its test file(s), `typecheck:client`, `build:client` |
  | One backend module | that module's tests, `build:server` (type-checks it too) |
  | Session ids, providers, auth, database, protocol | `npm test` — contracts span modules |
  | Dependency bump, upstream rebase, pre-merge | `npm test`, `typecheck`, `lint`, `build` |

- One file: `npm run test:client:one <path>` / `test:server:one <path>`.  The halves
  need different tsconfigs — root maps `@/*` to `src/*`, server to `server/*` — so a
  bare `--test` fails on the alias, and a directory argument fails even with the right
  tsconfig.
- **Cost is per test *file*, not per test** (~3s of startup each): add cases to an
  existing file rather than creating a near-empty new one.  Consolidating files is the
  lever, never deleting a passing test.
- Client bundles need no restart — the server reads `dist/` from disk per request, so
  `build:client` then refresh.  Only `dist-server/` changes need a restart.
- **Verify on the server that actually serves the checkout you edited.**  The main
  checkout's server does not serve a worktree's `dist/`, so worktree work is never
  verified there — use that worktree's own test server.  Never tell the user to refresh
  the main app for a change that only exists on a topic branch.
- Do not restart the production service from an agent session unless the user
  explicitly asks and the environment permits it.
- "I have no login credentials" is never a reason to skip live verification.  Stand the
  right server up, hand over the URL, and say what to look for — the user clicks
  through, not you.
- Use a real device for touch behaviour.  In particular, CSS `:active` is not a
  reliable long-press visual state; use the explicit `isPressing` state from
  `useLongPress`.
- Distinguish source inspection, automated checks, build output, running-service state,
  live behaviour, and user acceptance.  Say which one you actually have.
- Make the smallest coherent change that fully solves the request.  Follow existing
  patterns; do not broaden scope, add speculative abstractions, or compromise working
  behaviour merely to reach completion.

## Code comments

Fork-authored comments run ~30% wordier than upstream's, and every stale file path in
one sat inside narrative that condensing removes anyway.  Verbosity and staleness are
one defect, so these rules target length.

- **State the invariant, not the incident.**  No "used to", "this replaced", "before
  the fix" — git holds that.  Describe what must stay true, not what went wrong.
- **Never cite a file path, commit hash, or date unless the comment is useless without
  it.**  Paths move, hashes rewrite on every upstream rebase.  A date is legitimate
  only on a *measurement* (`decoded from the CLI binary, 2026-07-26`), never on
  narrative.
- **Default to one line.**  A multi-line block must earn it: a concurrency invariant, a
  measured constant, or a deliberate choice that reads as a bug.  Rationale a reader
  can recover from the code itself is not a reason.
- Prefer a terse register over prose.  "Fixed-width slot so labels align across rows"
  beats a sentence explaining why alignment matters.

## Project invariants

- Do not introduce `backdrop-filter`/glassmorphism.  Use a solid dim scrim such as
  `bg-black/50` (ADR 0001).
- Keep PWA manifest icons `purpose: "any"`; adding `maskable` causes a Samsung white
  box (ADR 0002).  For logo work, edit the masters in `designs/` and run
  `designs/regenerate-assets.py`; keep the dark master a plain filled path, and never
  hand-edit generated assets in `public/`.
- Claude emits synthetic, zero-usage transcript rows.  If touching Claude token usage,
  preserve the equivalent skip guard in all three paths — see
  `docs/maps/code-anchors.md`.  Codex accounting is separate.
- For session starring, retain `isStarred` in both fetch and watcher event paths and
  apply `compareSessionsStarredFirst` on every session-list surface.
- Claude model/transcript logic is subtle.  The transcript is ground truth for what
  ran, but validate transcript-derived values before they can reach a model argument.

## Git, backlog, and upstream workflow

- `main` is the long-lived CLIde branch and tracks `origin/main` on the user's
  `MetalZealot/CLIde` fork.  `upstream/main` is the clean `siteboon/claudecodeui` line;
  a separate local upstream mirror is unnecessary.  Rebasing rewrites hashes, so
  publishing `main` afterwards needs `--force-with-lease`.
- Conventional commits are enforced by commitlint; eslint runs on staged files.  Make
  self-contained commits only after appropriate verification.
- Work on `main` by default.  Create a worktree/topic branch only for genuinely
  parallel or risky work, and only when the maintainer asks or agrees.  **Never switch
  branches in the main checkout** while a service or dev server runs from it.
- Merge a branch back and delete it as soon as its work lands; stale worktrees are the
  maintainer's overhead.
- A worktree has no `node_modules`; link the main checkout's rather than running a
  second install.  **Never share the tsc/eslint caches across checkouts** — if a
  worktree's `.cache/tsbuildinfo/*.tsbuildinfo` is linked to another checkout's, tsc
  reads that state, believes everything is emitted, and **silently produces no
  `dist-server/` at all**, while `typecheck` skips files it thinks are unchanged so a
  clean result is vacuous.
- Keep `docs/TODO.md` current **in the same batch as the code change** — flip `[ ]` →
  `[~]` → `[x]` and move verified work to `docs/todo-done.md` as you go, not as a
  separate turn at the end.  Do not ask permission to update the board.  An item is
  one line naming the work and pointing at its plan, ADR, or commit; 400 characters
  is the enforced ceiling and most need far less, because git history and ADRs are
  the canonical detail.
- When a document and reality diverge, **edit the document**.  Never append a
  correction, re-measurement, or audit section to preserve the wrong text — git holds
  the old version, and that habit turned the v1.37 integration document into 79 KB
  whose two largest sections were both audits.
- **Git's conflict set is an anti-signal when merging upstream.**  Only 5 files
  conflicted textually in the final v1.37 merge, yet every genuine defect was in a
  file that merged cleanly.  When both sides refactor toward the same shape, diff the
  *contract* surfaces — runtime options, gateway addressing, provider context — and
  write one test per contract driving every provider with the ids deliberately
  unequal (`server/modules/websocket/tests/chat-session-addressing.test.ts`).
- Categorize fixes as fork-only or upstreamable in `docs/upstream-candidates.md`.
  Before describing a defect as upstream-wide, inspect upstream code as well as
  searching issues/PRs.  Never open, push, or update an upstream PR without the user's
  explicit approval.
- **Never end a turn by asking "worth an ADR?"** — that spends a whole reply asking
  permission to write a document.  Write one only when asked, or when a decision is
  the kind a future session would otherwise undo (a deliberate constraint that looks
  like a bug); then write it in the same batch as the work, unasked, in five
  sentences.  Otherwise the commit message is the record.  ADRs are append-only:
  supersede, never rewrite.

## Keeping the guides honest

Write a durable fact to the file that owns it and route to it, rather than into
whichever file you happen to have open.  Ownership:

- **This file** owns shared project truth: architecture, invariants, workflow,
  verification, and the routing table above.  It is published on the fork, so it
  carries **no host detail** — no home paths, hostnames, ports, or unit names.
- **`docs/`** owns depth, in three types, each answering one question: a **map**
  (`docs/maps/`) "how does this work today", an **ADR** (`docs/decisions/`) "what did
  we choose and why", a **plan** (`docs/plans/`) "what is left, in what order".
  Something answering a different question does not need a document.  `docs/specs/`
  is **retired** — the name invited an essay and eighteen reached 317 KB.  The
  replacement rules (byte caps, banned ceremony sections) live in
  `docs/plans/README.md`, enforced by `npm run check:docs`.  Do not invent a fourth
  type to escape them.
- **Host-local guides**, ignored by git, own the host: paths, ports, services, the
  deploy loop.  There are two, one per agent, and **they are not shared**: Claude
  reads `CLAUDE.md` files and never an agent-global `AGENTS.md`; Codex reads
  `AGENTS.md` files — this one plus its own global one — and **never any
  `CLAUDE.md`**.  A host fact recorded for only one of them is invisible to the other,
  which is how Codex ended up not knowing where the user database lives.  Record it in
  both, or accept that the other agent cannot know it.

Restating a rule a linter, type checker, or test already enforces is not documentation
— make the gate executable instead.

## Safety

- Never use a destructive operation on user documents, especially `docs/TODO.md` or
  `UI Visual References/`.  To stop tracking a file while keeping it on disk, use
  `git rm --cached`, never `git rm`.
- Do not delete or modify real user sessions, projects, credentials, or databases
  unless the user explicitly authorizes the exact scope.
