# Chat shows activities, not raw tool calls

- Status: not started
- Next: Phase 1 — stop discarding tool-result timestamps, Codex `turnId`, and Codex `item/started`
- Context: measured provider fields and transcript shape in the
  [tool activity stream map](../maps/tool-activity-stream.md); the originating
  brief is `docs/CLIde_Tool_Activity_Display_Investigation.md`, which this plan
  supersedes where they disagree.

Claude and Codex only. Cursor and OpenCode ride the same seam afterwards
without redesign — see "Not doing".

A burst of tool calls collapses to one row carrying counts, duration, and a
failure indicator; expanding gives one compact line per operation; expanding
that gives today's full tool card. The summary is derived from the operations,
never from prose or reasoning text, because the same prose means opposite
things on the two providers and Codex's reasoning summaries are empty.

## Phases

- [ ] 1. **The stream carries what the providers already report.** Tool
  duration survives normalization (the `tool_result` timestamp is folded away
  today); Codex `turnId` rides on every tool row; Codex `item/started` is
  forwarded so a running command is visible before it finishes, as Claude's
  already is.
- [ ] 2. **An activity is every tool call between two assistant prose
  messages.** New clusterer replaces `groupConsecutiveTools`, keyed on
  `turnId` where a provider supplies one. A cluster is terminated by assistant
  prose, a user message, a permission request, a tool error, an
  `AskUserQuestion`/`request_user_input`, a subagent container, and a compact
  boundary. Those events stay first-class rows outside any activity. Covered by
  the first tests this path has had.
- [ ] 3. **The collapsed row replaces `ToolGroupContainer`.** Faceted counts
  (`6 files · 3 commands · 2 edits`), duration, and an error or denial
  indicator that survives collapse; the current operation while running, using
  Claude's per-command description where it exists and the command itself where
  it does not. Same row on mobile and desktop, denser on mobile.
- [ ] 4. **Expanding gives compact operation rows, not nested cards.** One
  line per operation — verb, target, status. Inline on desktop, a bottom sheet
  on mobile; raw output opens the level below rather than rendering in place
  ([ADR 0046](../decisions/0046-tool-detail-leaves-the-chat-column.md)).
- [ ] 5. **Raw detail owns the viewport on mobile.** An operation row opens the
  existing `ToolRenderer` inline on desktop, and the full-screen code-editor
  overlay on mobile, which already handles safe areas and highlighting. Back
  from it returns to the operation list, not to the chat.
- [ ] 6. **Pagination counts activities.** `visibleMessages` slices 20 raw
  messages, which is three or four activities; the page becomes a count of
  rendered rows so "load more" advances a visible amount.

## Done when

- A session with a 14-call burst renders one row, and expanding it twice
  reaches the same raw output visible today.
- On a phone, a file read opened from an activity fills the screen and scrolls
  sideways without wrapping; closing it lands back on the operation list.
- A failed or denied command inside an otherwise successful burst is visible
  without expanding anything.
- The same burst on Claude and on Codex renders the same row shape, differing
  only where Claude has a description and Codex does not.
- A Codex command that takes 30 seconds is visible while it runs.
- Grouping rules are unit-tested, including a cluster cut by a permission
  request and one cut by an error.
- `npm run test:client:one` on the grouping and container tests, plus
  `typecheck:client` and `build:client`; Phase 1 additionally needs
  `build:server` and a restart from SSH.

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
