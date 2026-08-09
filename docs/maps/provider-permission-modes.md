# Provider permission and mode surfaces

Maps Claude and Codex permission concepts **by behaviour**, because similarly
named modes are not equivalent. Surveyed 2026-07-25 against the official SDK and
CLI documentation, `@anthropic-ai/claude-agent-sdk` 0.3.217, `@openai/codex-sdk`
0.144.6, and CLIde's `main`. These surfaces move quickly — recheck the pinned
versions before relying on a detail.

Three findings that make the rest worth reading:

- **A single shared permission-mode enum is not a safe abstraction.** Claude
  modes bundle tool-approval behaviour into one value. Codex controls the
  sandbox boundary, approval policy, approval reviewer, network access, and
  collaboration mode *separately*.
- **Some current CLIde mode names are false friends.** Claude `acceptEdits`
  auto-approves file operations but leaves other commands under normal
  permission handling. CLIde maps Codex `acceptEdits` to
  `workspace-write + never`, which runs everything the workspace sandbox permits
  without prompting. Those are not the same authority.
- **Plan is intent, not a security policy.** Claude Plan stops source edits from
  being auto-approved while allowing exploration; Codex Plan is a collaboration
  mode whose sandbox and approval policy remain independent. UI copy reading
  "no commands are executed" is therefore inaccurate on both.

Normalizing the *interactive request lifecycle* — reconnect, rendering, response
UX — is sound and is what CLIde should share. Normalizing the permission engines
underneath it is not.

## "Ask Before Tools" sends Claude's native mode explicitly

The composer labels Claude's internal `default` value **Ask Before Tools** and
forwards it explicitly to the Agent SDK. It no longer omits the value and silently
inherits `~/.claude/settings.json` → `permissions.defaultMode`, which previously
allowed a picker displaying "Default" to run as `acceptEdits`. Settings allowlists
and Bash sandboxing still participate in Claude's ordered policy evaluation, so
the label describes the native mode rather than claiming that every tool must ask.

Useful while testing: `TOOLS_REQUIRING_INTERACTION` (`AskUserQuestion`,
`ExitPlanMode`) is checked *before* the bypass/allow/deny block, so those two always
prompt regardless of mode or allowlist.

Cursor's picker is mostly cosmetic for a different reason: the capability matrix
advertises Default / Accept Edits / Bypass / Plan, but `spawnCursor` never reads
`permissionMode` — only `toolsSettings.skipPermissions` does anything, adding `-f`.
The CLI does support `--mode=plan`, with `--force` as the write/auto-approval
control, so either the adapter needs a real mapping or the matrix should stop
advertising modes it does not implement.

This document's 2026-07-25 proposal for a provider-neutral intent picker (Ask
before changes, Edit workspace, Auto in workspace, …) was not adopted and is not
queued. It was removed on 2026-08-06 and is recoverable from this file's history
with `git log --follow -p`.

## 1. Native mental models

### 1.1 Claude: ordered tool-permission evaluation

Claude's Agent SDK evaluates a proposed tool use through an ordered stack:

1. hooks;
2. explicit deny rules;
3. explicit ask rules;
4. the active permission mode;
5. explicit allow rules;
6. the `canUseTool` callback for anything still unresolved.

The named permission mode is therefore only one part of Claude's policy.
`allowedTools`, `disallowedTools`, settings-file rules, hooks, interactive
tools, and SDK callbacks can still affect the result.

Claude's current SDK modes are:

| Native mode | Native behavior |
|---|---|
| `default` | No mode-level auto-approval; unmatched tool calls reach `canUseTool`. |
| `acceptEdits` | Auto-approves file edits and recognized filesystem operations inside the allowed working directories. Other tools retain normal permission handling. |
| `dontAsk` | Never opens an approval prompt. Pre-approved tools run and unresolved requests are denied. |
| `auto` | A model classifier approves or denies permission prompts. |
| `plan` | Explores and plans without automatically approving source edits. Read-only work can continue; attempted writes are routed through permission handling. |
| `bypassPermissions` | Auto-approves tool uses at the mode step. Explicit deny/ask rules and hooks are evaluated earlier and can still intervene. Requires the SDK's explicit dangerous-bypass acknowledgement. |

### 1.2 Codex: independent access and review controls

Codex separates controls that Claude often bundles:

| Control | Question it answers |
|---|---|
| Sandbox / permission profile | What can a spawned command technically read, write, or reach? |
| Approval policy | When should Codex stop before an action? |
| Approval reviewer | Who handles eligible approval requests: the user or an automatic reviewer? |
| Network policy | Which network destinations can commands reach? |
| Collaboration mode | Is the model acting normally, planning, or following another collaboration preset? |
| Rules / policy amendments | Are particular command prefixes allowed, prompted, or forbidden? |

Common sandbox modes:

