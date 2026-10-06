# 0068 — A live session's settings and send queue live on the server

- Date: 2026-10-05
- Status: Accepted

For a session that is open, the requested permission mode, model, effort and fast mode are held on the server per session, as a requested and an effective value, and pushed to every browser showing it; the browser's own last choice only seeds a new session.
Queued messages are held on the server per session too: acknowledged when queued, sent when the session is idle, shown on every browser, and kept when the browser that queued them closes; Claude's own queue is used only for an explicit "send now".
Rejected: keeping both in each browser as today (the queue in `localStorage`, flushed by a 5-second poll; the mode in the composer's state, sent with each message), because a phone and a laptop on one chat each send their own value and flip it back and forth, and a message queued on a phone that is then closed never sends.
Rejected: Claude's queue as the only queue, because the Codex, Cursor and OpenCode runtimes have no equivalent and a queued message must outlive the process it was meant for.
This supersedes ARCHITECTURE.md invariant 11 for open sessions only: preferences that describe a device stay in the browser, and the device's last mode and model become the default for its next new chat.
