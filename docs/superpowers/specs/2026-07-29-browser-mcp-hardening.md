# Browser MCP hardening: snapshot-first, reference-based automation

*Proposed 2026-07-29 for a future CLIde session. This is a design and
implementation plan, not an instruction to begin the work immediately.*

## Purpose

CLIde's built-in `cloudcli-browser` MCP server is useful because it gives an
agent an isolated Playwright browser while the Browser panel lets the human
monitor it. Its first implementation is still an early browser bridge rather
than a mature agent interface:

- a snapshot is currently `body.innerText`, not a structured interaction map;
- click, type, fill, and select depend on raw CSS selectors, fuzzy text, or
  coordinates;
- page content is untyped, unbounded by byte count, and not explicitly marked
  as untrusted web content; and
- the panel, capture lifecycle, and agent protocol share one in-memory session
  object more closely than they need to.

Commit `ef604c5` fixes the most expensive version of that last problem. It
keeps the panel's JPEG preview but gives routine agent calls a compact summary,
limits ordinary results to 4,096 UTF-8 bytes, makes `browser_snapshot`
text-only, and returns an explicit screenshot as MCP `image/jpeg` content.
That change is a prerequisite for this proposal; do not replace or weaken its
DTO boundary.

The goal is not to clone Microsoft Playwright MCP or to add every browser
automation primitive. The goal is a dependable, provider-neutral CLIde Browser
experience with the same essential operating model:

```text
agent asks for a bounded page snapshot
        -> receives readable accessibility-oriented elements with short-lived refs
        -> acts on a ref
        -> receives compact outcome metadata
        -> snapshots again when it needs new page state

human opens Browser panel
        -> sees the independently maintained visual preview
```

This follows the direction used by Playwright MCP: use a structured page
snapshot for actions and reserve screenshots for explicit visual inspection.
MCP itself supports separate text and image tool-result content, so images must
remain images rather than base64 embedded in text.

References for the implementing session:

- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)

## Status and prerequisite

**Status: deferred design. No code is authorized by this document alone.**

Before implementation:

1. Confirm `ef604c5` (or its equivalent after rebase) is on the target branch
   and has passed the Browser MCP wire test on the isolated server.
2. Re-read `TODO.md`, this document, the preceding
   `archive/2026-07-29-browser-mcp-tool-result-token-bloat-investigation.md`, and any
   Browser-related ADR written after this proposal.
3. Inspect the currently installed Playwright version and its supported
   accessibility/ARIA snapshot APIs. Do not assume an API from a newer
   Playwright release exists in this checkout.
4. Recheck upstream and open issues before calling this upstream-wide. The
   existing browser-use code is upstream-derived, but this design is broader
   than the DTO correction and upstream may have moved.

This is likely an upstream candidate once the implementation is small enough
to separate from CLIde-specific Browser-panel behavior. Do not open, push, or
update an upstream issue or PR without Grayson's approval.

## Current implementation and constraints

| Concern | Current location / behavior | Required preservation |
|---|---|---|
| MCP stdio boundary | `server/browser-use-mcp.ts` turns HTTP tool results into MCP content | Keep the `cloudcli-browser` name and authenticated local HTTP bridge. |
| Agent HTTP route | `server/modules/browser-use/browser-use-mcp.routes.ts` dispatches each tool | Keep bearer-token authentication and concise errors. |
| Browser runtime | `server/modules/browser-use/browser-use.service.ts` owns Playwright contexts, session TTL, profiles, capture, and agent actions | Keep temporary contexts isolated and do not touch user credentials or profile data without an explicit decision. |
| Human monitor | `browser-use.routes.ts` and `src/components/browser-use/view/BrowserUsePanel.tsx` return/render `screenshotDataUrl` | The panel must retain live visual monitoring; an agent result must never contain the panel image by accident. |
| Provider setup | `registerAgentMcp()` registers one stdio MCP server for Claude, Codex, Cursor, and OpenCode | Do not make the common Browser tool schema Claude-only. Test each configured client separately. |

The present `captureSession()` takes a JPEG after most agent actions. That is
allowed to remain a panel-side operation in the first hardening increment: the
token leak is fixed because its image no longer crosses the agent boundary.
Do not silently remove the panel's preview to make an agent benchmark look
better. Capture cadence is a later, measurable performance decision.

## Product decisions

### 1. Snapshot-first is the normal interaction contract

`browser_snapshot` becomes the normal way an agent discovers the page. It
returns a compact, accessibility-oriented interaction map with opaque element
references. The agent uses those references for click, type, fill, select, and
optionally hover/focus actions.

