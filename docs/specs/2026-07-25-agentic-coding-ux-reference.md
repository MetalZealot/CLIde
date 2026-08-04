# Agentic coding UX reference: industry conventions and CLIde map

**Status:** Reference

**Survey date:** 2026-07-25

**CLIde baseline:** `main` at `172b0ef`

**Audience:** Product, design, and engineering work on CLIde

## Purpose

This document is a durable reference for evaluating and improving CLIde's
developer experience. It surveys the workflows presented by major agentic coding
products, identifies the conventions that have become normal developer
expectations, and maps those expectations to CLIde's current implementation.

It is not a request to reproduce another product's layout. CLIde is a
multi-provider, browser-based, mobile-capable application with different
constraints from a native IDE or provider-owned CLI. The useful target is the
shared interaction model:

> Give the agent the right context, agree on intent, let it work visibly, retain
> control over consequential actions, review the result, verify it, and recover
> safely when needed.

The external products and their terminology will change. The workflow principles
and the CLIde implementation notes are the durable parts of this reference.

## Executive summary

Agentic coding tools have converged on a recognizable task lifecycle:

1. Choose a repository, session, execution environment, agent, and model.
2. Assemble task context from the editor, files, symbols, diagnostics, Git, and
   durable project instructions.
3. Ask questions or create and approve a plan before editing when the task is
   uncertain or broad.
4. Let the agent edit files and run tools while showing legible progress.
5. Pause, steer, answer questions, or approve an individual action without
   losing the run.
6. Review agent-attributed changes as diffs, then accept, reject, revert, or
   request follow-up work.
7. Run checks, summarize what changed, and preserve a recoverable checkpoint.
8. For longer work, continue in an isolated worktree, local background session,
   or cloud environment and notify the developer when attention is needed.

CLIde already contains most of the raw ingredients: multi-provider sessions,
project and conversation navigation, streaming chat, tool renderers, approvals,
questions, rewind, a code editor, Git, shell, task management, browser use, MCP,
skills, plugins, voice, background activity, and a mobile PWA.

The main gap is not feature count. The essential loop is spread across separate
tabs and provider-specific behaviors:

- Context is mostly implicit or inserted as plain path text.
- Collaboration intent and permission policy are collapsed into one control.
- Planning, execution status, task progress, diffs, Git state, and verification
  do not read as one continuous run.
- Rewind handles conversation history but not a general file checkpoint.
- Git is capable, but it does not distinguish agent changes or provide a
  turn-scoped review workflow.
- Provider capability differences are not always visible before a user relies
  on a control.
- Background and parallel sessions exist as pieces, but not yet as a coherent
  agent-session control center.

The most valuable direction is therefore to organize existing capability around
the task lifecycle, not add another independent feature surface.

## What developers now expect

There is no formal industry standard. The following expectations are considered
**established** when they appear across provider CLIs, AI-native editors, and
general-purpose IDE integrations. **Emerging** patterns are common in leading
products but are not yet universal.

### 1. A task begins in a visible execution context

**Established**

- The current repository or workspace is always clear.
- The active conversation and model are visible.
- Local, worktree, background, and cloud execution are distinguished.
- The user can create, resume, search, and archive multiple sessions.

**Emerging**

- A unified session manager covers local, remote, and third-party agents.
- The user can hand a local plan or conversation to a background or cloud agent.
- Parallel tasks default to isolated worktrees or containers.

The important mental model is that a conversation is not merely a chat log. It
is a task run bound to a workspace and an execution boundary.

### 2. The composer assembles explicit context

**Established**

- `@` references files and folders.
- The current file or selected editor range can be attached to a prompt.
- Images can be attached when supported.
- Attached context is visible and removable before sending.
- Repository instructions are loaded automatically from durable files.

**Emerging**

- Symbols, diagnostics, terminal output, Git changes, commits, documentation,
  URLs, and earlier conversations are first-class context objects.
- Tools show which context is active, automatic, or excluded.
- Context-budget pressure and compaction are visible.

The user should be able to answer, “What exactly will the model see?” Plain text
that happens to resemble a path is weaker than an explicit, inspectable
attachment.

