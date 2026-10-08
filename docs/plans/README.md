# Plans

A plan is the ordered work remaining on one piece of CLIde, and nothing else.
It is the only document here that is meant to change constantly.

## The board

Current active work comes first, followed by the queue Grayson ordered on
2026-08-03 and the unqueued work below the rule.

| Plan | Status | Next |
|---|---|---|
| [Agent runtime rebuild](agent-runtime-rebuild.md) | 4/11 | Phase 3: typed wire in place |
| [Chat history performance](chat-history-performance.md) | 8/14 | Phase 7: cut the ~50 ms fixed frame cost of scroll restoration; phone check |
| [Upstream feature harvest](upstream-feature-harvest.md) | 1/4 | Composer message recall; the other two builds shipped |
| [One edit model for queued, scheduled, and earlier messages](message-edit-model.md) | 3/5 | Phase 3 — the banners go, and all three edits mark the original instead |
| [Send a queued message into the running turn](send-queued-now.md) | 3/4 | Phase 3: Codex live once its limit resets; Claude accepted on the phone |
| [Source Control truthfulness](source-control-truthfulness.md) | 1/4 | Phase 0: make server-side Git failures visible in the UI |
| [Commit-message model selection](commit-message-model-selection.md) | not started | Rebaseline on the post-v1.37 Git module, then build `IProviderJobs` |
| [MCP scope storage collisions](mcp-scope-storage-collisions.md) | not started | Re-map provider config paths after the module migration |
| — | | |
| [Claude permission default](claude-permission-default.md) | not started | Phase 1: read `permissions.defaultMode` into Claude's capability default |
| [Single-row mobile composer](composer-single-row.md) | not started | Phase 1: probe page on the S20 for row, badge and sheet |
| [Backend TypeScript conversion](server-typescript-conversion.md) | not started | Phase 1: Codex runtime, renamed in its own commit, then typed |
| [Subagent visibility](subagent-visibility.md) | 4/5 | Phase 5: the row opens the agent's whole transcript; waits on runtime rebuild phase 7 |
| [Workspace surfaces](workspace-surfaces.md) | 1/2 | Phase 1: a plain Terminal tab takes Shell's place; Shell view moves to the chat kebab |
| [Codex thread ownership](codex-chat-shell-ownership.md) | not started | Phase 0: make failed Codex resume stop instead of opening a blank thread |
| [Project dashboard](project-dashboard.md) | 1/4 | Use the generated page for real work before extending it |
| [Markdown-native project board](markdown-project-board.md) | 2/6 | Phase 2: plan-format contract (phase sizes, `Needs:`) enforced by check:docs |
| [Claude settings surface](claude-settings-surface.md) | 3/6 | Phase 4 (categories) built: live check on 3001, then Phase 5 |
| [Background-session notifications](background-session-notifications.md) | not started | Amber header dot + in-app banner, client-only |
| [Design system](design-system.md) | not started | Phase 0: Grayson agrees the design |
| [Cross-provider chat handoff](cross-provider-chat-handoff.md) | not started | Re-verify its four assumed contracts |
| [System diagnostics](system-diagnostics.md) | not started | Move process status from Commands into an authenticated System contract |
| [Diagnostics flight recorder](diagnostics-flight-recorder.md) | not started | Phase 0 re-audit against post-v1.37 `main`; the chat-path core is runtime rebuild phase 1b |
| [Composer prompt stash](composer-prompt-stash.md) | not started | Agree draft ownership and the `+` popover contract |
| [Browser video clips](browser-video-clips.md) | not started | Phase 0: live recording proof on a branch-test slot, with CPU and clip-size numbers |
| [Environments](environments.md) | not started | Phase 0: CLIde on the laptop, reachable from the phone over HTTPS |
| [Threads with no project](no-project-threads.md) | not started | Phase 0: prove each provider runs and resumes in an empty, non-git folder |
| [CLIde harness](clide-harness.md) | not started | Phase 0: inventory what each adapter injects and what each provider already tells its agent |
| [Scheduled tasks](scheduled-tasks.md) | not started | Phase 0: Grayson agrees the positions |
| [Sidebar rail](sidebar-rail.md) | not started | Phase 0: Grayson agrees the design |

Read this table before opening anything. Seeing where every piece of work
stands should cost about a kilobyte.

