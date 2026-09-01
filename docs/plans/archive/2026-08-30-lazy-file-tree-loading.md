# Bounded, lazy project files

- Status: complete
- Next: archived; current authority is ADR 0049 and source/tests
- Context: [ADR 0049](../../decisions/0049-file-tree-loads-folders-not-projects.md), [test suite](../../maps/test-suite.md)

## Phases

- [x] 1. Agree the visible result — folders load one at a time; search begins after a 200 ms pause and returns flat paths, 100 search results and 200 folder children at a time, with Load more.
- [x] 2. Bound backend work — real-path containment, paged directory/search APIs, deterministic reference resolution, propagated cancellation, a capped legacy tree, and a complete capped ZIP subtree.
- [x] 3. Replace eager clients — Files, `@file`, Command Palette, and message links use the bounded APIs; cached loads deduplicate, discard stale responses, and follow mutations.
- [x] 4. Prove the change — full tests, typecheck, lint, docs checks, builds, served-bundle inspection, and Grayson's broad home-folder live acceptance passed on the isolated server.

## Done when

- Opening Files for the home-folder project returns its first page without delaying links or other projects.
- Expanding folders and loading more never duplicates rows; Files search, `@file`, and Command Palette search after the accepted pause.
- Files Refresh makes agent- and shell-created paths visible to active search without waiting for cache expiry.
- A second file-link click cancels the first, while ambiguous references open nothing.
- Rename and move preserve expanded folders, selection, and open editors while refreshing both affected parents and active searches.
- Folder ZIP includes every readable entry at unlimited depth, fails when incomplete, and stops at 10,000 entries.
- Grayson accepts the behavior live before the item moves to `todo-done.md`.

## Not doing

- Replacing single-file downloads with server streaming; upstream issue #1197 tracks that separate defect.
- Reusing or replacing an occupied branch-test server.
