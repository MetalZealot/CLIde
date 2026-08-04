# Opt-in diagnostics flight recorder

- Date: 2026-08-01
- Status: Deferred implementation specification
- Scope: A local, toggleable, behavior-neutral diagnostic mode for narrowing
  browser, PWA, lifecycle, authentication, WebSocket, routing, and UI-state
  failures in CLIde
- Blocking prerequisite: Complete, live-verify, and merge the upstream v1.37
  integration before starting this work
- Historical implementation reference: `929a2dc`
- Historical fix reference: `4b5ac61`
- Historical cleanup reference: `05cf60c`
- Related decision: [ADR 0024 — token rotation does not restart auth
  bootstrap](../decisions/0024-token-rotation-does-not-restart-auth-bootstrap.md)
- Related integration plan: [Upstream v1.37.0
  integration](2026-07-29-upstream-1-37-integration.md)

## Status and sequencing

**Deferred. Do not implement this in the upstream v1.37 integration worktree.**

Upstream v1.37 substantially changes Settings, authentication, token refresh,
WebSockets, attachments, routing, the server entrypoint, and shared component
boundaries. Those are the same surfaces this diagnostic mode would observe.
Implementing it before the integration is complete would create unnecessary
conflicts and could encode paths or lifecycle assumptions that no longer exist.

Start only after the v1.37 result has been completed, live-verified, and merged
into the then-current `main`. At that point:

1. re-read `AGENTS.md`, `TODO.md`, this specification, ADR 0024, the final
   v1.37 integration record, and the ignored local `CLAUDE.md`;
2. run `git status --short` and `git worktree list --porcelain`, preserving all
   unrelated work;
3. re-audit the merged Settings registry, app bootstrap, auth/token-refresh,
   WebSocket, service-worker, routing, and attachment paths rather than copying
   the historical filenames blindly;
4. claim the TODO item and create a fresh topic branch/worktree from the
   then-current `main`, suggested as `feat/diagnostics-mode` in
   `../cloudcli-wt-diagnostics-mode`;
5. do not replace or reconfigure an occupied branch-test server;
6. keep implementation and commits isolated until Grayson has verified the
   branch-test result; and
7. do not push, merge, restart production, or mutate real user data as part of
   the implementation without the normal explicit handoff.

## Purpose

Give Grayson a low-friction way to turn on a bounded, persistent event timeline
before reproducing a difficult bug on the real device, then copy that report
back into a troubleshooting session.

The mode is a diagnostic **flight recorder**, not a general telemetry system.
It records a small allowlisted set of state transitions around important
application boundaries. It does not upload data, inspect user content, change
runtime behavior, or attempt to diagnose or repair the problem itself.

The permanent baseline should usually answer the first narrowing question:

> Did the failure originate in page/PWA lifecycle, service-worker state,
> authentication, WebSocket connectivity, navigation, a major React boundary,
> or the user-action delivery path?

Once that layer is known, a future investigation may add a few temporary,
bug-specific events. The permanent recorder is not expected to predict every
future probe.

## Evidence behind the design

The Samsung Internet attachment investigation demonstrated the method. An
opt-in recorder captured one stable page boot, a healthy service worker and
WebSocket, and a valid `picker.change` for one PNG. It then captured an
authenticated token refresh followed by the active workspace unmounting 49 ms
after the picker result. That timeline disproved the picker and service-worker
hypotheses and identified auth bootstrap as the cause.

The historical implementation was introduced on the topic branch in
`30f3498`, integrated into `main` in `929a2dc`, and removed after live
acceptance in `8aee41e`/`05cf60c`. Use those commits as evidence and a source of
tested ideas, not as a patch to cherry-pick. The old implementation was tightly
coupled to that investigation and included behavior-changing experimental
resume-probe switches that do not belong in a permanent observation mode.

The old recorder core and panel totalled 16,234 bytes of source and about 4,647
bytes when individually gzip-compressed. At the 2026-08-01 baseline, the main
JavaScript bundle was 2,816,700 bytes raw and 848,388 bytes gzip-compressed.
Those figures are directional rather than an exact production bundle delta,
but they establish that download size is not the primary risk. Runtime
inertness, privacy, event quality, and maintenance are the design constraints.

## Goals

