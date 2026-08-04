# Files multi-selection and organization

- Date: 2026-07-26
- Status: Completed and archived 2026-08-01. Phases 1–3 were implemented on
  `feat/files-multi-select` (`b37cb8c` server, `51af9ba` client), merged to
  `main` in `63655cb`, and Grayson confirmed the desktop multi-selection flow.
  This completion record does not claim a separate installed-PWA touch pass.
- Scope: Files-tab selection, multi-item move, desktop drag behavior, mobile
  selection mode, context menus, accessibility, batch filesystem safety, and
  open-editor path handoff
- Related completed work:
  - `0efea7d` — single-item **Move to...** and touch long-press context menu
  - `ad9efda` — fine-pointer drag-to-move and Move-dialog scrolling
  - `8747136` — collapsible Move-dialog folder picker
  - `0f31388` — shared, anchored, scroll-safe touch context menus
- Related decisions:
  - [ADR 0009 — Long-press menus: one shared overlay, and touch belongs to
    `useLongPress`](../../decisions/0009-context-menu-overlay-touch-ownership.md)

## Purpose

CLIde's Files tab can open, edit, upload, rename, move, delete, download, and
search project files. The earlier move work closed the absence of any
relocation operation, but every interaction and API contract still assumes one
source item.

A normal row click immediately opens a file or expands a directory. That is a
good default action, but there is no independent selection state, so a user
cannot assemble several files or folders and move them together.

This document defines a selection model that:

- preserves fast single-click opening;
- works naturally with mouse, keyboard, and touch;
- preserves CLIde's existing long-press context menu;
- makes selected-set drag-and-drop possible on desktop;
- uses one preflighted server operation for a multi-item move;
- keeps an open editor bound to the file's new path; and
- provides a reusable foundation for later batch actions.

## Executive summary

The Files tab should have two states:

1. **Normal mode:** a plain click or tap performs the item's default action.
   Desktop modifier-clicks and an explicit **Select** control can begin a
   selection. On touch, **Select** is available in the toolbar and the
   long-press context menu.
2. **Selection mode:** row clicks or taps toggle membership instead of opening
   files. The Files toolbar becomes a contextual action bar showing the count,
   **Move**, an overflow for compatible actions, and a clear exit control.

Selection and opening remain separate concepts. A row can also have keyboard
focus without being selected. This follows the WAI-ARIA tree guidance that
focus and selection are independent in a multi-select tree:
<https://www.w3.org/WAI/ARIA/apg/patterns/treeview/>.

On touch, the explicit mode follows the platform convention that a list enters
an edit/selection state before taps select rows:
<https://developer.apple.com/design/human-interface-guidelines/lists-and-tables>.

The first delivery should use selection for **Move**. The state and component
contracts should be action-neutral so later work can add batch delete,
download, cut/copy, or other organization features without replacing the
selection system.

The move API must accept the entire source set. Calling the existing
single-item endpoint repeatedly from the browser is not acceptable because a
conflict halfway through would leave only part of the selection moved.

## Goals

- Keep plain click/tap opening files and toggling directories in normal mode.
- Offer discoverable selection without requiring knowledge of modifier keys.
- Support Ctrl/Cmd-toggle and Shift-range selection on desktop.
- Support touch selection without adding small permanent checkboxes to every
  normal-mode row.
- Move selected files, folders, or a mixture of both.
- Drag the selected set to a directory or project root on desktop.
- Reuse the existing Move-dialog folder picker on touch and as the explicit
  desktop alternative to dragging.
- Preserve the existing external-file upload drop path.
- Preserve the existing touch long-press context menu and ADR 0009 behavior.
- Preflight the complete server-side move before changing the filesystem.
- Return old-to-new path mappings and update any open editor accordingly.
- Make selection state perceivable and operable by keyboard and assistive
  technology.

## Non-goals for the first delivery

- Copying files or folders.
- Clipboard cut/paste navigation between directories.
- Cross-project moves.
- Moving across filesystems.
- Drag-to-reorder within a folder; folders remain name-sorted.
- Persisting selection across leaving the Files tab, changing projects, or
  reloading the page.
- A general filesystem undo stack.
- Batch rename.
- Automatically resolving destination name conflicts.

Batch delete and batch download are intentionally deferred. Their eventual UI
can reuse the selection system, but each needs its own confirmation, progress,
and partial-failure design.

## Current implementation

### Row activation

