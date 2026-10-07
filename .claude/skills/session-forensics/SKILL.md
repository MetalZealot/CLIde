---
name: session-forensics
description: Locate a CLIde session and establish which id space you hold. Use when asked to find, inspect, or trace a specific session or its transcript; when a session appears duplicated, orphaned, missing from the sidebar, or attached to the wrong project; when reconciling a session id against a provider's on-disk file; or before deleting session rows or transcripts. Not for model-picker, token-usage, or general chat work.
---

# Session forensics

Five stores hold session state. Confusing them, or the two id spaces, is the
recurring failure this skill exists to prevent. Read-only unless the user
authorized a specific write.

## Two id spaces

- **`session_id`** — the id CLIde mints and owns. Stable across resume and fork.
  **The only id a runtime is addressed by.** The frontend uses it for the whole
  session lifetime; it is what appears in a CLIde URL.
- **`provider_session_id`** — the provider's own on-disk id (JSONL filename,
  store row). A **lookup key, never an address.** Filled in once the provider
  announces its id mid-run, or equal to `session_id` for sessions the watcher
  discovered on disk.

Before passing an id to a runtime, confirm which one you hold. ADRs 0008, 0012
and 0013 record what goes wrong when they are confused.

## Five stores

| Store | Path | Holds |
|---|---|---|
| App database | `~/.cloudcli/auth.db` | `sessions`, `session_provider_aliases`, `projects` — all providers in one table |
| Claude transcripts | `~/.claude/projects/<path-slug>/<provider_session_id>.jsonl` | One dir per project, slug = cwd with `/` → `-` |
| Codex transcripts | `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<provider_session_id>.jsonl` | Date-partitioned, not project-partitioned |
| Cursor transcripts | `~/.cursor/projects/**/<provider_session_id>.jsonl` | Workspace path recovered from the sibling `worker.log` |
| OpenCode | `~/.local/share/opencode/opencode.db` | One shared SQLite database for every session; `sessions.jsonl_path` is null |

Worktrees get their own Claude project dir, so one CLIde project can have
sessions under several slugs.

## Start here — resolve an unknown id

The id you were handed could be either space. The sidebar row menu's copy action
offers both, labelled: "CLIde" is the `session_id`, the provider's name is the
`provider_session_id`. When the label is unknown, this settles it in one query:

```bash
sqlite3 ~/.cloudcli/auth.db \
  "select 'app-row' src, session_id, provider_session_id, provider, project_path
     from sessions where session_id='<ID>'
   union all
   select 'provider-id', session_id, provider_session_id, provider, project_path
     from sessions where provider_session_id='<ID>'
   union all
   select 'alias(superseded)', session_id, provider_session_id, provider, ''
     from session_provider_aliases where provider_session_id='<ID>';"
```

- **`app-row`** → you hold a `session_id`. Safe to address a runtime with.
- **`provider-id`** → you hold a provider id. Use the returned `session_id` to
  address anything; never pass this one to a runtime.
- **`alias(superseded)`** → a tombstone. This provider id was merged into the
  returned `session_id`; the transcript may still exist on disk. Not a live session.
- **No rows** → the transcript exists but no row claims it, or the id is wrong.
  Search the filesystem before concluding it is missing.

## Find the transcript

```bash
# Claude — by provider id, across all project slugs including worktrees
find ~/.claude/projects -name '<PROVIDER_ID>.jsonl'

# Codex — filename embeds the provider id
find ~/.codex/sessions -name '*<PROVIDER_ID>.jsonl'
```

`sessions.jsonl_path` may hold the path directly; treat it as a hint, not truth —
it goes stale when a project moves.

## Reading a transcript

They are large (the cloudcli project dir alone exceeded 126 MB in Aug 2026). **Never bulk-read
or `cat` one.** Extract with `jq`, write intermediates to `/tmp`, read back only
aggregates. For the first user message — useful for identifying an orphan:

```bash
jq -r 'select(.type=="user") | .message.content
       | if type=="array" then (.[]|select(.type=="text")|.text)
         elif type=="string" then . else empty end' <FILE> 2>/dev/null | head -3
```

## Known trap: two sidebar rows from one session

Aborting a **new** session's *first* message orphans it into two rows. The abort
trips before the SDK yields any message, so `assignProviderSessionId` never fires
while the CLI has already written the JSONL — the watcher then indexes it as a
second session. This is a missing-trigger bug, not a corrupted database; do not
"repair" rows by hand. Details in `docs/code-anchors.md`.

## Before any write

The database is real user data and lives outside the repo, so a working-tree
revert cannot restore it.

1. Back up: `cp ~/.cloudcli/auth.db ~/.cloudcli/auth.db.bak-<label>`
2. Delete **filesystem before database rows** — the watcher re-discovers a
   transcript whose row you already removed, recreating the session. OpenCode
   sessions have no per-session file: never delete or edit `opencode.db` to
   remove one.
3. Only touch the exact scope the user authorized. Never clean up "obviously
   stale" sessions unasked.
