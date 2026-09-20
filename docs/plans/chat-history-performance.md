# Fast, stable chat history and navigation

- Status: 2/9
- Next: Phase 3 — stop rendering unchanged messages again
- Context: [pipeline and measurements](../maps/chat-history-performance.md),
  [test suite](../maps/test-suite.md),
  [phone selection](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [tool detail](../decisions/0046-tool-detail-leaves-the-chat-column.md)

Long conversations should open promptly, preserve the reader's place, and support
Find/direct jumps without loading intervening tool output.

## Phases

- [x] **1. Establish repeatable evidence and limits.**

Synthetic provider fixtures, four executable regression targets, isolated server
and production-built Browser harnesses are maintained in the repository. The
[baseline, commands and numeric budgets](../maps/chat-history-performance.md#repeatable-phase-1-baseline)
separate reader, transport, conversion and rendering costs. Real-device acceptance
and precise browser heap measurement remain explicit later-phase requirements.

- [x] **2. Reuse unchanged server history safely.**

Adapt upstream caching at the sessions/provider boundary. Key by app session,
provider identity and source revision (one consistent version of history).
Include main files, subagent additions/changes and Codex parent-chain dependencies.
Cursor/OpenCode need database-aware revisions or an explicit uncached fallback.
Combine concurrent reads only within a revision.

Handle writes during reads, partial lines, replacement, truncation, rewind,
missing files, provider-id reassignment, failures and eviction. Never cache a
failed read as valid empty history. Measure retained memory; transcript byte size
is not heap usage. Preserve token/turn-start metadata.

Shipped with stable before/after revisions, exact-version concurrency and a
32 MiB bounded LRU. Claude subagents and Codex ancestry participate; database
providers remain uncached. [Evidence](../maps/chat-history-performance.md#phase-2-server-cache).

**Exit:** warm reads do no reparse; concurrent reads share work; dependent changes
invalidate. Cached/uncached results agree and eviction loses no history.

- [ ] **3. Stop rendering unchanged messages again.**

Reuse display conversion for unchanged source records plus later tool results
and subagent dependencies. Reconcile unchanged records on server refresh so fresh
JSON does not invalidate everything. Stabilize keys, callbacks and grouping inputs;
reuse Markdown/code rendering where inputs match. Measure component work, not
only object equality; retain responsive streaming.

**Exit:** unchanged rows stay intact; changed results update. Markdown, citations,
copy, diffs, editing and expansion work.

- [ ] **4. Keep page boundaries stable while history changes.**

Define one provider-neutral contract: stable message ids, ordering, record versus
visible-row counts, completion and a cursor (a bookmark before a message). Bind
bookmarks to a history revision/branch. Appends can preserve older boundaries;
rewind/replacement must explicitly invalidate and re-anchor them. Return the next
bookmark and turn context rather than deriving position from client array length.
Keep tool/result joins correct across boundaries.

Migrate all providers and the store compatibly. Keep stale-response guards,
deduplication and cancellation; test append/refresh/rewind/reconnect races.

**Exit:** walking pages equals the reference active history; identical timestamps,
hidden-only segments and unequal app/provider ids are covered.

- [ ] **5. Bound transferred work, not just record counts.**

Separate display text/tool summaries from raw output, subagent detail and embedded
image bodies. Use authenticated, session-scoped detail/attachment references and
bounded caches. Serve transcript images without repeating their bodies in JSON;
avoid duplicating full results on both tool and result records. Bound page bytes
as well as rows, with an explicit path for one oversized prose message.

Preserve full copy/export and error visibility without silent truncation.
Combine duplicate reads, cancel stale ones and handle missing files. Reuse existing surfaces; agree
new visible behaviour before building. Activity clustering has its own plan.

**Exit:** unopened heavy bodies do not inflate pages beyond budget; requested
details/exports remain complete and access-controlled.

- [ ] **6. Separate Find and prompt navigation from rendered history.**

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

- [ ] **7. Bound expensive rendered contents.**

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

- [ ] **8. Close cold-load and active-session gaps.**

Profile after phases 2–7. If cold/live paths exceed budget, add incremental parsing
and index updates, rebuilding for branch replacement/incompatible formats. Any
persistent index must be reconstructible from provider history. Yield/isolate work
if traces show other requests blocked. Add storage/workers/dependencies only for
measured need with required authorization. Record evidence if none is needed.

**Exit:** first open, appends, dependent histories and concurrent sessions meet
budgets without unbounded caches or stale results.

- [ ] **9. Enforce regressions and accept the experience.**

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
