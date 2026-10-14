# Chat scroll: one owner, three modes, proved by tests

- Status: agreed 2026-10-14
- Plan: [Fast, stable chat history and navigation](../plans/chat-history-performance.md)
- Context: the 2026-10-14 research survey (kept locally, not in git);
  [ADR 0056](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md),
  [testing](../testing.md#which-checks-to-run), `ARCHITECTURE.md` invariant 15 and
  the "One owner per state" quality goal

Everything that moves the chat's scroll position goes through one owner, which is
always in one of three modes and changes mode only for the reader. Loading,
paging, syncing, Find and jumps keep their data side, which already matches
established practice; what changes is who may move the view, and how that is
proved.

## Starting point (2026-10-14)

Labels: **source** = read in code, **measured** = run, **research** = the local
report, which read Element, Telegram Web A and K, Zulip, Mattermost,
use-stick-to-bottom, assistant-ui, LibreChat, T3 Code, react-virtuoso, TanStack
Virtual and the CSS specs.

- **Many writers (source).** Eight statements in `useChatSessionState` set the
  scroll position, plus Find's `scrollToOccurrence`, the tool-row
  `toggleInPlace`, the composer's send, and the jump flash. Five timers decide
  when: 50 ms, 100 ms and 200 ms delayed scrolls, a 2 s restore "settle", and a
  frame-delayed scroll handler.
- **"Scrolled up" is guessed (source).** After any scroll event, including the
  app's own writes and the browser clamping a shrinking page, a 50 px distance
  check sets the flag that decides whether the bottom is followed.
- **Hold beats follow (source, measured).** While a restore settles, the bottom
  pin applies the restore and stops. Opening a long session in the phone layout
  ended 127, 179 and 360 px short of the bottom across three runs (Playwright,
  installed-app emulation at 412×880, main at `4b832d8c`); the pane layout did
  not.
- **Held row is always a top edge (source).** The restore keeps the top of the
  top-most visible row still, even when that top is off screen.
- **Partial watching (source).** The bottom pin observes only the rows column;
  the composer and bars are seen only through window resize, and only in page
  mode.
- **Native anchoring is off in both layouts (source).** `overflow-anchor: none`
  on the pane and on `html.chat-page-scroll`, so all correction is ours.
- **The window is five values (source).** `visibleMessageCount`, `viewRange`,
  the held start, the selection start and `viewHiddenCount` combine into the
  rendered rows.
- **The guard runs by hand (source, measured).** The history walk runs only in
  CLIde's Browser, headless did not finish one walk in 11 minutes, its fixtures
  are synthetic, and it passed while the phone-layout open failed.
- **Ten fixes since 31 July (source, git log).** Commits titled as scroll,
  position, bottom, jump, anchor or restore fixes touched these two files; the
  newest (`5b72da31`) introduced the measured fault within a day.

## Settled with Grayson

- 2026-10-14: the rules below, the finish line, a worktree on branch
  `chat-scroll-owner`, and tests written to fail on today's code before any fix.

### The rules

The chat is always in one of three modes: **Following** (pinned to the newest
message), **Reading** (holding the message you're on), **Jumped** (a Find or
prompt result held mid-screen).

1. **Opening a chat** lands on the newest message and stays there while images,
   code, tool cards and the activity line finish drawing, in the phone and the
   desktop layout.
2. **While Following**, anything that arrives or grows keeps you at the bottom:
   streaming replies, tool output, late-growing cards, older history loading
   above.
3. **Only you leave Following.** Your own upward scroll does it; the app's own
   scrolling and content changing size never count. Scrolling back to the
   bottom, the jump button, or sending re-enters it.
4. **While Reading**, the message you're on doesn't move: not when older
   history loads above, new messages arrive below, rows change height, the
   keyboard opens or the composer grows. If that message's top is off screen,
   its bottom edge is held instead.
5. **Opening or closing a tool card** leaves the card you tapped where it is;
   Following at the end stays at the end.
6. **Scrolling up never shows a Load button and never stalls.** The rest of the
   history loads in the background.
7. **A jump** loads the messages around the target, centres and flashes it, lets
   you scroll both ways, and the jump button reloads the newest messages.
8. **Selected text** never scrolls or gets trimmed.
9. **Returning to the tab, rotating, resizing, a reconnect or a refresh** leaves
   you where you were: at the bottom if Following, on your message if Reading.
10. **The jump-to-bottom button** shows only after you have scrolled up
    yourself.

**Finish line:** every rule passes as an automated test in both layouts on the
reference session; only the owner can set chat scroll position (lint-enforced);
the Load bar is gone; Grayson has accepted it on the S20.

## Design positions

- **One owner, reached only by requests.** Every other part of the chat asks
  (follow, hold this row, jump here, I am about to change rows) and never
  writes. An eslint `no-restricted-syntax` rule bans `scrollTop =`,
  `scrollTo`, `scrollBy` and `scrollIntoView` in `src/components/chat/**`
  outside the owner; the composer textarea, command menu and shell card scroll
  their own boxes under named exemptions. Rejects patching writer by writer: the
  git log above is that approach's record.
- **Port the model, not a library.** Element's `stuckAtBottom`/tracked-row
  panel and Telegram A's priority order are the model (research). Virtualizing
  libraries lose Ctrl+F and cross-row selection; the stick-to-bottom libraries
  force an element scroller, which ADR 0056 rules out on the phone.
- **Native anchoring stays off.** Exactly one system corrects each move, and it
  is the one we can log and test. Mixing native anchoring with a JS owner
  double-corrects (research: LibreChat disables it for exactly that reason),
  and Safari's support is weeks old with iOS unconfirmed.
- **Mode is state, not geometry.** Distance from the bottom is read only to
  re-enter Following (a downward reader scroll ending within the bottom band)
  and never to leave it. Rejects the 50 px check deciding mode.
- **The reader is recognised, not inferred.** A scroll counts as the reader's
  when its position is not one the owner wrote and the content height did not
  change since the owner's last read; wheel, touch and keyboard input mark
  intent directly. Rejects treating every scroll event as the reader's.
- **Correct before paint, once.** The owner re-applies its mode inside the
  ResizeObserver callback and the rows' layout effect: every geometry read
  first, then at most one write. No timers, no settle windows; a hold lasts
  until the reader moves. This also removes phase 7's forced-layout cost from
  restoration.
- **Rows stay mounted.** Off-screen rows keep skipping paint with
  `content-visibility` after a measured layout, so Find, selection and screen
  readers keep every row. Unmounting rows is not done unless phase 7's
  re-measurement needs it.
- **Tests come first and fail first.** Each rule is a test that fails on
  `4b832d8c`; nothing is called fixed without its test passing in both layouts.

## Target design

### The owner

One module under `src/components/chat/scroll/`: pure decision functions (mode,
event, geometry snapshot in; next mode and at most one write out) and a thin
hook that binds them to the host. The host is the pane or, in the installed
phone app, the document, through the existing `chatScrollHost` helpers; the
readable band is the pane, or the page between its sticky bars.

**State:** `follow` | `read { rowKey, edge: top | bottom, offset }` |
`jump { rowKey }`, plus the data side's "not the newest" flag, which forbids
`follow` until the live window is back.

**Requests in:** `follow(reason)`, `jumpTo(rowKey)`, `toggled(rowKey)`,
`beforeRowsChange()` (loads, reveals, trims), `selection(active)`.
**Signals in:** host scroll events; wheel, touch, pointer and key input;
ResizeObserver on the rows column, the host and each band edge (bars,
composer); `visualViewport` resize; visibility and host changes.
**Out:** the mode (the jump button shows when it is not `follow`), and the
distance to the rendered range's top for paging.

**Re-apply:** `follow` puts the band's bottom at the content's bottom. `read`
finds the held row by key and restores its edge to its offset; if the row is
gone, the nearest surviving row by index takes its place. `jump` keeps the
target centred until the reader scrolls. Holding picks the first row that
intersects the band; its top edge when that top is inside the band, otherwise
its bottom edge.

**Transitions:** `follow → read` on a reader scroll upward. `read → follow` on
a reader scroll ending in the bottom band, the jump button, or send.
`read → read` re-picks the held row as the reader scrolls. `→ jump` on a jump;
`jump → read` on any reader scroll. A toggle in `follow` at the end stays
`follow`; elsewhere it holds the toggled row's top for that change. While a
selection is active the owner writes nothing; when it clears, the mode
re-applies.

**Log:** behind a switch (a query flag persisted per origin, like the flight
recorder), every write records mode, reason, before, after and written value;
no message content. Tests read the same buffer.

### Rows, loading and sync

- **One rendered range** over loaded records replaces the five window values:
  a start key and an end that is either a key or "live". Reveals widen it, a
  jump replaces it, a selection pins its start, rewind hides the tail.
- **Load ahead:** after open, the rest of the slim history arrives in bounded
  background pages; nearing the range's top reveals rows from memory within the
  per-frame mount budget. A failed page shows a retry row, never a Load bar.
  Other sessions' histories are evicted past a memory bound.
- **Jumps** keep the existing `around` fetch and detached window; returning
  reloads the live window, as Element does.
- **Sync** (reconnect replay, watcher refresh, live rows, rewind) changes data
  only; each commit reaches the owner as a rows change and re-applies the mode.
  No data path scrolls.

### Lifecycle

Session switch starts in `follow`, or `jump` for a search target. A hidden chat
(another tab, an overlay's page lock) pauses the owner and keeps its mode, not
a pixel offset; showing it re-applies. Crossing between pane and page layout
re-binds the host and re-applies. Unmount drops observers and the log buffer.

### Budgets and failure

Per frame: one geometry read pass and at most one write by the owner. The
existing `scripts/chat-history/budgets.ts` budgets stay. A missing anchor falls
back by index; a failed fetch leaves the mode untouched and shows its retry row;
the owner never blocks reader input.

### How it is proved

1. **Rule tests:** the pure decisions, one test per rule and transition, in the
   client test suite; seconds to run.
2. **Browser scenarios:** headless Chromium drives the real chat view in both
   layouts on the reference session: open, stream while following, stream
   while reading, scroll up through all history, reveal while reading, toggle,
   composer growth, keyboard and resize, jump and return, reconnect. Each
   asserts position within 2 px and a layout-shift sum of zero (scrolling is
   not "recent input", so a missed correction records a shift). The measured
   open fault is the first scenario.
3. **Lint:** the ban above.
4. **Phone:** Grayson on the S20, installed test app on the slot's HTTPS port.

## What Grayson gives up

- While this runs, testing happens on the branch-test slot and its installed
  test app, not on 3001.
- Any upward nudge of your own stops following; before, anything under 50 px
  still counted as the bottom.
- The manual history walk is retired once the scenarios cover its targets.

## Not doing

- Native scroll anchoring or `column-reverse`.
- Unmounting off-screen rows, unless phase 7's re-measurement shows freezes.
- The "new prompt at the top, reply grows below" layout; it stays its own TODO
  item and becomes a fourth mode inside the owner if adopted.
- Changing ADR 0056's page scrolling on the phone.
