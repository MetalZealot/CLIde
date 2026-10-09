# 0075 — Photos is back; attachments are read before anything asks their size

- Date: 2026-10-08
- Status: Accepted

## Decision

The + menu reads Camera, Photos, Files, Scheduled Message. Photos clicks a hidden
`accept="image/*"` input outside the menu, and `copyAttachmentsToMemory` starts every read
before anything touches `file.size` or `lastModified`; the 10 MB cap is checked on the copy.

## Why

Round 6 of the attach-read probe on the S20 (2026-10-08) changed one detail of the profile
picture's read at a time: reading the size first failed 3 of 8 grid picks, every other variant
read 14 of 14. Chat checked the size before reading, which is why the grid failed there and
never for the profile picture. This supersedes 0074; a size check placed ahead of the read
reintroduces the failure.
