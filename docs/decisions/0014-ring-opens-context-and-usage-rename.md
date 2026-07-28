# 0014 — The composer ring opens `/context`; `/cost` became `/usage`

- Date: 2026-07-27
- Status: Accepted

## Decision

The composer's token ring now opens the **Context Window** panel (`/context`)
rather than the spend view. Four choices go with that, each of which looks like
an oversight from the outside:

1. **The ring's fill and colour stay purely context.** Plan limits are shown
   *inside* the panel it opens, never folded into the wheel itself.
2. **`/cost` was renamed `/usage`**, and `/cost` is retained as a handler alias
   that is deliberately **absent from the command menu**.
3. **The non-Claude ("no context breakdown") branch still renders the plan
   panel**, so it is not an empty modal.
4. **The `/context` breakdown is collapsed by default** behind one "Full
   breakdown" disclosure, and the plan-limits header carries a "Full usage"
   button into `/usage`.

## Rejected

- **Leaving the ring on the spend view.** It is the status quo from before
  `/context` existed, and the reason it looked fine is that spend was the only
  panel there was.
- **Folding plan usage into the ring's fill or colour.** Considered so one
  glance covers both ceilings.
- **Hiding `/usage` entirely** once the ring stopped pointing at it.
- **Deleting `/cost`** outright as part of the rename.
- **A second component for the windows-only plan view.** `UsageWindowList` took
  a `windowsOnly` prop instead.
- **Letting the unsupported branch say only "Codex does not report a context
  breakdown."** That is where the ring lands for a Codex session.

## Why

**The ring is a context gauge, so it should open the thing it measures.** Its
number is tokens-in-window over the auto-compact threshold (ADR 0013) — nothing
about spend. Pointing it at `/cost` was a historical accident: the ring predated
`/context`, so it opened the only panel that existed.

**Two ceilings, one wheel.** A turn can be stopped by the context window or by
the plan's 5-hour/weekly window, and they are unrelated quantities. If the wheel
blended them, the number beside it would stop matching it, and a session at 17%
context / 90% weekly has no honest single fill. So they are stacked in one panel
instead: context on top, plan limits below — the same pairing Claude Code's own
expanded status panel uses.

**The rename follows the CLI, and the alias is a fork-local safety net.** Claude
Code retired `/cost` for a richer `/usage`; matching it keeps muscle memory
working for a daily CLI user. Keeping `/cost` as a hidden alias costs one line
and covers two cases the menu cannot: a user who types it from habit, and a
browser tab left open across a deploy still emitting the old `cost` action —
which the client also still accepts, for the same reason.

**Codex has plan usage but no context breakdown.** Since the ring is now the
only click target for both, the unsupported branch would otherwise have been the
end of the road for a non-Claude session — a modal saying only what it *cannot*
show. Rendering the plan panel there keeps the ring useful for every provider,
which is the multi-provider rule in CLAUDE.md applied to a surface that is
Claude-only by accident of who reports a breakdown.

**Collapsed by default, because the first live test was a long scroll.** The
full reading is twelve itemised sections; on a phone the plan limits sat far
below the fold, and the headline plus the limits are what the panel is opened
for. The itemisation is what you go *looking* for — so it is one tap away, not
absent. Same reason `/usage` kept a UI entry point ("Full usage"): moving the
ring left it reachable only by typing, which is a real cost on mobile.

Verified live on the branch-test harness at 3002 (both rounds), against a real
Claude session. 3 new tests in `server/routes/tests/commands.test.js` cover the
action rename and the `/cost` alias resolving to the same handler.