| Sandbox | Native behavior |
|---|---|
| `read-only` | Inspect files, but do not edit or execute outside the read-only boundary without approval. |
| `workspace-write` | Read and edit within workspace roots and run routine local commands inside the sandbox. |
| `danger-full-access` | Remove the local sandbox boundary. |

Common approval policies:

| Approval policy | Native behavior |
|---|---|
| `untrusted` | Automatically run only commands in Codex's trusted set; prompt for other commands when the client supports approvals. |
| `on-request` | Work inside the sandbox and request approval when Codex needs to cross its boundary. |
| `never` | Do not stop for approval; make a best effort within the selected sandbox and deny unavailable escalations. |
| granular policy | Independently surface or reject sandbox, rule, MCP elicitation, permission, and skill approval categories. |

The reviewer is another independent field:

| Reviewer | Native behavior |
|---|---|
| `user` | Eligible approval requests are shown to the user. |
| `auto_review` | A separate reviewer agent decides eligible boundary-crossing requests. It does not review actions already permitted inside the sandbox. |

Codex's standard low-friction Auto preset is `workspace-write + on-request`.
Full access is `danger-full-access + never`.

## 2. Closest cross-provider mappings

These are behavioral translations, not claims of exact equivalence.

| User intent | Claude translation | Codex translation | Fidelity |
|---|---|---|---|
| Ask before changes | `default` | `read-only + on-request + user` | Similar user experience; Codex is boundary-oriented and more restrictive about commands. |
| Edit workspace, ask about risky commands | `acceptEdits` | `workspace-write + untrusted + user` | Closest practical match; each provider classifies filesystem shell commands differently. |
| Work autonomously inside workspace | No exact named mode; requires an allow-rule policy beyond `acceptEdits` | `workspace-write + on-request + user` | Codex-native intent with no exact Claude preset. |
| AI reviews permission prompts | `auto` | selected sandbox + `on-request + auto_review` | Similar intent. Claude classifies permission prompts; Codex reviews only eligible escalations. |
| Never prompt; stay constrained | `dontAsk` plus explicit allow rules | selected sandbox + `never` | Same interruption policy, different allow model. |
| Plan before implementation | `plan` | Plan collaboration mode plus an independently selected sandbox/approval policy | Intent match only; enforcement differs. |
| Unrestricted machine access | `bypassPermissions` | `danger-full-access + never` | Closest match, though Claude hooks/rules can still block earlier in evaluation. |

Two mappings should not be presented as equivalents:

- Claude `acceptEdits` is **not** Codex `workspace-write + never`.
- Claude `auto` is **not** Codex's standard Auto preset. The closest Codex
  concept is automatic approval review, which requires an interactive approval
  policy and only reviews actions that already need escalation.

## 3. CLIde's current implementation

### 3.1 Shared mode model

The composer currently uses:

```ts
type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'plan';
```

Provider capabilities publish access modes and collaboration modes separately.
The React UI remains provider-neutral while each provider supplies accurate
labels and behavior for its own values.

The composer preserves that separation. A tap or keyboard Tab cycles only the
routine modes a provider exposes: Claude's `default` / `auto` / `acceptEdits`,
or the `default` / `acceptEdits` pair elsewhere. Native Plan and unrestricted
access require an explicit picker selection. A touch long-press opens that
complete picker, while desktop exposes the same picker through a chevron and
places Codex Build / Plan beside the access control. Mobile keeps Build / Plan
in the complete picker and marks active Plan on the composer access icon.

Current capability lists after the App Server feature:

| Provider | Access modes exposed | Collaboration modes |
|---|---|---|
| Claude | `default`, `auto`, `acceptEdits`, `bypassPermissions`, `plan` | none; Plan is a native permission mode |
| Codex App Server | `default`, `acceptEdits`, `bypassPermissions` | `build`, `plan` |
| Codex SDK fallback | `default`, `acceptEdits`, `bypassPermissions` | none |
| Cursor | `default`, `acceptEdits`, `bypassPermissions`, `plan` | none |
| OpenCode | `default`, `acceptEdits`, `bypassPermissions`, `plan` | none |

The fallback difference is significant: the Codex TypeScript SDK wraps
non-interactive `codex exec --json` and cannot round-trip interactive approval
requests. The App Server transport can.

### 3.2 Claude adapter

CLIde forwards every selected composer mode, including native `default`, to the Agent SDK and
supplies:

- `allowedTools`;
- `disallowedTools`;
- the Claude Code built-in tool preset;
- a `canUseTool` callback that creates CLIde interactive requests;
- extra planning tools when the selected mode is `plan`.

The global Claude `skipPermissions` setting overrides the composer selection
with `bypassPermissions`, except when the composer is in Plan. The UI can
therefore display one selected mode while the adapter executes another.

The settings page exposes quick-add allow/deny entries such as
`Bash(git log:*)`, `Read`, `Write`, and `WebSearch`. CLIde's own matcher only
implements exact tool names and `Bash(prefix:*)`; it does not implement
Claude's complete permission-rule language. A future advanced UI must label
this subset accurately or delegate rule evaluation entirely to Claude.

