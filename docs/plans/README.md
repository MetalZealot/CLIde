# Plans

A plan is the ordered work remaining on one piece of CLIde, and nothing else.
It is the only document here that is meant to change constantly.

## The board

Ordered as Grayson set it on 2026-08-03, with the unqueued work below the rule.

| Plan | Status | Next |
|---|---|---|
| [Codex 0.147 and managed native runtime](codex-0-147-managed-native-runtime.md) | 6/7 | Phase 7: align the managed-runtime decisions, maps, and backlog with reality |
| [Post-v1.37 ADR reassessment](post-v1-37-adr-reassessment.md) | 0/2 | Decide ADR 0016 — build Phase 0 or supersede it. **Blocks the plan below.** |
| [Source Control truthfulness](source-control-truthfulness.md) | 1/4 | Phase 0: make server-side Git failures visible in the UI |
| [WebSocket liveness](websocket-liveness.md) | not started | Baseline the integrated gateway; decide any-frame vs matched echo |
| [Commit-message model selection](commit-message-model-selection.md) | not started | Rebaseline on the post-v1.37 Git module, then build `IProviderJobs` |
| [MCP scope storage collisions](mcp-scope-storage-collisions.md) | not started | Re-map provider config paths after the module migration |
| — | | |
| [Browser MCP hardening](browser-mcp-hardening.md) | not started | Slice 1: ref registry and deterministic snapshot projection |
| [Background-session notifications](background-session-notifications.md) | not started | Amber header dot + in-app banner, client-only |
| [Typography system](typography-system.md) | not started | Strip Google Fonts from `index.html`, add preloads |
| [Cross-provider chat handoff](cross-provider-chat-handoff.md) | not started | Re-verify its four assumed contracts |
| [Diagnostics flight recorder](diagnostics-flight-recorder.md) | not started | Phase 0 re-audit against post-v1.37 `main` |

Read this table before opening anything. Seeing where every piece of work
stands should cost about a kilobyte.

Provider architecture consolidation is deliberately not a plan: its baseline is
[the current contract](../maps/CLIde_Provider_Architecture_Current_Contract.md)
and the living maps, and it is kept separate from release work.

## Why plans are capped

Specs replaced plans for a while and grew to 317 KB across eighteen files. One
integration document reached 79 KB — roughly 21,000 tokens for a single read,
paid again after every compaction. Documents that expensive stop being read,
and documents nobody reads stop being updated, so they drift into being
confidently wrong. Two of the largest sections in that 79 KB document were not
plan at all: they were audits appended when reality diverged, because editing
the plan felt more expensive than adding to it.

So a plan is capped at **8 KB** and `npm run check:docs` enforces it. When a
plan strains the cap, the fix is almost never a bigger cap — it is that
background has crept in that belongs in a map, or a decision has crept in that
belongs in an ADR.

## The three document types

Each answers one question. If what you are writing answers a different one, it
belongs in a different file.

| Type | Question | Lifecycle |
|---|---|---|
| [Map](../maps/) | How does this work today? | Updated when the code changes |
| [ADR](../decisions/) | What did we choose, and why? | Append-only; supersede, never edit |
| Plan | What is left to do, in what order? | Rewritten as the work moves; archived when done |

**A plan may point at a map. It must never restate one.** Restating is how the
same provider semantics ended up copied into five specs, each drifting
separately. A line of the form "provider permission semantics:
[map](../maps/clide-provider-capability-map.md)" is complete.

## Template

```markdown
# <What this delivers>

- Status: not started | 2/5 | complete | blocked <why>
- Next: <the next concrete action, in one line>
- Context: <links to the maps and ADRs a reader needs; no summary of them>

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
3. Durable facts learned along the way go to a map; non-obvious choices go to an
   ADR. Neither stays in the plan.
4. When the last phase closes, move the plan to `archive/` with a row in that
   directory's index naming the current authority, and close the TODO item.

Archived plans and specs are frozen. They are exempt from these rules because
the rule that matters for them is that nothing reads them by default.
