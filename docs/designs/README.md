# Designs

A design is what one large piece of CLIde work will look like when its plan is
done, and why: the target shape, the positions behind it, and what it costs. It
is the part of a big plan that must not move while the work runs, so it lives
apart from the plan, which changes every session.

| Design | Status | Plan |
|---|---|---|
| [Agent runtime](agent-runtime-rebuild.md) | agreed 2026-10-06 | [Rebuild the agent runtime](../plans/agent-runtime-rebuild.md) |

## When one exists

Only for architecture work whose plan runs across many sessions. Everything
else is a plan alone: its TODO item, its phases and its commits are enough. A
small plan's background belongs in a map, not here.

A design is drafted, given the pillar pass (`ARCHITECTURE.md`'s quality goals,
each gap folded into the design or the plan as work), and agreed with Grayson
before the plan's first build phase starts.

## Who changes it

- **Only Grayson.** A session that finds the design wrong — an SDK fact that
  changed, a position the code cannot keep — stops and says so with the
  evidence. It never edits the design to fit what it built.
- **Each change is its own commit**, so `git log -- docs/designs/<file>` lists
  every design change. A design change hidden inside a status update is the
  drift this folder exists to stop.
- The plan's Status, Next and phase notes change freely; they belong to the plan.

## Next to the other types

- **ADR**: one decision in five sentences. A position a future session would
  undo even after reading the design becomes an ADR, and the design links it.
- **Map**: how it works today. A design's starting point is a dated snapshot,
  never kept current; when the plan closes, what became true moves into maps
  and `ARCHITECTURE.md`, and the design goes to `archive/` with its plan.
- **Plan**: what is left, in what order. Its header names the design in a
  `- Design:` line. `npm run check:docs` checks the two link each other, the
  32 KB cap, and the same banned sections as plans.

## Template

```markdown
# <What the system looks like when this is done>

- Status: draft | agreed <date> | superseded by <link>
- Plan: [<plan title>](../plans/<same-name>.md)
- Context: <links to the maps and ADRs a reader needs; no summary of them>

<Two or three sentences: what this changes and what stays.>

## Starting point

- <Each problem this fixes, as read or measured when written, labelled.>

## Settled with Grayson

- <date>: <what he decided>

## Design positions

- **<The call.>** <Its reason, and the alternative it rejects.>

## Target design

<How it works when done: contracts, ownership, lifecycle, failure handling.>

## What Grayson gives up

- <Each cost he accepts.>

## Not doing

- <Only the exclusions someone would otherwise assume were in.>
```
