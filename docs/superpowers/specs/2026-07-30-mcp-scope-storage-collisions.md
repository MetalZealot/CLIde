# MCP scope storage collisions

- Date: 2026-07-30
- Status: Source assessment complete; implementation deferred to a fresh
  session
- Scope: Prevent CLIde from listing or mutating one provider MCP configuration
  file as both user and project scope
- Observed providers: Codex and Cursor
- Upstream status: Present in the locally fetched `upstream/main` at
  `v1.37.0` (`264e0946d2a168c281b85807cd1183130f40b090`);
  likely upstreamable after CLIde verification

## Executive decision

Fix this at the provider configuration-storage boundary, not by deduplicating
server names in the React client.

When a provider's requested project scope resolves to the same configuration
storage target as its user scope:

1. listing that project scope must return no second copy;
2. add, edit, and delete operations against that project scope must fail before
   reading or writing provider configuration;
3. the error must explain that the project scope aliases the user
   configuration and cannot be represented separately; and
4. legitimate same-name user and project entries in distinct configuration
   files must remain separate.

The first implementation should be a small provider-layer correction with
focused tests. It must not become a general MCP settings redesign, alter
Browser registration, migrate configuration, or restart production.

## Problem statement

CLIde currently has a registered project with:

```text
display name: gnuthall
path:         /home/gnuthall
```

The Codex MCP adapter resolves configuration as:

```text
user scope:
  /home/gnuthall/.codex/config.toml

project scope for /home/gnuthall:
  /home/gnuthall/.codex/config.toml
```

Those are the same file and the same `mcp_servers` table. The Settings MCP
screen nevertheless requests both scopes and assigns different client
identities:

```text
codex:user:global:cloudcli-browser
codex:project:/home/gnuthall:cloudcli-browser
```

As a result, one configured `cloudcli-browser` entry appears twice. The
`openaiDeveloperDocs` entry appears twice for the same reason. The second card
is not evidence of a second registration on disk.

Cursor has the same storage layout:

```text
user scope:
  /home/gnuthall/.cursor/mcp.json

project scope for /home/gnuthall:
  /home/gnuthall/.cursor/mcp.json
```

The current Cursor user configuration also contains `cloudcli-browser`, so the
same defect is reachable there even though it was first reported on the Codex
screen.

Claude does not exhibit this home-project collision:

```text
user:    ~/.claude.json -> mcpServers
local:   ~/.claude.json -> projects[workspacePath].mcpServers
project: <workspace>/.mcp.json -> mcpServers
```

Claude user and local scopes may share a file, but they use distinct logical
tables. That is not a storage collision and must not be collapsed.

## Why this is more than a duplicate-card defect

Managed servers whose names start with `cloudcli-` are rendered read-only, so
the duplicate Browser card cannot currently be edited or deleted through the
screen.

Ordinary duplicated entries are actionable. Deleting the apparent
`project · gnuthall` copy of `openaiDeveloperDocs` currently resolves the
project configuration path to the user configuration file and removes the
user entry. Editing or adding through that apparent project scope likewise
changes the user configuration while the UI claims it is changing only one
project.

A display-only filter would leave those mutation paths unsafe.

## Current source map

Re-read these paths before implementation because the active upstream v1.37
integration may move them:

| Concern | Current path | Relevant behavior |
|---|---|---|
| Shared MCP operations | `server/modules/providers/shared/mcp/mcp.provider.ts` | Resolves the workspace and performs list, upsert, and remove without checking whether scopes share storage. |
| Codex storage | `server/modules/providers/list/codex/codex-mcp.provider.ts` | Uses `~/.codex/config.toml` for user scope and `<workspace>/.codex/config.toml` for project scope. |
| Cursor storage | `server/modules/providers/list/cursor/cursor-mcp.provider.ts` | Uses `~/.cursor/mcp.json` for user scope and `<workspace>/.cursor/mcp.json` for project scope. |
| Claude storage | `server/modules/providers/list/claude/claude-mcp.provider.ts` | Uses separate path/table identities and must remain unchanged. |
| OpenCode storage | `server/modules/providers/list/opencode/opencode-mcp.provider.ts` | Selects `opencode.json` or `opencode.jsonc`; audit its resolved user/project targets before deciding whether it needs the same guard. |
| Service/global add | `server/modules/providers/services/mcp.service.ts` | Iterates providers and reports per-provider success/failure; it is not transactional. |
| MCP routes | `server/modules/providers/provider.routes.ts` | Exposes scoped list, upsert, delete, and all-provider add. |
| Client merge identity | `src/components/mcp/hooks/useMcpServers.ts` | Correctly includes provider, scope, workspace, and name; do not weaken it. |
| MCP form | `src/components/mcp/hooks/useMcpServerForm.ts` and `src/components/mcp/view/modals/McpServerFormModal.tsx` | Lists every CLIde project for provider project scope. |
| Browser registration | `server/modules/browser-use/browser-use.service.ts` | Correctly registers `cloudcli-browser` at user scope for all providers. |
| Provider tests | `server/modules/providers/tests/mcp.test.ts` | Has file-backed user/project coverage but no same-storage collision case. |

The implementation was introduced upstream in `49dd3cf` and remains unchanged
in the locally fetched upstream v1.37 source. Do not call a future upstream
version affected without rechecking it.

## Provider and Codex semantics

Codex documents user configuration and project configuration as distinct
precedence layers:

- user defaults live in `~/.codex/config.toml`;
- trusted project overrides live in `.codex/config.toml` files inside a
  project; and
- project layers take precedence over user configuration.

