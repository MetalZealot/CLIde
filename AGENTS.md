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
   working on.  Read only the section you need.
3. Read relevant ADRs in `docs/decisions/` — especially before "fixing" anything that
   looks odd but deliberate.
4. Load the task-specific context below.

**Read indexes before documents.**  The README in each `docs/` folder says what each
document covers and where it stands.  Open a document
only once its index points there; never read a directory to find out.

### Task-specific context

| If the work touches | Read first |
|---|---|
| Backend code under `server/modules/` | `.agents/skills/backend-module-standards/SKILL.md` |
| Provider behaviour, capability parity, or a runtime adapter | `docs/providers.md`, then the provider's own types and docs |
| Abort, approval replay, resume, rewind, or fork | ADRs 0008, 0012, 0013 |
| The model picker | "Model picker follow-ups" in `docs/TODO.md`, ADRs 0003 and 0025 |
| Token usage, the context ring, session identity, or any file the code anchors list | `docs/code-anchors.md` — grep the symbol, don't blind-read |
| Running, adding, or timing tests | `docs/testing.md` |
| An upstream-shared defect | "Sending fixes upstream" in `docs/upstream.md` |
| Phased work, or any architecture change | its plan via the `docs/plans/` board, and its design whole if it names one; the quality goals in `ARCHITECTURE.md`; a pre-mortem |

## Glossary

- **`session_id`** is the id CLIde mints and owns: stable across resume and fork, and
  **the only id a runtime is addressed by**.  **`provider_session_id`** is the
  provider's own on-disk id for the same conversation — a lookup key, never an
  address.  Confusing them caused three separate v1.37 merge defects; before passing
  an id to a runtime, confirm which one you hold (`docs/code-anchors.md`).
- **"default"** — never write it bare.  It can mean the model Anthropic recommends,
  Claude Code's fallback, the last model picked, or CLIde's stored preference.  Name
  which.  ADRs 0003 and 0025 fix the behaviour; this fixes the vocabulary.
- **"done"** — merged is not verified.  Say which.

## Architecture and compatibility

- The system's shape, code map, invariants and quality goals are in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).  `server/routes/`, `server/utils/`,
  `server/services/`, `server/middleware/`, and the flat adapter files at `server/`'s
  root are gone since upstream 1.37 — be suspicious of any doc or memory naming them.
- Providers are adapters.  Claude is the daily driver, but shared UI, protocol,
  database, and provider-interface work must keep working for Codex, Cursor, and
  OpenCode.  Prototype against Claude, then check how each other adapter implements
  the equivalent behaviour and design the integration point so each can plug in or
  explicitly no-op.  Add capability flags or clean degradation rather than leaking
  Claude-only concepts into shared code; purely Claude-specific files are exempt.
- The user database is SQLite, outside the repo, so working-tree changes cannot destroy
  it.  Back it up before any schema/auth/data write.  Treat live-session tests as
  stateful: clean any test data from the filesystem before its database rows, so the
  watcher cannot rediscover it.

### Backend module standards

Upstream 1.37 ships `.agents/skills/backend-module-standards/SKILL.md`.  Use it as a
**directory-shape reference** for backend work under `server/modules/`; where the two
disagree, this guide wins.  Known exceptions:
runtime adapters that remain JavaScript are a deliberate migration exception, shared
`types.ts`/`utils.ts` are not cross-module dumping grounds, and provider-specific
behaviour stays behind adapter interfaces.

## Development and verification

- **Match the checks to what changed.  The full gate is opt-in, not the default ending
  of a task** — ~250s all together against seconds for a focused path, and running it
  after every edit is a session's largest avoidable cost.  Per-change checks, one-file
  commands, and measured costs: [the testing doc](docs/testing.md).
- **Cost is per test *file*, not per test**: add cases to an existing file, don't create
  a near-empty new one.  `npm run check:tests` enforces that with a per-half file budget
  — raise one only deliberately.  Consolidating is the lever, never deleting a passing
  test.