1. Make diagnostics discoverable under Settings and visibly indicate when
   recording is active.
2. Start early enough to capture boot and installed-PWA lifecycle failures.
3. Keep events ordered across workspace remounts, page resumes, and reloads.
4. Preserve enough redacted context to correlate user actions with auth,
   transport, lifecycle, and rendering transitions.
5. Keep the disabled path effectively inert.
6. Keep reports local and explicitly user-exported.
7. Make the recorder reusable while keeping domain-specific probes small and
   independently removable.
8. Retain a URL activation escape hatch for failures that prevent Settings
   from opening.

## Non-goals

- General analytics, crash reporting, usage telemetry, or remote log upload.
- Recording prompts, responses, tool arguments/results, transcripts, or user
  documents.
- Replacing server logs, provider-native diagnostics, Browser MCP, performance
  profiling, or bug-specific instrumentation.
- Monkey-patching `fetch`, WebSocket, React, or browser APIs to record every
  operation automatically.
- Adding behavior-changing experiment switches to the permanent Settings
  screen.
- Building a remote support bundle or server-side report collector in v1.
- Restarting the production service or changing authentication/database state.
- Restoring the old 650-line patch unchanged.

## Product behavior

### Settings location

Add a top-level **Diagnostics** screen to the existing **System** Settings
group. The provisional stable screen id is `diagnostics`. Re-check the merged
v1.37 Settings registry before relying on that name.

The screen should use the merged Settings registry and primitives, participate
in Settings search, respect the one-scroll-container rule, and add search terms
such as `diagnostics`, `debug`, `logs`, `report`, `PWA`, `auth`, `WebSocket`, and
`lifecycle`.

Do not place the control in Chat preferences: it observes the application as a
whole. Do not create a second QuickSettings-like surface.

### Controls and status

The first version contains:

- **Enable diagnostic recording** — a persistent toggle, off by default;
- a clear active/inactive status and current boot-id prefix;
- retained event count and the configured maximum;
- **Copy report**;
- **Clear report**; and
- **Reload and capture startup** when recording is enabled.

Enabling recording starts eligible listeners immediately and records
`diagnostics.enabled`. It must not automatically reload the page or discard
composer/editor state. The explicit reload action exists because the current
boot cannot be reconstructed after Settings has already opened.

Disabling recording stops listeners, timers, and channels immediately and
records or flushes the final disable boundary. It retains the existing report
until the user clears it, so a successful reproduction is not lost merely by
turning the recorder off.

Copy and Clear remain available whenever retained events exist, including
while recording is disabled. Copy produces formatted JSON and shows local
success/failure feedback. Clear requires no destructive global confirmation
because it removes only the local diagnostic buffer; it must not touch normal
CLIde preferences, caches, sessions, projects, transcripts, or service-worker
data.

### Active-recording affordance

When recording is enabled, show a compact, unmistakable `Diag` status control
above application content. Activating it opens a small report view with recent
events plus Copy, Clear, and a link to the full Diagnostics Settings screen.

The control must:

- remain accessible after the workspace or auth boundary remounts;
- avoid covering the composer, mobile navigation, dialogs, or safe-area
  insets;
- use solid surfaces and the existing scrim rules, never backdrop blur;
- be keyboard and screen-reader accessible; and
- make forgotten recording visible without presenting itself as an error.

The compact view may show the newest 100 events while export includes the
whole retained bounded buffer.

### URL escape hatch

Retain an early-boot URL mechanism equivalent to the historical query flag:

- `?clideDebug=1` enables recording before normal app bootstrap; and
- `?clideDebug=0` disables recording.

The exact parameter may be renamed during implementation if v1.37 introduces
a conflicting convention, but Settings must remain the primary interface.
The URL path is necessary when the failure prevents Settings from opening or
when a cold-start reproduction must be armed before React renders.

Consume the parameter into the dedicated diagnostic preference. Do not leave
it as a separate source of truth that can disagree with the Settings toggle.

## Baseline event model

Every event has:

```ts
type DiagnosticEvent = {
  sequence: number;
  timestamp: string;       // wall-clock ISO timestamp
  elapsedMs: number;       // monotonic time since this page boot
  bootId: string;
  name: DiagnosticEventName;
  details?: DiagnosticEventDetails;
};
```

