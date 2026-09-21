# 0058 — Stop lives in the send button; the usage ring lives in the header

- Date: 2026-09-20
- Status: Accepted

## Decision

Mid-turn the send button is Stop while the input is empty and Queue once it isn't; long-press still schedules, and Stop keeps its arm-then-fire two taps, the armed pill growing left over its neighbours rather than reflowing the row. The status row above the composer holds only the activity label, token count and timer. The usage ring sits in the header left of the kebab, sized and anchored like it, and falls back into the composer only where there is no header. The + button opens Attach files and Schedule message, with the real file input still owning the Attach tap (ADR 0026).

## Why

A separate Stop beside the status row squeezed the timer and token count on a phone, and the two-tap arm already guards the one-button form against a mis-tap. The ring describes the whole session, which the UI standards map places in the header. These were the maintainer's calls after earlier sessions defended the old layout; the constraints are "queueing works mid-turn" and "Stop is hard to hit by accident", not a placement.