### 3. Collaboration intent is separate from access policy

**Established**

- An ask or chat mode explores without editing.
- A plan mode researches and proposes an implementation before editing.
- An agent or edit mode can modify files and run tools.
- Tool use can require approval.

**Emerging**

- Custom agent profiles select prompts, models, tools, skills, and MCP servers.
- Permission policy separately describes filesystem scope, command approval,
  network access, secrets, and destructive actions.
- A formal plan can be reviewed, edited, and then continued in the same session
  or handed to another execution environment.

“Plan,” “agent,” and “ask” describe how the user wants to collaborate.
“Workspace write,” “ask before commands,” or “allow network access” describe the
authority available to the agent. Treating these as the same setting creates
false equivalence between providers.

### 4. Execution is visible but summarized

**Established**

- The transcript shows tool calls, commands, edits, outputs, and errors.
- Routine operations are compact; meaningful detail is expandable.
- A running task has an obvious stop control.
- The agent reports when it is waiting for approval or user input.

**Emerging**

- A structured plan or todo list updates as work proceeds.
- Provider-native status, subagents, background tasks, retries, and context
  compaction appear as typed events.
- Users can steer an active run or queue a follow-up without stopping it.
- Completion summaries include changed files, tests, and unresolved concerns.

Raw event logs are useful for diagnosis, but the default presentation should
answer: what is happening, what changed, what needs attention, and what remains?

### 5. Consequential actions are approved in context

**Established**

- The approval identifies the exact command, file action, tool, or requested
  resource.
- The user can allow or deny the action without abandoning the session.
- Products distinguish a one-time approval from a broader policy change.

**Emerging**

- Approvals expose their effective sandbox, network, and credential boundary.
- A temporary session rule can be created from an approval.
- Structured questions, plan approval, and tool approval share one consistent
  attention treatment.

The safest UI presents effective behavior, not just a provider-specific mode
name.

### 6. Agent changes have a dedicated review and recovery loop

**Established**

- Edits are shown as diffs.
- The developer can review all changed files before accepting the result.
- Checkpoints or prompt rewind can restore an earlier state.
- Git remains the canonical durable history.

**Emerging**

- Review can be scoped to the last turn, the full session, unstaged changes, a
  commit, or a branch.
- Files and hunks can be accepted, rejected, staged, unstaged, or reverted from
  the review surface.
- Inline comments become follow-up instructions for the same agent.
- Checkpoints restore both conversation state and agent-made filesystem changes.

Review is not a separate administrative activity after chat. It is a first-class
phase of an agent run.

### 7. Long-running and parallel work has an attention model

**Established**

- Multiple sessions can run without blocking the main UI.
- Running, completed, failed, and waiting-for-input states are visible.
- The developer can return to a session and continue it.

**Emerging**

- Worktrees, containers, or cloud sandboxes isolate concurrent writes.
- Subagents are visible as child tasks with their own status and transcript.
- Notifications are sent only when work completes or needs attention.
- A developer can inspect, steer, take over, or turn a background result into a
  pull request.

Parallelism without clear ownership and isolation is a source of risk rather
than productivity.

### 8. Customization is durable, scoped, and inspectable

**Established**

- Repository instruction files establish project conventions.
- MCP connects external tools and data.
- Reusable commands, skills, or workflows encode repeated tasks.
- Provider and repository settings can be scoped separately.

**Emerging**

- Named agents bundle an instruction set, model, tools, skills, MCP, memory, and
  isolation policy.
- Hooks enforce or automate lifecycle actions.
- The UI explains which instructions, tools, and policies are active for the
  current turn.

## How major products present the workflow

This is a comparison of product framing, not a feature scorecard. Provider-owned
CLIs, AI-native editors, and IDE extensions solve different parts of the problem.