- Client bundles need no restart — the server reads `dist/` from disk per request, so
  `build:client` then refresh.  Only `dist-server/` changes need a restart.
- **Verify on the server that actually serves the checkout you edited.**  The main
  checkout's server does not serve a worktree's `dist/`, so worktree work is never
  verified there — use that worktree's own test server.
- Do not restart the production service from an agent session unless the user
  explicitly asks and the environment permits it.
- Test logins use Playwright's saved state or the secret names Browser's typing tools
  list, never a scripted login.  **Never ask for or type Grayson's personal password.**
- Verify a named browser surface in that context.  Separate Playwright or Chromium is
  not verification of it.
- Use a real device for touch behaviour.  CSS `:active` is not a reliable
  long-press visual state; use `useLongPress`'s `isPressing`.
- Distinguish source inspection, automated checks, build output, running-service state,
  live behaviour, and user acceptance.  Say which one you actually have.
- Make the smallest coherent change that fully solves the request.  Follow existing
  patterns; do not broaden scope, add speculative abstractions, or compromise working
  behaviour merely to reach completion.

### UI standards

**Before building, bucket each UI choice as external standard, house convention,
or maintainer taste.**  A confident convention reads like a published standard
to someone who cannot check it.  44px is contextual comfort guidance, not CLIde's
universal target floor.  Sources: [the UI standards doc](docs/ui-standards.md).

## Code comments

Fork-authored comments run ~30% wordier than upstream's, and every stale path in one sat
inside narrative that condensing removes anyway — so these rules target length.

- **State the invariant, not the incident.**  No "used to", "this replaced", "before
  the fix" — git holds that.  Describe what must stay true, not what went wrong.
- **Never cite a file path, commit hash, or date unless the comment is useless without
  it.**  Paths move, and `git blame` already links a line to its commit.  A date is legitimate
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
  `designs/regenerate-assets.py`; keep the dark master a plain filled path —
  flatten stroke-thinning with Inkscape Stroke-to-Path + Difference, because a
  background-coloured stroke overlay breaks the transparent derivatives — and never
  hand-edit generated assets in `public/`.  The icon background is `#141414`, matching
  the manifest's `background_color`/`theme_color`.
- Claude emits synthetic, zero-usage transcript rows.  If touching Claude token usage,
  preserve the equivalent skip guard in all three paths — see
  `docs/code-anchors.md`.  Codex accounting is separate.
- For session starring, retain `isStarred` in both fetch and watcher event paths and
  apply `compareSessionsStarredFirst` on every session-list surface.
- Claude model/transcript logic is subtle.  The transcript is ground truth for what
  ran, but validate transcript-derived values before they can reach a model argument.

- In a *manager* panel (Worktrees, Projects), a plain row tap must not navigate or
  select.  Long-press and right-click open the same menu the kebab opens; a single tap
  is reserved for an explicit Select mode or does nothing.  Picking a thing to work in
  belongs to the New Session launcher that already does it, not duplicated into the
  manager.  When a row looks inert, fix the affordance, not the tap target.

## Git, backlog, and upstream workflow

- `main` is the long-lived CLIde branch and tracks `origin/main` on the user's
  `MetalZealot/CLIde` fork; `upstream/main` is `siteboon/claudecodeui`.  **Upstream
  work is cherry-picked or reimplemented, never rebased or merged** — see
  [the upstream doc](docs/upstream.md).
- Conventional commits are enforced by commitlint; eslint runs on staged files.
  **Commit verified work in the same turn, unasked**, by path
  (`git commit -- <paths>`): another agent may share the checkout, so never `stash`,
  `reset`, `checkout --`, `add -A`, or `commit -a`.  A file already holding edits you
  did not make cannot be split between two commits — stop and say so.
- Work on `main` by default.  Create a worktree/topic branch only for genuinely
  parallel or risky work, and only when the maintainer asks or agrees.  **Never switch
  branches in the main checkout** while a service or dev server runs from it.
- Merge a branch back and delete it as soon as its work lands; stale worktrees are the
  maintainer's overhead.
