# 0053 — Browser tools are official Playwright MCP over an authenticated HTTP endpoint

- Date: 2026-09-04
- Status: Accepted

## Decision

CLIde registers one bearer-guarded Streamable HTTP MCP endpoint,
`/api/browser-use-mcp/mcp`, with all four providers, and Playwright MCP owns
every tool schema behind it.  CLIde keeps four things and no more: the tool set
(`core` plus `testing`, with `browser_run_code_unsafe` and
`browser_file_upload` refused at the transport), the contexts and their device
presets, named profile directories rooted under CLIde's own config home and
never an agent-supplied path, and one CLIde-authored tool, `browser_use_device`,
because touch, user agent and pixel density are fixed when a context is created
and so a device change must swap the context under a live session id.

## Rejected

A stdio bridge process per provider, which CLIde previously shipped: it needed a
per-tool REST dispatcher, CLIde-authored schemas for actions Playwright MCP
already defines, and a `browser_create_session` tool plus a `sessionId` argument
on every call.  Selector-based actions were rejected with it, in favour of the
reference-based ones the official snapshot already yields.  Persistent profiles
chosen by the agent, storage writes, network mutation, PDF and devtools capture
stay off until each has an approval path.

## Why

HTTP makes the transport session the identity: the MCP session id, the browser
context lease and the Browser panel row are one id, so a release on any side
closes the others, and the endpoint needs no database row.  It also removes the
bridge's whole schema surface — 28 official tools, versus a hand-written subset
that drifted.  `browser_use_device` is the one deliberate addition to an
otherwise official tool surface; it is not an oversight and should not be
deleted to "restore the official set".  Registering over HTTP first required
every provider's config writer to preserve native keys it does not model, so
that contract now lives in the shared `McpProvider` base and each provider only
declares which keys it owns.
