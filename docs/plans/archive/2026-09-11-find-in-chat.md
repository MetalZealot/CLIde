# Find text in the open chat

- Status: complete
- Next: none — accepted live 2026-09-11
- Context: [UI standards](../../maps/ui-standards.md), [mobile bottom navigation](../mobile-bottom-navigation.md)

## Phases

- [x] 1. Agree the contract: use the ChatGPT/Cursor-style in-conversation find pattern rather than a separate results feed.
- [x] 2. Reuse complete-history loading and extract stable occurrence targeting into the in-header search mode.
- [x] 3. Cover matching, unloaded history, repeated text, session changes, keyboard operation, and desktop/mobile behavior; then complete browser and installed-PWA acceptance.

## Agreed behavior

- Find in Chat in the Chat header kebab, or `Cmd/Ctrl+F` while Chat is active, replaces the normal 56px header with Back, a focused search field, `current of total`, Next, and Previous. It does not open a results feed or remain in a popover.
- Search is case-insensitive and literal across rendered conversation text in the complete open session, excluding hidden metadata and attachment contents. Complete history loads before the final count is shown; the counter shows loading in the meantime.
- Every matching text occurrence is highlighted, with the active occurrence visually distinct. The first active match is at or after the current viewport; Next/`Enter` and Previous/`Shift+Enter` follow transcript order and wrap.
- Back or `Escape` closes search, removes its highlights, and leaves the chat at the selected result. Changing session or workspace view closes search.
- The counter is announced without interrupting typing; the input remains 16px on mobile, every icon button has an accessible name and visible focus, and touch targets keep the established header size.

## Done when

- Find in Chat searches the full open session without scanning unrelated sessions, and each navigation step reliably scrolls to and emphasizes the exact matching text.
- The header mode works by touch and keyboard, keeps the normal header height, and does not obscure the conversation or change its position when closed.

## Not doing

- Replacing the sidebar's cross-session search.
- Searching hidden provider metadata or the contents of attachments.
