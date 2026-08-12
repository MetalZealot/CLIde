# Codex 0.147, then a managed native runtime

- Status: 4/7
- Next: Phase 5 — resolve and select one managed native runtime for every Codex facet
- Context: [Codex surface map](../maps/codex-cli-sdk-app-server.md), [upgrade ledger](../maps/codex-upgrade-ledger.md), [chat transport map](../maps/2026-07-25-codex-chat-transport-architecture.md), [provider contract §5](../maps/CLIde_Provider_Architecture_Current_Contract.md), ADR 0011. Claude's runtime/SDK pairing stays out of scope — it belongs to the "Recurring provider SDK/CLI update process" item in `TODO.md`.

This branch pins the bundled runtime to 0.147.0; `main` is still 0.146.0. App Server
is the *default* Chat transport, not opt-in. What remains is that every Codex facet
resolves its own executable, so the version CLIde runs is still whatever is bundled
rather than a version anyone chose.

## Decisions — do not re-open these

- `isBlocking: true` → wait indefinitely. `isBlocking: false` → auto-answer with empty
  responses after `autoResolutionMs`, or 120 s when it is null (matches upstream's
  60 s hidden + 60 s countdown). Field absent → 0.146 behaviour: honour
  `autoResolutionMs`, else block.
- The native runtime is **selected, never followed.** A newer install is a candidate
  until promoted by hand. No automatic promotion, ever.
- The bundled CLI is an explicit emergency choice. If the approved executable is gone
  or fails validation, report Codex unavailable — never silently fall back.
- Browser requests carry opaque installation ids, never executable paths.
- One installation serves every Codex facet: Chat, Shell, SDK jobs, model discovery,
  account usage. Any exception must be visible in diagnostics.
- Every phase lands on the `codex-native-runtime` worktree and is verified on 3002
  before merge. Do not open a second worktree.
- Keep `approvalsReviewer: 'user'`; `--approve-for-me` stays unmapped.

## Phases

- [x] 1. **`isBlocking` honoured, behaviour unchanged on 0.146** — `448e1ab`,
  live-verified on 3002.

- [x] 2. **Pinned to 0.147.0** — `56bf5bf`. SDK, bundled CLI, platform lockfile packages,
  diagnostics, and drift contract updated. Zero-time questions resolve in the Codex
  transport without changing Claude's shared no-timer contract. New and resumed Chat
  live-verified on 3002.

- [x] 3. **Codex MCP edits stop erasing unknown native keys** — `2a4a727`. The edit
  merges over the existing record and clears only the keys this provider owns, so a
  cleared field and a transport change both still take effect. Live-verified on 3002
  through list → edit → native re-read. Claude, Cursor and OpenCode still rebuild
  their records the old way; that is a `TODO.md` item, not a phase here.

- [x] 4. **One reusable compatibility check** — `3c932a9`.
  `checkCodexAppServerCompatibility` takes any Codex executable, native binary or JS
  launcher, and the drift test is its first caller. Phase 6 must reuse it rather than
  write a second implementation, and should surface the first failing method or field
  — today the result says only that something is missing.

- [ ] 5. **Managed runtime resolution, provider-generic, Codex first.** A shared
  resolver plus a per-provider descriptor — not a Codex-shaped module retrofitted
  later. Detect `CLIDE_CODEX_CLI_PATH`, the service `PATH`, known installer
  locations, and the bundled CLI; resolve symlinks, dedupe by real path, read
  versions, assign opaque ids. Persist the host-wide selection atomically at
  `~/.cloudcli/provider-runtimes.json`, mode `0600`, storing active and previous
  fingerprints by real path, seeded to bundled so current behaviour is preserved.
  Route every Codex consumer through the selection: Chat and account usage launch
  `<selected> app-server --stdio`, SDK jobs and startup fallback pass
  `codexPathOverride`, Shell uses the same executable with platform-safe quoting,
  model discovery uses the selected runtime's `model/list` with the filesystem cache
  demoted to a source-labelled stale fallback. Snapshot executable and version when
  the long-lived App Server starts; a promotion mid-turn sets `updatePending` and
  recycles the process after the last active turn. Never interrupt a turn, never
  restart CLIde.

- [ ] 6. **Runtime row in the Codex account card.** One compact row: active,
  candidate, previous, bundled, SDK, and live-process versions, with **Check**,
  **Use** and **Roll back**. **Use** unlocks only after the Phase 4 check passes on
  that candidate, and its result is reported as a structural check, not as live Chat
  acceptance. Rollback is an explicit selection. Authenticated routes:
  `GET /api/providers/codex/runtime`, `POST …/runtime/check`,
  `PUT …/runtime/selection`, the last two taking an opaque installation id. No new
  settings screen.

- [ ] 7. **Documents match reality.** Supersede ADR 0011 — it still describes App
  Server as opt-in and pinned to 0.144.6 — with the default-transport,
  approved-native, explicit-fallback, idle-recycle position. Edit
  [provider contract §5](../maps/CLIde_Provider_Architecture_Current_Contract.md):
  its resolution order currently prefers whatever is on `PATH`, which Phase 5
  deliberately contradicts, and its §7 gap "native runtime resolution … not
  implemented" closes here. Refresh the Codex surface map (it still calls native
  thread pinning a candidate; 0.147 replaced it with persistent sections), the
  upgrade ledger, the permission and capability maps, the maps index, and
  `TODO.md`. Do not touch the frozen archived architecture spec.

## Done when

- A Build-mode Codex question on 0.147 auto-resolves instead of hanging, and a
  Plan-mode question still waits for you.
- Refreshing the browser mid-question replays the card with the right countdown.
- `npm run test:server`, `typecheck`, `lint` and `check:docs` pass, and the drift test
  asserts 0.147.0.
- Editing an MCP server in Settings leaves an unmodelled key in `~/.codex/config.toml`
  intact.
- The Codex account card shows active 0.146 bundled with 0.147 as a candidate;
  pressing Check passes, Use promotes it, and the version shown changes without a
  CLIde restart and without killing a running turn.
- With 0.147 active on 3002: new and resumed Chat, approvals, image and file input,
  abort, rewind, fork, usage, model list, and Shell all work, and Roll back returns
  to bundled.
- Deleting the approved executable makes Codex report unavailable rather than
  silently running the bundled CLI.
