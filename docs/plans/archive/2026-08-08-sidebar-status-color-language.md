# Theme-relative sidebar selection and symbolic status

- Status: complete
- Next: None — accepted live in Samsung Browser on 2026-08-08.
- Context: [ADR 0030](../../decisions/0030-sidebar-activity-persistent-search-footer-archive.md), [ADR 0031](../../decisions/0031-theme-relative-selection-and-symbolic-sidebar-status.md)

## Phases

- [x] 1. Resolve one displayed state everywhere: needs attention, then running, then unread; keep the existing session-state lifecycle.
- [x] 2. Add one accessible status-indicator primitive and centrally owned attention, unread, and running colour tokens.
- [x] 3. Replace session and repository status tints with the shared indicator across rows, Activity counts, and the collapsed rail; retain `primary` selection and `accent` interactions.
- [x] 4. State-overlap and rendering tests pass; theme-relative selection, symbol alignment, and unresolved-attention persistence were accepted live.

## Done when

- Selected rows follow the active theme, never a fixed blue utility.
- Running shows a spinner, unread-finished a green dot, and needs-attention an amber/yellow symbol without colouring the full row.
- The same precedence, label, and non-colour cue appear on session rows, repository roll-ups, the Activity summary, and the collapsed rail.

## Not doing

- The theme picker, theme presets, or background-hue controls.
- Cross-client attention persistence/resync and the known stale-attention case.
- Reworking update, destructive, archive, TaskMaster, provider-brand, or search-result colours.
