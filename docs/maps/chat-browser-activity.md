# Chat browser activity

Chat polls lightweight Browser summaries only while visible, filtered by its stable
app session id. A changed capture version fetches the selected session's image;
screenshots never enter normal agent tool results. Pending questions, permissions,
queued messages/answers, and rewind edits collapse the preview to a text row. The browser/async-question area scrolls within
half the usable viewport on short screens, keeping the composer below it reachable.

The preview opens the matching Browser session, including stopped sessions; a missing
session cannot silently select another. Among several connections for one chat, an
active connection wins, then the most recently updated one. This is a latest capture,
not a video stream. Polling is every two seconds, so short actions can finish between
updates.

## Connection and state

The runtime supplies `chatSessionId` in the local built-in MCP endpoint URL for each
run. The endpoint fixes that association at initialization; the browser/MCP id remains
separate from the chat id. No database migration or persistent provider-config edit
is needed. Older, external, or unsupported connections stay in Browser without a
Chat preview; CLIde never infers their owner from timing or tool text.
Shell commands such as `xdg-open` do not use the monitored browser and cannot
produce a preview. Native Codex chats with a scoped Browser connection receive
app guidance explaining the Browser tab and tool discovery. This is appended to
native effective developer instructions on start, resume, and fork; collaboration
mode instructions and user messages retain their existing behavior.

| Provider | Runtime binding |
|---|---|
| Claude | Scoped SDK MCP URL; other server settings preserved |
| Codex | URL-only config override for App Server start/resume/fork and SDK fallback |
| OpenCode | Inline runtime config; existing inline settings preserved |
| Cursor | No verified runtime-only MCP override in the current adapter; preview omitted |

OpenCode's [documented config merge order](https://opencode.ai/docs/config/#precedence-order)
puts inline config after project config. Custom OpenCode config paths without an
explicit inline Browser URL are left unmodified because CLIde cannot resolve their
effective Browser destination. OpenCode and Cursor are not installed on the test host;
OpenCode binding has configuration tests, not live-provider proof.

The endpoint counts in-flight tools, including failures and cancellation. An open
context with no call in flight is idle; explicit close, Stop, expiry, and process
exit stop the monitor. A failed status read is unavailable, never evidence of activity.

Page selection uses Playwright's public current-tab and page-URL response metadata,
including the tab tool's `Result` section. Unknown multi-tab selection has no image.
Captures from a previously selected page are discarded if selection changes mid-capture.

## Verification

Browser endpoint, provider configuration, chat hook, and preview component tests cover
identity isolation, selection, state labels, stale requests, and compact navigation.
An isolated real-Playwright check passes for two chats, selecting an older tab,
and active/idle/stopped transitions. A browser-rendered component harness passes at
320, 412, and 1280 pixels wide, including a 320×568 viewport with a question and queue.
A native Codex 0.153.4 ephemeral-thread probe against the running preview server
connected to Browser, navigated to MetalZealot.com, and verified the matching chat
summary, capture version, and stopped state after closing. A separate native Terra
model check reproduced `xdg-open` for “Open MetalZealot.com in the Browser”; adding
the app guidance made the same request invoke `browser_navigate` successfully.
Transport tests cover preserving configured instructions across start/resume/fork
and omitting Browser guidance without a scoped connection. All 960 tests pass;
client/server builds, targeted lint, and docs checks pass. Grayson confirmed the
ordinary Browser request works in the running preview after the guidance fix.
The installed test PWA still needs human acceptance with a queue and a question open.
