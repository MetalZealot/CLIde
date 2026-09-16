# Phone chat text selection that behaves like a native page

- Status: 3/4
- Next: On the phone, re-test the Samsung Internet install: handles, the open sidebar, and whether the scroll-to-bottom button shows while already at the bottom.
- Context: branch `feat/mobile-chat-page-scroll`; `docs/maps/orientation.md` gains a section when this merges.

On a phone the conversation used to scroll inside its own box, and Android's selection
handles cannot travel past a scrolling box: dragged into the header they jumped to the top
of the history, and the page could not scroll to follow them. Making the page itself the
scroller gives handles the browser's own edge scrolling.

## Phases

- [x] 1. On phones the chat scrolls as the page with sticky header, composer and tab bar; links copy; bars and message metadata stay out of copies; the chat neither scrolls nor trims messages while a selection is active — `afe6842c`
- [x] 2. Page scrolling only in the installed app. In a browser tab the browser's own toolbars hide and show as the page scrolls, which jerks the sticky composer and leaves it misplaced until the first scroll (seen in Chrome and Samsung Internet tabs, 2026-09-16). The tab keeps the scrolling box — `32ca6a97`
- [x] 3. Full-screen overlays that can open over the chat stop the page scrolling beneath them. None had a scroll lock (read from source), so a drag on the sidebar drawer scrolled the chat underneath and the drawer was hard to regain; the same held for settings, the mobile file editor, the image viewer, the schedule menu and several dialogs — `32ca6a97`
- [ ] 4. Scroll-to-bottom button: it now shows in the Samsung Internet install. Confirm on the phone whether it appears while already at the bottom; fix only if so.

## Done when

- In the Samsung Internet install: dragging a handle into the header scrolls the chat smoothly, handles never select the composer or tab bar, the open drawer scrolls only itself, and a browser tab behaves as it did before this branch.

## Not doing

- Chrome as a target. In its install the handles still slip into the composer and tab bar, and dragging into the header jumps to the top; this is unexplained, and Samsung Internet stays the browser.
- Hiding Samsung Internet's full-height scrollbar. It ignores the setting that hides the page scrollbar, so the bar stays and overlaps the composer slightly.
