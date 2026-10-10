# Lossless composer drafts and prompt stash

- Status: not started
- Next: agree the active-draft ownership, conflict behaviour and attachment scope
  before implementation.
- Context: [composer anchors](../code-anchors.md); Grayson reproduced both
  failures on the installed PWA on 2026-08-14.

## Phases

- [ ] **1. Settle the draft contract and visual end state.** Decide what New
      Session does with non-empty text, whether a stash contains text only or
      attachments too, the lifetime and maximum count of browser-local
      stashes, and whether desktop `Ctrl+S` accompanies the visible control.
      **Stash prompt** and **Stashed prompts (N)** join the existing + menu.
- [ ] **2. Make draft handoff lossless.** Give the visible composer an explicit
      owner (untargeted, project, or session), keep text written before project
      selection visible, and never restore an empty or older project draft over
      newer visible text. New Session and manual clearing must update the state
      they visibly represent. Add focused tests for project selection, New
      Session, clearing, reload, and conflicting drafts.
- [ ] **3. Add durable stash operations.** Park the current prompt, list saved
      prompts with short previews and project provenance where known, restore
      one into an empty composer, and swap rather than overwrite when the
      composer is non-empty. Empty, duplicate, delete, quota, and stale-entry
      behaviour must be deterministic.
- [ ] **4. Add the + menu rows.** Reuse `ComposerMenuPrimitives`; leave the
      attach rows as ADRs 0070–0075 fix them. Add keyboard and screen-reader
      access alongside the touch flow.
- [ ] **5. Verify the complete lifecycle.** Run the focused client tests and
      client build, then exercise the agreed flows in the installed PWA. Treat
      automated checks and Grayson's live acceptance as separate gates.

## Done when

- In a new untargeted session, typing and then selecting a project never clears
  or replaces the visible prompt.
- Starting another new session cannot leave the visible draft detached from the
  saved draft that will later reappear.
- When current and saved text conflict, both remain reachable and CLIde names
  which one is active; no project/session switch, restore, or clear silently
  discards either.
- A prompt can be stashed and restored from the agreed composer surface after a
  refresh, and every + menu attach row still works on the installed PWA.

## Not doing

- Server-synced or cross-device stashes.
- A reusable prompt-template library, agent memory, queued/scheduled sending, or
  Git stash integration.
