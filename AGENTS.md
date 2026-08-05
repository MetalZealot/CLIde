# CLIde agent guide

CLIde is Grayson's personal fork of `siteboon/claudecodeui`.  Use **CLIde** when
talking about the product.  Do not rename the checkout, package, or systemd service:
their existing names and paths are intentional.

## Start here

Before changing code:

1. Run `git status --short`, inspect active worktrees/branches when relevant, and
   preserve unrelated user changes.
2. Read the relevant open item in `docs/TODO.md`.  It is the tracked backlog and the
   coordination board for concurrent work.
3. Read relevant ADRs in `docs/decisions/`.  Treat Claude-specific project history as
   provider-specific context, not as a reason to assume the same behaviour applies to
   another provider.
4. If present, consult the ignored local `CLAUDE.md` for additional architecture and
   deployment context.  Do not add or commit that file.

## Architecture and compatibility

- The backend is Express + WebSocket under `server/`, fully migrated into
  `server/modules/` as of upstream 1.37; the frontend is React 18, Vite, and Tailwind
  under `src/`.  Shared types and utilities live in `shared/`.  `server/routes/`,
  `server/utils/`, `server/services/`, `server/middleware/`, and the flat adapter files
  at `server/`'s root are gone — be suspicious of any doc or memory that names them.
- Providers are adapters.  Claude is the daily driver, but shared UI, protocol,
  database, and provider-interface work must continue to work for Codex, Cursor, and
  OpenCode.  Add capability flags or clean no-op behaviour instead of leaking
  Claude-only concepts into shared code.
- The app owns stable `session_id`s; `provider_session_id` is the provider's native
  ID.  Do not confuse them when tracing transcripts, watchers, or database rows.
- `~/.cloudcli/auth.db` is user data outside the repo.  Back it up before any
  schema/auth/data write.  Treat live-session tests as stateful: clean any test data
  from the filesystem before its database rows so the watcher cannot rediscover it.

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
  root tsconfig maps `@/*` to `src/*` while the server maps it to `server/*`.
- Small client-only changes: `npm run build:client`, then refresh the running app.  A
  server restart is not needed for client bundles.
- Verify on the server that actually serves the checkout you edited.  The main
  checkout's server does not serve a worktree's `dist/`, so worktree work is never
  verified there — use that worktree's own test server.  Never tell the user to refresh
  the main app for a change that only exists on a topic branch.
- Iterative visual work may use the `cloudcli-dev` Vite service on port 5173; never
  run plain `npm run dev`, which conflicts with the production server.  The dev page
  is not an installed PWA, so verify standalone/safe-area/mobile-PWA behaviour against
  the installed app served on port 3001.
- Server changes need `npm run build:server`; do not restart the production service
  from an agent session unless the user explicitly asks and the environment permits it.
- Use the real device for touch behaviour.  In particular, CSS `:active` is not a
  reliable long-press visual state; use the explicit `isPressing` state from
  `useLongPress`.
- Make the smallest coherent change that fully solves the request. Follow existing
  patterns; do not broaden scope, add speculative abstractions, or compromise working
  behaviour merely to reach completion.
  
## Project invariants

- Do not introduce `backdrop-filter`/glassmorphism.  Use a solid dim scrim such as
  `bg-black/50`.
- Keep PWA manifest icons `purpose: "any"`; adding `maskable` causes a Samsung white
  box.  For logo work, edit the masters in `designs/` and run
  `designs/regenerate-assets.py`; never hand-edit generated assets in `public/`.
- Claude emits synthetic, zero-usage transcript rows.  If touching Claude token usage,
  preserve the equivalent skip guard in all three paths: live extraction, the
  `/token-usage` endpoint, and history extraction.  Codex accounting is separate.
- For session starring, retain `isStarred` in both fetch and watcher event paths and
  apply `compareSessionsStarredFirst` on every session-list surface.
- Claude model/transcript logic is subtle.  The transcript is ground truth for what
  ran, but validate transcript-derived values before they can reach a model argument.
  Read the model-picker notes and TODO follow-ups before changing it.

## Git, backlog, and upstream workflow

- `main` is the long-lived CLIde branch and tracks `origin/main` on the user's
  `MetalZealot/CLIde` fork. `upstream/main` is the clean
  `siteboon/claudecodeui` line; a separate local upstream mirror is unnecessary.
- Make self-contained commits only after appropriate verification.  For parallel work,
  claim the TODO item and create a worktree/topic branch from `main`, then merge it
  back into `main`; do not switch the main checkout while its service or dev server is
  using it.
- Keep `docs/TODO.md` current: use `[ ]`, `[~]`, and `[x]`; move verified work to
  `docs/todo-done.md` as a short record with its commit.  Git history and ADRs are the
  canonical detail.
- Categorize fixes as fork-only or upstreamable.  Before describing a defect as
  upstream-wide, inspect upstream code as well as searching issues/PRs.  Never open,
  push, or update an upstream PR without the user's explicit approval.
- When work creates a non-obvious lasting decision, ask whether it merits a new ADR.
  ADRs are append-only: supersede a prior decision rather than rewriting history.

## Safety

- Never use a destructive operation on user documents, especially `docs/TODO.md` or
  `UI Visual References/`.  To stop tracking a file while keeping it on disk, use
  `git rm --cached`, never `git rm`.
- Do not delete or modify real user sessions, projects, credentials, or databases
  unless the user explicitly authorizes the exact scope.