`FileTree.handleItemClick` owns the current default action:

- directory -> toggle expansion;
- image -> open `ImageViewer`;
- other file -> open the editor.

`FileTreeNode` renders each row as a non-focusable `div` whose `onClick`
unconditionally calls that handler. Selection state does not exist.

### Operations

`useFileTreeOperations` stores:

- one `renamingItem`;
- one delete-confirmation item; and
- one `movingItem`.

`performMove(item, destinationPath)` sends one request, refreshes the complete
tree, and shows one toast.

### Drag

`useFileTreeDragMove` stores one `draggedItem`. The internal data-transfer
marker exists only to distinguish a Files-row move from an operating-system
file upload. Directory rows and the project-root background are drop targets;
file rows deliberately swallow internal drops.

The hook currently decides whether drag is enabled from a mount-time
`(pointer: fine)` query. That is not a reliable general desktop/mobile
classifier: hybrid devices exist, and Samsung Internet can report surprising
pointer capabilities. The new selection semantics should be based on the
actual input event. Presentation can still use CLIde's existing responsive
`isMobile` state.

### Move dialog

`FileTreeMoveDialog` accepts one `item`, calculates one current parent, removes
that directory's subtree from destination candidates, and disables the
current parent.

### Server

`PUT /api/projects/:projectId/files/move` accepts:

```json
{
  "sourcePath": "/absolute/project/path/file.ts",
  "destinationPath": "/absolute/project/path/archive"
}
```

It validates and renames one source. There are no focused server tests for this
route.

### Open-editor path problem

`useEditorSidebar` stores an open editor as a file name and path.
`useCodeEditorDocument` later saves its in-memory buffer to that stored path.
Neither a rename nor a move updates the editor.

If a file is moved and its old parent still exists, a later editor save calls
`writeFile` on the old path and silently recreates the file in its original
location. If a containing directory moved, the save may instead fail because
the old parent no longer exists.

Multi-item movement must not ship without a generic path-change handoff. The
same handoff should also repair the existing single-item rename and move
behavior.

## Interaction specification

### Behavior matrix

| Input | Normal mode | Selection mode |
| --- | --- | --- |
| Desktop plain click | Open file or toggle folder | Toggle clicked item |
| Desktop Ctrl/Cmd-click | Enter selection mode and toggle item | Toggle item |
| Desktop Shift-click | Enter selection mode and select a visible range | Extend selection from the range anchor |
| Desktop drag | Move one item, or the selected set when starting on a selected item | Move selected set |
| Desktop right-click | Open the clicked item's menu, or the selected-set menu when clicked item is selected | Open selected-set menu |
| Mobile tap | Open file or toggle folder | Toggle item |
| Mobile long-press | Open the existing context menu | No separate row menu; use the contextual toolbar |
| Explicit **Select** | Enter empty selection mode | Not shown |
| Escape / selection-bar close | No effect | Clear selection and return to normal mode |

Ctrl/Cmd means `event.ctrlKey || event.metaKey`, allowing the same code to work
with Windows/Linux and macOS conventions.

### Normal mode

- Rows retain their current visual density.
- No permanent selection checkbox is required.
- The normal Files toolbar exposes a **Select** action with a clear accessible
  label.
- If adding Select makes the narrow toolbar collide, consolidate lower-priority
  view controls into an overflow menu rather than shrinking touch targets.
- A desktop modifier-click immediately reveals the contextual selection bar;
  the user does not need to press Select first.
- A mobile long-press continues to open `FileContextMenu`. Add **Select** near
  the start of that menu. Choosing it closes the menu, enters selection mode,
  and selects the pressed item.

Long-press must continue to flow through `useLongPress` and
`ContextMenuOverlay`. In particular, preserve ADR 0009's Android native
`contextmenu` guard and post-dismissal tap shield.

### Selection mode

- Every selected row has an unambiguous selected treatment and visible check
  affordance.
- A row tap/click toggles selection and never opens the file.
- A directory's chevron becomes a distinct expansion target. Activating the
  chevron expands or collapses without changing selection.
- Selection can contain files and directories from different parents.
- Leaving selection mode clears the complete set and its range anchor.
- If the last selected item is deselected, remain in selection mode until the
  user exits. This allows **Select** -> navigate/expand -> choose without the
  toolbar flashing between states.

The contextual action bar replaces the normal title/action row and contains:

- an `X` or equivalent exit action;
- `N selected`;
- **Move**;
- an overflow control reserved for other compatible batch actions.

Search remains available below the contextual bar. Selection survives a search
change, and the count includes selected items hidden by the query. Any
**Select all** action means all currently visible filtered rows, not the entire
unfiltered project tree, and its label or help text must make that scope clear.

### Range selection

Shift selection operates over the current flattened visible order:

- only rendered rows participate;
- collapsed descendants do not;
- filtered-out rows do not;
- the range includes both endpoints;
- the most recent direct selection becomes the range anchor.

If the stored anchor is no longer visible because search or expansion changed,
a Shift-click selects only the clicked row and makes it the new anchor.

Range selection should add the range to the existing set. It should not
silently discard Ctrl/Cmd selections made elsewhere.

### Selection normalization

The UI may visually allow both a directory and one of its descendants to be
selected. Before any filesystem operation, canonicalize the source set:

1. remove duplicate paths;
2. sort shallowest paths first; and
3. remove any source already covered by a selected ancestor directory.

The server must repeat this normalization; client normalization is for clear
UI and payloads, not a trust boundary.

Example:

```text
selected:
  docs/
  docs/design.md
  src/app.ts

canonical operation:
  docs/
  src/app.ts
```

The selection count shown before the action remains the number of explicitly
selected rows. The Move dialog may clarify when descendants are included by a
selected folder.

## Desktop selected-set drag

### Drag source rules

- Dragging a selected row moves the canonical selected set.
- Dragging an unselected row replaces the current selection with that row and
  moves only it.
- All rows participating in the drag receive the dragged visual treatment.
- The drag image or badge should show the count when more than one canonical
  source is moving.
- The custom internal data-transfer MIME marker remains so operating-system
  drops continue to use `useFileTreeUpload`.

### Drop targets

- Directory row -> that directory.
- Empty tree background -> project root.
- File row -> invalid dead zone; do not let the event bubble into a root move.
- A destination is invalid if it is equal to any selected directory or is
  inside any selected directory.
- A destination is allowed when only some sources already live there. Those
  sources become explicit no-ops and the remaining sources move.
- If every canonical source already lives in the destination, treat the target
  as invalid and show no move cursor.

Dropping on an invalid destination must not call `preventDefault`, preserving
the browser's not-allowed feedback.

### Failure behavior

Keep the selection when the batch fails so the user can choose another
destination or inspect the conflict. Clear it only after a successful batch or
explicit cancellation.

## Touch and narrow-screen behavior

Touch selection should be modal in behavior but not a blocking modal:

- normal tap retains direct opening;
- the Files toolbar offers **Select**;
- the existing long-press menu offers **Select** for the pressed row;
- once active, row taps toggle selection;
- the contextual bar remains visible while the list scrolls;
- **Move** opens the existing solid-scrim folder picker;
- completing a move closes the picker and selection mode;
- cancelling the picker returns to the same selection.

Do not implement touch drag-to-move in this phase. It collides with scrolling,
native browser drag behavior, and the established long-press menu. The picker
is the touch move surface.

The installed PWA is the authority for verification. Vite on port 5173 does
not reproduce standalone safe-area behavior.

## Move-dialog changes

Change the dialog contract from `item` to `items` or, preferably, canonical
`sources`.

### Header

- One source: retain `Move to folder` and the item name.
- Multiple sources: show `Move N items` and a concise preview such as the first
  two names plus `and N more`.
- Do not render an unbounded list of source paths in the modal.

### Destination tree

The existing collapsed-by-default picker remains. For a source set:

- remove every selected directory and its subtree as a candidate;
- disable a destination only when the complete operation would be a no-op or
  invalid;
- keep disabled folders' chevrons operable when their descendants may still be
  legal;
- keep the project root explicit;
- retain separate chevron expansion and row selection.

The client should show a deterministic conflict returned by the server without
closing the dialog or clearing selection.

## Selection state and component architecture

Add a dedicated `useFileTreeSelection` hook owned by `FileTree`.

Suggested state:

```ts
type FileTreeSelection = {
  isSelectionMode: boolean;
  selectedPaths: Set<string>;
  rangeAnchorPath: string | null;
};
```

Paths are the selection identity because operations and row keys already use
paths. Build a path-to-node lookup from the current `files` tree whenever node
metadata is needed.

Suggested responsibilities:

