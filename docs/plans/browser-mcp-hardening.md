# Browser MCP hardening: snapshot-first, reference-based automation

- Status: not started
- Next: slice 1 — the revision/ref registry and a deterministic snapshot
  projection, behind the existing action inputs.
- Context: follows the token-bloat fix `ef604c5`, whose output limits this
  keeps · `server/modules/browser-use/`

The built-in `cloudcli-browser` MCP is still an early browser bridge: a snapshot
is `body.innerText`; click, type, fill and select depend on raw CSS selectors,
fuzzy text, or coordinates; page content is untyped, unbounded, and not marked
as untrusted; and the panel, capture lifecycle and agent protocol share one
in-memory session object more tightly than they need to.

## The four product decisions

1. **Snapshot-first is the normal contract.** `browser_snapshot` returns a
   compact accessibility-oriented interaction map with opaque element
   references, and the agent acts through those. It must not expose raw DOM,
   arbitrary CSS selectors, browser internals, cookies, request headers, storage,
   or a screenshot. Raw selectors survive only as a migration escape hatch — not
   the documented happy path.
2. **References are short-lived capabilities, not selectors.** A ref is valid
   only for its session, selected tab, and document revision; navigation, tab
   switch, a DOM-changing action, or an explicit refresh invalidates it. The
   backend resolves a ref to a server-held Playwright locator and rechecks that
   the element is attached, visible, enabled where relevant, and still agrees
   with its recorded role and accessible name. If it cannot, it **fails closed**
   with `This page changed after snapshot r17. Request browser_snapshot again,
   then use a current ref.` — it never clicks an adjacent element. Refs are
   opaque, bounded in count, and never persisted to the database, transcript, or
   panel.
3. **Page text is untrusted data.** Every snapshot puts page-derived text in a
   clearly labelled `untrusted` section; tool descriptions and server errors stay
   outside it. This is a provenance cue, not a prompt-injection defence. The
   server must never return the MCP bearer token, cookies, local/session storage,
   password values, authorization headers, or profile filesystem paths; must not
   add `evaluate`, cookie/storage export, download, or file-upload tools in this
   scope; must keep the temporary-vs-named-profile distinction explicit in every
   session summary; and must return an explicit action outcome rather than
   reading a page's prose as success.
4. **Bounded output is a correctness rule.** Keep `ef604c5`'s limits for ordinary
   action/list/session responses — 4,096 UTF-8 bytes, no `screenshotDataUrl` or
   `data:image`, capped lists, UTF-8-safe truncation. Snapshots get a **12,000
   UTF-8 byte** cap on the whole serialised response, counted in bytes rather
   than JS characters, reporting `truncated: true` and
   `nextStep: "narrow the snapshot or inspect a target"`. No hidden overflow
   file, no silent omission. `browser_take_screenshot` stays the only tool that
   may return an image: one compact metadata text block plus one JPEG block,
   never a data URL, never repeating page text.

## Phases

Each slice is a reviewable commit leaving a working Browser MCP.

- [ ] **1. Contract and observation foundation.** Revision/ref registry,
      deterministic snapshot projection, byte-counted encoding, error codes.
      Retain old action inputs; no panel behaviour change.
- [ ] **2. Reference actions.** Add `ref` to click/type/fill/select/wait with
      stale and non-actionable validation. Make `ref` the documented default and
      mark legacy targeting deprecated.
- [ ] **3. Panel and runtime observability.** Surface safe session/tab/action
      health. Measure capture overhead *before* changing capture cadence.
- [ ] **4. Compatibility and retirement.** Run provider and client tests, then
      decide separately whether legacy target inputs can go.

**If the ARIA projection, reference resolution, and panel health cannot stay one
coherent increment, stop after slice 1 and record why.** Do not rush an unsafe
selector-to-ref rewrite to claim parity.

## Decide at implementation start

These are product policy, not protocol shape, and an ADR is probably warranted
once one is answered — but do not write a retrospective ADR for the proposal
alone.

1. Should a named persistent profile require explicit selection in Browser
   settings, rather than an agent supplying an arbitrary profile name?
2. What is the right approval experience for destructive external actions —
   form submission, purchases, uploads — across all providers?
3. After measuring real panel use: capture after every action, on a throttled
   cadence, or only while the panel is visible?
4. Is this one upstreamable core patch plus a CLIde-only panel patch, or
   fork-only?

## Not doing

Replacing the Browser panel with Microsoft's Playwright MCP server. Browser
devtools or network recording, arbitrary JavaScript evaluation, downloads,
uploads, cookie or storage inspection. Removing persistent profiles or changing
their user-data policy. Solving web prompt injection or designing a global agent
approval system. Making screenshots free — explicit image requests still spend
vision and context capacity. Touching the production service during development
or isolated testing.
