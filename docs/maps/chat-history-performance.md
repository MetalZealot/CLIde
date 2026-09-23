# Chat history loading and rendering

Phases 1–6 provide server reuse, unchanged-message rendering, stable paging,
bounded payloads and Find without rendered history below. What remains is in
the [performance plan](../plans/chat-history-performance.md).

## What the reader experiences

Opening fetches the newest 20 records; scrolling within 1.5 screens of the top
reveals loaded rows, then fetches 20 more. Rendered rows only accumulate until
the session changes or ↓ rejoins the tail. Collapsed activities fold many
records into one row, so a page can add little height and the pane chains
further requests. Find and jumps use the detached window below.

Measured 2026-09-23 in CLIde Browser on a branch-test server serving `main`,
412 px viewport, pane scrolling, the 17 MB reference session:

| Measurement | Result |
|---|---:|
| Whole session rendered | 115 rows, 1,778 elements |
| Scroll-to-top steps / history requests to reach the top | 17 / 52 |
| Request time per page, server cache warm | ~20 ms |
| Blocked main thread per step at 14 / 112 mounted rows | 67 / 855 ms |
| Of which layout forced from script | 28 / 497 ms |
| DOM change per step | ~17 nodes added; no existing row remounted |
| First request, server cache cold | 1.9 s |

Cost per step grows with rows already mounted while the DOM change stays
small. Profiled causes, largest first:

- Style recalculation forced by scroll restoration once per commit, ~70 ms
  at 40–66 rows; a step makes ~4 commits (chained fetches). A fresh copy of
  the list restyles 5–6× faster, for an unidentified reason. Rows now skip
  rendering off-screen (`content-visibility`), which cuts it ~5×.
- Tailwind `space-y`'s sibling selector restyled every row on a top insert
  (130 vs 9 ms on a fresh list); the list uses `gap`.
- Closed rewind/fork pickers re-filtered the conversation twice per render
  (~13 ms each); they now scan only when open.
- Scroll restoration read `scrollHeight` after writing `scrollTop`, a second
  forced layout per commit; reads now precede the write.
- The top activity remounted, with all its rows, on each prepend that
  extended it; it now keeps its key.

A whole walk to the top blocked 6.7 s before these fixes, 4.1 s without
`content-visibility`, 1.9 s with it (desktop). Worst frame 105 ms, but late
steps still sum 210–286 ms over 3–5 long frames: one per commit.

A row may skip only after a real layout records its size: one skipped
before that holds the 150 px guess and jumps the reader when reached (why
it was removed on 2026-07-31). Scrolling up 120 px at a time, 0 of 274
steps jump; a restore also keeps scroll the reader made since capture.

## Repeatable phase-1 baseline

The fixture version and source fingerprint travel with each report. The initial
reports include concurrent, uncommitted copy/settings work; they identify the
measured source and do not assert a clean release baseline. All records are
synthetic. The harness creates and removes its own temporary database, transcripts
and client build; it never opens user histories or replaces deployed assets.

Commands from the checkout root:

```sh
npm run bench:chat-history -- --samples=5 --output=/tmp/history-server.json
npm run bench:chat-history -- --regressions-only
npm run bench:chat-history -- --check --samples=5
npm run bench:chat-history:browser -- --output=/tmp/history-browser.json
```

The last command prints a loopback URL. Open it in CLIde Browser, wait for
`window.historyBench`, and evaluate `await window.historyBench.run(0)` for 200
mixed records, or `run(1)` for 1,000. Reload before every sample. Record three or
more samples per viewport with no concurrent builds/tests; stop the fixture
process afterward. Results save automatically when an output path is supplied.
Use the same Browser session, not another Chromium process. The fixture mounts
the actual session store, history/Find hooks and message pane, with production
React and instrumented conversion, row and Markdown counters. It excludes the
full app shell, composer, WebSocket transport and production authentication.

Server fixtures cover 200/2,000/10,000 plain messages for Claude and Codex plus
heavy tool output. Correctness checks cover unequal app/provider ids, complete
pagination, branch filtering, hidden rows, images, tool joins and subagent-file
changes. Codex ancestry invalidation has phase-2 coverage. Cursor/OpenCode now
have synthetic SQLite paging checks, but no measured performance baseline.

Cold means the first application read, not an emptied operating-system disk
cache. HTTP wraps the real sessions service over loopback and excludes auth/TLS.
Read bytes are logical stream traffic; page bytes are uncompressed JSON. Server
heap deltas are retained memory after garbage collection, not peak memory.
Browser elapsed time ends after two animation frames; a further 100 ms delivers
observer entries. Frame samples include that delivery interval. Browser heap
estimates are coarse and cannot establish the memory limit. Desktop and emulated
phone evidence never establishes real-device or installed-PWA acceptance.