| Product | Primary workflow | Context and planning | Execution, review, and recovery | Parallel or remote work |
|---|---|---|---|---|
| **OpenAI Codex** | Sessions in CLI, IDE, app, or cloud; local, worktree, and cloud environments | Repository `AGENTS.md`, files and editor selections, skills, MCP, Plan mode, configurable agents | Tool approvals and sandboxing are independent; IDE review supports turn, working-tree, commit, and branch diffs with Git staging and revert controls | App worktrees, cloud tasks, and visible subagent threads |
| **Claude Code** | Terminal-first agent with IDE awareness and resumable conversations | Selected code, files/folders, project instructions, Plan mode, skills, MCP, custom subagents | Permission modes, inline diffs, checkpoints, hooks, background commands, and provider-native task events | Multiple conversations, worktrees, background subagents, and CI/headless use |
| **Cursor** | AI-native editor with Ask, Agent, and custom modes | Broad `@` context for code, files, folders, docs, Git, web, diagnostics, rules, and prior chats | Agent terminal and edits, change review with file/line acceptance, automatic agent checkpoints | Background agents use isolated remote environments; its Agents Window also supports asynchronous subagents and worktree tasks |
| **VS Code and GitHub Copilot** | General IDE with local, background, cloud, CLI, and third-party agent sessions | Plan agent, editor/workspace context, custom agents, instructions, skills, hooks, MCP, model and tool selection | Permission levels, checkpoints, inline edit review, session logs, and issue-to-PR coding-agent workflow | Unified agents view, worktree isolation, GitHub coding agents, handoff between local and background sessions |
| **Gemini CLI** | Terminal agent with explicit operating modes | Hierarchical memory/instructions, Plan mode, skills, MCP, and todo tools | Policy engine separates modes and tool permissions; optional checkpointing snapshots conversation and filesystem state | Headless automation, experimental worktrees, and local or remote subagents, primarily presented through a CLI |
| **Devin Desktop / Cascade** | Desktop coding workspace with Code and Chat modes | Selected editor/terminal text, memories, rules, `AGENTS.md`, workflows, skills, plans and todos | Tool timeline, queued messages, linter/problem handoff, named checkpoints and reverts | Simultaneous sessions use worktrees; prior conversations can be referenced |

Across these products, the most consistent sequence is:

```text
Workspace/session
      ↓
Goal + explicit context
      ↓
Ask or plan
      ↓
Execute visibly
      ↓
Approve / answer / steer
      ↓
Review changes
      ↓
Verify
      ↓
Commit, hand off, or restore
```

## CLIde today

### Current end-to-end experience

1. The developer selects a project and conversation from the sidebar.
2. A new conversation begins with provider and model selection.
3. The developer writes a prompt, optionally inserts a file path with `@`,
   attaches images, chooses an effort level, and cycles a permission-mode
   control.
4. The selected provider runs through its adapter. Messages, tool calls,
   commands, edits, plans, questions, approvals, and errors are normalized into
   the shared chat.
5. The developer can stop the run, queue one next message, answer a question, or
   approve a supported action.
6. Files can be opened in CLIde's CodeMirror editor; changes can be inspected and
   managed in the Git tab; shell, tasks, browser, and plugins live in other
   primary tabs.
7. A prior user message can be edited through rewind. Filesystem restoration is
   not a general part of rewind.
8. Sessions can be searched, starred, archived, renamed, and resumed. Running
   and unread state appears in the conversation list.

This works, but the user must mentally join together chat, editor, Git, shell,
tasks, provider settings, and notifications. The strongest opportunity is to
make those parts read as one task lifecycle.

### Capability map

Status terms:

- **Strong:** Present and close to the expected workflow.
- **Partial:** Useful implementation exists, but an important part of the
  expected workflow is absent.
- **Detached:** Capable feature exists but is not integrated into the agent run.
- **Provider-dependent:** The shared UI cannot promise consistent behavior.
- **Missing:** No general user-facing implementation was found.