It must not expose a raw DOM, arbitrary CSS selector, browser internals,
cookies, request headers, storage contents, or a screenshot. Raw selectors
remain an implementation escape hatch only during migration; they are not the
documented happy path for an agent.

### 2. References are short-lived capabilities, not selectors

A snapshot reference is valid only for its session, selected tab, and document
revision. A navigation, tab switch, successful action that changes the DOM, or
an explicit refresh invalidates it. A stale reference must fail closed with an
actionable error such as:

```text
This page changed after snapshot r17. Request browser_snapshot again, then use a current ref.
```

The backend resolves a ref to a server-held Playwright locator/descriptor; it
never asks the model to reconstruct a CSS selector. Before interaction, it
rechecks that the element is attached, visible, enabled where relevant, and
still agrees with its recorded accessible role/name. If it cannot establish
that, it returns the stale-ref error rather than clicking an adjacent element.

References are opaque (`e1`, `e2`, or revision-scoped equivalents), bounded in
count, and never persisted to the database, transcript, or human panel.

### 3. Page text is untrusted data

Sites can put deceptive instructions in visible text and accessibility labels.
Every snapshot must place page-derived text in a clearly labelled `untrusted`
field or text section. Tool descriptions and server errors remain outside that
section. This is a provenance cue, not a complete prompt-injection defense.

The Browser MCP must also:

- never return the MCP bearer token, cookies, local/session storage, password
  values, authorization headers, or profile filesystem paths;
- not add arbitrary `evaluate`, cookie export, storage export, download, or
  file-upload tools in this hardening scope;
- keep the existing temporary-vs-named-profile distinction explicit in every
  session summary; and
- return an explicit action outcome rather than interpreting a page's prose as
  success.

Navigation and ordinary form interaction retain the provider's existing tool
and approval model. This proposal does not pretend that a text label alone can
make an untrusted page safe. A later policy project may add per-domain rules or
human confirmation for irreversible actions; do not smuggle that product
decision into this implementation.

### 4. Bounded output is a correctness rule

Keep the `ef604c5` limits for ordinary action/list/session responses:

- 4,096 UTF-8 bytes maximum;
- no `screenshotDataUrl`, `data:image`, or other binary content;
- capped tab/session lists and UTF-8-safe truncation.

For the new snapshot contract, use a **12,000 UTF-8 byte** cap for the entire
serialised response, not merely a JavaScript character count. It must report
`truncated: true` and `nextStep: "narrow the snapshot or inspect a target"`
when it omits content. No hidden overflow file and no silent omission.

An explicit `browser_take_screenshot` remains the only tool that may return
image content. It returns one compact metadata text block plus one JPEG image
block; it never returns a data URL or repeats page text.

## Target tool contract

The final JSON field spelling can follow the project's TypeScript conventions,
but the semantics below are required. Use an output-schema if the installed MCP
protocol/client support can express it cleanly; otherwise validate and test the
same shape at the service/MCP boundary.

### `browser_snapshot`

Input:

```ts
{
  sessionId: string;
  tabIndex?: number;       // defaults to the selected tab
  targetRef?: string;      // optional subtree focus from a prior snapshot
  maxDepth?: number;       // bounded server-side; never a raw unlimited tree
}
```

Text result shape, within the snapshot budget:

```ts
{
  session: AgentBrowserSessionSummary;
  page: {
    revision: string;
    url: string | null;
    title: string | null;
    tabIndex: number;
  };
  untrusted: {
    elements: Array<{
      ref: string;
      role: string;
      name: string;
      value?: string;      // never a password value
      state?: string[];    // e.g. disabled, checked, expanded
    }>;
    text?: string;         // bounded supplementary visible text, if useful
  };
  truncated: boolean;
  nextStep?: string;
}
```

Only actionable/meaningful elements belong in the default snapshot: links,
buttons, inputs, textareas, selects, checked/expanded controls, headings, and
concise nearby text needed to disambiguate them. Decorative layout containers,
scripts, styles, hidden nodes, and arbitrary full-page body text do not.

Prefer Playwright's supported accessibility/ARIA mechanism if it supplies the
required roles/names. If it does not provide stable actionable references,
build the smallest server-side projection needed for this contract and test it
against semantic HTML, labels, nested controls, frames, dynamic content, and
duplicate labels. Do not parse browser-generated snapshot text with fragile
regular expressions.

### Reference-based actions

Add `ref` as the primary target to the existing actions:

| Tool | Required target / outcome |
|---|---|
| `browser_click` | `ref`; returns a compact action receipt and current page revision. |
| `browser_type` | `ref` plus text and optional submit; rejects a non-editable ref. |
| `browser_fill_form` | a bounded list of `{ ref, value }`; fail before filling if any ref is invalid, then report exactly what completed. |
| `browser_select_option` | `ref` plus values; validates a select-like target. |
| `browser_wait_for` | explicit time, URL, or **current-snapshot ref** condition; no fuzzy unbounded page scan by default. |
| `browser_tabs` | keeps its current lifecycle but reports a tab revision and invalidates refs on selection/new/close. |

For one compatibility release, the old `selector`, `text`, and `x`/`y` inputs
may remain accepted behind a `legacyTarget` path. They must be described as
deprecated in the tool schema and produce a compact warning in the receipt.
They must not be combined with `ref`, and no new feature may depend on them.
Remove them only after real Claude, Codex, Cursor, and OpenCode sessions have
been observed loading the new schema.

Every successful mutating action returns only a compact receipt:

```ts
{
  session: AgentBrowserSessionSummary;
  action: { kind: 'click'; targetRef: 'e4'; completed: true };
  page: { revision: 'r18'; url: '…'; title: '…' };
  nextStep: 'Request browser_snapshot before another page-targeted action.';
}
```

It does not automatically include a snapshot, screenshot, raw page text, or
the full accessibility tree. This avoids context churn and makes the agent ask
for fresh state deliberately.

### Errors

Errors must remain short and remedy-oriented. At the internal HTTP boundary,
give every expected error a stable code; at the MCP boundary render its message
as a concise error result rather than an HTML/Express error blob.

Required codes include:

- `BROWSER_SESSION_NOT_FOUND` / `BROWSER_SESSION_UNAVAILABLE`;
- `BROWSER_TAB_NOT_FOUND`;
- `BROWSER_SNAPSHOT_REF_STALE`;
- `BROWSER_SNAPSHOT_REF_NOT_ACTIONABLE`;
- `BROWSER_SNAPSHOT_TRUNCATED` only when an action requires omitted detail;
- `BROWSER_PAGE_TIMEOUT` with the operation and safe retry suggestion; and
- `BROWSER_RUNTIME_DISCONNECTED` with a create/resume-session suggestion.

Do not expose selector internals, profile paths, headers, tokens, or page
source in an error. Preserve underlying Playwright detail only in structured,
redacted server logs.

## Architecture plan

### A. Split panel capture from agent observation

Retain `BrowserUseSession` and `publicBrowserSession()` for the human monitor.
Keep `AgentBrowserSessionSummary` for the agent boundary. Make the split
explicit in naming and tests:

```text
Playwright page
    |-- capturePanelPreview() --> session.screenshotDataUrl --> Browser panel API
    `-- buildAgentSnapshot() --> revision + ref registry + bounded text --> MCP
