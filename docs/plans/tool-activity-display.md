# Chat shows activities, not raw tool calls

- Status: 1/6
- Next: Phase 2 — the clusterer; Codex running rows are unit-tested, not yet seen live
- Context: measured provider fields and transcript shape in the
  [tool activity stream map](../maps/tool-activity-stream.md); the originating
  brief is `docs/CLIde_Tool_Activity_Display_Investigation.md`, which this plan
  supersedes where they disagree.

Claude and Codex only. Cursor and OpenCode ride the same seam afterwards
without redesign — see "Not doing".

**Names.** An **activity** is one burst of tool calls; its collapsed row is an
**activity row**, which follows the standard *disclosure* pattern (a header that
shows or hides content). On mobile it opens a **bottom sheet**: a panel rising
from the screen's bottom edge, sized by dragging its **grabber** between fixed
heights called **detents**.

A burst of tool calls collapses to one row carrying counts, duration, and a
failure indicator; expanding gives one compact line per operation; expanding
that gives today's full tool card. The summary is derived from the operations,
never from prose or reasoning text, because the same prose means opposite
things on the two providers and Codex's reasoning summaries are empty.

## Phases

- [x] 1. **The stream carries what the providers already report.** A tool's
  `toolResult.timestamp` is when its result arrived, attached or joined live;
  Codex `turnId` rides on every tool row; Codex `item/started` sends a running
  row and its completion a `tool_result`, as Claude's stream does. Both fields
  survive page slimming.
- [ ] 2. **An activity is every tool call between two assistant prose
  messages.** New clusterer replaces `groupConsecutiveTools`, keyed on
  `turnId` where a provider supplies one. A cluster is terminated by assistant
  prose, a user message, a permission request, a tool error, an
  `AskUserQuestion`/`request_user_input`, a subagent container, and a compact
  boundary. Those events stay first-class rows outside any activity. Extends
  the grouping identity tests in `chatUtils.test.ts`.
- [ ] 3. **The collapsed row replaces `ToolGroupContainer`.** Faceted counts
  (`6 files · 3 commands · 2 edits`), duration, and an error or denial
  indicator that survives collapse; the current operation while running, using
  Claude's per-command description where it exists and the command itself where
  it does not. Same row on mobile and desktop, denser on mobile. A closed
  activity mounts only its row: operations are built on open and kept until it
  closes, so long sessions draw a fraction of today's rows (history plan, phase 7).
- [ ] 4. **Expanding gives compact operation rows, not nested cards.** One
  line per operation — verb, target, status. Inline on desktop, a bottom sheet
  on mobile; raw output opens the level below rather than rendering in place
  ([ADR 0046](../decisions/0046-tool-detail-leaves-the-chat-column.md)). The
  sheet, like the Claude and ChatGPT phone apps: drag the grabber between a
  half-height and a full-height detent, swipe down to dismiss. No shared sheet
  with dragging exists yet; agree its end state on the phone before building.
- [ ] 5. **Raw detail owns the viewport on mobile.** An operation row opens the
  existing `ToolRenderer` inline on desktop, and the full-screen code-editor
  overlay on mobile, which already handles safe areas and highlighting. Back
  from it returns to the operation list, not to the chat.
- [ ] 6. **Loading advances a useful number of activities.** Integrate with the
  [history performance plan](chat-history-performance.md), which owns stable page
  boundaries and record/visible-row counts. Grouping must preserve message anchors
  and request enough bounded pages to advance visibly without a second paging model.

## Done when

- A session with a 14-call burst renders one row, and expanding it twice
  reaches the same raw output visible today.
- On a phone, a file read opened from an activity fills the screen and scrolls
  sideways without wrapping; closing it lands back on the operation list.
- A failed or denied command inside an otherwise successful burst is visible
  without expanding anything.
- A closed activity adds one row to the page, and opening it shows its
  operations with no loading state.
- On a phone, the sheet resizes by its grabber and dismisses with a swipe down.
- The same burst on Claude and on Codex renders the same row shape, differing
  only where Claude has a description and Codex does not.
- A Codex command that takes 30 seconds is visible while it runs.
- Grouping rules are unit-tested, including a cluster cut by a permission
  request and one cut by an error.
- `npm run test:client:one` on the grouping and container tests, plus
  `typecheck:client` and `build:client`; Phase 1 additionally needs
  `build:server` and a server restart.

## Not doing

- **Cursor and OpenCode**, this pass. Cursor already renames its tools to
  Claude's vocabulary and needs only the category map; OpenCode passes raw
  lowercase names that fall through to the `Default` config today, so it needs
  a case-insensitive lookup first. Both are additive once Phases 2–4 exist.
- **A sheet on desktop.** The chat pane is the wide surface there, so
  operation rows expand in place; only mobile needs the sheet.
- **A conversation-density setting.** Ship one representation, then judge
  whether a second is wanted.
- **Titling activities from prose or reasoning.** The map records why: opposite
  meaning per provider, and empty Codex summaries.
- **Classifying shell commands as read-only to fold them into exploration.**
  Real commands chain (`git add … && git commit`), so a misread hides a
  mutation. Commands stay their own visible facet.