| Area | CLIde implementation | Status | Main implication |
|---|---|---:|---|
| Project and session navigation | Project hierarchy, all-conversation search, starring, archive, rename, delete, unread/running state, pagination | **Strong** | This is a solid foundation for an agent-session control center. |
| New-session setup | Provider and model picker grouped by provider | **Partial** | It does not summarize workspace, branch/environment, collaboration intent, access policy, or available capabilities. |
| Workspace layout | Chat, Shell, Files, Git, Tasks, Browser, and plugin tabs; editor sidebar can coexist with a primary tab | **Partial** | It is more capable than a chat page, but still feels like adjacent tools rather than a task workbench. |
| File context | `@` search finds project files and inserts path text | **Partial** | The path is not retained as a structured, inspectable attachment; folders, symbols, selections, diagnostics, diffs, docs, and prior sessions are absent. |
| Editor context | CodeMirror editor with syntax, save, diff, preview, minimap, and wrapping | **Detached** | There is no selected-text-to-thread or active-file context contract and no inline agent edit entry point. |
| Images and voice | Image attachments by capability; voice input | **Strong** | Useful input breadth, though not a substitute for code-context objects. |
| Commands and skills | Built-in slash commands, provider skills, custom commands, command palette | **Partial** | Discovery is split between chat commands, settings, and global navigation; provider command parity is incomplete. |
| Ask/plan/agent intent | Provider modes are exposed through a single permission-mode control | **Provider-dependent** | Labels are false friends across providers, and collaboration intent is mixed with authority. See the permission-mode map. |
| Model and effort | Model selected at session start or through commands; effort shown when supported | **Partial** | These should remain visible and capability-aware without dominating the composer. |
| Tool and edit timeline | Compact/collapsible renderers for edits, commands, search, tasks, plans, and other tools; optional raw detail and reasoning | **Strong** | The renderer system is a major asset and can support richer typed run state. |
| Running state | Generic activity label, elapsed time, stop, connection state, one queued next message | **Partial** | It lacks a durable plan/progress view, typed blocked state, provider status, background-task hierarchy, and richer steering. |
| Structured questions | Inline normalized question panel | **Strong when supported** | This is the right interaction pattern; capability should be clear before execution. |
| Tool approvals | Exact provider-normalized request with allow-once, allow-for-session, deny, or cancel choices | **Strong when supported** | Effective sandbox/network scope and persistence semantics still need clearer presentation. |
| Codex interactive transport | Codex App Server chat is merged and opt-in through `CLIDE_CODEX_CHAT_TRANSPORT=app-server`; it adds plan mode, approvals, and structured questions | **Provider-dependent** | The richer transport should be represented as runtime capability, not assumed from provider identity alone. |
| Rewind | Edit an earlier user message and continue the conversation tree in place | **Partial** | Conversation recovery exists; general restoration of agent-made file changes does not. |
| Change review | Tool-call diffs, editor diff, and a capable Git tab with status, staging, history, branches, and remote operations | **Detached** | There is no session/turn change set, agent attribution, accept/reject by hunk, inline review-to-agent loop, or dedicated verification summary. |
| Shell | Embedded real provider CLI in a PTY | **Detached** | It is a useful escape hatch, but transcript synchronization is imperfect and it is not a unified agent execution console. |
| Tasks and plans | Plan tool rendering plus a TaskMaster PRD/task board | **Detached** | Long-lived project tasks are powerful, but they are not the same thing as a live run plan and completion checklist. |
| Background sessions | Shared WebSocket activity, session polling, running/unread indicators, queued drafts, web push foundations | **Partial** | Completion and attention states need one reliable notification and session-inbox model, including reconnect recovery. |
| Parallel isolation | Git worktrees are used operationally by contributors; provider subagents may use provider-native isolation | **Missing as a general UI contract** | Users cannot launch and supervise an isolated CLIde session or see a child-agent tree from the shared UI. |
| MCP | Per-provider/global MCP configuration in settings | **Partial** | Configuration exists, but runtime connection health, authentication, active tools, errors, and per-session selection are not prominent. |
| Skills | Provider-native skill discovery and import with scopes | **Partial** | Skills are available but not integrated into task setup or visible active context; provider coverage varies. |
| Project instructions | Provider CLIs can consume their native instruction files; CLIde has project guidance of its own | **Provider-dependent** | The UI does not consistently show which instruction sources were applied to the active run. |
| Hooks and workflow automation | Plugins, custom commands, provider-native facilities, and server extension points | **Partial** | There is no unified lifecycle-hook model or explanation of what will run automatically. |
| Browser and plugins | Browser use, plugin tabs, API tokens, notifications, Tasks, and other extensions | **Strong breadth** | CLIde differentiates through breadth, but these should attach to the core loop rather than compete with it. |
| Mobile PWA | Responsive sidebar/overlays, touch-aware controls, installed PWA behavior | **Partial** | A mobile bottom navigation and background-attention model remain important to make the core loop intuitive on the real device. |