- enter and exit selection mode;
- toggle one path;
- select a visible range;
- select or deselect all visible rows;
- prune paths that disappear after an external refresh;
- expose selected nodes in stable visible order;
- expose canonical operation sources;
- clear after a successful operation or project change.

Selection should remain owned by `FileTree`, not by each recursive
`FileTreeNode`. Propagate only the selected boolean and event callbacks through
`FileTreeBody`, `FileTreeList`, and `FileTreeNode`.

The click callback must receive the original event so `FileTree` can inspect
Ctrl/Cmd and Shift modifiers. Do not infer modifier behavior inside each row.

## Batch move API

Retain the existing route and evolve its request body:

```http
PUT /api/projects/:projectId/files/move
Content-Type: application/json
```

Preferred request:

```json
{
  "sourcePaths": [
    "/project/src/a.ts",
    "/project/docs"
  ],
  "destinationPath": "/project/archive"
}
```

For compatibility, the route can continue accepting the old singular
`sourcePath` body and normalize it to a one-element array internally. New
client code should always send `sourcePaths`.

Successful response:

```json
{
  "success": true,
  "moved": [
    {
      "oldPath": "/project/src/a.ts",
      "newPath": "/project/archive/a.ts"
    },
    {
      "oldPath": "/project/docs",
      "newPath": "/project/archive/docs"
    }
  ],
  "skipped": [
    {
      "path": "/project/archive/already-here.ts",
      "reason": "already-in-destination"
    }
  ]
}
```

Use structured error details where possible:

```json
{
  "error": "Destination contains conflicting names",
  "code": "MOVE_CONFLICT",
  "conflicts": [
    {
      "sourcePath": "/project/one/readme.md",
      "targetPath": "/project/archive/readme.md"
    }
  ]
}
```

### Server preflight

Before the first rename:

1. Resolve the project root from the database.
2. Require a non-empty, bounded array of string source paths.
3. Lexically validate every source and the destination under the project root.
4. Resolve real paths where relevant so a symlinked destination cannot escape
   the project root.
5. Reject the project root as a source.
6. Confirm every source exists and record whether it is a directory or
   symlink.
7. Normalize duplicates and selected descendants.
8. Confirm the destination exists and is a directory.
9. Reject a destination equal to or below any selected directory.
10. Calculate every final target path.
11. Separate sources already in that destination as no-ops.
12. Detect duplicate basenames within the source set.
13. Detect existing target collisions.
14. Verify the operation remains on the supported filesystem boundary.

Only after the complete preflight passes should renames begin.

### Execution and rollback

Execute the canonical moves sequentially and record each completed mapping.
If an unexpected rename fails:

- stop executing later moves;
- attempt to rename completed items back in reverse order;
- log rollback failures with exact paths;
- return a failure response that distinguishes a clean rollback from a
  possibly partial result; and
- do not let the client claim generic success.

Filesystem operations cannot provide database-style atomicity. Full preflight
eliminates predictable partial failures; reverse rollback is protection for
unpredictable runtime failures.

Refresh the Files tree once after the whole batch, not once per item.

## Open-editor path handoff

The move response supplies the mapping needed to keep other UI state coherent.

Add a generic path-change callback between Files and `MainContent`, for example:

```ts
type FilePathChange = {
  oldPath: string;
  newPath: string;
  type: 'file' | 'directory';
};
```

`useEditorSidebar` should expose a handler that:

- updates an exact open-file match;
- rewrites the path prefix when a containing directory moved;
- updates the displayed filename;
- retains the same in-memory document identity and editor buffer; and
- causes future saves to use the new path.

Changing the path must not make `useCodeEditorDocument` reload from disk and
discard unsaved content. Separate “open a different document” identity from
“the same document moved to a new path.” A stable document ID or explicit
rebind operation is preferable to relying on the path as the load-effect key.

Use the same callback after:

- batch move;
- single-item move; and
- rename.

If the open item is a media preview rather than an editable buffer, updating
its path and reloading the preview is acceptable.

## Context-menu rules

### Normal mode

- Right-click or long-press on an unselected row keeps the existing single-item
  menu.
- Add **Select** to file and directory menus.
- On desktop, right-clicking a row that belongs to a multi-selection opens a
  selected-set menu.

### Selected-set menu

Show only actions valid for the complete selection:

- **Move N items...** is available.
- Rename is hidden or disabled for more than one item.
- Copy Path is hidden or disabled for more than one item.
- New File and New Folder remain contextual to one directory, not a selected
  set.
