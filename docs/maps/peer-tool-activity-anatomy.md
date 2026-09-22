# How other agent apps show tool activity

The anatomy of tool activity in four desktop agent apps — the Claude app, the
Codex app, Cursor and T3 Code — read from 20 screenshots taken 2026-09-21. It
records what each one shows, not how it is built; none of it comes from their
source. What CLIde takes from it is [the tool activity plan](../plans/tool-activity-display.md)
and [ADR 0059](../decisions/0059-activity-operations-expand-inline-on-every-screen.md);
which parts are convention and which are taste is in
[UI standards](ui-standards.md#tool-activity-rows).

**Limits of the evidence.** Every screenshot is desktop; none is a phone. None
shows a failed or denied call. They are stills, so any animation is inferred.
They sit untracked in the maintainer's checkout under `Activity Screenshots/`,
where three are filed under the wrong product — Claude-6 is Codex, Codex-2 is
Cursor, Cursor-5 is Claude — and Cursor-2 duplicates Cursor-1. The references
below use the right product.

## The parts

Each app assembles tool activity from the same parts, though not every app
uses all of them:

- **Activity row** — the one line a burst of tool calls collapses to.
- **Operation list** — what the row opens to: one line per call.
- **Raw detail** — a command and its output, a file's contents, or a diff.
- **Running label** — what the row says while a call is in flight.
- **Turn status** — time, and sometimes tokens, for the whole reply.
- **Own rows** — things that never fold into an activity: questions, to-do
  lists, plans, subagents.
- **Changes card** — a summary of every file a turn edited.

## Claude app

Claude-1 to 5, 7, 8, and Cursor-5.

- **Where activity sits.** Between prose. Each burst between two pieces of
  assistant text is one row, and the text around it stays full contrast.
- **Activity row.** Muted text, no box, chevron after the label. Past tense,
  verb phrases, counts: "Ran 2 commands", "Used 4 tools", "Created a file, used
  a tool", "Ran a command, created 3 files".
- **One-call row.** Shows the call itself: "Created tip-calculator.html +248 −0",
  with the verb muted, the file name brighter and the counts in green and red.
  Also "Listed contents of project directory", and an MCP call as "Used Claude
  Preview: preview eval".
- **Running label.** The "-ing" form: "Running a command", "Creating", "Using
  Claude Preview: preview eval". The word is lit partway across in Claude-3,
  which reads as a sweeping highlight rather than a spinner (inferred). A
  command's own description can title the row: "Built and open single-file
  HTML fun facts page" (Claude-4) is a description rewritten into past tense,
  only halfway.
- **Operation list.** Opens in place (Claude-5). The chevron turns down and a
  bordered box lists one row per command, each titled by its description in
  past tense — "Created dated pun folder and mov…", "Reopened HTML from new
  folder …" — truncated, each with its own chevron.
- **Raw detail.** Inline in the chat (Claude-2): a box holding the full
  command, syntax-coloured, with its output beneath.
- **Turn status.** A live line at the bottom while the reply runs: the Claude
  mark, elapsed time, tokens and a state — "37s · 721 tokens · Running tools…",
  "Almost done thinking…". A finished reply's footer (Claude-3) shows copy,
  fork, pin, read-aloud and "2 minutes ago"; no duration appears once it is done.
- **Own rows.** A question and its answer as a bordered card ("What kind of
  app should this be? / React app (Vite)"), and "Proposed plan" as its own
  disclosure row (Cursor-5).
- **Changes card.** None seen.

## Codex app

Codex-1, 3, 4, and Claude-6.

- **Where activity sits.** Inside the turn. When a reply finishes, all of its
  work — tool calls and the prose between them — folds into one
  "Worked for 13m 14s ›" row above a thin rule, and only the final answer stays
  open below it (Codex-1).
- **While running.** The header reads "Working for 21s" (Claude-6), and calls
  appear flat, one line each, as they happen: "Ran Get-Content
  '.claude/skills/…'". A subagent finishing gets its own line with a coloured
  avatar, "X launches finished". "Thinking" sits muted at the end.
- **Opened turn.** "Worked for 1m 51s ˅" (Codex-3) reveals the prose and,
  between it, activity groups. A group header names verbs without counts —
  "Read files, ran commands", "Edited files, ran commands" — with an icon for
  its main kind (a book for reading, a pencil for editing) and a chevron.
- **Operation list.** Shown under each opened group: one line per call, each
  with a kind icon. Commands show the raw command, truncated ("Ran rg --files
  projects/youtube-videos …"); reads show the file as a link ("Read
  transcript-timestamped.txt"); edits show the file and counts ("Edited
  _index.md +2 −0", "Created REPURPOSING-DRAFTS.md +73 −0" with a blue dot).
- **Raw detail.** Not seen opened.
- **Turn status.** The turn header is the duration, while running and after.
- **Changes card.** Ends an editing turn (Codex-1): "Edited 2 files +75 −0"
  with Undo and Review buttons, then one row per file with its counts. A blue,
  link-styled "Saved drafts and source notes" line sits above it; its role
  isn't clear from the still.

## Cursor

Cursor-1, 3, 4, and Codex-2.

- **Where activity sits.** Between prose, as in Claude.
- **Activity row.** Muted text in two shades, the verb brighter than the
  detail, and no chevron in any still (it may appear on hover). Verb phrases
  with counts, plus line counts: "Edited 5 files, explored 1 file +35 −25".
- **Running label.** "Exploring 1 search, 1 tool" — the "-ing" verb with the
  counts so far. Between steps, a muted placeholder: "Planning next moves".
- **Thinking.** Its own short row, "Thought for 2s" — the only duration Cursor
  shows.
- **Operation list and raw detail.** Not seen opened in the chat. Diffs open in
  a side pane instead (Cursor-1): a Changes tab headed "Last Turn Changes
  +35 −25", with each file's diff and unchanged stretches folded away.
- **Own rows.** A to-do card listing steps, the current one marked with an
  arrow (Cursor-3); "Checked to-do list" as a one-line row; a background agent
  as a row with its name, model and live status ("Build forest platformer ·
  Cursor Grok 4.5 High Fast", then "Planning next moves"), plus a "1 Working"
  pill above the composer.
- **Changes card.** "5 Files Changed" with a Review button and one row per file
  with its counts, under the final answer.

## T3 Code

T3-1 to 4. It runs GPT models here, and its turn handling copies the Codex
app's.

- **Where activity sits.** Inside the turn, as in Codex: "Working for 3m 53s"
  above a rule while running, "Worked for 2m 38s ›" once done, with the final
  answer below.
- **Running label.** A terminal icon and just the program's name, "Running gh",
  lit partway across like Claude's.
- **Activity row.** A hammer icon and a sentence: "Ran 6 commands and changed
  1 file" (T3-1). It sits after a changes card at the end of a turn; whether it
  covers the whole turn or only the last burst isn't clear from the still.
- **Operation list and raw detail.** Not seen.
- **Changes card.** The richest of the four. Collapsed (T3-3): "259 changed
  files +23k −7.3k", counts per top folder ("apps 178 files · scripts 25 files
  · …"), a few file chips, "Show all 259 files" and an "Open diff" button.
  Expanded (T3-2): a folder tree with counts per folder and per file.
- **Footer.** Copy and a clock time ("2:51 PM") under each reply.

## Side by side

| Part | Claude | Codex | Cursor | T3 Code |
|---|---|---|---|---|
| What collapses | each burst between prose | the whole turn, prose included | each burst between prose | the whole turn, prose included |
| Row wording | "Ran a command, created 3 files" | "Read files, ran commands" (no counts) | "Edited 5 files, explored 1 file" | "Ran 6 commands and changed 1 file" |
| One-call row | the call: "Created x.html +248 −0" | the call, flat | not seen | "Running gh" |
| Line counts | yes | yes | yes | yes |
| While running | "-ing" label, sweeping highlight | calls listed live | "-ing" label, counts so far | "-ing" label, program name |
| Icons | none | per group and per call | none | per row |
| Chevron | after the label | after the label | none visible | after the label |
| Opens to | bordered list, one line per call | flat list, one line per call | side pane, for diffs | not seen |
| A call's title | its description, past tense | raw command or file name | not seen | program name |
| Raw detail | inline in the chat | not seen | side pane | not seen |
| Time shown | live status line, while running | turn header | per thought | turn header |
| Changes card | not seen | Undo and Review | Review | per-folder counts, Open diff |
