# Product bar

What comparable agent apps ship around running and steering agents, and where CLIde
stands against each. The quality goal it serves is in
[`ARCHITECTURE.md`](../ARCHITECTURE.md#quality-goals-pillars).

- **Read from each app's own docs, changelogs and repos on 2026-10-12**, newest
  versions: Claude Code 2.1.296, Codex CLI 0.162.1, Cursor 3.24, T3 Code 0.0.45,
  Conductor 0.90, Happy Desktop 0.0.97. A † marks a row recalled, not verified.
- **Editor features** (tab completion, inline edit, language servers) are out:
  CLIde is not an editor (Grayson, 2026-10-12).
- Re-check an area's rows against the apps before designing in it; this field
  moves monthly.

**The six apps.** **CC** Claude Code (CLI, desktop Code tab, claude.ai/code, phone
app) · **CX** Codex (ChatGPT desktop app, cloud, phone app, CLI) · **CU** Cursor
(Agents Window, cloud agents, iOS app, Android PWA) · **T3** T3 Code · **CO**
Conductor · **HA** Happy. OpenCode, Antigravity and Zed were swept for outliers only.

**Bar.** *Convention*: four or more of the six ship it. *Common*: three. *Taste*:
one or two. Convention is what users now expect; taste is one team's opinion.

**Verdict.** *Have*, *Partial*, a plan link, *Gap* (not planned, awaiting Grayson's
pick; a picked gap becomes a TODO line or a plan phase) or *Decline* with a reason.

## How they are built

| App | Unit of work | Where it runs | Copy per chat | Chats with no project |
|---|---|---|---|---|
| CC | Session; "Projects" coordinator (beta) | Local, SSH, cloud VM; phone is a remote | Optional worktree | No (Projects instead) |
| CX | Chat in a project of folders | Local, worktree, SSH host, cloud container | Worktree, no branch until asked | Yes |
| CU | Agent (chat) with a "Run on" target | Local, worktree, SSH, cloud VM, your own worker | Worktree or VM | Yes |
| T3 | Thread → turns (a git checkpoint each) | Your own servers, many per client | Main, new worktree or reused | Yes, scratch folder |
| CO | Workspace (worktree + branch) → chat tabs | Mac or cloud microVM | Always | No |
| HA | Session in a workspace | Your own machines | Only when work would collide | Bots only |

**What this says about CLIde's skeleton.**

- **CLIde's core shape is the convention, not a mistake to patch.** The server owns
  execution and every client is thin (T3, OpenCode, Happy Agent, Codex's app-server);
  the app's own id addresses a thread and the provider's is a lookup (T3, invariant
  1); features follow declared capabilities (T3, invariant 2). T3 Code is CLIde's
  closest peer: same architecture, also multi-provider, also self-hosted.
- **Three convention breaks are already planned:** a chat bound to its own copy (all
  six; [Diffs and Previews](plans/source-control-truthfulness.md)), a machine layer
  above projects (five; [Environments](plans/environments.md)), and chats with no
  project (three; [no-project threads](plans/no-project-threads.md)).
- **One convention break is not planned: the list is organised by project, not by
  what needs you.** All six lead with a view grouped by state (needs you, working,
  ready for review, done). CLIde shows the same signals on each row but never
  groups by them.
- **Deliberate differences worth keeping:** an always-on host gives what four of the
  six sell cloud sandboxes for (work continues with the laptop shut); following the
  installed provider CLIs (ADR 0061) is what CO and T3 do, while CU and the new HA run
  their own harness, a taste split.
- **No row puts CLIde ahead of all six.** Its position (self-hosted, always on,
  four providers, an installed Android app) is T3 Code's too, and T3 ships most of
  the convention rows CLIde lacks.
- **Emerging, two apps each:** a coordinator chat that delegates to threads (CC, CU),
  and switching provider mid-thread (T3, HA).

## Features by area

### Sessions and navigation

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Pin, rename, archive | all six | Convention | Have | — |
| Search across chats | CC CX CU T3 HA | Convention | Have, message text included | — |
| Fork a chat | CC CX CU T3 HA | Convention | Have, `/fork` | — |
| Side question (`/btw`) | CC CX CU HA | Convention | Have | — |
| Unread marker per chat | CC CX CU HA | Convention | Have | — |
| View grouped by state: needs you, working, ready, done | all six | Convention | Partial: row signals only | **Gap** → a view in the [sidebar rail](designs/sidebar-rail.md) |
| Chats with no project | CX CU T3 | Common | — | [Plan](plans/no-project-threads.md) |
| Drafts follow you across devices | CU T3 HA | Common | Partial: per browser | [Prompt stash](plans/composer-prompt-stash.md) |
| Several chats side by side | CC CU T3 | Common | — | Existing TODO (desktop layout) |
| Snooze, auto-settle, archive on merge | CC T3 | Taste | — | Decline for now |
| "While you were away" recap | CC CX | Taste | — | Decline for now |

### Composer

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Attachments, @-files, slash commands and skills, model, effort, plan mode | all six | Convention | Have | — |
| Queue while running | all six | Convention | Have | — |
| Send now: lands at the next tool call | CC CX CU T3 CO | Convention | Partial | [Send queued now](plans/send-queued-now.md) |
| Edit, reorder or take back a queued message | CC CX CU T3 CO | Convention | Partial | [Edit model](plans/message-edit-model.md) |
| Voice dictation | CC CX CU T3 HA | Convention | Have | — |
| `/goal`: keep working until a condition holds, with a goal row | CC CX CU CO HA | Convention | — | **Gap** → check the SDK and App Server first |
| Spoken back-and-forth with the agent | CX CU HA | Common | Partial: dictation, read aloud | Decline for now |
| Prompt history on ↑ | CC CU | Taste | — | Existing TODO (`#1238`) |
| `!` shell mode | CC CU | Taste | — | Existing TODO |
| One prompt to several models at once | CU T3 | Taste | — | Decline: 4 GB host |
| Link that opens a new chat with a prompt filled in | CC T3 | Taste | — | **Gap**, S |

### Run visibility

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Collapsed tool rows, thinking, plan and to-dos, context meter | all six | Convention | Have | — |
| Plan-limit meters | CC CX T3 HA | Convention | Have, plus pace ticks and cache countdown | — |
| Subagents live, open their transcript | CC CX CU T3 HA | Convention | Partial | [Subagent visibility](plans/subagent-visibility.md) |
| Background work listed | CC CX CU CO HA | Convention | Have | — |
| Stop one background task | CC CX T3 | Common | — | **Gap**, S/M |
| Transcript density setting | CC CU HA | Common | — | Decline for now |
| Usage history page | CX CU T3 | Common | Have | — |

### Control

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Permission modes, including a model-reviewed Auto | CC CX CU T3 HA | Convention | Have (Claude `auto`) | [Permission default](plans/claude-permission-default.md) |
| Approve, deny, always allow; Stop; compact | all six | Convention | Have | — |
| Rewind code and conversation | CC CU T3 CO HA | Convention | Partial: conversation only | Rewind phase B, runtime phase 7 |
| Edit an earlier message and resend | CC CU, CX† | Common | Partial | [Edit model](plans/message-edit-model.md) |
| Resume when the usage limit resets | CC T3 | Taste | Have | — |

### Changes and review

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| The chat's diff: file list, per-file view | all six | Convention | — | [Diffs](plans/source-control-truthfulness.md) |
| Diffs on the phone | CC CX CU HA | Convention | — | Diffs |
| Comment on a diff line for the agent | CC CX CO HA | Convention | — | Diffs |
| What this turn changed | CC CX T3 | Common | — | **Gap** in the Diffs design |
| Stage or revert one hunk | CC CX CU | Common | — | Diffs, last |
| Review command with a findings view | CC CX CU CO | Convention | Partial: runs, answers in prose | Decline until Diffs |
| GitHub PR inbox: review, approve, merge | CX CU T3 CO | Convention | — | Decline: merges are local squashes |

### Git and pull requests

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Own worktree per chat | all six | Convention | Partial: launcher option | Diffs |
| Setup runs on a new copy | all six | Convention | — | Diffs |
| Ignored files (`.env`) copied into a new copy | CC CX CO HA | Convention | — | **Gap** in the Diffs design, S |
| Old copies cleaned up | CX CU T3 HA | Convention | — | Diffs (offered after merge) |
| Commit and push | CC CX CU T3 CO | Convention | Have | — |
| Open a pull request | CC CX CU T3 CO | Convention | — | Diffs |
| PR and CI status on the chat | CC CU T3 CO | Convention | — | Decline: no PR flow here |
| Agent watches its PR, fixes CI, auto-merges | CC CU T3 CO | Convention | — | Decline (2026-10-10) |

### Run and preview

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Project actions: run, test, setup buttons | CC CX T3 CO | Convention | — (Pi-Ops today) | Previews |
| The running app beside the chat | CC CX CU T3 CO | Convention | — | Previews |
| Agent checks its own work in the preview | CC CU T3 | Common | Partial: Browser tools | Previews |
| Point at an element in the preview to comment | CC CX CU T3 CO | Convention | — | **Gap** → Previews, M |
| Live phone simulators | CC T3 | Taste | — | Decline: no simulators on a Pi |

### Terminal and files

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Integrated terminal | all six | Convention | Have | — |
| File tree and editor | CC CU T3 CO HA | Convention | Have | — |
| `path:line` in a reply opens the file there | CC CO HA | Common | Have | — |
| Search file contents across the project | CU CO HA | Common | — | **Gap**, S/M |

### Parallel and remote

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Many agents at once | all six | Convention | Have | — |
| Several machines in one client | CC CX CU T3 HA | Convention | — | [Environments](plans/environments.md) |
| Cloud sandboxes | CC CX CU CO | Convention | — | Decline: the Pi is always on |
| Move a chat to another machine | CC CX CU | Common | — | With Environments |
| Agents start and message other chats | CC CU T3 CO HA | Convention | Partial: Claude's own | Decline for now |
| Coordinator chat that delegates | CC CU | Taste | — | Decline for now; the Board is adjacent |

### Automation

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Prompts on a schedule | all six | Convention | Partial: one-off sends | [Scheduled tasks](plans/scheduled-tasks.md) |
| Triggers: webhook, GitHub, Slack | CC CX CU T3 CO | Convention | — | Decline for now; a webhook trigger fits scheduled tasks |
| API for other tools | all six | Convention | Have (Agent API) | — |

### Configuration

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| MCP servers | CC CX CU CO | Convention | Have | — |
| Instructions and memory (CLAUDE.md, AGENTS.md) in settings | CC CX CU HA | Convention | — (Files only) | **Gap**, M |
| Browse and install plugins and skills | CC CX CU | Common | Partial: listed only | Existing TODO |
| Subagent definitions | CC CX CU | Common | — | Decline for now |
| Themes, shortcut editor | CX T3 CO | Common | Partial | [Design system](plans/design-system.md) |

### Notifications and phone

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Push on finished, needs approval, asked a question | CC CX CU T3 HA | Convention | Have; a tap opens the chat | — |
| Quiet while you are looking | CC T3 HA | Common | Have | — |
| Phone client | all six | Convention | Have; the main surface | — |
| Drafts and sends survive going offline | CU T3 HA | Common | Partial: sends retry | Decline for now |
| Live progress on the lock screen | CU T3 | Taste | — | Decline: native-app only† |
| Share from another app into a chat | T3 | Taste | — | Existing TODO |

### Browser, output and security

| Feature | Ships | Bar | CLIde | Verdict |
|---|---|---|---|---|
| Agent-driven browser | CC CX CU T3 | Convention | Have, per chat | — |
| Browser recordings as proof | CU | Taste | — | [Browser clips](plans/browser-video-clips.md) |
| Computer use | CC CX CU | Common | — | Decline: headless Pi |
| Markdown, code, math | all six | Convention | Have | — |
| Interactive visuals in the reply | CC CX CU T3 HA | Convention | — | **Gap**: promote the someday TODO |
| Mermaid diagrams | CX T3 CO | Common | — | **Gap**, S |
| Read-only share link | CC CX CU | Common | — | Decline: one user |
| Sandbox and network allowlist | CC CX CU HA | Convention | Provider-owned; Claude's keys in Agents › Claude | — |
| Secrets the model never sees | CU T3 HA | Common | — | Decline for now |
