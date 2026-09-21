# Fast, stable chat history and navigation

- Status: 5/9
- Next: Phase 6 — Find and prompt navigation without rendering history
- Context: [pipeline and measurements](../maps/chat-history-performance.md),
  [test suite](../maps/test-suite.md),
  [phone selection](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [tool detail](../decisions/0046-tool-detail-leaves-the-chat-column.md)

Long conversations should open promptly, preserve the reader's place, and support
Find/direct jumps without loading intervening tool output.

## Effort sizes

Estimates include implementation, tests and verification.
They do not predict model tokens, cost or how much fits in a usage window.
**M:** bounded work with focused checks. **L:** several connected changes with
substantial edge-case testing; split into reviewable batches. **XL:** changes
across layers/providers or complex interaction behaviour; multiple L-sized batches.
Completed phases provide reference sizes.

## Phases

- [x] **1. Establish repeatable evidence and limits — M.**

Synthetic provider fixtures, four executable regression targets, isolated server
and production-built Browser harnesses are maintained in the repository. The
[baseline, commands and numeric budgets](../maps/chat-history-performance.md#repeatable-phase-1-baseline)
separate reader, transport, conversion and rendering costs. Real-device acceptance
and precise browser heap measurement remain explicit later-phase requirements.

- [x] **2. Reuse unchanged server history safely — L.**

Shipped a 32 MiB serialized-history cache with bounded entries, shared concurrent
loads and before/after source checks. Claude subagents and Codex ancestry
participate; Cursor/OpenCode remain uncached. Review fixes cover discovery races,
directory-read failures and identity cleanup. Warm reads avoid reparsing; measured
memory and correctness coverage are in the [map](../maps/chat-history-performance.md#phase-2-server-cache).

- [x] **3. Stop rendering unchanged messages again — L.**

Shipped identity-preserving conversion and server refreshes, stable tool groups,
and memoized Markdown. Tests cover changed tools, subagents, streaming and removals;
Browser checks enforce bounded append/update work and zero unchanged-refresh work.
At 1,000 records, median append time fell from 10.36 s to 255 ms. Full-history Find
and remaining layout stalls stay in phases 6–7. [Evidence](../maps/chat-history-performance.md#phase-3-unchanged-message-rendering).

- [x] **4. Keep page boundaries stable while history changes — XL.**

Shipped session-scoped bookmarks across all four providers, explicit record counts,
append-safe older pages and refreshes from the oldest loaded boundary. Rewind or
replacement invalidates bookmarks and reloads the window. Requests are cancelled
and guarded against stale publication; tools join before paging. Tests cover
SQLite/JSONL histories, hidden records, equal timestamps, identity changes,
reconnects and cancelled Find loads. Six synthetic Browser runs preserve the loaded
tail without duplicate ids and retain phase-3 rendering limits.
[Contract and verification](../maps/chat-history-performance.md#phase-4-stable-history-bookmarks).

- [x] **5. Bound transferred work, not just record counts — XL.**

Pages carry image URLs and tool-payload previews instead of bodies; strings over
8 KiB leave the page, prose never does. Pages stop at 256 KiB, keeping one
oversized record alone. Opening a card fetches its complete record; export swaps
in full records or exports nothing. The heavy fixture page fell from 723,743 to
6,146 bytes; a real 17 MB session's full slim history is 2.6 MB.
[Contract and evidence](../maps/chat-history-performance.md#phase-5-bounded-page-payloads).

- [ ] **6. Separate Find and prompt navigation from rendered history — XL.**

Build a lightweight text/turn lookup, tied to the history revision, for Find and
future prompt navigation. Preserve authored-text scope, literal case-insensitive
matching, counts, wraparound, keyboard actions and focus restoration. Match the
text actually displayed, including Markdown boundaries and follow-up questions;
exclude hidden markup/tool bodies and existing excluded message kinds.

Return message ids/match locations; fetch a bounded window around the chosen id
and highlight after mounting. Cancel stale work on typing, switch or rewind. Bound
and update the index; choose worker/server search from measurements. Expose
previous/next authored-turn and list APIs; new controls are separate.

**Exit:** old matches need no page walk, attachment reads or full render; cached
history needs no full redownload. Streaming preserves correctness.

- [ ] **7. Bound expensive rendered contents — XL.**

After phase 6, render near-viewport contents with measured-height placeholders
elsewhere. Agree loading/selection behaviour first. Support desktop scroll boxes
and phone page scrolling. Preserve message/pixel anchors through prepends, image/
font loads, expansion, keyboard/typography changes and tab switches. Bound prefetch
and prevent overlapping loads.

Pin selected text, focus, editing and the active search result as needed. Keep
expansion state outside evicted contents. Selection may deliberately extend the
window; release it afterward. Preserve cross-message copy, screen-reader access,
reduced motion and bottom-follow only when intended.

**Exit:** rich contents stay bounded except interaction pins; history remains
reachable. Real phone handles and Browser layout pass.

- [ ] **8. Close cold-load and active-session gaps — M–XL.**

M for profiling; up to XL if incremental parsing/indexing is needed.
Profile after phases 2–7. If cold/live paths exceed budget, add incremental parsing
and index updates, rebuilding for branch replacement/incompatible formats. Any
persistent index must be reconstructible from provider history. Yield/isolate work
if traces show other requests blocked. Add storage/workers/dependencies only for
measured need with required authorization. Record evidence if none is needed.

**Exit:** first open, appends, dependent histories and concurrent sessions meet
budgets without unbounded caches or stale results.

- [ ] **9. Enforce regressions and accept the experience — L.**

Test operation counts and correctness in the relevant normal tests. Run
browser scaling benchmarks on a controlled runner with explicit thresholds and
variance; avoid blind wall-clock gates. Re-run for provider/parser, store,
Markdown, search, transcript and upstream integration changes.

Exercise cold open, upward scrolling, Find/jumps, streaming while reading old text,
reconnect, rewind/fork, selection, details and session switching. Memory must settle
within budget. Publish before/after results distinguishing source/build/runtime/
device evidence. Ship reviewable commits with tested fallbacks where needed. Update
the map and orientation as rules change; verify the served checkout before closing.

**Exit:** gates pass; device acceptance and unverified cases are recorded.

## Done when

All nine exits hold. Loading preserves position, old text is directly searchable,
and future regressions fail maintained gates.

## Not doing

- Replacing provider transcripts as authority or importing upstream's restructure.
- Designing the prompt navigator/minimap or [activity UI](tool-activity-display.md).
- Runtime changes or deployment during this planning task.
