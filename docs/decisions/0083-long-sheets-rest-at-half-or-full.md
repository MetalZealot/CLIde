# 0083 — Long bottom sheets rest at half or full height; transcripts open in them

- Date: 2026-10-14
- Status: Accepted; supersedes 0080's full-screen item and 0076's full-screen agent on phones

## Decision

On phones a bottom sheet holding long content (`/btw`, an agent's or command's
transcript) rests at half or full height: at half a drag up grows it before the
content scrolls, a drag down from full returns to half, the handle taps between
the two. Option sheets keep their content's height and never grow. Agents and
commands open inside the sheet at full height, from the background-work list or
the chat row; wider screens keep the popover and full-screen view. A touch that
starts on any scrim closes on lift, swiped or not.

## Why

Android's and iOS's own sheets work this way, and a transcript read in a sheet
keeps the chat one swipe away instead of replacing it.
