# 0069 — A chat's Browser context belongs to the chat, not the MCP connection

- Date: 2026-09-15
- Status: Accepted

## Decision

The browser context lease and its Browser panel row are keyed by the chat's
session id; the MCP session id stays per connection and addresses only the
transport.  A connection with no chat keeps the connection's lifetime and
releases its context when it closes.  This supersedes 0053's "the MCP session
id, the browser context lease and the Browser panel row are one id"; the rest of
0053 stands.

## Rejected

Keying the context to the MCP connection, as 0053 did.

## Why

Providers reconnect their MCP servers every turn, so a connection-keyed context
opened on `about:blank` each turn while the panel still showed the previous
turn's page: a relative navigation resolved to an empty URL and `localStorage`
reads hit an opaque origin (`e6db86db`).