The stored/exported envelope includes a schema version, CLIde/app version,
client build or module-asset identity where available, enabled-at timestamp,
retention/cap metadata, and ordered events. Multiple boot IDs may coexist in
one report so a reload, discard, or replacement can be distinguished from a
workspace-only remount.

Event names are stable dotted identifiers. Details are typed per event; do not
restore a public `Record<string, unknown>` API that lets arbitrary objects
reach storage.

### Lifecycle and environment

Record, where supported:

- `diagnostics.enabled` / `diagnostics.disabled`;
- `page.boot`, including navigation type, normalized route shape,
  `display-mode: standalone`, visibility, `document.wasDiscarded`, browser user
  agent, and build/module identity;
- `page.visibility`, including bounded hidden duration;
- `page.show`, `page.hide`, `page.freeze`, `page.resume`, `page.focus`, and
  `page.blur`;
- `page.peer-detected` through a diagnostic-only `BroadcastChannel`, so a
  second app page can be distinguished from a reload;
- `page.error` and `page.unhandled-rejection` through the redaction boundary;
  and
- supported coarse runtime memory fields, treated as optional rather than a
  required browser contract.

### Service worker

Record:

- controller script identity and controller changes;
- registration scope and active/waiting/installing state;
- registration success/failure; and
- registration count and normalized scopes when safely available.

Do not update, unregister, bypass, or otherwise manipulate the service worker
from Diagnostics.

### Authentication

Record stable state transitions, not credentials:

- auth bootstrap start, completion, failure category, and loading-state
  changes;
- protected-route state transitions such as loading/authenticated/setup, using
  booleans or enums rather than user data;
- token-refresh observed and adopted, without the token, header, expiry
  payload, user id, email, or response body; and
- visibility/resume auth probe start, completion status, and failure category.

Diagnostics must not disable refresh, suppress keep-alives, change callback
dependencies, retry requests, or force logout/login. The historical
`resumeProbes=none|auth|ws` experiment is explicitly excluded from permanent
mode.

### WebSocket

Record:

- connect attempt, open, close code/category, error category, and intentional
  shutdown;
- reconnect scheduled/attempted/cancelled and current attempt count;
- visibility/online liveness probe with the socket ready state;
- application ping/pong timeout or recovery; and
- subscription/replay state only as coarse identifiers or counters.

Never record WebSocket URLs containing credentials, frames, prompt content,
provider output, permission answers, or complete session identifiers.

### Application and navigation boundaries

Record:

- root/app-content mount and unmount;
- major loading-boundary changes that can replace the workspace;
- normalized route-shape changes with dynamic IDs removed or irreversibly
  shortened; and
- selected project/session presence as booleans, never names or paths.

Avoid logging every React render or store update. Events should correspond to
transitions that help establish causality.

### User-action delivery

Keep a deliberately small set of safe breadcrumbs for actions whose loss can
be confused with lifecycle failure. Re-audit these paths after v1.37. Initial
candidates are:

- attachment picker open, change, and cancel;
- accepted/rejected file count, MIME categories, and aggregate bytes;
- composer submit attempt/accepted/rejected category without message text; and
- application navigation action category without labels or destination IDs.

Do not record filenames, clipboard contents, message contents, mentioned
paths, drag payloads, or raw browser events.

## Recorder architecture

The final filenames should follow the merged v1.37 structure. Preserve these
logical boundaries:

1. **Early configuration:** reads one dedicated local preference and query
   override before React bootstrap.
2. **Recorder manager:** starts/stops listeners, owns the current boot ID and
   monotonic clock, accepts typed event DTOs, and has an immediate no-op path
   when disabled.
3. **Redaction/serialization boundary:** validates and sanitizes every event
   before it can enter memory, storage, UI, or export.
4. **Bounded storage adapter:** retains the newest events under a versioned
   key and tolerates malformed JSON, storage denial, and quota failure.
5. **Probe modules:** lifecycle, service-worker, auth, WebSocket, app-boundary,
   and action probes register independently and clean up symmetrically.
6. **Settings/report UI:** observes recorder state and never owns the recorder
   lifecycle itself.

Do not put the diagnostic setting into the general `useUiPreferences` object.
The recorder must be readable before React mounts, must remain usable if
Settings changes after v1.37, and needs independent versioning/retention.