### Recorded measurements (2026-09-19)

[Server report](../../scripts/chat-history/baselines/2026-09-19-server.json):
five samples per workload, Node 24 on Linux ARM64. No competing build/test was
started during the measurements; background services were not suspended.
Values below are median / observed p95 in milliseconds.

| Provider / plain messages | Cold reader | Warm reader | Warm HTTP | Warm bytes read |
|---|---:|---:|---:|---:|
| Claude / 200 | 16 / 32 | 10 / 12 | 15 / 24 | 0.12 MiB |
| Claude / 2,000 | 67 / 71 | 56 / 87 | 58 / 69 | 1.25 MiB |
| Claude / 10,000 | 233 / 310 | 232 / 274 | 225 / 273 | 6.25 MiB |
| Codex / 200 | 19 / 34 | 11 / 15 | 14 / 19 | 0.19 MiB |
| Codex / 2,000 | 83 / 91 | 68 / 75 | 77 / 88 | 1.35 MiB |
| Codex / 10,000 | 329 / 343 | 302 / 328 | 291 / 301 | 6.53 MiB |

All six warm-read targets fail. Plain 20-message pages are about 13 KB, while
heavy-tool pages reach 723,743 bytes (Claude) and 727,572 bytes (Codex): both fail
the page budget. Retained server heap growth per sample stayed below 1 MiB;
this does not measure peak parsing allocations or a future cache's steady state.

[Browser report](../../scripts/chat-history/baselines/2026-09-19-browser.json):
three reloads per mixed-history size, CLIde Browser desktop preset, 1280×720,
Chromium 153 running on the same host. The user-agent reports Windows because it
is an emulation preset; the runner is Linux ARM64. No console errors in the final
run. Values are median / observed p95 milliseconds.

| Operation | 200 fixture records | 1,000 fixture records |
|---|---:|---:|
| Open newest page | 850 / 930 | 1,000 / 1,451 |
| Load one older page | 867 / 968 | 865 / 1,320 |
| Find oldest authored text | 4,096 / 4,366 | 24,656 / 25,958 |
| Append one live message after closing Find | 2,115 / 2,150 | 10,363 / 11,018 |

Find transfers 440,494 / 2,204,564 decoded response bytes and mounts 180 / 900
chat rows. The next append makes no history request but rerenders all 181 / 901
rows and their Markdown. Median longest append tasks are 2,083 / 10,212 ms;
median append frame p95 is 2,083 / 10,250 ms. Find's longest individual task
reaches 24,771 ms in the larger fixture. Tool-result/hidden records explain why
fixture record counts, converted messages and mounted rows differ.

Reader and rendering costs grew independently. This is a baseline, not proof of
production latency or touch smoothness.

## Phase 2 server cache

[Server report](../../scripts/chat-history/baselines/2026-09-20-server-phase2.json):
five samples per workload on the same Node/Linux ARM64 host. Values are median /
observed p95 milliseconds. Source was dirty only because the measured phase-2
change and unrelated preserved client work were uncommitted; the report carries
the exact server/source fingerprint.

| Provider / plain messages | Cold reader | Warm reader | Warm HTTP | Warm bytes read |
|---|---:|---:|---:|---:|
| Claude / 200 | 20.43 / 67.31 | 1.47 / 2.31 | 8.16 / 15.33 | 0 |
| Claude / 2,000 | 76.23 / 80.42 | 1.33 / 1.42 | 5.11 / 6.04 | 0 |
| Claude / 10,000 | 315.68 / 351.31 | 1.27 / 1.33 | 4.78 / 5.15 | 0 |
| Codex / 200 | 25.79 / 35.62 | 0.97 / 1.07 | 4.46 / 4.88 | 0 |
| Codex / 2,000 | 94.94 / 95.53 | 1.05 / 1.53 | 4.62 / 5.58 | 0 |
| Codex / 10,000 | 372.79 / 402.31 | 1.05 / 1.06 | 5.10 / 22.67 | 0 |

At 10,000 messages, warm-reader p95 fell from 274 to 1.33 ms for Claude
and 328 to 1.06 ms for Codex. All warm reads avoided transcript stream bytes.
The largest observed post-GC retained heap delta was 10.08 MiB; the largest
cache estimate was 30.89 MiB against a 32 MiB bound. That estimate is V8's
serialized normalized history, not transcript size or exact heap occupancy.