```

The initial increment may still call panel capture after an action so existing
monitoring remains live. It must not call capture merely because an agent asks
for a text snapshot. Later performance work can measure and alter that cadence
without changing the agent contract.

### B. Add per-session page-observation state

Extend the runtime handle, not the persisted/public session DTO, with an
ephemeral observation record:

```ts
type PageObservation = {
  revision: string;
  tabIndex: number;
  createdAt: number;
  refs: Map<string, RefDescriptor>;
};
```

`RefDescriptor` should hold only the minimum safe locator description and
expected accessible metadata. Clear it when the selected tab changes, a page
navigates, an action completes, the session stops/expires, or the context
closes. Limit the map size and allow one current revision per active tab.

Never put this state in a transcript, the user database, a browser profile, or
the Browser panel response.

### C. Centralise result creation

`browser-use-mcp-content.ts` remains the only place that converts Browser API
data into MCP content. Extend it with explicit helpers for:

- normal bounded JSON receipts;
- bounded snapshots;
- concise errors; and
- explicit image results.

Enforce UTF-8 byte budgets after serialisation and before writing to stdio.
Tests must prove every normal helper rejects screenshot fields/data URLs and
that no tool switch can bypass these helpers.

### D. Keep the Browser panel simple

The Browser panel remains a monitor, not a second automation client. It keeps
its screenshot, cursor marker, selected session, stop/delete controls, and
clear temporary/profile indication. Add only useful observability that does
not reveal page secrets:

- current tab count/selected tab;
- last safe action outcome and time; and
- a recoverable runtime-disconnected state.

Do not make screenshot clicking generate agent refs or send coordinate actions.
The accessible snapshot is the authoritative interaction surface.

## Delivery slices

Keep this as several reviewable commits, each leaving a working Browser MCP.

1. **Contract and observation foundation**
   - Add the revision/ref registry and a deterministic snapshot projection.
   - Introduce byte-counted snapshot encoding and error codes.
   - Retain old action inputs temporarily; no Browser-panel behavior change.
2. **Reference actions**
   - Add `ref` to click/type/fill/select/wait and validate stale/non-actionable
     references.
   - Make `ref` the documented/default schema path; mark legacy targeting
     deprecated.
3. **Panel and runtime observability**
   - Surface safe session/tab/action health in the panel.
   - Measure capture overhead before making any capture-cadence change.
4. **Compatibility and retirement**
   - Run provider/client tests. Only then decide whether legacy target inputs
     can be removed in a separately announced compatibility change.

If the ARIA projection, reference resolution, and user-facing panel health
cannot remain a coherent small increment, stop after slice 1 and record the
facts. Do not rush an unsafe selector-to-ref rewrite just to claim parity.

## Verification plan

### Automated coverage

Add narrow server tests under `server/modules/browser-use/tests/` for:

- semantic snapshot projection: labels, links, buttons, text fields, selects,
  checked/disabled/expanded state, duplicate names, and nested elements;
- byte budgets with multibyte Unicode; truncation is explicit and never cuts a
  UTF-8 code point;
- no screenshot/data URL/session secret reaches ordinary receipts or snapshots;
- an explicit screenshot has exactly compact text metadata plus one
  `image/jpeg` MCP content item;
- references resolve only in their source session/tab/revision;
- navigation, tab selection, stop, expiry, and a successful mutation all
  invalidate prior references;
- stale/non-actionable refs return their stable code and no click/type occurs;
- form preflight avoids a partial fill when any ref is invalid; and
- unexpected Playwright failures become redacted, actionable errors.

Use a local static fixture or `page.setContent`/equivalent for deterministic
browser integration tests. Do not use a production account, user website, or
real browser profile for automated tests.

Run:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test \
  server/modules/browser-use/tests/browser-use-mcp-content.test.ts \
  server/modules/browser-use/tests/browser-use.service.test.ts
npm run typecheck
npm run lint
npm run build:server
```

### Isolated live verification

This is server work. Build and test it through the worktree-specific harness,
never by restarting `cloudcli.service`:

```bash
cloudcli-branch-test start /absolute/path/to/browser-hardening-worktree
```

On `http://nuthallpi.tailb083b8.ts.net:3002`, use a clearly named throwaway
agent session and a safe public fixture such as `https://example.com`.

For each configured provider client (Claude, Codex, Cursor, OpenCode), record
either a real pass or a clear not-configured/not-supported result:

1. create session, navigate, snapshot;
2. click/type through a returned ref;
3. deliberately reuse a stale ref and confirm the safe retry message;
4. request a screenshot and verify native image handling;
5. watch the Browser panel: preview, selected tab, action status, stop, and
   expiry all remain correct; and
6. confirm a normal action/snapshot contains no base64 image and respects its
   byte budget.

Do not report provider parity from one Codex-only run. Do not navigate to an
account, credential, payment, or personal-content page for this smoke test.
After testing, close the isolated Browser session and remove any test-only
provider transcript from the filesystem before deleting its branch-test
database row, if one was created.

## Non-goals

- Replacing CLIde's Browser panel with the Microsoft Playwright MCP server.
- Full browser-devtools/network recording, arbitrary JavaScript evaluation,
  downloads, uploads, or cookie/storage inspection.
- Removing persistent profiles or changing their user-data policy.
- Solving all web prompt injection or designing a global agent approval system.
- Making screenshots free: explicit image requests still use vision/context
  capacity.
- Changing the production service as part of development or isolated testing.

## Decisions to revisit at implementation start

These are deliberately deferred because they affect product policy more than
the protocol shape:

1. Should a named persistent profile require explicit selection in Browser
   settings, rather than allowing an agent to supply an arbitrary profile name?
2. What is the right approval experience for destructive external actions
   (submitting forms, purchases, file uploads) across all providers?
3. After measured panel use, should previews capture after every action, on a
   throttled cadence, or only while the Browser panel is visible?
4. Is the hardening implementation one upstreamable core patch plus a
   CLIde-only panel-observability patch, or should it remain fork-only?

An ADR is probably warranted once one of those product-policy choices is made.
Do not create a retrospective ADR for this proposal alone.