Provider architecture is now a plan, [the agent runtime rebuild](agent-runtime-rebuild.md),
built to [its design](../designs/agent-runtime-rebuild.md) and the one plan exempt
from the size cap by Grayson's decision; its baseline is
[ARCHITECTURE.md](../../ARCHITECTURE.md)'s provider invariants and
[the provider reference](../providers.md).

## Why plans are capped

Specs replaced plans for a while and grew to 317 KB across eighteen files. One
integration document reached 79 KB — roughly 21,000 tokens for a single read,
paid again after every compaction. Documents that expensive stop being read,
and documents nobody reads stop being updated, so they drift into being
confidently wrong. Two of the largest sections in that 79 KB document were not
plan at all: they were audits appended when reality diverged, because editing
the plan felt more expensive than adding to it.

So a plan is capped at **16 KB** and `npm run check:docs` enforces it. When a
plan strains the cap, the fix is almost never a bigger cap — it is that
background has crept in that belongs in a reference doc, a decision has crept in that
belongs in an ADR, or the target design of architecture work belongs in a design.

## The four document types

Each answers one question. If what you are writing answers a different one, it
belongs in a different file.

| Type | Question | Lifecycle |
|---|---|---|
| [Reference](../README.md) | How does this work today? | Updated when the code changes |
| [ADR](../decisions/) | What did we choose, and why? | Append-only; supersede, never edit |
| [Design](../designs/) | What will it look like when done, and why? | Changes only with Grayson; deleted with its plan |
| Plan | What is left to do, in what order? | Rewritten as the work moves; deleted when done |

**A plan may point at a reference doc. It must never restate one.** Restating is how the
same provider semantics ended up copied into five specs, each drifting
separately. A line of the form "provider permission semantics:
[reference](../providers.md)" is complete. A plan with a
design names it in a `- Design:` header line, because the design binds every
phase; [when a plan gets one](../designs/README.md).

## Template

```markdown
# <What this delivers>

- Status: not started | 2/5 | complete | blocked <why>
- Next: <the next concrete action, in one line>
- Context: <links to the reference docs and ADRs a reader needs; no summary of them>
- Design: <only when it has one: link, and that it binds every phase>

## Phases

- [x] 1. <Outcome, not activity> — `<commit>`
- [~] 2. <Outcome>
- [ ] 3. <Outcome>

## Done when

- <observable condition someone can check>

## Not doing

- <only the exclusions someone would otherwise assume were in>
```

`Status` and `Next` are checked mechanically, so a plan can never again fail to
say where it is. Update them **in the same batch as the code** — a plan updated
later is a plan updated never.

## Sections that are banned, and why

`check-docs.mjs` rejects these. Every one was load-bearing ceremony in the pile
this replaced:

- **How to read this document** — needing reading instructions means it is too long.
- **Purpose**, **Overview**, **Background**, **Scope** — specs routinely opened
  with Status, Purpose, Executive summary and Scope restating each other before
  any content arrived. The title and first sentence do this job.
- **Executive summary / Executive decision** — the decision belongs in an ADR;
  a plan short enough to read does not need summarising.
- **Verification plan / checklist**, **Automated coverage** — `AGENTS.md` already
  owns how to verify. A plan only adds *what* proves this specific thing done.
- **Open questions** — that is a TODO item with an owner, not a section that
  sits unanswered for a month.
- **Corrections applied / Re-measurement / Claim verification** — the append
  pathology. When reality diverges, **edit the plan**. Git holds the old text.

Do not teach general knowledge. An earlier spec spent 7.5 KB explaining what a
git worktree is and that a repository is history rather than a folder of files.
Every reader of these documents already knows that, and every one of them paid
for it.

## Lifecycle

1. Work is claimed as an item in [`../TODO.md`](../TODO.md). Small items never
   need a plan — the item and the commit are enough.
2. A plan appears only when work has **phases that outlive one session**. That
   is the whole test.
3. Durable facts learned along the way go to a reference doc; non-obvious choices go to an
   ADR; the target design of architecture work goes to a design. None stays in
   the plan.
4. When the last phase closes, move what became true into the reference docs
   and `ARCHITECTURE.md`, delete the plan and its design, and close the TODO
   item. Git keeps both; the closing commit names them.
