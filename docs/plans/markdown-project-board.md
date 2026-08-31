# A Markdown-native project board makes work visible without becoming an orchestrator

- Status: not started
- Next: use the existing single-project dashboard in real work, then test the proposed status contract against three differently structured projects
- Context: [current project dashboard](project-dashboard.md), [plans board](README.md), [static HTML preview boundary](../decisions/0045-html-file-preview-is-static-and-isolated.md)

CLIde may eventually provide a built-in or opt-in extension that shows project work
as a dashboard and Kanban board. This plan owns that cross-project, potentially
interactive surface. The current dashboard plan still owns the generated,
single-project, read-only page.

**Project Markdown remains authoritative.** The board is a view and constrained
editor over those files, never another place where task state lives. Whether the
surface ships built in or as an extension remains an implementation decision after
the contract proves useful across projects.

## The useful board

- Cards represent plans or workstreams, not every small checkbox. A card shows its
  project, title, state, next action, blocker or required acceptance, and links to the
  source files.
- The candidate columns are **Ready**, **Active**, **Needs Grayson**,
  **Paused/Blocked**, and **Recently Done**. The names and mappings remain provisional
  until real projects have been sampled.
- A work-in-progress warning can expose too many Active cards without adding claims,
  locks, assignments, or a scheduler.
- The visual board primarily helps the human see scope, overload, stalled work, and
  the difference between agent completion and personal acceptance. Agents benefit
  from the same structured state, next action, evidence requirement, source path, and
  concurrency boundary; they do not need to operate the visual surface.

## The smallest shared contract

The board consumes one normalized summary per workstream:

- project and workstream name;
- lifecycle state;
- current work and next action;
- blocker, required decision, or acceptance evidence;
- authoritative source file and location.

That interface does not require every repository to adopt the same documentation
system. An existing plan index, TODO, README status block, or small dedicated status
file may own the fields. A central registry may opt projects in and identify their
source locations, but it must not copy their status.

The reader should recognize common Markdown patterns first, including headings,
checkboxes, and CLIde's existing `Status` and `Next` fields. Missing or ambiguous
fields render as **Not provided** instead of being guessed. Projects may be partially
configured, so adoption is useful before every workstream is normalized.

The runtime parser is deterministic: the same files produce the same board without an
AI call. An agent may assist once by inspecting an unusual project and proposing a
reviewable documentation patch. Setup should also add a short project-local rule that
future agents update the owning Markdown in the same batch as the work. The agent is
an adoption assistant, not a board dependency.

## Safe visual edits

If real use shows that editing from the board is valuable, add only controls with a
precise Markdown meaning, in this order:

1. Check or uncheck an existing item.
2. Move an existing workstream among a fixed set of states.
3. Edit a small existing field such as `Next`.
4. Consider drag-and-drop only when each move has one unambiguous source edit.

Every action identifies the target file, re-reads it before writing, refuses stale or
ambiguous edits, changes the Markdown immediately, and refreshes the view. A visible
diff or immediate Undo makes the mutation inspectable. Browser storage may hold UI
preferences but never authoritative project state.

The static HTML preview remains isolated under ADR 0045. It must not gain project-file
write powers. Interactive editing needs a first-class authenticated CLIde surface or
extension using the app's file-access boundary.

## Phases

- [ ] 0. Observe the existing dashboard unchanged during real project work and record
      which information is used, missing, or decorative.
- [ ] 1. Sample at least three differently organized repositories and define the
      smallest source contract and deterministic mapping that represents them without
      wholesale documentation migration.
- [ ] 2. Build a read-only cross-project board that supports explicit registration,
      partial configuration, source links, provisional workflow columns, and a
      work-in-progress warning; decide built-in versus extension placement from that
      evidence.
- [ ] 3. Add setup assistance that scans common Markdown, reports recognized and
      missing fields, and proposes a reviewable source patch plus a project-local
      maintenance rule.
- [ ] 4. Add constrained Markdown edits one capability at a time, starting with
      checkboxes and retaining conflict detection, visible provenance, and recovery.

## Done when

- One CLIde surface answers what is ready, active, waiting for Grayson, blocked, and
  recently completed across registered projects, with every card linked to its source.
- A new project can appear partially, then become fully supported through a small
  reviewed documentation change rather than a prescribed documentation overhaul.
- Agents can read the same normalized state directly from the repository without the
  board or an AI interpretation step.
- Any accepted board edit changes only authoritative Markdown and survives reload,
  rebuild, and use outside CLIde.
- The feature has no task database, hidden browser-owned state, or required background
  orchestration service.

## Not doing

- AI-generated project plans, PRD decomposition, task research, automatic next-task
  selection, or model configuration.
- Agent scheduling, assignment, claiming, locking, conflict recovery, or autonomous
  execution. A board can expose overlap; it cannot make multi-agent work safe by
  itself.
- Requiring all project documentation to share one layout or migrating unrelated
  architecture notes, decisions, changelogs, and research.
- Replacing source documents with cards, reproducing their full content, or making the
  dashboard the authority.
- Weakening the static HTML preview sandbox or synchronizing with TaskMaster as a
  prerequisite.
