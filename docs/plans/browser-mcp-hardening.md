# Official Playwright MCP bridge with a monitored Browser tab

- Status: 5/7
- Next: Phase 5 — register the endpoint with all four providers.
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
  database row is required.
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

Claude, Cursor and OpenCode MCP updates must preserve provider-native keys they
do not model before the bridge rewrites their `cloudcli-browser` registration;
Codex already merges. The Browser work must not conceal or work around it.

## Phases

- [x] **0. Public-API and transport proof.** Trivial page: navigate 271 B,
      snapshot 329 B, JPEG 17 KB, panel capture ~200 ms; browser 143 MB PSS at
      launch, +71 MB first context, +16 MB per idle extra.
- [x] **1. CLIde-owned runtime boundary.** Shared temporary browser,
      per-connection contexts, device presets, named-profile locking, session
      cap, inactivity expiry and shutdown cleanup, split from the action service.
- [x] **2. Embedded Playwright MCP endpoint.** Bearer-guarded Streamable HTTP at
      `/api/browser-use-mcp/mcp`, on one Playwright tree pinned to the exact
      prerelease the package requires; device, orientation and profile come from
      the query string. The lease id is the transport session id, so the MCP
      session, the context and the panel row are one identity, and a release on
      any side closes the others. The legacy tool registry and REST dispatcher
      stay until providers migrate.
- [x] **3. Policy, artifacts and result boundaries.** `core` plus `testing`,
      whose assertions answer "is this visible" in ~150 B instead of a snapshot;
      storage, network mutation, PDF and devtools capture stay off.
      `browser_file_upload` joins `browser_run_code_unsafe` in the deny set,
      which leaves no host-file surface, so client roots need no separate
      restriction. Known secrets are replaced by name, artifacts are capped at
      32 MB per session, and every result is labelled untrusted page data.
      Ordinary results hold to 4 KiB and snapshots to 12 KiB, truncation marker
      included, with `browser_find` as the recovery path: a 120-section page
      measured 27 KB unbounded, 12 KB bounded, and `browser_find` returned the
      cut section in 421 B. `browser_use_device` swaps the lease's context under
      a live session, since touch, user agent and pixel density are fixed when a
      context is created — desktop 1440 px untouched, phone 412 px with touch,
      both ways, same session id and panel row.
- [x] **4. Live Browser monitor.** Tool name and outcome are recorded at the
      transport as each call completes, so the panel reflects agent work without
      the agent reporting it; denied calls never count. A capture follows on a
      700 ms trailing debounce, so a burst costs one screenshot. The panel polls
      a summary view that carries no image bytes and fetches a screenshot only
      when its version moves, and only while the tab is on screen. Opening the
      tab shows current state. Visible: a recent-actions list with per-call
      outcome, and a viewport badge that tracks device swaps. Stop, Delete and
      profile visibility are unchanged; the cursor marker retires with the
      legacy path, since the official contract exposes no pointer position.
- [ ] **5. Provider migration and compatibility.** Register the authenticated
      HTTP endpoint for Claude, Codex, Cursor and OpenCode without disturbing
      unrelated native MCP keys. Remove the old `browser_create_session`,
      session-id arguments, selector tools and stdio bridge after all providers
      see the official schemas. Existing named profile directories remain owned
      by CLIde. Record the chosen transport, capability and profile policy in an
      ADR once the proof fixes those decisions.
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