### Provider capability reality

CLIde correctly treats providers as adapters, but the UX still exposes several
concepts as if they were portable:

| Concept | Claude | Codex App Server | Cursor | OpenCode |
|---|---|---|---|---|
| Shared stable CLIde session ID | Yes | Yes | Yes | Yes |
| Images | Supported | Supported | Supported | Supported |
| Abort active run | Supported | Supported | Supported | Supported |
| Plan-like mode | Supported | Supported in App Server mode | Provider mode available | Provider mode available |
| Interactive tool approval in shared chat | Supported | Supported in App Server mode | Not generally exposed | Not generally exposed |
| Structured user questions | Supported path | Supported in App Server mode | Not generally exposed | Not generally exposed |
| Token/usage display | Supported with Claude-specific guards | Supported separately | Not generally exposed | Provider-dependent |
| Rewind conversation | Supported in CLIde's shared history model | Shared history behavior | Shared history behavior | Shared history behavior |
| Provider-native file rollback/checkpoint | Not exposed as a shared contract | Not exposed as a shared contract | Not exposed as a shared contract | Not exposed as a shared contract |

This table is intentionally about the shared CLIde experience, not everything a
provider can do in its own first-party client.

The design consequence is to expose a richer runtime capability descriptor:

- collaboration intents available;
- structured questions and approvals;
- streaming granularity and typed status;
- tool, subagent, plan, and background-task events;
- steering and queued follow-ups;
- checkpoint, fork, rollback, and resume semantics;
- usage, rate limits, and context information;
- supported skills, MCP, hooks, images, and other inputs;
- effective filesystem, network, and command policy.

A disabled control should explain the missing capability or transport. It should
not silently behave differently because two providers use the same mode label.

## Product principles for future CLIde work

### Organize around the task lifecycle

Use chat, editor, Git, shell, tasks, and browser as views of one task. A user
should not have to know which tab owns each phase.

A practical lifecycle vocabulary is:

```text
Frame → Plan → Run → Review → Verify → Finish
```

Not every task needs every phase. The interface can compress trivial tasks while
preserving the same mental model for larger work.

### Make context tangible

Context should appear as removable typed items near the composer:

- file or folder;
- symbol or selected lines;
- diagnostic or terminal excerpt;
- current diff, commit, or branch;
- image, URL, documentation, or previous session;
- active project instructions, skill, or MCP tool set.

CLIde can continue sending provider-appropriate prompts or protocol objects
underneath. The UI contract should remain consistent and honest about whether an
item is attached explicitly or merely available for the provider to discover.

### Separate intent, model, and authority

The task controls should answer three different questions:

1. **How should we collaborate?** Ask, Plan, or Agent.
2. **Which intelligence should do it?** Provider, model, and effort.
3. **What may it do?** Filesystem, command approval, network, secrets, and
   persistence of grants.

Provider adapters can translate supported combinations and cleanly disable or
explain unsupported ones.

### Give every run a legible state

The activity surface should show:

- the current plan step or action;
- completed and remaining work;
- commands and edits summarized by default;
- waiting-for-user, waiting-for-approval, retrying, failed, stopped, and
  completed states;
- child agents or background tasks;
- elapsed time and a stop or steer action;
- verification results and a completion summary.

This can build on CLIde's existing typed message and tool renderer system.

### Treat changes as an agent artifact

Add a change set associated with the current turn or session, even though Git
continues to own the files:

- last-turn and full-session diff;
- changed-file count and additions/deletions;
- file/hunk review;
- stage, revert, or request-follow-up actions;
- inline review comments that become context;
- explicit distinction between pre-existing user changes and agent changes.

This must preserve unrelated dirty worktree changes and avoid implying that an
agent owns edits it cannot reliably attribute.

### Define one recovery contract

