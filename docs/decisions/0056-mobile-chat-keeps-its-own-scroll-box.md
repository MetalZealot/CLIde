# 0056 — Mobile chat keeps its own scroll box; selection handles stop at its edge

- Date: 2026-09-16
- Status: Accepted

## Decision

The conversation keeps scrolling inside its own box between the fixed header and composer: the page itself does not scroll, and no script moves or clamps a text selection. On Android a selection handle dragged past that box jumps to the start of the loaded history or into the bars; this is accepted as a platform limit, because claude.ai and chatgpt.com in a phone browser do the same (checked on-device, 2026-09-16). CLIde owns the rest: links stay selectable, the bars and message metadata are unselectable so a copy carries only message text, and the chat's own scrolling must not move content while a selection is active.

## Rejected

Making the page the scroller gave native handle edge-scrolling on-device, but the browser toolbars hid on scroll, overscroll stretched the whole window, and the scrollbar ran full height. Script that clamped a selection to the visible edge, or scrolled while a handle was held there, lost the handles on-device: the page receives no events while a handle is dragged. Locking selection to one message, as the Claude and ChatGPT apps do, blocks copying a slice of a conversation.

## Why

Chromium gives toolbar hiding and whole-window overscroll to a single root scroller per page, and a box that does not fill the viewport never becomes it ([Chromium scrolling README](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/page/scrolling/README.md)); on-device, handle edge-scrolling came only with that scroller.
