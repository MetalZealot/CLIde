# Chat history loading and rendering

Initial diagnosis: `668f4049`, investigated 2026-09-19. Phase 1 now has maintained
synthetic baselines below. Performance fixes and acceptance remain open in the [performance plan](../plans/chat-history-performance.md).

## What the reader experiences

Opening a long conversation, walking backward, and finding an old sentence share
the same expensive history path. A small response does not imply a small read:
the server processes the full transcript before choosing a page. The client then
converts the accumulated history again, and the rendered window grows as older
pages arrive. Collapsing tool cards can reduce screen space without reducing the
work to read, transfer, or convert their contents.

## Measured baseline

Read-only probes called the deployed provider readers against the largest local
Claude and Codex transcript files by byte size. Session metadata was read through
a read-only database connection; the reader's database lookup was substituted in
the probe process. No transcripts or user database rows were changed. These are
diagnostic samples, not a representative latency distribution or browser profile.

| Reader measurement | Claude sample | Codex sample |
|---|---:|---:|
| Sequential 20-record requests to exhaust history | 46 | 21 |
| Total elapsed reader time for those requests | 17.98 s | 7.24 s |
| Logical bytes read across those requests | 795.6 MiB | 308.1 MiB |
| One complete-history read | 391 ms | 329 ms |
| Complete serialized response, uncompressed | 16.43 MiB | 3.14 MiB |

Logical bytes are stream bytes, not measured physical disk traffic. The operating
system can serve them from memory. Timings exclude HTTP transfer and browser
rendering. Files were selected for size; the Claude sample includes substantial
embedded image data and is not evidence that all large sessions have that mix.

Other probes established:

- Claude's first three 20-record pages each processed 2,676 raw records and read
  17.3 MiB including a dependent file. The second and third took 448 and 432 ms.
- Minimal plain-text fixtures retained the same scaling: a warmed second page
  processed all 200 or all 2,000 records, taking 8 or 73 ms respectively. Tools
  and images are not required to reproduce repeated full-history processing.
- Wrapping the current Claude reader with the inspected upstream history cache
  gave 554 ms for the initial load and 2.07/2.83 ms for subsequent page preparation.
  This was an isolated experiment, not an integrated CLIde fix. A separate fixture
  changing only a dependent child file returned stale cached data.
- Appending one normalized message recreated all 1,000 existing display objects.
- Mounting the actual session and Find hooks in JSDOM with simple row bodies grew
  a cached fixture from 100 rows to 1,000 when Find opened. Closing Find left 1,000
  rows rendered. There were no history requests; this isolates the render-window
  contract, not browser layout cost.
- Appending one transcript row between two offset-based pages produced one
  overlapping message. This reproduces a pagination stability gap without a
  browser or concurrent network requests.
- The existing chat-hook and session-store test files passed all 80 tests while
  these probes exposed the gaps. Functional coverage does not establish bounded
  processing or rendering cost.

The initial probes were removed after investigation. The maintained phase-1
fixtures below replace them for repeatable comparisons.

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
changes. Codex ancestry invalidation still needs phase-2 cases. Cursor/OpenCode
have no measured fixture baseline yet; preserve explicit fallback behaviour.

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

These measurements confirm independently growing reader and rendering costs.
They are a baseline for optimization, not proof of production latency or touch
smoothness. Precise browser heap capture and physical-phone acceptance are still
unmeasured. Increasing page size alone would not resolve the measured rendering
stalls; collapsing tool cards alone would not eliminate transcript rereads.

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

The four known failures execute as TODO assertions in the existing provider and
chat-hook tests. They do not fail ordinary correctness runs. The dedicated
`--regressions-only` command removes TODO status and must currently exit 1 with
four failures. `--check` additionally fails on warm rereads and oversized pages.
Remove each TODO when its implementation phase lands so future regressions fail
ordinary CI. Timing and memory targets are advisory until phase 9 establishes a
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

## Owners and contracts today

| Boundary | Current owner and behaviour |
|---|---|
| History request | [sessions service](../../server/modules/providers/services/sessions.service.ts), `fetchHistory`: resolves the app session and delegates directly; no server history cache |
| Claude | [reader](../../server/modules/providers/list/claude/claude-sessions.provider.ts), `fetchHistory`/`getSessionMessages`: reads main and subagent files, filters the active branch, normalizes and attaches results, then slices |
| Codex | [reader](../../server/modules/providers/list/codex/codex-sessions.provider.ts), `fetchHistory`: reads the [transcript chain](../../server/modules/providers/list/codex/codex-transcript-chain.ts), normalizes and joins tool results, then slices |
| Other providers | Cursor loads and normalizes its blobs; OpenCode reads session message/part rows before slicing. Source inspection only; no live performance sample |
| Client history | [store](../../src/stores/useSessionStore.ts), `fetchMore`/`refreshFromServer`: prepends offset pages; stale-response tickets protect against a newer applied request but do not freeze the transcript's tail |
| Display conversion | [normalizedToChatMessages](../../src/components/chat/hooks/useChatMessages.ts): creates new display objects for unchanged source records, defeating memoized row comparisons |
| Rendering | [pane](../../src/components/chat/view/subcomponents/ChatMessagesPane.tsx) renders the growing visible slice; [Markdown](../../src/components/chat/view/subcomponents/Markdown.tsx) is not memoized |
| Scroll and Find | [session hook](../../src/components/chat/hooks/useChatSessionState.ts) requests 20 records, preserves prepend anchors, and sets an unlimited visible count for full-history paths; [Find](../../src/components/chat/hooks/useChatFind.ts) loads all history and searches rendered text |

Claude and Codex pages include tool-result records even when those records attach
to another row. Their displayed `total` excludes tool results but the paging
offset counts returned records. A future contract must explicitly distinguish
records, displayed rows, and authored turns.

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

Its cache validates the main transcript path, modification time, and size. That
is insufficient for CLIde's dependent subagent files and Codex ancestry. Its
file-byte cache budget is not a measured heap limit. Its lazy rows assume a
scroll container and need adaptation for page scrolling, selection, Find,
expansion state, and variable heights. Adapt behaviours and tests; do not import
the unrelated frontend restructure. The [sync map](upstream-sync.md) owns the
broader harvest policy.