Conversation rewind, provider-native checkpoints, filesystem snapshots, and Git
are different mechanisms. CLIde should describe exactly what each restore action
will affect.

The expected high-level operation is:

> Restore the conversation and the changes made by this agent after this point,
> without overwriting unrelated user work.

Where a provider or local transport cannot offer that safely, present
conversation-only rewind explicitly rather than overpromising.

### Design attention before adding parallelism

Every background or child session needs:

- an isolated workspace or an explicit shared-write warning;
- owner/provider/environment/branch identity;
- running, complete, failed, and needs-attention status;
- a concise result and changed-file summary;
- inspect, steer, stop, take-over, and archive actions;
- reliable reconnect recovery and notifications.

CLIde's sidebar and shared WebSocket are natural foundations. The notification
design should be completed before background work becomes more autonomous.

### Let provider strengths remain visible

Provider normalization should make the app coherent, not erase meaningful
differences. A shared surface may contain:

- portable controls available everywhere;
- capability-gated controls with explanations;
- provider-native events rendered through typed extension points;
- a details view showing the effective transport and policy.

This is preferable to both lowest-common-denominator UI and provider names
scattered through shared components.

### Preserve CLIde's mobile advantage

Most agentic coding products are optimized for desktop even when they offer
remote monitoring. CLIde can be unusually useful on mobile if the same lifecycle
is compressed well:

- bottom navigation for the few primary task phases;
- a persistent attention indicator;
- one-tap review of questions, approvals, completion, and failed checks;
- focused full-screen editor/diff views;
- no hover-dependent or unreliable `:active` interactions;
- installed-PWA verification for safe areas and standalone behavior.

## Suggested information architecture

This is a conceptual organization, not a pixel specification.

### Global layer

- Project/workspace switcher
- Session inbox: active, needs attention, recent, starred, archived
- New task
- Global search and command palette
- Provider/account health

### Task header

- Task title and stable CLIde session identity
- Project, branch/worktree, and local/background/cloud location
- Provider, model, and effort
- Run state and attention state
- More details: provider-native ID, context/usage, effective policy

### Task workspace

- **Conversation:** goal, plan, transcript, questions, approvals, completion
- **Changes:** last-turn/session/working-tree diffs and review actions
- **Files:** project tree and editor
- **Activity:** commands, terminal output, tasks, child agents, verification

On desktop these can coexist in resizable panes. On mobile they can be focused
views reached from a small bottom navigation. The underlying state should be the
same.

### Composer

```text
[file] [selection] [diagnostic] [skill]                    context
┌─────────────────────────────────────────────────────────────────┐
│ Ask CLIde to…                                                    │
└─────────────────────────────────────────────────────────────────┘
[Ask/Plan/Agent] [model · effort] [access summary] [attach] [Send]
```

Questions, approvals, queued follow-ups, and rewind editing may temporarily
replace or augment the normal composer, but should not introduce a different
control language.

## Priority guide

This is a decision aid for existing and future TODO items, not a replacement for
`TODO.md`.

### Foundation: make current behavior truthful

1. Introduce capability descriptors rich enough for interaction, recovery,
   status, and authority—not only a few booleans.
2. Separate collaboration intent from provider access/permission policy.
3. Show the effective transport and explain unavailable controls.
4. Define the semantics of session, turn, provider session, branch/worktree, and
   checkpoint in shared types and user-facing copy.

### Core loop: connect existing features

1. Replace plain-path mentions with structured context attachments, starting
   with files, folders, and editor selections.
2. Add an integrated run state and plan/progress presentation.
3. Create a turn/session changes view that connects tool diffs, editor, and Git.
4. Add a verification/completion summary with checks run and unresolved work.
5. Make rewind's conversation-only scope explicit, then design safe file
   restoration.

### Long-running work: attention and isolation

1. Complete the background-session notification and attention-state design.
2. Add reconnect-safe server state for completed and waiting sessions.
3. Represent subagents and background tasks in the shared protocol.
4. Define an isolated worktree launch and handoff workflow before enabling broad
   parallel writes.

### Extension layer: expose existing breadth in context

1. Surface active skills, MCP tools, hooks, and instructions in task setup and
   run details.