The installed Agent SDK declares that `bypassPermissions` requires
`allowDangerouslySkipPermissions: true`. CLIde does not currently populate
that explicit acknowledgement. This needs a focused adapter test before the
permission UI is revised.

CLIde also contains a comment saying Claude `auto` and `bypassPermissions`
prevent `AskUserQuestion` and `ExitPlanMode` from reaching `canUseTool`.
Current Anthropic documentation says tools that require user interaction still
force the callback in those modes. Test the pinned SDK and bundled Claude Code
version, then update either the adapter or the stale comment.

### 3.3 Codex SDK and App Server adapters

Both Codex paths translate access presets as follows:

| CLIde mode | Codex sandbox | Codex approval policy | Effective meaning |
|---|---|---|---|
| `default` | `workspace-write` | `untrusted` | Workspace edits can proceed; only trusted commands auto-run. |
| `acceptEdits` | `workspace-write` | `never` | Everything available inside the workspace sandbox runs without prompts. |
| `bypassPermissions` | `danger-full-access` | `never` | No sandbox and no approval prompts. |

Consequences:

- Codex `acceptEdits` is displayed as **Auto in Workspace**.
- Codex `default` is displayed as **Ask When Needed**.
- Codex `bypassPermissions` is displayed as **Full Access**.
- App Server Plan/Build is selected independently beneath those access presets;
  Build is translated to native collaboration mode `default` on every turn.
- App Server currently sets `approvalsReviewer: 'user'` explicitly; Codex
  automatic review is not exposed.
- The SDK fallback cannot display the prompts produced by `untrusted`, so the
  transport capability changes the effective UX of the same selected mode.

### 3.4 Composer copy

The compact composer menu uses provider-specific labels and short behavioral
descriptions. It does not present one shared "Default" or claim that Plan means
no commands execute. Settings retains its more detailed technical descriptions
until the later desired-versus-effective policy redesign consolidates both surfaces.

## 4. Interactive requests and decisions

The App Server feature generalized the old Claude pending-permission registry.
The normalized request types are:

```ts
type InteractiveRequestType =
  | 'tool_approval'
  | 'user_input'
  | 'command_approval'
  | 'file_change_approval'
  | 'permission_approval';
```

The normalized decisions are:

```ts
type InteractiveRequestDecision =
  | 'allow_once'
  | 'allow_session'
  | 'deny'
  | 'cancel';
```

### 4.1 Decision translation

| CLIde decision | Claude | Codex command/file request | Codex permission-profile request |
|---|---|---|---|
| Allow once | `canUseTool` allow response | `accept` | Return the requested subset with `scope: turn` |
| Allow for session | Add/use a session allow entry | `acceptForSession` | Return the requested subset with `scope: session` |
| Deny | `canUseTool` deny response | `decline` | Return an empty granted subset |
| Cancel | Resolve the pending callback as cancelled/denied | `cancel` | Return an empty turn-scoped subset |

Codex App Server distinguishes:

- command approval, including command, cwd, reason, and possible network
  destination;
- proposed file changes, reason, and requested root;
- a requested subset of filesystem and network permissions.

The first rollout deliberately does not accept persistent exec-policy
amendments. "Allow for session" is therefore the strongest Codex choice CLIde
currently exposes.

Claude's native permission-update model is different. It can propose rule,
mode, or directory updates targeting user, project, local, session, or CLI
settings. CLIde currently adapts the common allow-once/session interaction but
does not expose the full native update destination model.

### 4.2 Structured questions are adjacent, not permissions

Claude `AskUserQuestion` and Codex `request_user_input` share the same pending
request lifecycle and panel, but they are not access approvals. Keep
`requestType: user_input` separate from approval requests even if they appear
in the same action-required area.

The normalized question model already captures:

- stable question id;
- header and prompt;
- option label and description;
- Other/free-text support;
- secret input;
- multi-select capability;
- expiry and auto-resolution.

Codex 0.144.6 does not advertise a multi-select bit, so its questions default
to one selection while still returning arrays on the wire.

## 5. Primary references

Official Anthropic:

- [Claude Agent SDK — Configure permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)

Official OpenAI:

- [Codex sandboxing](https://developers.openai.com/codex/sandboxing)
- [Codex auto-review](https://developers.openai.com/codex/sandboxing/auto-review)
- [Codex agent approvals and security](https://developers.openai.com/codex/agent-approvals-security)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Codex permission profiles](https://developers.openai.com/codex/permissions)
- [Codex App Server](https://developers.openai.com/codex/app-server)

Related CLIde records:

- `docs/maps/claude-agent-sdk.md`
- `docs/maps/codex-cli-sdk-app-server.md`
- `docs/decisions/0011-codex-app-server-chat-transport.md`
