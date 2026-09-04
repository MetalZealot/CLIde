# Official Playwright MCP bridge with a monitored Browser tab

- Status: 3/7
- Next: Phase 3 — capability policy, bounded artifacts and result limits.
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
  density, orientation). `browser_resize` changes responsive width; full device
  emulation takes effect on a new context.
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
- [x] **2. Embedded Playwright MCP endpoint.** One deduped Playwright tree at the
      exact prerelease the package requires. Bearer-guarded Streamable HTTP at
      `/api/browser-use-mcp/mcp`: POST initialize leases a context — device,
      orientation and profile come from the query string — and the lease id *is*
      the transport session id, so the MCP session, the Playwright context and
      the panel row are one identity. DELETE, inactivity expiry, panel Stop and
      shutdown each close the other side. Denied tools are filtered at the public
      `Transport`, the only point a core tool cannot escape. Saved artifacts go
      to a per-session directory under CLIde's config home and are removed on
      close; unset, Playwright MCP writes them into the checkout. Tests cover
      initialize, context binding, unknown ids, a dropped stream, cancellation
      and close; live on real Chromium, 23 official tools without
      `browser_run_code_unsafe`, a 412 px phone context taking ref clicks, and
      navigate results 268 B and image-free. The legacy tool registry and REST
      dispatcher stay until providers migrate.
- [ ] **3. Policy, artifacts and result boundaries.** Expose the approved
      official capabilities on top of Phase 2's deny filter. Restrict file
      access to MCP client roots, cap the size of the per-session output
      directory, redact known secrets and label page-derived content as
      untrusted. Keep ordinary results within 4 KiB and snapshot-bearing results
      within 12 KiB unless Phase 0 measurements justify a separately recorded
      limit change; truncation is
      explicit and recoverable through targeted snapshots or bounded files.
- [ ] **4. Live Browser monitor.** Record tool name and outcome at the transport
      boundary, mirror safe tab/page metadata from the supplied context and
      capture a debounced screenshot after state-changing calls. Push or poll
      updates only while the Browser tab is visible; opening the tab must show
      current state without a manual Refresh. Preserve Stop/Delete and profile
      visibility. Retain the cursor marker only if its position is available
      through the public contract.
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