### Persistence and performance

- Default retention: newest 240 events, matching the proven historical cap.
- Keep an in-memory buffer while the page is active.
- Batch ordinary `localStorage` writes rather than synchronously parsing and
  rewriting the full report for every noisy event.
- Flush on `visibilitychange` to hidden, `pagehide`, recorder disable, explicit
  Copy, and global error/rejection capture.
- Catch every diagnostic exception. Recorder failure must not produce another
  application error or alter the action being observed.
- Rate-limit or coalesce noisy transitions such as repeated focus, reconnect,
  or identical loading state.
- When disabled, register no diagnostic listeners, timers, or
  `BroadcastChannel`; perform no report writes; and make each instrumentation
  call return after one cheap enabled check.

Dynamic import is optional, not a requirement. Prefer a simple reliable early
bootstrap unless an actual before/after production build shows an unreasonable
bundle delta.

## Privacy and safety boundary

Reports remain on the local browser until Grayson explicitly copies them.
There is no diagnostics API, upload endpoint, database table, provider message,
or transcript row in v1.

Never record:

- access/refresh/API tokens, cookies, authorization headers, credentials, or
  decoded JWT fields;
- prompts, assistant responses, reasoning, tool arguments/results, permission
  answers, or transcript content;
- filenames, file contents, clipboard contents, absolute filesystem paths, Git
  diffs, terminal output, or browser page content;
- user names, email addresses, project/session names, full application or
  provider session IDs, database rows, or MCP configuration; or
- arbitrary request/response bodies and raw thrown objects.

Safe details must be allowlisted per event. Normalize routes and endpoints,
truncate all strings to a small documented limit, redact token/JWT-like
patterns and absolute paths as defense in depth, and export only the sanitized
stored DTO—not live application objects.

The Diagnostics screen should state that the report contains browser/build
metadata and redacted application state, remains on this device, and is shared
only when copied.

## Bundle and runtime budgets

Implementation acceptance requires a real before/after production client
build comparison. Record raw and gzip or Brotli deltas for the main entry and
any new chunk.

Initial budgets:

- target no more than 15 KiB additional gzip-compressed JavaScript;
- no server bundle or server runtime addition for the first version unless the
  post-v1.37 re-audit proves a client-only boundary insufficient;
- zero recurring timers/listeners/channels when disabled; and
- no visible input, scrolling, navigation, attachment, resume, or reconnect
  regression while enabled.

Exceeding the size target is a review point, not permission to weaken privacy
or lifecycle correctness. The historical estimate suggests the target is
comfortable.

## Suggested implementation sequence

### Phase 0: Post-v1.37 re-audit

- Map the final app bootstrap, Settings registry, auth refresh, WebSocket,
  service-worker, router, root boundaries, and attachment implementation.
- Re-run bundle-size measurements against the new baseline.
- Check whether upstream added diagnostics, telemetry, error boundaries, or
  logging utilities worth adapting instead of duplicating.
- Confirm that the URL query parameter does not conflict with upstream.
- Record the exact implementation paths in the topic-branch TODO claim or
  implementation plan.

### Phase 1: Recorder core

- Implement versioned enable/report storage.
- Implement typed events, redaction, ordering, bounded retention, batching,
  flushing, corruption recovery, and export.
- Implement idempotent `startDiagnostics()` / `stopDiagnostics()` behavior.
- Add query activation before React bootstrap.
- Add unit tests before installing domain probes.

### Phase 2: Baseline probes

- Add lifecycle/environment and service-worker probes.
- Add auth, WebSocket, app-boundary, navigation, and minimal action probes at
  their real ownership boundaries.
- Ensure each probe has symmetric cleanup and produces no duplicate listeners
  under React Strict Mode or remounts.
- Keep provider-specific logic behind provider adapters or typed categories;
  do not make shared diagnostic events Claude-only.

### Phase 3: Settings and compact report UI

- Register the Diagnostics screen and search metadata.
- Add toggle, status, count, Copy, Clear, and Reload actions.
- Add the enabled-only compact affordance outside remount-prone app content.
- Add i18n keys in every supported locale, following current fallback policy.
- Add accessibility and safe-area coverage.

### Phase 4: Isolated live acceptance and cleanup

