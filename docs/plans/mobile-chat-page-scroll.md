# Phone chat text selection that behaves like a native page

- Status: complete
- Next: Merge `feat/mobile-chat-page-scroll` into main when Grayson says so.
- Context: [ADR 0056](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md); orientation section 15.

On a phone the conversation used to scroll inside its own box, and Android's selection
handles cannot travel past a scrolling box: dragged into the header they jumped to the top
of the history, and the page could not scroll to follow them. Making the page itself the
scroller gives handles the browser's own edge scrolling.

## Phases

- [x] 1. On phones the chat scrolls as the page with sticky header, composer and tab bar; links copy; bars and message metadata stay out of copies; the chat neither scrolls nor trims messages while a selection is active — `afe6842c`
- [x] 2. Page scrolling only in the installed app. In a browser tab the browser's own toolbars hide and show as the page scrolls, which jerks the sticky composer and leaves it misplaced until the first scroll (seen in Chrome and Samsung Internet tabs, 2026-09-16). The tab keeps the scrolling box — `32ca6a97`
- [x] 3. Full-screen overlays that can open over the chat stop the page scrolling beneath them. None had a scroll lock (read from source), so a drag on the sidebar drawer scrolled the chat underneath and the drawer was hard to regain; the same held for settings, the mobile file editor, the image viewer, the schedule menu and several dialogs — `32ca6a97`
- [x] 4. The scroll-to-bottom button seen in the Samsung Internet install was the browser's own scroll button, switched off in its settings; not a CLIde defect.
- [x] 5. In Chrome, while chat text is selected, the header, composer and tab bar let touches through, so a dragged handle edge-scrolls the chat instead of sliding under the bars or jumping to the first message; the drawn scrollbar is unselectable, because a handle over the composer stretched the selection to it (verified in the Chrome install, 2026-09-16) — `6e65fda0`, `1c3dc069`

## Done when

- In the Chrome install: dragging a handle into the header scrolls the chat smoothly, handles never slide under the composer or tab bar, the open drawer scrolls only itself, and a browser tab behaves as it did before this branch.

## Not doing

- Samsung Internet as the target. Chrome is the tested browser (ADR 0056); Samsung keeps a full-height scrollbar that overlaps the composer slightly.
