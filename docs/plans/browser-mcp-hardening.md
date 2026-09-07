# Official Playwright MCP bridge with a monitored Browser tab

- Status: 6/7
- Next: Phase 6 — Grayson's acceptance on the topic server, then retirement.
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
- Page text reaches an agent only through a labelled, capped MCP result. Every
  tool but a bare `browser_snapshot` writes the snapshot to a file and returns
  a link, so the transport inlines and deletes that file and CLIde names every
  output path; without both, the byte limits bound a link, not the page.
- The package's secrets filter and file-access guard are configured but are
  conveniences by its own documentation, not boundaries. Nothing may depend on
  either: the tool filter, context isolation and CLIde-owned paths are what
  hold.
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
      transport; artifacts confined to a per-session directory CLIde names and
      deletes; results labelled untrusted and bounded to 4 KiB, or 12 KiB
      carrying page text, with `browser_find` as the recovery path; snapshot
      files inlined so those limits bind the page, not a link;
      `browser_use_device` swaps the context in place. Secrets substitution and
      the file-access guard are conveniences, not controls.
- [x] **4. Live Browser monitor.** Tool name and outcome recorded at the
      transport, a capture on a 700 ms trailing debounce, and a summary view
      that carries no image bytes; denied calls never count.
- [x] **5. Provider migration and compatibility.** All four providers hold a
      `cloudcli-browser` entry in their own native shape carrying the bearer
      header, written at boot as well as on enable because the URL names this
      server's port. An upsert clears only the keys that provider's writer owns,
      so native settings survive and old stdio keys cannot linger. The stdio
      bridge, its REST dispatcher, the CLI subcommand, `browser_create_session`,
      every `sessionId` argument, the selector tools and the panel's cursor
      marker are gone. Policy is [ADR
      0053](../decisions/0053-browser-tools-are-official-playwright-mcp-over-http.md).
- [~] **6. Isolated live acceptance and retirement.** Driven at the HTTP
      transport on the topic server, and by Claude and Codex in a conversation.
      Device presets, reference actions, forms, dialogs, tabs, console and
      network reads, service-worker registration and `browser_find` all behave;
      denied tools, profile locking and containment, the session cap, cookie
      isolation, reconnect and release-to-baseline all hold. Three contexts cost
      293 MB PSS (236 MB for the browser plus the first, ~25-35 MB each). Output
      dirs are swept at boot, stopped rows cap at the newest five, and the
      action timeout is CLIde's, not the package's 5 s.
      An image result caps at 1 MiB: a viewport shot measures 183 KiB and
      passes, a 30,584 px full page measures 6.4 MB and is refused with a hint.
      Codex refuses a tool call whose MCP server is not pre-approved, so the
      registration carries `default_tools_approval_mode = "approve"` — `auto`
      routes through a review a session with approvals off auto-denies, which
      is why the browser worked only in Bypass. Cursor and OpenCode are
      uninstalled here: config-verified only. Acceptance is outstanding.

## Done when

- Agents use the official Playwright MCP tool contract, including structured
  references and mobile-sized browsing. Claude and Codex are driven live;
  Cursor and OpenCode are uninstalled here and config-verified only.
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