- Build and serve the topic worktree through `cloudcli-branch-test` on port
  3002 without disturbing production 3001 or an occupied branch-test owner.
- Have Grayson perform the real browser/device flows below and copy the report.
- Fix only diagnostic-mode defects in this branch; do not opportunistically
  repair unrelated failures merely exposed by the report.
- After branch acceptance and normal integration approval, perform the
  installed-PWA acceptance against the 3001 build as a separate verified
  milestone.
- Keep Diagnostics in the shipped app; remove only temporary probes added to
  investigate implementation failures.

## Verification plan

### Automated

- Typecheck, changed-file lint, and client build.
- Registry, navigation, and Settings-search tests for the stable screen.
- Recorder tests for:
  - disabled no-op behavior;
  - idempotent enable/disable and listener cleanup;
  - strictly increasing sequence numbers;
  - multiple boot IDs across reload-shaped input;
  - retaining only the newest 240 events in chronological order;
  - batched and forced flush behavior;
  - malformed/old storage envelopes;
  - storage denied/quota failure;
  - query enable/disable normalization;
  - typed redaction and string truncation;
  - absence of forbidden fields in serialized reports; and
  - Copy/Clear behavior.
- Component tests for Settings state, retained-report behavior after disable,
  copy feedback, and active-recording affordance accessibility.
- Strict Mode test proving probes do not double-register or double-record one
  browser event.

### Live branch-test flows

1. Open Diagnostics while disabled; confirm no panel and no event growth.
2. Enable recording without reload; confirm status/panel and immediate events.
3. Navigate Chat/Files/Git/Settings; background and resume the page; confirm
   ordered, redacted transitions.
4. Use Reload and capture startup; confirm a new boot ID and boot/service-worker
   events while the prior boot remains distinguishable.
5. Open and cancel the native attachment picker, then choose a small image;
   confirm counts/MIME/bytes without filename or content.
6. Exercise offline/online or an equally safe WebSocket reconnect path; confirm
   connection transitions without frames or credentials.
7. Disable recording; confirm listeners stop and the report remains copyable.
8. Copy and inspect the complete JSON for forbidden data, then Clear and verify
   only diagnostic storage was removed.
9. Enable via the query escape hatch from a cold URL and disable it again.
10. Repeat the core touch flow on the real mobile device; static/browser-only
    checks are insufficient for picker, resume, and safe-area behavior.

### Installed-PWA acceptance

After the branch has been accepted and integrated through the normal workflow,
verify separately on the installed Samsung Internet PWA served from port 3001:

- cold launch and resume;
- Settings toggle and explicit reload;
- compact affordance placement with keyboard and safe area;
- Android picker cancel and selection;
- report survival across workspace remount and page reload; and
- no visible behavior or performance regression with diagnostics disabled and
  enabled.

Client-only implementation needs `npm run build:client` and a refresh; do not
restart the production service unless the post-v1.37 architecture genuinely
adds a server component and the user explicitly authorizes that restart.

## Acceptance criteria

- Diagnostics is discoverable under Settings → System and through Settings
  search.
- Recording is off by default and visibly active when enabled.
- Enabling starts recording without a forced reload; an explicit action
  captures the next boot.
- A bounded report survives workspace remounts, background/resume, and reload.
- Copy/Clear work on the real mobile device without DevTools.
- The baseline report can distinguish page replacement, workspace remount,
  auth transition, WebSocket transition, service-worker change, navigation,
  and a valid attachment-picker result.
- The serialized report contains none of the forbidden data classes above.
- Diagnostics never changes auth, keep-alive, reconnect, retry, routing,
  service-worker, or picker behavior.
- Disabled mode has no diagnostic listeners, timers, channels, or storage
  writes and stays within the agreed bundle budget.
- Tests, client build, branch-test flows, and installed-PWA acceptance are
  reported as separate milestones.
- No production restart, push, merge, or live-data mutation is implied by
  implementation completion.

## ADR handoff

Before final integration, draft a short ADR for Grayson's approval recording
the lasting boundaries: diagnostics is opt-in, local-only, bounded, redacted,
behavior-neutral, and retains no remote/server copy. Do not create or number
that ADR now; re-evaluate the final implementation after v1.37 and record what
was actually built.
