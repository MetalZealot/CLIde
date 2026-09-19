# Chat history loading and rendering

Current baseline: `668f4049`, investigated 2026-09-19. Implementation and acceptance
remain open in the [performance plan](../plans/chat-history-performance.md).

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

The throwaway probes were removed after investigation. Phase 1 must establish
maintained, synthetic reproductions before using these observations as gates.
No device scrolling, frame-time, HTTP latency, or heap distribution was measured.

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
