# Provider permission and mode surface map

*Surveyed 2026-07-25 against the official Claude Agent SDK and Codex
documentation, installed `@anthropic-ai/claude-agent-sdk` 0.3.217, installed
`@openai/codex-sdk` 0.144.6, CLIde's `main` branch, and the completed
`feat/codex-app-server-chat` implementation.*

This is a reference for the planned CLIde UI revamp. It maps Claude and Codex
permission concepts by behavior instead of assuming that similarly named modes
are equivalent.

No UI redesign is decided by this document. Its purpose is to preserve the
investigation, identify misleading current mappings, and give a later design
one accurate semantic model to build on.

## Executive summary

1. **One shared permission-mode enum is not a safe abstraction.** Claude modes
   bundle tool approval behavior. Codex separately controls the sandbox
   boundary, approval policy, approval reviewer, network access, and
   collaboration mode.

2. **Several current CLIde mode names are false friends.** Claude
   `acceptEdits` auto-approves file operations but leaves other commands under
   normal permission handling. CLIde's Codex `acceptEdits` mapping is
   `workspace-write + never`, which runs every operation permitted by the
   workspace sandbox without prompting.

3. **Plan is intent, not a universal security policy.** Claude Plan prevents
   source edits from being auto-approved while allowing exploration. Codex
   Plan is a collaboration mode whose sandbox and approval policy remain
   separate. Copy such as "no commands are executed" is therefore inaccurate.

4. **The UI should present provider-neutral user intents backed by structured
   controls.** Examples are Ask before changes, Edit workspace, Auto in
   workspace, AI-reviewed, No prompts, Plan first, and Full access. Each
   provider adapter should translate an intent into native settings and disclose
   when the translation is approximate.

5. **Interactive request normalization is the right shared layer.** Claude and
   Codex can share request lifecycle, reconnect, rendering, and response UX
   without pretending their underlying permission engines are identical.

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

Provider capabilities publish a list of strings in cycle order. This keeps the
React UI provider-neutral, but the strings currently imply shared semantics
that the adapters do not provide.

Current capability lists after the App Server feature:

| Provider | Modes exposed |
|---|---|
| Claude | `default`, `auto`, `acceptEdits`, `bypassPermissions`, `plan` |
| Codex App Server | `default`, `acceptEdits`, `bypassPermissions`, `plan` |
| Codex SDK fallback | `default`, `acceptEdits`, `bypassPermissions` |
| Cursor | `default`, `acceptEdits`, `bypassPermissions`, `plan` |
| OpenCode | `default`, `acceptEdits`, `bypassPermissions`, `plan` |

The fallback difference is significant: the Codex TypeScript SDK wraps
non-interactive `codex exec --json` and cannot round-trip interactive approval
requests. The App Server transport can.

### 3.2 Claude adapter

CLIde forwards the selected non-default composer mode to the Agent SDK and
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

Both Codex paths currently translate composer modes as follows:

| CLIde mode | Codex sandbox | Codex approval policy | Effective meaning |
|---|---|---|---|
| `default` | `workspace-write` | `untrusted` | Workspace edits can proceed; only trusted commands auto-run. |
| `acceptEdits` | `workspace-write` | `never` | Everything available inside the workspace sandbox runs without prompts. |
| `bypassPermissions` | `danger-full-access` | `never` | No sandbox and no approval prompts. |
| `plan` (App Server only) | `workspace-write` | `untrusted` | Same access mapping as default plus Codex Plan collaboration mode. |

Consequences:

- Codex `acceptEdits` should be described as **Auto in workspace**.
- Codex `default` is closer to **Edit workspace, ask about risky commands**.
- Codex Plan is not read-only in the first App Server rollout.
- App Server currently sets `approvalsReviewer: 'user'` explicitly; Codex
  automatic review is not exposed.
- The SDK fallback cannot display the prompts produced by `untrusted`, so the
  transport capability changes the effective UX of the same selected mode.

### 3.4 Existing copy that should change in the revamp

Current composer/settings copy includes:

- Default: "Other commands are skipped."
- Accept Edits: "All commands run automatically within the workspace."
- Plan: "No commands are executed."

The second statement describes the current Codex implementation but not the
name "Accept Edits." The first varies by transport, and the Plan statement is
wrong for both providers' exploration behavior.

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

## 5. Recommended UI model

### 5.1 Separate user intent from provider-native controls

A future shared type should describe behavior rather than carry a provider's
native mode string:

```ts
type AgentAccessPolicy = {
  collaboration: 'act' | 'plan';
  filesystem: 'read-only' | 'workspace-write' | 'full';
  network: 'off' | 'ask' | 'allowed';
  escalation: 'ask-user' | 'auto-review' | 'deny';
  automation:
    | 'prompt-changes'
    | 'auto-edits'
    | 'auto-in-boundary';
};
```

This need not be the final serialized schema. The important constraint is that
collaboration mode, technical boundary, and approval handling remain separate.

Provider capabilities should return structured preset metadata instead of only
mode-name strings. Each option needs:

- stable provider-neutral intent id;
- provider-native label and effective settings;
- concise user-facing behavior;
- risk level;
- whether the mapping is exact or approximate;
- whether it works differently under the active transport;
- supported request/decision types;
- whether session or persistent policy changes are supported.

### 5.2 Suggested user-facing presets

| Preset | User-facing promise |
|---|---|
| Ask before changes | Explore freely, but ask before editing or executing consequential actions. |
| Edit workspace | Make workspace edits automatically; ask about commands or access outside the editing policy. |
| Auto in workspace | Work without interruption inside the workspace boundary; ask only to leave it. |
| AI-reviewed | Route eligible approval requests to the provider's automatic reviewer when supported. |
| No prompts | Never interrupt for access; deny anything outside the configured boundary. |
| Plan first | Investigate and produce a plan before implementation, under the separately displayed access policy. |
| Full access | Remove local sandbox and approval boundaries. Show a dangerous-action confirmation. |

Not every provider needs to show every preset. Unsupported intents should be
absent or explicitly approximate, not silently translated into broader access.

### 5.3 Progressive disclosure

The composer can stay simple:

1. show the intent/preset name;
2. show a one-line effective behavior for the active provider and transport;
3. provide a details view with the actual native settings.

The settings page can expose advanced provider-native controls:

- Claude: allow, ask, and deny rules; extra directories; rule destination;
  hooks/policy caveats.
- Codex: permission profile or sandbox; approval policy; reviewer; network;
  writable/readable roots; granular categories; rules.

The advanced pages should not force Claude tool names into Codex permission
profiles or vice versa.

## 6. Recommended implementation sequence

1. Replace the shared string list in provider capabilities with structured
   permission/collaboration preset descriptors.
2. Rename current Codex `acceptEdits` to Auto in workspace while preserving a
   compatibility parser for stored session values.
3. Add explicit Codex combinations for read-only, on-request, never, and
   automatic review rather than overloading three legacy names.
4. Split Plan from access policy in composer state. Selecting Plan should not
   silently redefine filesystem/network authority.
5. Add Claude `dontAsk` and audit the dangerous-bypass acknowledgement.
6. Test the installed Claude SDK's interactive-tool behavior in `auto`,
   `bypassPermissions`, and Plan.
7. Make copy derive from the provider's effective settings and active
   transport, not from a global translation key keyed only by mode name.
8. Preserve the normalized interactive request registry and provider-aware
   approval panels.
9. Decide whether persistent Claude rules and Codex exec-policy amendments are
   in scope. Do not label a session-only decision as permanent.
10. Add migration tests for previously stored `permissionMode` values.

## 7. Acceptance criteria for the later revamp

- The same displayed preset never grants materially broader access on one
  provider without an explicit disclosure.
- Claude Accept Edits and Codex Auto in workspace are no longer represented by
  the same semantic id.
- Plan copy accurately distinguishes collaboration behavior from access.
- Codex SDK fallback and App Server show different interaction capability when
  relevant.
- Auto-review copy explains that only eligible escalations are reviewed.
- No-prompts copy distinguishes "deny unavailable work" from full access.
- Effective sandbox, network, reviewer, and persistence scope are inspectable.
- Allow once/session/deny/cancel continue to work across reconnect and refresh.
- Secret question answers remain redacted in persisted and delivered history.
- Existing Claude settings and stored composer modes migrate without silently
  expanding authority.

## 8. Primary references

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

- `docs/superpowers/specs/2026-07-19-agent-sdk-surface-map.md`
- `docs/superpowers/specs/2026-07-24-codex-cli-sdk-surface-map.md`
- `docs/decisions/0011-codex-app-server-chat-transport.md`

These provider surfaces evolve quickly. Recheck the pinned SDK/CLI versions and
regenerate App Server bindings when implementation begins; treat this as a dated
design input, not a permanent protocol contract.