2. Let terminal output, diagnostics, browser results, TaskMaster tasks, and
   plugin data become explicit context objects.
3. Preserve the underlying specialist views while giving them consistent entry
   and return paths from the active task.

## Evaluation checklist

When reviewing a proposed CLIde feature, ask:

- Can a developer predict what context the model will receive?
- Is collaboration intent distinct from access and approval policy?
- Does the UI accurately reflect runtime provider capability?
- Can the developer see what the agent is doing and why it is waiting?
- Are unrelated user changes protected?
- Can the result be reviewed by turn, file, and hunk?
- Is recovery scope explicit and safe?
- Does the task end with verification evidence and a concise handoff?
- Can a background session request attention reliably after reconnect?
- Does the workflow remain understandable on the installed mobile PWA?
- Is this feature part of the core task lifecycle, or another detached surface?

## Related CLIde references

- [Claude Agent SDK surface map](../maps/claude-agent-sdk.md)
- [Codex CLI and SDK surface map](../maps/codex-cli-sdk-app-server.md)
- [Provider permission mode map](./2026-07-25-provider-permission-mode-map.md)
- [Background session notifications](./2026-07-21-background-session-notifications.md)
- [ADR 0005: mobile bottom navigation](../decisions/0005-mobile-bottom-navbar.md)
- [ADR 0007: rewind in-place conversation tree](../decisions/0007-rewind-in-place-tree-append.md)
- [ADR 0011: Codex App Server opt-in](../decisions/0011-codex-app-server-chat-transport.md)
- [`TODO.md`](../TODO.md)

## Official product sources

These sources describe the products as of the survey date. They should be
rechecked before relying on a vendor-specific detail in a new implementation.

### OpenAI Codex

- [Best practices](https://learn.chatgpt.com/guides/best-practices)
- [Code review](https://learn.chatgpt.com/docs/code-review)
- [IDE commands and editor context](https://learn.chatgpt.com/docs/developer-commands?surface=ide)
- [Git worktrees and execution environments](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Customization overview](https://learn.chatgpt.com/docs/customization/overview)
- [`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)

### Claude Code

- [Common workflows](https://code.claude.com/docs/en/common-workflows)
- [Best practices](https://code.claude.com/docs/en/best-practices)
- [Permission modes](https://code.claude.com/docs/en/permission-modes)
- [IDE integrations](https://code.claude.com/docs/en/ide-integrations)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Code review](https://code.claude.com/docs/en/code-review)

### Cursor

- [Agent modes](https://docs.cursor.com/en/agent/modes)
- [Working with context](https://docs.cursor.com/en/guides/working-with-context)
- [`@` symbols](https://docs.cursor.com/context/@-symbols/overview)
- [Rules](https://docs.cursor.com/context/rules)
- [Reviewing agent changes](https://docs.cursor.com/en/agent/review)
- [Checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints)
- [Background agents](https://docs.cursor.com/background-agent)
- [Agents Window multitasking and worktrees](https://cursor.com/changelog/04-24-26)

### VS Code and GitHub Copilot

- [Agents overview](https://code.visualstudio.com/docs/agents/overview)
- [Agents view](https://code.visualstudio.com/docs/agents/agents-window)
- [Planning](https://code.visualstudio.com/docs/agents/planning)
- [Review AI-generated edits](https://code.visualstudio.com/docs/chat/review-code-edits)
- [Chat checkpoints](https://code.visualstudio.com/docs/chat/chat-checkpoints)
- [Agent tools and approvals](https://code.visualstudio.com/docs/copilot/concepts/tools)
- [GitHub Copilot coding agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)
- [Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)

### Gemini CLI

- [Plan mode](https://geminicli.com/docs/cli/plan-mode/)
- [Checkpointing](https://geminicli.com/docs/cli/checkpointing/)
- [Policy engine](https://geminicli.com/docs/reference/policy-engine/)
- [Gemini CLI documentation](https://geminicli.com/docs/)

### Devin Desktop / Cascade

- [Cascade](https://docs.devin.ai/desktop/cascade/cascade)
- [Memories, rules, workflows, and skills](https://docs.devin.ai/desktop/cascade/memories)
