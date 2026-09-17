# 0056 — In the installed phone app, the chat scrolls as the page

- Date: 2026-09-16
- Status: Accepted

## Decision

In the installed app on a phone, the conversation scrolls as the page itself, with the header, composer and tab bar sticky; desktop and browser tabs keep the scrolling box. Android lets text-selection handles edge-scroll only the page they sit in, so inside a box they jumped to the top of the history or into the bars (tested on-device, 2026-09-15 and 2026-09-16). While chat text is selected the header, composer and tab bar let touches through: in Chrome a handle dragged over them slid under the composer or jumped to the first message, and with the bars see-through it landed on the chat beneath and edge-scrolled (probed in Chrome, 2026-09-16). Every full-screen overlay that can open over the chat renders `PageScrollLock`, and the chat never scrolls or trims messages while a selection is active.

## Rejected

Script that clamped a selection to the visible edge, or scrolled while a handle was held there, lost the handles on-device. Page scrolling in a browser tab made the browser's toolbars hide and show, jerking the composer. Locking selection to one message blocked copying a slice of a conversation. A chat box with the bars floating over it, as claude.ai and chatgpt.com build theirs, was probed on-device: filling the screen exactly, it still showed the full-height scrollbar and hid the browser toolbars but lost handle edge-scrolling; 1px short, its scrollbar could be hidden but handles jumped into the bars.

## Why

Chrome is the tested browser: it is the reference Chromium, and it hides the page scrollbar, so CLIde draws a thumb beside the chat instead. Samsung Internet gave smooth handles without see-through bars but keeps a full-height page scrollbar a page cannot hide, and its changes to Chromium are undocumented. The cost of see-through bars is that while text is selected, the first tap on a bar only clears the selection.
