# 0056 — In the installed phone app, the chat scrolls as the page

- Date: 2026-09-16
- Status: Accepted

## Decision

In the installed app on a phone, the conversation scrolls as the page itself, with the header, composer and tab bar sticky; desktop and browser tabs keep the scrolling box. Android lets text-selection handles edge-scroll only the page they sit in, so inside a box they jumped to the top of the history or into the bars (tested on-device, 2026-09-15 and 2026-09-16). Every full-screen overlay that can open over the chat renders `PageScrollLock`, and the chat never scrolls or trims messages while a selection is active.

## Rejected

Script that clamped a selection to the visible edge, or scrolled while a handle was held there, lost the handles on-device. Page scrolling in a browser tab made the browser's toolbars hide and show, jerking the composer. Locking selection to one message blocked copying a slice of a conversation.

## Why

Samsung Internet keeps its full-height page scrollbar, which a page cannot hide, so it slightly overlaps the composer; that is the accepted cost. Chrome hides it and CLIde draws a thumb beside the chat instead, but Chrome's handles still slipped into the bars, so Samsung Internet is the tested browser.