Reference:
[Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
and
[Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#project-config-files-codexconfigtoml).

CLIde does not need to reproduce Codex's entire trust and hierarchical
configuration loader to fix this issue. It does need to avoid pretending that
one physical file and logical table are two independently writable scopes.

## Required behavior

### Listing

For a scoped list request:

```text
GET /api/providers/:provider/mcp/servers
  ?scope=project
  &workspacePath=<path>
```

if that scope's storage identity equals the provider's user-scope storage
identity, return a successful empty project list. The user-scoped request
continues to return the configured entries.

Do not return an error during Settings background refresh. A known alias is not
a broken configuration file, and an error banner would make a safely skipped
duplicate look like provider failure.

### Mutations

For upsert and delete requests that target a colliding project scope, reject
before reading or writing the configuration file.

Use an `AppError` with a stable code such as:

```text
MCP_SCOPE_STORAGE_COLLISION
```

`409 Conflict` is preferred because both scopes are individually valid but
cannot be represented as distinct targets at that workspace. A clear message
should name the provider and explain that the selected project uses the
provider's user MCP configuration file.

The exact error code may follow a newer repository convention, but it must be
stable enough to test and must not expose tokens, headers, environment values,
or other config contents.

### Storage identity

Collision detection must compare both:

1. the canonical configuration path; and
2. the logical MCP table within that file.

Path-only comparison is insufficient for Claude user/local scopes because
they intentionally share `~/.claude.json` while addressing different tables.

For the observed Codex and Cursor cases, a provider-local identity can be as
small as:

```ts
type McpStorageIdentity = {
  configPath: string;
  tableKey: string;
};
```

The implementing session may use an equivalent internal representation. Keep
it provider-owned; the React client should not reconstruct provider filesystem
rules.

Normalize absolute paths before comparison. If the implementation can resolve
existing symlinks without turning a missing project config into an error, do
so; otherwise the first patch may cover canonical lexical paths and document
symlink aliases as a tested follow-up. Never create a config file merely to
compare paths.

### Scope preservation

These are not duplicates and must continue to list independently:

```text
~/.codex/config.toml:
  [mcp_servers.docs]

<different-project>/.codex/config.toml:
  [mcp_servers.docs]
```

The same applies to Cursor and every other provider. Project configuration
normally overrides or supplements user configuration; identical server names
across distinct scope targets are meaningful.

## Recommended implementation shape

Prefer one small shared guard rather than client filtering or copy-pasted
public-operation overrides.

One acceptable design is:

1. add a protected provider hook in `McpProvider` that reports whether a
   resolved scope/workspace target conflicts with another logical scope;
2. default it to no conflict;
3. invoke it after scope/workspace normalization:
   - scoped list returns `[]` when it reports a collision;
   - upsert and remove throw the reported `AppError` before reading;
4. implement storage identities/collision detection in Codex and Cursor; and
5. audit OpenCode's dynamically selected JSON/JSONC paths and add the same
   override only if its user and project identities can coincide.

The hook may return a small structured conflict rather than an `AppError`
directly if that keeps error construction in the shared layer. Do not expose
configuration paths to the browser merely to perform deduplication.

If the then-current provider architecture makes an adapter-local guard
materially smaller while still protecting list, upsert, and remove, that is
acceptable. It must be impossible for a new mutation path to bypass the guard
silently.

## All-provider add behavior

`addMcpServerToAllProviders()` currently performs best-effort sequential
writes and reports individual results. It is not transactional.

The implementing session must add a focused test for an all-provider project
add whose workspace aliases Codex/Cursor user storage. At minimum:

- Codex and Cursor user config bytes must remain unchanged;
- their results must report failure with the collision reason; and
- the client must continue surfacing the partial failure.

A deterministic preflight that rejects the whole all-provider request before
any provider write would be safer, but it changes the existing best-effort
contract and is not required for the first fix. Do not introduce transactional
or rollback semantics without separately assessing the global-add product
contract.

## UI scope

No React change is required to remove the duplicate cards if the backend
returns an empty colliding project scope.

The project selector will still offer a project target that the backend cannot
represent separately. The server rejection is the required safety boundary.
An optional later refinement may expose per-provider, per-project scope
availability so the form can disable that target with an explanation.

Do not infer the server home directory in browser code, hardcode
`/home/gnuthall`, filter a project by display name, or deduplicate by MCP server
name. If UI target availability is added, it must come from provider-owned
backend metadata and must also handle the all-provider form honestly.

## Non-goals

This fix does not:

- change the `cloudcli-browser` command, arguments, URL, token, or registration
  scope;
- add or remove any real MCP entry;
- migrate `~/.codex/config.toml`, `~/.cursor/mcp.json`, `.mcp.json`, or
  `opencode.json`;
- change Codex trust policy or reproduce its full config-layer discovery;
- merge user and project MCP entries based on name or content;
- change provider precedence;
- redesign the MCP Settings screen;
- make global add transactional;
- modify `auth.db`, project rows, sessions, or provider authentication;
- implement the separately specified Browser MCP hardening work; or
- restart production or replace an occupied branch-test service.

## Test plan

Extend `server/modules/providers/tests/mcp.test.ts` using disposable temporary
homes and workspaces.

### Codex collision

1. Patch `os.homedir()` to a temporary root.
2. Use that same root as `workspacePath`.
3. Seed one user MCP entry.
4. Assert user scope lists it once.
5. Assert project scope lists no entries.
6. Attempt project upsert and remove.
7. Assert both reject with the collision code.
8. Compare the user config bytes before and after each attempt.

### Cursor collision

Repeat the same assertions for `~/.cursor/mcp.json`.

### Distinct scopes remain distinct

Use a workspace nested away from the temporary home config target. Put the
same server name in user and project configurations with different values.
Assert both scopes list independently and that mutations affect only the
selected file.

### Claude regression

Confirm Claude user, local, and project behavior remains unchanged,
particularly that user and local scopes sharing `~/.claude.json` do not
collide because they use different logical tables.

### OpenCode audit

Exercise the resolved user and project path identities selected by
`resolveOpenCodeConfigPath()`. If they can coincide, require the same list and
mutation behavior. If they cannot under supported project targets, record that
conclusion in the test or implementation notes rather than adding speculative
code.

### Global add

Use the colliding home workspace with disposable provider configs. Verify that
Codex/Cursor report a failure and their user config bytes do not change.
Preserve and explicitly assert the current behavior of the other providers;
do not accidentally imply an atomic contract.

## Verification commands

Before heavier work on the Raspberry Pi, check available memory with
`free -h`. Use the repository-pinned Node runtime and local tools.

Focused test:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/mcp.test.ts
```

Then:

```bash
npm run typecheck
npm run lint
npm run build:server
```

If the optional client availability UI is implemented, also run:

```bash
npm run build:client
```

There is no `npm test`.

## Live verification

Use a fresh topic branch/worktree from the then-current `main`; first claim or
add the corresponding `TODO.md` item according to repository coordination
rules. Do not implement in an occupied integration worktree.

For an isolated live check:

1. snapshot the branch-test provider configs using the existing harness;
2. open Codex MCP Settings and confirm `cloudcli-browser` and
   `openaiDeveloperDocs` each appear once;
3. open Cursor MCP Settings and confirm `cloudcli-browser` appears once;
4. confirm Claude remains unchanged;
5. add the same disposable MCP name at user and ordinary project scope and
   confirm both distinct cards remain visible;
6. attempt the colliding project mutation through an authenticated request and
   confirm the user config fingerprint is unchanged; and
7. remove all disposable test entries from the branch-test snapshots.

Do not edit the real user MCP configs to manufacture the test. Do not expose
config secrets in logs, screenshots, test output, or the spec.

A server change requires `npm run build:server` and an isolated server restart
for live verification. Do not restart `cloudcli.service` or replace production
port 3001 from an agent session without Grayson's explicit approval. Keep the
topic branch/worktree isolated until Grayson has personally verified the live
behavior.

## Acceptance criteria

- Codex shows one `cloudcli-browser` card for the `/home/gnuthall` project
  inventory.
- Codex shows one `openaiDeveloperDocs` card for the same inventory.
- Cursor does not duplicate a user MCP entry through the home project.
- A colliding project mutation cannot change, delete, or replace a user MCP
  entry.
- The server returns a stable, actionable collision error for mutations.
- Legitimate same-name user/project entries in different storage targets
  remain separately visible and editable.
- Claude scope behavior is unchanged.
- Browser MCP registration remains user-scoped and unchanged.
- Global-add collision behavior is tested and user config bytes are preserved.
- Focused tests, typecheck, lint, and server build pass.
- No production service, real provider config, database, session, or project
  row is changed during automated verification.

## Upstream classification

The defect is present in the local upstream v1.37 source and originated in the
upstream provider/MCP refactor. A provider-layer fix with disposable tests is a
good upstream candidate because it is independent of CLIde's Browser feature
and applies to ordinary MCP entries.

Before describing it as still upstream-wide or preparing a contribution,
refresh and inspect current `upstream/main` plus open upstream issues and pull
requests. Do not open, push, or update an upstream issue or PR without
Grayson's explicit approval.

## Handoff checklist

The implementing session should begin by:

1. reading `AGENTS.md`, `TODO.md`, this spec, and any newer MCP/provider ADR;
2. checking `git status --short`, current worktrees, branch occupancy, and
   available memory;
3. confirming the active provider paths and upstream status have not changed;
4. reproducing the duplicate from disposable config fixtures before editing;
5. implementing the smallest server-side storage collision guard;
6. running focused tests before broad validation;
7. reporting source, build artifact, isolated server, and production status as
   separate deployment layers; and
8. leaving production restart and final live acceptance to Grayson.

This document authorizes no implementation, config mutation, service restart,
push, merge, or upstream action by itself.