- Batch delete and download remain absent until their separate behavior is
  designed and implemented.

On touch, once selection mode is active, the contextual toolbar is the action
surface. Do not open one row's long-press menu and create ambiguity about
whether the action applies to that row or the selected set.

## Accessibility and keyboard behavior

Do not add `role="tree"` or `role="treeitem"` without also implementing the
keyboard contract those roles imply.

The first complete accessibility pass should provide:

- one tab stop into the tree with roving row focus;
- a visible focus indicator distinct from selected styling;
- `aria-multiselectable="true"` on the tree;
- `aria-selected` on selectable rows;
- `aria-expanded` on directory rows;
- Up/Down to move through visible rows;
- Right to expand a closed directory or move to its first visible child;
- Left to collapse an open directory or move to its parent;
- Enter to perform the normal default action when not selecting;
- Space to toggle selection without opening;
- Shift+Space or Shift+arrow range behavior where practical;
- Ctrl/Cmd+A to select visible rows only while focus is inside the tree;
- Escape to clear selection and leave selection mode; and
- accessible names for Select, Move, selection count, and folder chevrons.

Native checkbox controls may be used for the visible selection affordance, but
they must not create invalid nested interactive markup or duplicate row
activation. If checkboxes are used, their labels should include the file name.

## Edge cases

### Search and hidden selection

- A selected item can become hidden by search or directory collapse.
- The contextual count continues to include it.
- Moving acts on the complete selected set.
- Exiting selection clears hidden selections too.
- Select All operates on the visible flattened set.

### External refresh

If a watcher, terminal, or agent removes a selected path before the operation,
prune it when fresh tree data arrives. The server still treats a race between
preflight and execution as a move failure.

### Mixed current parents

A destination may already contain some selected sources because those items
started there. Skip those no-ops and move the remaining sources. If all sources
are already there, disable the destination.

### Duplicate names

Two selected files from different directories may share a basename. They
cannot both move into one destination without a naming policy. The first phase
must reject the operation and identify both conflicts; it must not overwrite,
auto-number, or prompt once per file.

### Selected directory plus descendant

Move only the selected ancestor. Preserve the explicit visual selection until
the action starts, but communicate that the folder includes its descendants.

### Open editor

Rebind the open path without losing unsaved content. This is a release-blocking
case, not optional polish.

### Images and other previews

If an image viewer is open over Files when a move starts, either close it before
selection begins or update its path mapping after the move. Do not leave a
preview pointing at a missing URL.

### Operation in flight

- Disable selection mutations, drag starts, and competing file operations.
- Keep the dialog open with a spinner.
- On success, close the dialog, clear selection, refresh once, and show a
  pluralized success message.
- On failure, keep the dialog and selection so the user can recover.

### Project or tab change

Changing projects always clears selection. Leaving Files currently unmounts the
tree, so selection naturally clears; do not lift it into global application
state merely to persist it.

## Suggested implementation boundaries

Likely client files:

- `src/components/file-tree/hooks/useFileTreeSelection.ts` — new
- `src/components/file-tree/hooks/useFileTreeDragMove.ts`
- `src/components/file-tree/hooks/useFileTreeOperations.ts`
- `src/components/file-tree/view/FileTree.tsx`
- `src/components/file-tree/view/FileTreeHeader.tsx`
- `src/components/file-tree/view/FileTreeBody.tsx`
- `src/components/file-tree/view/FileTreeList.tsx`
- `src/components/file-tree/view/FileTreeNode.tsx`
- `src/components/file-tree/view/FileContextMenu.tsx`
- `src/components/file-tree/view/FileTreeMoveDialog.tsx`
- `src/components/main-content/view/MainContent.tsx`
- `src/components/code-editor/hooks/useEditorSidebar.ts`
- `src/components/code-editor/hooks/useCodeEditorDocument.ts`
- `src/utils/api.js`
- file-tree translations in all supported locales

Likely server work:

- keep route wiring in `server/index.js` initially;
- extract normalization, preflight, execution, and rollback into a focused,
  testable file-operation service rather than growing the route handler;
- add temporary-directory tests that never touch a real project or user
  database.

The selection hook and destination-validation helpers should remain
provider-neutral; the Files tab operates on the selected project's filesystem,
not on a provider session.

## Delivery phases

### Phase 1 — selection foundation

