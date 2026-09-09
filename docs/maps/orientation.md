# How CLIde works — orientation

Written for Grayson, not for an agent. Every other document in `docs/` assumes you
already know the architecture; this one doesn't. Nine areas, each with the one rule
that governs it and what goes wrong when the rule is broken.

Nothing here is implementation detail — it is the set of assumptions the code is built
on. When an agent proposes a change that contradicts one of these, that is the moment
to stop and ask, whether or not you can read the diff.

---

## 1. Every conversation has two IDs, and only one of them is an address

CLIde mints its own id for a session (`session_id`) and stores it in its database.
The provider — Claude Code, Codex — separately writes its own id (`provider_session_id`)
into its own transcript file on disk. They are different strings for the same
conversation.

**The rule:** a running process is only ever addressed by CLIde's id. The provider's id
is a lookup key — used to find the right file — never a way to reach a running session.

**What breaks:** send, abort, or resume goes to the wrong process or none at all, and a
single conversation splits into two sidebar rows. This caused three separate bugs in one
upstream merge, so it is the assumption most worth protecting.

## 2. Providers are adapters, and shared code must not know their names

Claude, Codex, Cursor and OpenCode each have a folder under
`server/modules/providers/list/`. Everything above them — the UI, the websocket layer,
the database — is supposed to work the same regardless of which one is running.

**The rule:** shared code asks *what can this provider do*, never *which provider is
this*. There are ten capability flags for exactly this (`supportsAbort`,
`supportsFork`, `supportsRewind`, `supportsImages`, and so on), served by
`provider-capabilities.service.ts`.

**What breaks:** a feature built for Claude with an `if (provider === 'claude')` check
either silently does nothing on Codex or crashes it. Because Claude is your daily
driver, you will not notice until you open a Codex session days later — which is
precisely the delayed-bug pattern.

## 3. The transcript file is the truth about what ran

Providers write an append-only log of the conversation to disk. CLIde reads it. Whatever
the UI shows, whatever the database recorded, whatever model you *think* was selected —
the transcript is the record of what actually happened.

**The rule:** read the transcript to establish what ran, but validate anything taken from
it before feeding it back into a command. It is trustworthy as history and untrustworthy
as input.

**What breaks:** a value scraped from an old transcript gets passed as a live model
argument, and a session silently resumes on a different model than it started on.

## 4. A watcher rediscovers anything left on disk

`sessions-watcher.service.ts` watches the providers' transcript directories and pushes
any session it finds into the sidebar automatically. This is how a session started
outside CLIde still shows up.

**The rule:** when removing a session, delete the file on disk *before* the database row.
Do it in the other order and the watcher re-adds it in the gap.

**What breaks:** deleted sessions reappear, and test runs leave real-looking projects and
conversations in your sidebar.

## 5. Token counting exists in three places that must agree

The number behind the context ring is assembled by three separate pieces of code: one
for the live stream, one for the API endpoint the UI polls, one for reading a session's
history. Claude also writes fake zero-usage rows into transcripts (error notices,
session-limit messages), and all three paths have to skip them identically.

**The rule:** any change to how Claude usage is counted gets made in all three, in the
same edit.

**What breaks:** the context ring goes blank or reads zero, usually only on sessions that
hit a limit — so it looks intermittent and unrelated to whatever was changed.

## 6. Merged, built, and live are three different facts

`dist/` is the browser code, built by `npm run build:client`. The server reads it from
disk on every request, so a rebuild plus a browser refresh is a complete deploy.
`dist-server/` is the backend, built by `npm run build:server`, and only a restart picks
it up. A merge changes source only; it does not install dependencies, rebuild either
artifact, or replace the already-running server process.

**The rule:** establish each boundary separately: source merged, dependencies current,
client and server built from that source, then the current server process running that
build. Frontend-only work can still use `build:client` then refresh; anything crossing
dependencies or the backend uses the production deployment path that verifies every
boundary.

**What breaks:** you refresh, see no change, and conclude the fix failed when it was
never built or loaded. Or “merged” is mistaken for “live” while production keeps serving
an older client, server, or dependency set.

## 7. Which port you check is not a judgment call

3001 is production, serving the main checkout. 3002 is the branch-test server, serving a
worktree. 5173 is the Vite dev server with hot reload, and it is pinned to the main
checkout.

**The rule:** verify on the port that serves the checkout that was edited. Work done on a
branch in a worktree does not exist on 3001, by definition.

**What breaks:** you're sent to refresh 3001 for a change that only exists on a branch,
see nothing, and both of you start debugging a bug that isn't there.

## 8. The database is outside the repo, so git cannot undo it

Your logins, sessions and project rows live in `~/.cloudcli/auth.db`, deliberately
outside the checkout so that working-tree changes can't destroy them. The tradeoff is
that `git checkout` and `git stash` can't rescue them either.

**The rule:** back it up before anything touching auth, schema, or migrations —
`cp ~/.cloudcli/auth.db ~/.cloudcli/auth.db.bak-<label>`. There is no other undo.

**What breaks:** a bad migration is permanent.

## 9. Documents have three types and hard size caps

A **map** (`docs/maps/`) answers "how does this work today". An **ADR**
(`docs/decisions/`) answers "what did we choose, and why". A **plan**
(`docs/plans/`) answers "what is left, in what order". `npm run check:docs` enforces a
byte cap on each — 8 KB for a plan, 24 KB for a map, 10 KB for an ADR.

**The rule:** when a document and reality disagree, edit the document. Never append a
correction or an audit section to preserve the wrong text.

**What breaks:** the caps exist because the previous system reached 317 KB across
eighteen files, one of them 79 KB, whose two largest sections were both audits appended
rather than edits made. Documents that expensive stop being read, and documents nobody
reads drift into being confidently wrong.

---

## When to stop and ask

You do not need to understand a diff to catch these. If a proposed change would:

- pass a provider's own id to something that runs a session (1);
- branch on a provider's name in shared code (2);
- feed a transcript value into a live command without checking it (3);
- delete a database row for a session whose file is still on disk (4);
- change Claude token counting in fewer than three places (5);
- reach the backend but end with "just refresh" (6);
- ask you to verify a branch's work on 3001 (7);
- touch auth, schema, or migrations without a backup first (8);

— then say so. Being able to name the rule is enough; you don't have to be able to prove
the violation. Asking is cheap, and every one of these is expensive to find later.
