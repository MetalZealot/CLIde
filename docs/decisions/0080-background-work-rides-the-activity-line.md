# 0080 — Background work rides the activity line and opens a bottom sheet

- Date: 2026-10-11
- Status: Accepted; supersedes 0078's header button and 0079 for the background-work list

## Decision

A session's agents and background commands sit behind a mark at the right end
of the chat's last activity line — the Working line during a turn, else the
latest turn's summary row — present only while the list holds work: a robot
when it holds agents alone, layers otherwise, in a white pill with the running
count, grey with a tick once nothing runs.
Tapping it opens the list in the shared bottom sheet on every width; an item
opened from it is full screen, and back returns to the list.
Scrolled up, the jump-to-bottom button widens into a pill showing the same icon
and count beside the turn's dots.

## Why

The maintainer chose it on agent-activity probe round 4 over the header button,
and the white pill on round 5 after a bare icon read too small on the phone:
the work belongs to the turn that launched it, and a trigger at the bottom opens
a sheet from the bottom.