- Add selection state and path lookup.
- Preserve normal activation.
- Add Select toolbar/context-menu entry points.
- Add Ctrl/Cmd toggle and visible Shift ranges.
- Add contextual selection toolbar and row selected styling.
- Separate directory chevron activation.
- Add selection accessibility and keyboard behavior.

Phase 1 is useful for interaction testing but should not be merged as a
dead-end visible feature unless Phase 2 follows in the same delivery.

### Phase 2 — batch Move

- Evolve the API to `sourcePaths`.
- Extract and test server preflight/execution.
- Update operations and Move dialog for a source set.
- Return path mappings.
- Rebind open editor and preview paths.
- Clear selection and refresh once on success.

### Phase 3 — selected-set drag

- Extend internal drag state to canonical sources.
- Add selected-set drag visuals and count.
- Validate group destinations.
- Preserve upload-drop separation.

Phase 3 may ship with Phase 2; separating it in the plan makes touch/dialog
movement independently testable.

### Later organization work

- Batch delete with a count, directory warning, and explicit confirmation.
- Batch download with one ZIP and a progress model.
- Cut/copy and destination paste.
- Conflict-resolution choices such as skip, replace, or rename.
- File-operation undo/history.

## Verification plan

### Pure and component behavior

- Plain click still opens a file.
- Plain click still toggles a directory in normal mode.
- Select mode prevents opening.
- Ctrl/Cmd toggles one item.
- Shift selects the current visible range.
- A hidden or removed range anchor falls back safely.
- Folder chevrons expand without selecting.
- Parent-plus-descendant normalization is deterministic.
- Select All affects filtered visible rows only.
- Project change clears selection.
- Failed move retains selection.

### Server tests

Use temporary project directories and the repository's server-test command:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <matching-test-file>
```

Cover:

- one-file compatibility request;
- multiple files from one parent;
- mixed files and directories from different parents;
- selected ancestor plus descendant;
- some sources already in destination;
- every source already in destination;
- source missing;
- destination missing or not a directory;
- destination inside a selected directory;
- duplicate basenames within the batch;
- collision with an existing destination entry;
- project-root source rejection;
- path escape and symlinked-destination escape;
- simulated mid-execution failure with successful reverse rollback; and
- simulated rollback failure reported as possibly partial.

### Editor integration

- Move the currently open file, edit its buffer before and after the move, and
  save; only the new path exists and content is preserved.
- Move a directory containing the open file and save to the rewritten child
  path.
- Rename the open file and save without recreating the old name.
- Repeat with an unsaved buffer to prove no reload discarded it.
- Move an open image/media preview and confirm it reloads from the new path.

### Desktop live verification

- Single drag remains unchanged when no selection exists.
- Dragging a selected row moves the selected set.
- Dragging an unselected row moves only that row.
- Invalid group targets show not-allowed feedback.
- File-row dead zones do not move the group to root.
- Operating-system file drops still upload.
- Right-click on a selected row applies to the selected set.

### Installed mobile PWA verification

- Normal tap still opens files.
- Normal tap still expands folders.
- Long-press menu remains anchored and scroll-locked.
- Long-press -> Select selects the correct row without a synthetic click opening
  it.
- Toolbar Select enters empty selection mode.
- Taps toggle several files while scrolling remains smooth.
- Chevron expansion does not change selection.
- Move picker scrolls, expands, selects, cancels, and confirms correctly.
- Cancelling returns to the same selection.
- Successful move clears selection and refreshes once.
- The contextual toolbar respects safe areas and does not crowd the Files tab.

### Repository checks

- `npm run typecheck`
- `npm run lint`
- focused server tests
- `npm run build:client`
- `npm run build:server`

Do not restart the production service from an agent session. Server changes can
be exercised with the branch-test harness on port 3002, then the user can
perform the final production restart from SSH after merge.

## Later-session start checklist

1. Re-read this document, TODO's completed Files entries, ADR 0009, and any new
   Files backlog item.
2. Check `git status --short` and active worktrees.
3. Claim the TODO item before editing.
4. Use an isolated topic worktree if other work is active.
5. Start with the batch-move service contract and editor path-handoff tests;
   they define the safety boundary for the UI.
6. Build the generic selection hook and interaction layer.
7. Connect the Move dialog, batch API, and group drag.
8. Verify desktop behavior and the installed mobile PWA.
9. Record any non-obvious lasting decision as a new ADR rather than rewriting
   ADR 0009.
