# 0065 — The agent runtime layer is rebuilt in place and stops tracking upstream

- Date: 2026-10-05
- Status: Proposed

CLIde rebuilds the layer between each provider's SDK and the chat view (the provider runtime adapters, the chat gateway and run registry under `server/modules/websocket/`, and the chat message and event types the client consumes) inside the current app, following [the runtime rebuild plan](../plans/agent-runtime-rebuild.md).
A new app was rejected: resume, approvals, tool display, PWA quirks, login, the terminal, Git, Browser, voice and scheduled messages would all be rebuilt before anything was gained, while what is wrong sits in about 4,500 lines of that one layer.
That layer stops taking upstream changes: an upstream fix to it is read, then reimplemented by hand or skipped, and the decision goes in the upstream sync map's ledger.
Tracking it was rejected because the rebuild changes the contracts upstream's fixes are written against (one long-lived Claude process per chat, a typed shared message shape, a server-side queue), so every such fix would be a reimplementation anyway, as every change after upstream `#1206` already is.
Everything outside the layer keeps taking upstream work as before.