- **Asking for a change never authorises the branch it lands on.**  If the work
  already exists uncommitted in another checkout, say so and ask which one owns it
  — copying it onto `main` is a merge, and leaves a conflicting duplicate.
- Every checkout owns its `node_modules`; `scripts/setup-worktree.sh` runs `npm ci`.
  **Never link or copy another checkout's** — a branch could not change
  `package.json`, and tsc's incremental cache lives inside it, so a shared one makes
  tsc **emit no `dist-server/`** while `typecheck` skips files and passes vacuously.
- Keep `docs/TODO.md` current **in the same batch as the code change**: flip `[ ]` →
  `[~]` → `[x]` and delete an item once it is verified, as you go, never as a
  separate turn at the end.  Never ask permission to update the board.  An item is one
  line naming the work and pointing at its plan, ADR, or commit, capped at 400
  characters.
- When a document and reality diverge, **edit the document**.  Never append a
  correction or audit section to preserve the wrong text — git holds the old version,
  and that habit grew the v1.37 integration document to 79 KB, mostly audits.
- **Git's conflict set is an anti-signal when taking upstream work.**  In the v1.37
  merge every genuine defect was in a file that merged cleanly.  Diff the
  *contract* surfaces — runtime options, gateway addressing, provider context —
  and write one test per contract driving every provider with the ids
  deliberately unequal (`server/modules/websocket/tests/chat-session.test.ts`).
- Categorize fixes as fork-only or upstreamable in `docs/upstream.md`.
  Before calling a defect upstream-wide, inspect upstream code, not just issues/PRs.
  Never open, push, or update an upstream PR without the user's explicit approval.
- **Never end a turn by asking "worth an ADR?"** — write one only when asked, or
  when a decision is the kind a future session would otherwise undo (a deliberate
  constraint that looks like a bug); then write it in the same batch as the work,
  in five sentences.  Otherwise the commit message is the record.  ADRs
  are append-only: supersede, never rewrite.

## Keeping the guides honest

Write a durable fact to the file that owns it and route to it, rather than into
whichever file you happen to have open.  Ownership:

- **`ARCHITECTURE.md`** owns the system's shape, code map, invariants and quality
  goals.  **This file** owns workflow, verification, project-wide rules, and the
  routing table above.  It is published on the fork, so it
  carries **no host detail** — no home paths, hostnames, ports, or unit names.
- **`docs/`** owns depth, in four types, each answering one question: a
  **reference doc** (`docs/*.md`) "how does this work today", an **ADR**
  (`docs/decisions/`) "what did we choose and why", a **design** (`docs/designs/`)
  "what will it look like when done", a **plan** (`docs/plans/`) "what is left, in
  what order".  A design binds every phase of its plan and changes only with
  Grayson: if it is wrong, stop and say so.  Anything else does not need a
  document, and nothing is archived: finished work is deleted, and git keeps it.
  Byte caps and banned sections are in the plans and designs READMEs, enforced by
  `npm run check:docs`, which also rejects any other folder under `docs/`.  Do not
  invent a fifth type to escape them.
- **Each agent's global config** owns the host — paths, ports, services, the
  deploy loop.  This repo is published, so it holds none of it.  The two files
  are not shared: Claude Code reads `~/.claude/CLAUDE.md`, Codex reads
  `~/.codex/AGENTS.md`, neither reads the other.  Record a host fact in both, or
  the other agent cannot know it.  Both load in every checkout, so a worktree
  needs no setup.

Restating a rule a linter, type checker, or test already enforces is not documentation
— make the gate executable instead.

## Safety

- Never use a destructive operation on user documents, especially `docs/TODO.md` or
  `UI Visual References/`.  To stop tracking a file while keeping it on disk, use
  `git rm --cached`, never `git rm`.
- Do not delete or modify real user sessions, projects, credentials, or databases
  unless the user explicitly authorizes the exact scope.
- **Never drive a browser into the session you are running in** — clicking your own
  session id, its Shell especially, disconnects the conversation you are having.  If you
  cannot tell which id is yours, click none.
