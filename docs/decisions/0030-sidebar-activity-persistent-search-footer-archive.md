# 0030 — Sidebar activity is a section; search is persistent and Archive is in the footer

- Date: 2026-08-08
- Status: Accepted

## Decision

CLIde presents blocked, unread-finished, and running sessions as one urgency-ordered Activity section above Pinned.
Search stays visible below the sidebar title on desktop and mobile, while Archive is an icon action beside Settings in the footer.
The former Running search mode is deleted because Activity now supplies the transient-work view without making repository rows jump.

## Rejected

Keeping Search, Running, and Archive as title-row toggles was rejected because those controls crowded the wordmark and hid the primary search field.

## Why

The section preserves glanceable status when collapsed, and the footer placement keeps Archive available without spending another permanent row.
