# Official Playwright MCP bridge with a monitored Browser tab

- Status: 6/7
- Next: Phase 6 — live acceptance through each provider, then retirement.
- Context: `server/modules/browser-use/` · token boundary `ef604c5` ·
  [Playwright MCP API](https://github.com/microsoft/playwright-mcp/blob/main/index.d.ts) ·
  [configuration](https://github.com/microsoft/playwright-mcp/blob/main/config.d.ts)

Replace CLIde's hand-written tools with a pinned `@playwright/mcp` package while
keeping the Browser tab as a live monitor. Playwright MCP owns tool schemas,
snapshots, element references and actions; CLIde owns contexts, policy and
visible state.

## Contract

- One authenticated MCP transport maps to one CLIde Browser session and one
  Playwright context. Its opaque id also identifies the panel session; no
  database row is required. A provider connects to every configured MCP server
  just to read its tool list, so the context and the panel row are created by
  the first tool call that needs a page, never by connecting.
- CLIde passes each context through Playwright MCP's public
  `createConnection(config, contextGetter)` API, with `browser.isolated` unset:
  the getter's context is used as-is and the package never closes it. Do not
  fork the package, import private internals or copy its tools here.
- Temporary sessions share one headless browser with isolated contexts. A named
  persistent profile is locked to one context and never an agent-supplied path.
- Contexts support desktop, phone and tablet presets (touch, user agent, pixel
  density, orientation). `browser_resize` changes responsive width only, so
  switching device swaps the lease's context in place, under one session id.
- Service workers are allowed by default so PWA behaviour can be tested; a
  deliberate test configuration may block them, the bridge must not.
- The Browser tab remains a monitor, not a second controller: session identity,
  status, tabs, URL, title, device, viewport, last action and a recent
  screenshot. Visible changes are agreed before panel code is edited.
- Observe calls at the public MCP transport layer only.
- Preserve `ef604c5`'s separation between agent results and panel screenshots:
  no routine MCP result contains a screenshot data URL, and only an explicit
  screenshot tool may return an MCP image.
- Full browser capability does not include server-code execution:
  `browser_run_code_unsafe` is a `core` tool no config removes, so the transport
  filter is all that keeps it out. Uploads, downloads, storage writes, network
  mutation and persistent profiles stay disabled until their approval path is
  proven.

## Prerequisite

Met in Phase 5: an upsert clears only the keys a provider's writer owns, so
native settings survive a rewrite. The rule lives in the shared `McpProvider`
base; each provider declares `modeledConfigKeys`.

## Phases

- [x] **0. Public-API and transport proof.** Trivial page: navigate 271 B,
      snapshot 329 B, JPEG 17 KB; browser 143 MB PSS, +71 MB first context.
- [x] **1. CLIde-owned runtime boundary.** Shared temporary browser,
      per-connection contexts, device presets, named-profile locking, session
      cap, inactivity expiry and shutdown cleanup.
- [x] **2. Embedded Playwright MCP endpoint.** Bearer-guarded Streamable HTTP at
      `/api/browser-use-mcp/mcp`; the lease id is the transport session id, so
      the MCP session, the context and the panel row are one identity.
- [x] **3. Policy, artifacts and result boundaries.** `core` plus `testing`;
      `browser_run_code_unsafe` and `browser_file_upload` refused at the
      transport; secrets replaced by name, artifacts capped, results labelled
      untrusted and bounded to 4 KiB (12 KiB for snapshots) with `browser_find`
      as the recovery path; `browser_use_device` swaps the context in place.
- [x] **4. Live Browser monitor.** Tool name and outcome recorded at the
      transport, a capture on a 700 ms trailing debounce, and a summary view
      that carries no image bytes; denied calls never count.
- [x] **5. Provider migration and compatibility.** All four providers hold an
      `http` `cloudcli-browser` entry carrying the bearer header, written at
      boot as well as on enable, because the URL names this server's port. An
      upsert now clears only the keys that provider's writer owns, so native
      settings survive and the old stdio keys cannot linger. The stdio bridge,
      its REST dispatcher, the CLI subcommand, `browser_create_session`, every
      `sessionId` argument, the selector tools and the panel's cursor marker are
      gone; profile directories stay CLIde-owned. Policy is [ADR
      0053](../decisions/0053-browser-tools-are-official-playwright-mcp-over-http.md).
- [ ] **6. Isolated live acceptance and retirement.** Exercise desktop and
      phone contexts, reference actions, tabs, dialogs, console/network reads,
      PWA service workers, explicit screenshots, denied tools, profile locking,
      transport reconnect and cleanup through each provider. Confirm ordinary
      calls contain no image data, panel captures do not enter agent context and
      three concurrent temporary contexts stay inside the measured host budget.
      Serve only the topic checkout until Grayson accepts the Browser tab and a
      real agent workflow; then remove the old implementation and archive this.

## Done when

- Agents use the official Playwright MCP tool contract through all four
  providers, including structured references and mobile-sized browsing.
- The Browser tab updates during agent work and remains able to stop and remove
  CLIde-owned sessions without exposing screenshots or credentials to MCP text.
- Temporary and persistent contexts are isolated, bounded and cleaned up after
  disconnect, expiry and server shutdown.
- Output sizes, browser memory, screenshot cadence and provider-config
  preservation have measured evidence; automated checks and Grayson's live
  acceptance are reported separately.

## Not doing

- Forking or vendoring Playwright MCP, depending on its private internals, or
  keeping parallel CLIde implementations of its browser actions.
- Exposing `browser_run_code_unsafe`, unrestricted host-file access or secrets
  merely to claim the complete upstream tool count.
- Turning the Browser tab into a manually operated remote browser.
- Adding a public listener, cloud-browser vendor, database schema or real-device
  Android control.
- Treating emulation as proof of Samsung Browser, Firefox Mobile or installed-PWA
  acceptance, or claiming automation solves web prompt injection.
