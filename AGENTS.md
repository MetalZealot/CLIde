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
2. Read the relevant open item in `docs/TODO.md`.  It is the tracked backlog and the
   coordination board for concurrent work.  Claim an item before you touch it.
3. Read relevant ADRs in `docs/decisions/` — especially before "fixing" anything that
   looks odd but deliberate.
4. Load the task-specific context below.

### Task-specific context

| If the work touches | Read first |
|---|---|
| Backend code under `server/modules/` | `.agents/skills/backend-module-standards/SKILL.md` |
| Token usage, the context ring, or session identity | `docs/maps/code-anchors.md` |
| Provider behaviour, capability parity, or a runtime adapter | `docs/maps/README.md`, then that provider's map |
| Abort, approval replay, resume, rewind, or fork | ADRs 0008, 0012, 0013 |
| The model picker | "Model picker follow-ups" in `docs/TODO.md`, ADRs 0003 and 0025 |
| Any file listed in the code anchors | `docs/maps/code-anchors.md` — grep the symbol, don't blind-read |
| An upstream-shared defect | `docs/upstream-candidates.md` |

## Architecture and compatibility

- The backend is Express + WebSocket under `server/`, fully migrated into
  `server/modules/` as of upstream 1.37; the frontend is React 18, Vite, and Tailwind
  under `src/`.  Shared types and utilities live in `shared/`.  `server/routes/`,
  `server/utils/`, `server/services/`, `server/middleware/`, and the flat adapter files
  at `server/`'s root are gone — be suspicious of any doc or memory that names them.
  The 19 modules: `agent/`, `assets/`, `auth/`, `browser-use/`, `cli/`, `commands/`,
  `database/`, `file-tree/`, `git/`, `notifications/`, `plugins/`, `projects/`,
  `providers/`, `settings/`, `system/`, `taskmaster/`, `user/`, `voice/`, `websocket/`.
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

- Use `npm run typecheck`, `npm run lint`, and the narrowest relevant build.
- `npm test` runs `test:server` then `test:client`; run either half alone while
  iterating.  A single server test needs the server tsconfig —
  `npx tsx --tsconfig server/tsconfig.json --test <path to *.test.ts>` — because the
  root tsconfig maps `@/*` to `src/*` while the server maps it to `server/*`.  A bare
  `--test` fails on the alias, and a directory argument fails even with the tsconfig.
- Small client-only changes: `npm run build:client`, then refresh the running app.  A
  server restart is not needed for client bundles; the server reads `dist/` from disk
  per request.  Only server changes (`dist-server/`) need `npm run build:server` and a
  restart.
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
- For parallel work, claim the `docs/TODO.md` item and create a worktree/topic branch
  from `main`, then merge it back.  **Never switch branches in the main checkout** while
  a service or dev server runs from it.
- A worktree has no `node_modules`; link the main checkout's rather than running a
  second install.  **Never share the tsc/eslint caches across checkouts** — if a
  worktree's `.cache/tsbuildinfo/*.tsbuildinfo` is linked to another checkout's, tsc
  reads that state, believes everything is emitted, and **silently produces no
  `dist-server/` at all**, while `typecheck` skips files it thinks are unchanged so a
  clean result is vacuous.
- Keep `docs/TODO.md` current: use `[ ]`, `[~]`, and `[x]`; move verified work to
  `docs/todo-done.md` as a short record with its commit.  Git history and ADRs are the
  canonical detail — keep the board's entries short.
- Categorize fixes as fork-only or upstreamable in `docs/upstream-candidates.md`.
  Before describing a defect as upstream-wide, inspect upstream code as well as
  searching issues/PRs.  Never open, push, or update an upstream PR without the user's
  explicit approval.
- When work creates a non-obvious lasting decision, ask whether it merits a new ADR.
  ADRs are append-only: supersede a prior decision rather than rewriting history.

## Keeping the guides honest

This file drifted from the local `CLAUDE.md` because nothing said which one owned a
fact.  It does now:

- **This file** owns shared project truth: architecture, invariants, workflow,
  verification rules, and the routing table above.  It is tracked and published on the
  fork, so it must contain **no host-specific detail** — no absolute home paths, no
  hostnames, no port numbers, no systemd unit names (ADR 0027).
- **`docs/`** owns depth: maps for current code and provider surfaces, ADRs for
  decisions, `TODO.md` for live work.  Prefer adding detail there and routing to it
  over growing this file.
- **The ignored local `CLAUDE.md`** owns only the host: this machine's paths, ports,
  services, and deploy loop.  If a fact would be true for anyone who cloned the fork,
  it does not belong there.

When you learn something durable, write it to the owner above and route to it — do not
record it in whichever file you happen to have open.  Repeating a rule that a linter,
type checker, or test already enforces is not documentation; make the gate executable
instead.

## Safety

- Never use a destructive operation on user documents, especially `docs/TODO.md` or
  `UI Visual References/`.  To stop tracking a file while keeping it on disk, use
  `git rm --cached`, never `git rm`.
- Do not delete or modify real user sessions, projects, credentials, or databases
  unless the user explicitly authorizes the exact scope.
