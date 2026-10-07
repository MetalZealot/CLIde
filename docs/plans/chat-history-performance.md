# Fast, stable chat history and navigation

- Status: 8/14
- Next: Phase 7 — cut the ~50 ms fixed frame cost (forced layout in scroll restoration); phone check. Phase 13 lands with [the agent runtime rebuild](agent-runtime-rebuild.md)'s phase 2, and phase 11 is coordinated with its phase 3
- Context: budgets in `scripts/chat-history/budgets.ts`,
  [test suite](../testing.md),
  [phone selection](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [tool activity rows](../design-system.md#tool-activity-rows)

Long conversations open promptly, scroll back without a Load button or a
freeze that grows with length, keep their place and open state, and let any
prompt be reached directly.

The **reference session** is the largest local Claude transcript (17 MB, 115
rendered rows): real tool bursts, images and subagents. Synthetic fixtures
are prose-heavy and missed the per-page growth phase 7 targets.

**Every change is checked for position, not just speed, in pane and phone
page-scroll mode** ([how](../testing.md#which-checks-to-run)):
the session opens at the bottom, and a walk up that pauses between swipes
moves nothing the reader did not scroll. Speed-only checks shipped a fault
that opened sessions 629 px up and jumped the view 1,338 px (`61440326`).

## Effort sizes

**M:** bounded work with focused checks. **L:** several connected changes with
substantial edge-case testing. **XL:** changes across layers or complex
interaction behaviour. Sizes include tests and verification, not model cost.

## Phases

- [x] **1. Repeatable evidence and limits — M.** Synthetic fixtures, server and
  Browser harnesses, numeric budgets. `6de67688`
- [x] **2. Reuse unchanged server history — L.** Bounded revision cache; warm
  reads never reparse. `dc29d441`
- [x] **3. Unchanged messages keep their render — L.** Identity-preserving
  conversion, memoized Markdown. `6cd6f553`
- [x] **4. Stable page boundaries — XL.** Session-scoped bookmarks on all four
  providers; rewind invalidates. `83015151`
- [x] **5. Bounded page payloads — XL.** Previews instead of tool output and
  image bodies; 256 KiB page cap. `1047d1e4`
- [x] **6. Find without rendered history — XL.** Text index over a text-only
  copy; jumps load a window around the match. `20db29e2`

- [~] **7. Cut the per-page cost of scrolling up — M–L.**

Each scroll-up step blocks the main thread longer as rows accumulate: 67 ms at
14 rows, 855 ms at 112, with requests near 20 ms.
Done: pickers scan only when open, restoration reads before writing, the
list uses `gap`, restores keep the reader's scroll, laid-out rows skip
rendering off-screen, chained pages double (walk 6.7 → 1.2 s blocked), the
composer skips history commits (components rendered per walk 5,108 → 3,123).
older pages reveal within a 30 ms estimated mount budget per frame (worst
frame 282 → 116 ms, production build); rows opt in to skipping with their
measured height, so restores stop drifting (`61440326`). Left: 4 of 38 steps still exceed
100 ms, on a ~50 ms fixed frame cost that is ~40% forced layout; the phone check.

Count before cutting: timings on the Pi vary run to run and can hide a small
win. Record React commits and rows re-rendered per scroll-up step in the
reference session. Those counts repeat exactly. Confirm once that lowering them
lowers blocked time, then work against the counts; the phase-9 walk fails
when they grow. To count on the reference session, a stub
`__REACT_DEVTOOLS_GLOBAL_HOOK__` in a same-origin iframe counts commits and
components rendered; Long Animation Frame entries give frame and forced-layout
time; aliasing `react-dom` to `react-dom/profiling` adds time per component.

**Exit:** in the reference session no scroll-up step blocks over 100 ms in
CLIde Browser, and cost no longer grows with rows already mounted.

- [x] **8. Activity identity survives older pages — M.** An activity keeps
  the key any of its calls had; it stays open and in place. `445ef15d`

- [x] **9. Tests match real sessions, sustained use and position — M.**
  `historyBench.walk` on a tool-burst fixture, both scroll modes; it found
  arrivals trimming rows above a scrolled-up reader and a stale settle anchor
  (`3a83002a`). Red with `61440326` undone. `1ace705a`

- [ ] **10. Load ahead instead of on demand — L.**

After open, fetch the viewed session's remaining slim history in the
background in bounded pages; scrolling reveals rows from memory. Evict other
sessions' histories from browser memory past a bound. Remove the Load all
bar: show progress only while a needed fetch runs, with retry on failure.
Export reads complete records without widening the rendered window. Replaces
tool-activity phase 6 (loading by activities).

**Exit:** scrolling to the top of the reference session shows no Load button
and waits on no request on a normal connection; export leaves the view as it
was.

- [ ] **11. One rendered-window model — L; XL if bounding is needed.**

The tail count, the jump range and the selection hold become one range over
loaded records. The prompt list and jumps work with Find closed. One owner
sets scroll position, in two modes: follow the bottom, or hold a row still.
About 15 sites set it today (grep, 2026-09-27); loads, reveals, resizes and
jumps all go through the owner. Re-measure
long sessions: only if freezes remain, render near-viewport rows with reserved
space, keeping selection, focus, editing, Find highlights, expansion and phone
page scrolling intact. Otherwise record the evidence and close.

**Exit:** any user prompt is reachable directly without rendering what lies
between; scrolling from a jump pages both ways and rejoins the tail; only
the owner writes scroll position.

- [ ] **12. Close cold-load and Find-preparation gaps — M–XL.**

First open of a changed transcript reparses it (1.9 s for the reference
session); Find preparation is 3.2 s on the 1,000-record fixture. Profile, then
add incremental parsing or indexing only for measured need. Any persistent
index must be rebuildable from provider history. Find indexes in the browser
because only the browser turns records into displayed text; a server search
would match text the chat never shows. Building in 12 ms slices keeps typing
responsive, so no worker.

**Exit:** first open and Find meet the budgets in `scripts/chat-history/budgets.ts`, or the evidence for
leaving them is recorded.

- [ ] **13. Streaming replies stay cheap as they grow — M.**

Markdown skips work only for unchanged text, so a streaming reply probably
reparses all of itself on every chunk (read from source, not measured). Measure
per-chunk cost against reply length on a long reply with code blocks. If it
grows, render finished blocks once and reparse only the open tail.

**Exit:** per-chunk work does not grow with reply length, or the measurement
for leaving it is recorded.

- [ ] **14. Accept on the phone — M.**

Cold open, scroll to the top and back, Find, jumps, streaming a long reply and
streaming while reading old text, reconnect, rewind, selection and session switching on the installed
phone app. Update ARCHITECTURE.md as rules change.

**Exit:** device acceptance recorded, with unverified cases named.

## Done when

- The reference session scrolls bottom to top with no Load button and no step
  blocking over 100 ms in CLIde Browser, and without visible stalls on the phone.
- A session opens at the bottom and nothing moves that the reader did not
  scroll, in pane and phone mode; a maintained check fails otherwise.
- An expanded activity stays expanded while older history loads.
- Any user prompt can be reached directly; old text is findable.
- Maintained tests fail when per-page cost grows with mounted rows.
- A long streaming reply costs no more per chunk at its end than at its start,
  or the measurement for leaving it is recorded.

## Not doing

- Replacing provider transcripts as authority or importing upstream's restructure.
- Designing the prompt navigator; it has its own item in `docs/TODO.md`.
- Rendering only near-viewport rows unless phase 11's measurement needs it.
