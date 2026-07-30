# 0021 — Save confirmation is local to the action, and only where an action can fail

- Date: 2026-07-29
- Status: Accepted

## Decision

The global "Saved" indicator in the Settings header is removed (P4 of the
Settings IA restructure). `saveStatus` is gone from `useSettingsController`
entirely rather than relocated; in its place the controller exposes
`loginResult: { provider, succeeded } | null`, which the provider account card
renders as an inline line for a few seconds.

Nothing else in Settings shows a save confirmation. Toggles, selects and radio
choices autosave and are considered self-confirming — the control's own state
*is* the feedback. The one other confirmation in the pane is Projects & Git's
inline save-on-blur line (P3b), which exists because a text field's value can be
in flight and a `git config --global` write can genuinely fail.

## Rejected

- **Keeping the header indicator.** It was the last thing in the shell that knew
  about individual screens' persistence, and it contradicted the IA spec's save
  model ("confirmation is always local to the thing that changed").
- **Giving Notifications a group-local "Saved" line**, which is what P2's
  decision 3 and P3a's note anticipated. Two facts killed it. First, the
  indicator only ever rendered `success` — `saveStatus === 'error'` was never
  displayed, so an autosave failure was already invisible and no feedback was
  being preserved. Second, `saveSettings`' debounced autosave effect keys off
  the settings state that `loadSettings` populates, so it fires shortly after
  Settings opens: the indicator flashed "Saved" on open, before the user touched
  anything. Moving that flash from the header into the Notifications card would
  have made a spurious signal more conspicuous, not less.
- **Surfacing autosave errors properly instead.** A real fix, but it is new
  behaviour rather than a port, and it belongs to whoever next touches
  notification-preference persistence — not to a packet whose rule was "moving a
  control does not redesign it."

## Why

Login is the only action in the Agents area with an outcome the user cannot
otherwise see: the OAuth flow happens in a separate modal and process, and its
result is a change in state the account card is already displaying. Reporting it
next to that card answers "did that work?" where the question is asked. A
header-level indicator answered it in a corner shared with every other screen,
which is why it also had to be vague enough to be useless ("Saved") for a login.

The general shape: confirm an action where it happened, and only when the action
has an outcome the UI does not already show. Everything else in Settings writes
optimistically to `localStorage` or a local endpoint and reflects the new value
immediately in the control itself.

Evidence: implemented and verified in P4 (commit `46cbcce`) — the login
confirmation renders per-provider from `loginResult`, and the removal of
`saveStatus` left no remaining consumer (typecheck clean). See
[ADR 0018](0018-settings-drill-down-one-scroll-container.md) for the restructure
this belongs to and the build plan's P4 section for the full packet record.
