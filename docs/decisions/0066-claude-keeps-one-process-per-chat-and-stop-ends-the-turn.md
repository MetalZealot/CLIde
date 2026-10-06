# 0066 — A Claude chat keeps one process open, and Stop ends only the turn

- Date: 2026-10-05
- Status: Proposed

Each open Claude chat holds one Claude Code process whose input stays open between messages, addressed by CLIde's own session id; an idle chat's process is closed when memory runs low or after an idle timeout, and the next message reopens it by resuming the transcript, as every message does today.
Stop calls `interrupt()` and ends only the running reply: measured on 2026-10-05 it returns in under 10 ms, cancels a pending approval, keeps any queued message (which then runs next), and leaves the process ready for the next message, so the process is closed only when the chat closes, is evicted, or the interrupt has not settled within a few seconds.
Background jobs keep running after Stop: background shells already survive a bare interrupt, and background subagents, which a bare interrupt kills, survive once CLIde declares `perTaskStopAffordance`, which ships together with a stop button per job.
A message counts as delivered when Claude reports it `queued` or `started` (`command_lifecycle`, keyed by the message's id), replacing ADR 0013's rule that a run with `seq > 0` was delivered, which the "Starting" status frame satisfies before Claude has even launched; ADR 0013's signal-first abort still holds for Codex, Cursor and OpenCode.
Rejected: today's one process per message, which spends a median 3.3 s starting Claude before every message (246 production turns, 2026-09-28 to 10-05) and leaves nothing that can change a setting or start a turn between messages; and `prewarm()` spares, which cannot resume a chat and hold 230–260 MB each.
