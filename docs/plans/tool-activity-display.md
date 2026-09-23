# Chat shows activities, not raw tool calls

- Status: 9/10
- Next: Phase 6; Codex running rows are not yet seen on a phone
- Context: measured provider fields and transcript shape in the
  [tool activity stream map](../maps/tool-activity-stream.md); what peer apps
  share and where they differ in
  [UI standards](../maps/ui-standards.md#tool-activity-rows); the originating
  brief is `docs/CLIde_Tool_Activity_Display_Investigation.md`, which this plan
  supersedes where they disagree.

Claude and Codex only. Cursor and OpenCode ride the same seam afterwards
without redesign — see "Not doing".

**Names.** An **activity** is one burst of tool calls; its collapsed row is an
**activity row**, which follows the standard *disclosure* pattern (a header that
shows or hides content). Its **facets** are the verb phrases that summarise it
(`read 6 files`, `ran 3 commands`).

A burst of tool calls collapses to one row carrying its facets, line counts,
and a failure indicator; expanding gives one compact line per operation;
opening one of those shows the call flat, in place. The rows that stay outside
an activity get the same row and panel, not the old tool cards. The summary is derived from
the operations, never from prose or reasoning text, because the same prose
means opposite things on the two providers and Codex's reasoning summaries are
empty.

## Phases

- [x] 1. **The stream carries what the providers already report.** A tool's
  `toolResult.timestamp` is when its result arrived, attached or joined live;
  Codex `turnId` rides on every tool row; Codex `item/started` sends a running
  row and its completion a `tool_result`, as Claude's stream does. Both fields
  survive page slimming.
- [x] 2. **An activity is every tool call between two assistant prose
  messages.** `groupToolActivities` replaced `groupConsecutiveTools`; a
  different Codex `turnId` also cuts. A cluster is terminated by assistant
  prose, a user message, a pending permission request, a question, a to-do
  list, a plan, a subagent container, and a compact boundary; those stay
  first-class rows. A failed or denied call and any thinking stay inside. A
  permission prompt cuts only when it carries the call's id: Claude's do,
  Codex's do not.
- [x] 3. **The collapsed row replaces `ToolGroupContainer`.** One line of muted
  text with a trailing chevron — no border, tint, icon box or count pill —
  reading as past-tense facets with line counts:
  `Read 6 files, ran 3 commands, edited 2 files +41 −7`. A failure or denial
  adds `· 1 failed` in red, which survives collapse. A one-call activity shows
  that call (`Edited toolGrouping.ts +12 −3`). While running, it names the
  current operation in the "-ing" form with a text shimmer that stops under
  reduced motion: Claude's per-command description verbatim where it exists,
  the command where it does not. No duration on this row. Same row on mobile
  and desktop, denser on mobile. A closed activity mounts only its row:
  operations are built on open and kept until it closes, so long sessions draw
  a fraction of today's rows (history plan, phase 7).
- [x] 4. **Expanding gives compact operation rows, not nested cards.** One
  line per operation, inline on every screen: verb, target, line counts for an
  edit, status, and duration once it reached 1 s; a Claude command row reads
  as its description, and shown thinking as a `Thought:` line. Raw output
  opens the level below rather than rendering in place
  ([ADR 0059](../decisions/0059-activity-operations-expand-inline-on-every-screen.md)).
- [x] 5. **A call opens flat, in place, on every screen.** Tapping an
  operation row shows its full input and output under it in one new panel —
  command then output, changed lines only for an edit, matched files for a
  search — with no header, badge, strip or second disclosure. Lines wrap;
  blocks stop at 12 lines behind "Show all"; the old tool card and code-editor
  overlay are not used ([ADR 0060](../decisions/0060-a-calls-detail-opens-flat-in-place.md)).
- [ ] 6. **Loading advances a useful number of activities.** Integrate with the
  [history performance plan](chat-history-performance.md), which owns stable page
  boundaries and record/visible-row counts. Grouping must preserve message anchors
  and request enough bounded pages to advance visibly without a second paging model.
- [x] 7. **Thinking and answered questions use the activity row and panel.**
  Thinking reads `Thought for 23s ›`, timed from the row before it, and opens to
  its text in the flat panel; redacted thinking keeps the line, no ›.
  Codex reasoning and the compaction summary share that row. A question shows each
  prompt over its answer in the panel — no tool name, strip, header chip or
  unchosen options — and a failure inside it rather than as a red row.
- [x] 8. **A subagent is one row.** `Explore · Find call sites · 18 calls · 1m 35s`,
  shimmering while it runs, red when it failed; it opens to what it was asked,
  its calls as operation rows, and what it reported, each opening flat. It is
  phase 4 of the [subagent plan](subagent-visibility.md), whose phase 3 makes it
  update live.
- [x] 9. **A plan is one row.** `Proposed plan ›` opens to the plan in the flat
  panel at full contrast; while it waits for a decision it stays open with Build
  and Revise under it, matched to its own call so an older plan never shows them.
- [x] 10. **Permission prompts.** The waiting call is its own row,
  `Run npm test · waiting`; above the composer, one question line over the
  call's flat detail, then the decisions. A denied call keeps that label.

## Done when

- A session with a 14-call burst renders one row, and two taps reach a call's
  full input and output.
- On a phone, a call opened from an activity shows its output in place,
  wrapped, with nothing further to expand.
- On a phone, an open activity's operation rows each stay one line, and none
  scrolls sideways.
- A failed or denied command inside an otherwise successful burst is visible
  without expanding anything.
- A closed activity adds one row to the page, and opening it shows its
  operations with no loading state.
- The same burst on Claude and on Codex renders the same row shape, line counts
  included, differing only where Claude has a description and Codex does not.
- A Codex command that takes 30 seconds is visible while it runs.
- Grouping rules are unit-tested, including a cluster cut by a permission
  request and one that keeps a failed call inside it.
- `npm run test:client:one` on the grouping and container tests, plus
  `typecheck:client` and `build:client`; Phase 1 additionally needs
  `build:server` and a server restart.

## Not doing

- **Cursor and OpenCode**, this pass. Cursor already renames its tools to
  Claude's vocabulary and needs only the category map; OpenCode passes raw
  lowercase names that fall through to the `Default` config today, so it needs
  a case-insensitive lookup first. Both are additive once Phases 2–4 exist.
- **A bottom sheet**, on any screen
  ([ADR 0059](../decisions/0059-activity-operations-expand-inline-on-every-screen.md)).
- **Collapsing a whole turn** to `Worked for 2m`, as the Codex app does: it
  hides the prose that bounds activities.
- **A changed-files card at the end of a turn** — its own item in
  `docs/TODO.md`.
- **To-do lists**, this pass: Claude made no TodoWrite or Task* call in 30 days
  of sessions (measured 2026-09-22) and Codex hides `update_plan`, so they keep
  the old card until one reappears.
- **A conversation-density setting.** Ship one representation, then judge
  whether a second is wanted.
- **Titling activities from prose or reasoning.** The map records why: opposite
  meaning per provider, and empty Codex summaries.
- **Classifying shell commands as read-only to fold them into exploration.**
  Real commands chain (`git add … && git commit`), so a misread hides a
  mutation. Commands stay their own visible facet.