The cache keys an app session to provider/native identity and a source revision.
File identity includes device, inode, mode, size, nanosecond mtime and ctime.
Claude also watches the optional subagent directory plus every agent JSONL/meta
file; directory discovery is bracketed by revision checks so newly created agents
cannot escape the dependency list. Strict loads propagate directory-read errors
other than an absent optional directory. Codex validates every resolved parent rollout. A load is retained only
when the same complete revision exists before and after parsing. Partial tails,
malformed rows, missing/unreadable dependencies and read failures fall back to
the tolerant uncached provider path. Concurrent misses share only an exact
revision; changed identity or source cannot replace newer work. LRU retention is
limited to eight entries and 32 MiB of normalized serialized values, and one
oversized history is served without retention. Identity generations are retained
only while requests are active; superseded requests cannot repopulate the cache.

Cold-path work remains phase 8.

Tests compare cached pages to direct reads (tool results, token usage, turn
starts) and cover concurrent loads, subagent discovery, directory-read failures,
identity changes, append/rewind/replacement/truncation, partial or malformed
tails, missing files, failed loads, parent/subagent changes and eviction. Cursor
and OpenCode stay on direct reads until their SQLite stores have revisions.

## Phase 3 unchanged-message rendering

Store refreshes reconcile equivalent JSON records by id and complete content within
the session slot. Display projections use weak keys tied to immutable source
records and their separately arriving tool results. Replace a record when any
nested field changes; mutating it in place would leave a stale projection.
Unchanged tool groups retain their objects; group containers and Markdown use
React's ordinary prop comparison, preserving state/context updates and changed
callbacks. No custom comparator ignores live inputs. Late results, child tools,
streaming text, grouping membership and server removals have regression coverage.

[Browser report](../../scripts/chat-history/baselines/2026-09-20-browser-phase3.json):
three samples each at 200 and 1,000 mixed records, same desktop Browser preset and
fixture as phase 1, with no Browser console errors; not deployed-app or
physical-phone acceptance.

| Operation, median / observed p95 ms | 200 records | 1,000 records |
|---|---:|---:|
| Append after Find, phase 1 | 2,115 / 2,150 | 10,363 / 11,018 |
| Append after Find, phase 3 | 53 / 60 | 255 / 284 |
| Refresh equivalent server history | 39 / 44 | 250 / 312 |
| Update an existing streaming row | 32 / 33 | 136 / 159 |

