# Fast, stable chat history and navigation

- Status: 9/17
- Next: Phase 15 — record today's walk in both layouts, then write the rule tests and browser scenarios, each failing on `4b832d8c`
- Context: budgets in `scripts/chat-history/budgets.ts`,
  [test suite](../testing.md),
  [phone selection](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [tool activity rows](../design-system.md#tool-activity-rows)
- Design: [Chat scroll: one owner, three modes](../designs/chat-history-performance.md) — binds every open phase

Long conversations open promptly, scroll back without a Load button or a
freeze that grows with length, keep their place and open state, and let any
prompt be reached directly. The design's ten rules are what "keep their place"
means; a rule is met when its test passes in both layouts, not before.

The **reference session** is the largest local Claude transcript (17 MB, 115
rendered rows): real tool bursts, images and subagents. Synthetic fixtures
are prose-heavy and missed both the per-page growth phase 7 targets and the
phone-layout open fault of 2026-10-13.

Work happens on branch `chat-scroll-owner` in its own worktree, verified on a
branch-test slot, and merges to `main` after phase 14. Order of the open
phases: **15, 11, 16, 10, 17, 7, 12, 14**.

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
- [x] **8. Activity identity survives older pages — M.** An activity keeps
  the key any of its calls had; it stays open and in place. `445ef15d`
- [x] **9. Tests match real sessions, sustained use and position — M.**
  `historyBench.walk` on a tool-burst fixture, both scroll modes. `1ace705a`
- [x] **13. Streaming replies stay cheap as they grow — M.** Streaming
  replies render block by block (`splitMarkdownBlocks`); an update costs the
  open block only.

- [ ] **15. A baseline and failing tests before any fix — L.**

Run today's walk once in each layout and record the result here. Write the
owner's rule tests (one per design rule and transition) and the browser
scenario suite: headless Chromium, the real chat view, the reference session,
phone page mode at 412×880 and the desktop pane, asserting position within
2 px and a layout-shift sum of zero. Measure the suite's run time on the Pi;
each scenario must finish in under a minute or the harness changes before
phase 11 starts.

**Exit:** every scenario that covers a known fault fails on `4b832d8c`,
starting with the phone-layout open landing short; the suite runs from one
`npm` script.

- [ ] **11. One scroll owner — L.**

Build the owner as the design describes and route every writer through it:
the eight in `useChatSessionState`, Find, `toggleInPlace`, the composer's send
and the jump flash. Remove the five timers and the settle window. Add the
eslint ban and the switchable scroll log.

**Exit:** the rule tests and scenarios pass in both layouts; lint fails on a
direct scroll write in chat code; the log shows one write per frame at most.

- [ ] **16. One rendered range — M–L.**

The tail count, jump range, held start, selection start and rewind's hidden
count become one range over loaded records. The prompt list and jumps work
with Find closed. Coordinated with [the runtime rebuild](agent-runtime-rebuild.md)'s
phase 3, which owns the message contract the range indexes.

**Exit:** any user prompt is reachable directly without rendering what lies
between; scrolling from a jump pages both ways and rejoins the tail.

- [ ] **10. Load ahead instead of on demand — L.**

After open, fetch the viewed session's remaining slim history in the
background in bounded pages; scrolling reveals rows from memory. Evict other
sessions' histories from browser memory past a bound. Remove the Load all
bar: a failed page shows a retry row. Export reads complete records without
widening the rendered range. Replaces tool-activity phase 6.

**Exit:** scrolling to the top of the reference session shows no Load button
and waits on no request on a normal connection; export leaves the view as it
was.

- [ ] **17. Sync keeps the reader's place — M.**

Reconnect replay, watcher refresh, live rows and rewind change data only and
reach the owner as row changes. Scenarios: reconnect mid-stream while
following and while reading, a watcher refresh while reading, rewind.

**Exit:** those scenarios pass in both layouts and no data path writes scroll
position.

- [ ] **7. Per-page scroll-up cost, re-measured — M.**

The owner removes restoration's forced layout. Re-measure the reference
session's scroll-up steps (blocked time and React commits per step); bisect
the walk's failing `rerenderBounded` target (passed at `1ace705a`, failed at
`c9cf0b64`) if it still fails. Unmount far rows only if freezes remain.

**Exit:** no scroll-up step blocks over 100 ms in CLIde Browser, and cost no
longer grows with rows already mounted.

- [ ] **12. Close cold-load and Find-preparation gaps — M–XL.**

First open of a changed transcript reparses it (1.9 s for the reference
session); Find preparation is 3.2 s on the 1,000-record fixture. Profile, then
add incremental parsing or indexing only for measured need. Any persistent
index must be rebuildable from provider history. Find indexes in the browser
because only the browser turns records into displayed text.

**Exit:** first open and Find meet the budgets in `scripts/chat-history/budgets.ts`, or the evidence for
leaving them is recorded.

- [ ] **14. Accept on the phone — M.**

On the installed test app: cold open, scroll to the top and back, Find, jumps,
streaming while following and while reading old text, a fling during
streaming, the keyboard and a growing composer, reconnect, rewind, selection,
session switching and tab returns. Update ARCHITECTURE.md invariant 15 and
the testing doc as rules change.

**Exit:** device acceptance recorded, with unverified cases named; the branch
merges to `main`.

## Done when

- Every design rule passes as an automated scenario in both layouts on the
  reference session, from one `npm` script.
- Only the scroll owner writes chat scroll position, and lint enforces it.
- The reference session scrolls bottom to top with no Load button and no step
  blocking over 100 ms in CLIde Browser.
- Any user prompt can be reached directly; old text is findable.
- A long streaming reply costs no more per chunk at its end than at its start.
- Grayson has accepted it on the S20.

## Not doing

- Replacing provider transcripts as authority or importing upstream's restructure.
- Designing the prompt navigator; it has its own item in `docs/TODO.md`.
- The design's own exclusions: native anchoring, `column-reverse`, unmounting
  rows without measured need, the prompt-to-top layout.
