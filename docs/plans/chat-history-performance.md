# Fast, stable chat history and navigation

- Status: 7/14
- Next: Phase 7 — cap rows mounted per commit so no step blocks over 100 ms; phone check
- Context: [pipeline and measurements](../maps/chat-history-performance.md),
  [test suite](../maps/test-suite.md),
  [phone selection](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [tool activities](tool-activity-display.md)

Long conversations open promptly, scroll back without a Load button or a
freeze that grows with length, keep their place and open state, and let any
prompt be reached directly.

The **reference session** is the largest local Claude transcript (17 MB, 115
rendered rows): real tool bursts, images and subagents. Synthetic fixtures
are prose-heavy and missed the per-page growth phase 7 targets.

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
14 rows, 855 ms at 112, with requests near 20 ms
([measurement](../maps/chat-history-performance.md#what-the-reader-experiences)).
Done: pickers scan only when open, restoration reads before writing, the
list uses `gap`, restores keep the reader's scroll, laid-out rows skip
rendering off-screen, chained pages double (walk 6.7 → 1.2 s blocked), the
composer skips history commits (components rendered per walk 5,108 → 3,123).
Left: a new row costs ~6.5 ms to mount, mostly Markdown, and one commit can
add 38, so 7 of 13 steps still exceed 100 ms; the phone check.

Count before cutting: timings on the Pi vary run to run and can hide a small
win. Record React commits and rows re-rendered per scroll-up step in the
reference session. Those counts repeat exactly. Confirm once that lowering them
lowers blocked time, then work against the counts. Phase 10 turns them into
the failing check.

**Exit:** in the reference session no scroll-up step blocks over 100 ms in
CLIde Browser, and cost no longer grows with rows already mounted.

- [x] **8. Activity identity survives older pages — M.** An activity keeps
  the key any of its calls had; it stays open and in place. `445ef15d`

- [ ] **9. Load ahead instead of on demand — L.**

After open, fetch the viewed session's remaining slim history in the
background in bounded pages; scrolling reveals rows from memory. Evict other
sessions' histories from browser memory past a bound. Remove the Load all
bar: show progress only while a needed fetch runs, with retry on failure.
Export reads complete records without widening the rendered window. Replaces
tool-activity phase 6 (loading by activities).

**Exit:** scrolling to the top of the reference session shows no Load button
and waits on no request on a normal connection; export leaves the view as it
was.

- [ ] **10. Tests match real sessions and sustained use — M.**

A tool-heavy fixture with long bursts. Walk to the top and back, stream while
reading old text, expand output mid-walk; assert phase 7's commit and row-render counts per
prepend.

**Exit:** the benchmark fails when per-page cost grows with mounted rows.

- [ ] **11. One rendered-window model — L; XL if bounding is needed.**

The tail count, the jump range and the selection hold become one range over
loaded records. The prompt list and jumps work with Find closed. Re-measure
long sessions: only if freezes remain, render near-viewport rows with reserved
space, keeping selection, focus, editing, Find highlights, expansion and phone
page scrolling intact. Otherwise record the evidence and close.

**Exit:** any user prompt is reachable directly without rendering what lies
between; scrolling from a jump pages both ways and rejoins the tail.

- [ ] **12. Close cold-load and Find-preparation gaps — M–XL.**

First open of a changed transcript reparses it (1.9 s for the reference
session); Find preparation is 3.2 s on the 1,000-record fixture. Profile, then
add incremental parsing or indexing only for measured need. Any persistent
index must be rebuildable from provider history.

**Exit:** first open and Find meet the map's budgets, or the evidence for
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
phone app. Update the map and orientation as rules change.

**Exit:** device acceptance recorded, with unverified cases named.

## Done when

- The reference session scrolls bottom to top with no Load button and no step
  blocking over 100 ms in CLIde Browser, and without visible stalls on the phone.
- An expanded activity stays expanded while older history loads.
- Any user prompt can be reached directly; old text is findable.
- Maintained tests fail when per-page cost grows with mounted rows.
- A long streaming reply costs no more per chunk at its end than at its start,
  or the measurement for leaving it is recorded.

## Not doing

- Replacing provider transcripts as authority or importing upstream's restructure.
- Designing the prompt navigator; it has its own item in `docs/TODO.md`.
- Rendering only near-viewport rows unless phase 11's measurement needs it.