Every append converts one record, renders two affected rows (new content and the
previous reply's turn metadata), and renders Markdown once. Refresh performs zero
conversions/row/Markdown renders. A streaming update converts and renders one row.
The Browser harness now fails these work-count checks after saving its report:
append/update at most one conversion, three rows and one Markdown render; unchanged
refresh zero of each. Conversion instrumentation now counts cache misses; phase 1
counted input records, so those counter definitions differ. Row counters are comparable.

Append frame p95 still reached 200 ms despite bounded React work; phase 7 owns
mounted-content limits.

### Targets and enforcement

These are engineering targets for this workload, not external standards or
achieved guarantees. [budgets.ts](../../scripts/chat-history/budgets.ts) owns the
numbers; change a target only with an explained measurement-based decision.

| Boundary | Target |
|---|---|
| Unchanged warm page | zero transcript bytes reread |
| Append between pages | zero overlapping message ids |
| Append one display row | zero unchanged objects recreated |
| Find | at most 100 mounted rows, including an old reachable match |
| 20-record page including heavy tools | at most 256 KiB serialized JSON |
| Reader cold / warm p95 | 500 / 50 ms |
| Loopback HTTP cold / warm p95 | 750 / 150 ms |
| Browser open / Find p95 | 1,000 / 500 ms |
| Frame interval p95 / longest task | 32 / 200 ms |
| Server retained growth / browser heap growth | 64 / 128 MiB |

Warm reads, unchanged display objects, append-safe pagination and the Find
window pass ordinary tests; `--regressions-only` runs those targets and exits 0.
`--check` additionally checks warm rereads and oversized pages.
Timing and memory targets are advisory until phase 9 establishes a
controlled runner, precise memory capture and accepted tolerances; no green
correctness run means scrolling has passed. With five server or three browser
samples, nearest-rank p95 is the slowest observed sample, not a population estimate.

Harness checks:

```sh
node_modules/.bin/tsc -p scripts/chat-history/tsconfig.client.json
node_modules/.bin/tsc -p scripts/chat-history/tsconfig.server.json
npm run test:server:one -- server/modules/providers/tests/provider-sessions.test.ts
npm run test:client:one -- src/components/chat/hooks/chatHooks.test.ts
```

## Phase 4: stable history bookmarks

The [pagination service](../../server/modules/providers/services/history-pagination.service.ts)
issues versioned, session-scoped bookmarks containing an exclusive record boundary
and the loaded snapshot's count/fingerprint. `before` walks older records;
`from` refreshes from the oldest loaded boundary through the current tail. Provider
ordering, including equal-timestamp order, is preserved after complete tool joins.
A prefix-preserving append keeps existing bookmarks valid. Changing any existing
record, its order, or app/provider/path identity returns HTTP 409
`HISTORY_CURSOR_INVALIDATED`; malformed bookmarks return 400. Content changes,
including completed tool output, conservatively invalidate the snapshot.

The client retries invalidation once with its loaded window size, replaces stale
rows, and arms the existing scroll restoration before publishing a page reset.
Surviving message anchors can be restored; a removed anchor uses the existing
scroll fallback. Refresh appends retain the oldest loaded record. A newer request,
session switch, unmount or optimistic rewind cancels obsolete work; request tickets
also guard transports that ignore abort. A cancelled full load cannot mark a
partial window complete. Failed reads retain the existing window.
Legacy servers without bookmark metadata retain offset compatibility.

Bookmarks are stateless and survive cache eviction/server restart. Fingerprints
are weakly owned by the normalized array, capped at eight requested boundaries
per snapshot, with 2 KiB reserved in the existing 32 MiB cache budget. Warm requests reuse them. Cold or changed histories
still require full normalization and hashing (phase 8). Cursor's synthetic
timestamps (session creation time plus sequence) and fallback ids are
deterministic, not real wall-clock times.

Verification covers all four providers, app/native ids deliberately unequal,
appends and cache eviction, equal timestamps, hidden-only pages, tool joins,
rewind/replacement, malformed HTTP queries, reconnect/reset, deduplication and
cancelled responses. Browser checks additionally require bookmark advancement,
no duplicate ids and retention of the loaded tail while scrolling upward.

The [server report](../../scripts/chat-history/baselines/2026-09-20-server-phase4.json)
uses three samples per size. At 10,000 records, warm-reader median / observed p95
was 1.92 / 17.30 ms for Claude and 1.68 / 1.76 ms for Codex, with zero transcript
bytes reread. Cold p95 was 450 / 484 ms respectively.

The [Browser report](../../scripts/chat-history/baselines/2026-09-20-browser-phase4.json)
has three desktop runs each at 200 and 1,000 records. All paging and phase-3 rendering checks pass; older-page
median / observed p95 was 590 / 621 ms and 557 / 586 ms respectively. No console
errors in the final run. Physical-phone acceptance remains open.

## Phase 5: bounded page payloads

The [payload service](../../server/modules/providers/services/history-payload.service.ts)
sends a copy of each paged record; cached history stays complete. Inline image
bodies become authenticated `messages/:id/images/:n` URLs. Tool input, results,
`toolUseResult` and subagent-child strings over 8,192 characters become
1,024-character previews, and the record carries `elidedDetail` (full size,
result line count). Authored prose is never shortened. Tail and `before` pages
stop adding older records past 256 KiB, always keeping the newest, so one
oversized message gets a page of its own; `from` refreshes and unbounded loads
are exempt. `payload=full` returns records unchanged.

Clicking an elided tool card (default-open cards: on mount) fetches
`messages/:id`; the client keeps the last 16 details and shows a retry on
failure. Export with tool calls swaps every elided record from one full read and
exports nothing if one is missing.

[Server report](../../scripts/chat-history/baselines/2026-09-21-server-phase5.json):
the heavy 20-record page fell from 723,743 to 6,146 bytes (Claude) and 727,572
to 9,979 (Codex); warm rereads stay zero. A real 17 MB Claude session on a
branch-test server (2026-09-21) paged at most 147 KB per page and 2.6 MB for its
whole slim history; its 19 images loaded through the image route.

## Phase 6: Find without rendered history

Find searches a text index, not the page. The [index](../../src/components/chat/utils/chatFindIndex.ts)
converts each record the way the chat does and reduces Markdown to its displayed
text with the renderer's parser, one segment per `data-chat-find-content` element,
built in 12 ms slices. A complete loaded history is indexed in place; otherwise
`?payload=text` returns only records that can display as conversation text, with
only the fields conversion reads, on the pages' revision; the store reuses it per
revision. The loaded window lies over it, so streamed and live rows count.

A match is a message id plus an ordinal. Rendered matches highlight as before; an
unrendered one reveals from memory or fetches `?around=<id>` (40 records, page
byte cap). That window is detached: it hides live rows, skips refreshes, and pages
newer with an id-anchored `after` token that survives a growing tail, rejoining
through ↓, sending, or the newest page. Sidebar results land the same way.
Prompt navigation is API-only: `listPromptTurns`, `adjacentPromptTurn`.

[Browser report](../../scripts/chat-history/baselines/2026-09-21-browser-phase6.json),
medians of three at 200 / 1,000 records: Find fell from 3.7 / 24.0 s to 1.4 /
3.2 s, longest task from 2.9 / 16.2 s to 0.30 / 0.33 s, mounted rows from 180 /
900 to 36, bytes from 441 KB / 2.2 MB to 87 / 352 KB. The rest is the index build
(Markdown parsing, about 2 ms per short record in Node here; the fixture has 850),
so the 500 ms target still fails. A real 17 MB session (139 searchable records,
130 KB text) built in 671 ms in Node, no record over 52 ms; on a branch-test server
its first prompt showed 778 ms after typing, 24 rows mounted. No worker or server
search: slicing keeps typing responsive; the server lacks display conversion.

## Owners and contracts today

| Boundary | Current owner and behaviour |
|---|---|
| History request | [sessions service](../../server/modules/providers/services/sessions.service.ts), `fetchHistory`: resolves app/provider identity, reuses one stable full Claude/Codex history through the bounded revision cache, then applies the same bookmark contract and page payload rules to all providers; Cursor/OpenCode reread directly |
| Claude | [reader](../../server/modules/providers/list/claude/claude-sessions.provider.ts), `fetchHistory`/`getSessionMessages`: reads main and subagent files, filters the active branch, normalizes and attaches results, then slices |
| Codex | [reader](../../server/modules/providers/list/codex/codex-sessions.provider.ts), `fetchHistory`: reads the [transcript chain](../../server/modules/providers/list/codex/codex-transcript-chain.ts), normalizes and joins tool results, then slices |
| Other providers | Cursor loads and normalizes its blobs; OpenCode reads session message/part rows before slicing. Synthetic SQLite paging tests; no live performance sample |
| Client history | [store](../../src/stores/useSessionStore.ts), `fetchMore`/`refreshFromServer`: reuses unchanged records, prepends bookmark pages and refreshes from the oldest loaded boundary; latest-started requests own publication, with cancellation and deduplication |
| Display conversion | [normalizedToChatMessages](../../src/components/chat/hooks/useChatMessages.ts): weakly caches projections by immutable source record and attached result identity; changed records/results rebuild their projection |
| Rendering | [pane](../../src/components/chat/view/subcomponents/ChatMessagesPane.tsx) renders the growing visible slice; [Markdown](../../src/components/chat/view/subcomponents/Markdown.tsx) is memoized; unchanged tool groups also retain identity |
| Scroll and Find | [session hook](../../src/components/chat/hooks/useChatSessionState.ts) requests 20 records, preserves prepend anchors, and renders the tail or a detached range around a jump; [Find](../../src/components/chat/hooks/useChatFind.ts) searches the [text index](../../src/components/chat/hooks/useChatTextIndex.ts) and highlights rendered rows |

Claude and Codex pages include tool-result records even when they attach to
another row. `recordTotal` counts normalized records; legacy `total` retains each
reader's display-oriented count. Neither is a rendered-row or authored-turn count.
Only `nextCursor`/`hasMore` controls modern paging; offsets remain compatible with
older clients. Display grouping and hidden records cannot determine a bookmark.

The scroll listener already uses animation-frame throttling and a passive event
listener. This part of upstream issue #1050 is not an outstanding CLIde fix.
The installed phone app's page scrolling and selection protections are deliberate:
[ADR 0056](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md).
Find's current scope is authored conversation text and follow-up questions, not
tool activity, thinking, compaction, notices, timestamps, or attachment contents.

## Upstream work that can inform implementation

The inspected `upstream/main` snapshot was `5e73a49b` (2026-09-08), including
[#1206](https://github.com/siteboon/claudecodeui/pull/1206). It contains a
session-history cache, identity-preserving message conversion, memoized Markdown,
and lazy row contents. The cache sits above the provider readers; inspecting only
the readers misses that improvement.

Its cache validates only the main transcript's path, time and size; CLIde's
(phase 2) also covers subagent files and Codex ancestry. Its lazy rows assume a
scroll container and need adaptation for page scrolling, selection, Find,
expansion state, and variable heights. Adapt behaviours and tests; do not import
the unrelated frontend restructure. The [sync map](upstream-sync.md) owns the
broader harvest policy.
