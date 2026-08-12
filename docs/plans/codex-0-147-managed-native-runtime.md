# Codex 0.147, then a managed native runtime

- Status: 6/7
- Next: Phase 7 — align the managed-runtime decisions, maps, and backlog with reality
- Context: [Codex surface map](../maps/codex-cli-sdk-app-server.md), [upgrade ledger](../maps/codex-upgrade-ledger.md), [chat transport map](../maps/2026-07-25-codex-chat-transport-architecture.md), [provider contract §5](../maps/CLIde_Provider_Architecture_Current_Contract.md), ADR 0011. Claude's runtime/SDK pairing stays out of scope — it belongs to the "Recurring provider SDK/CLI update process" item in `TODO.md`.

This branch pins the bundled runtime to 0.147.0 and routes every Codex facet through
one approved installation; `main` is still 0.146.0 with each facet resolving its own.
What remains is the surface that lets someone see which installation is active and
choose a different one.

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

- [x] 5. **Managed runtime resolution, provider-generic, Codex first** — `c0b8d5a`.
  A shared resolver with a per-provider descriptor persists one approved executable
  at `~/.cloudcli/provider-runtimes.json`, mode `0600`, seeded to bundled. Chat,
  Shell, SDK jobs, auth, model discovery and account usage all launch it; a promotion
  arriving mid-turn waits for idle; a missing or invalid selection reports Codex
  unavailable instead of falling back. Live-verified on 3002 — all facets resolved
  one installation.

- [x] 6. **Runtime row in the Codex account card** — `b0d4f54`. Installations list by
  path with active, candidate, bundled and previous state; Check names the first
  missing method or field and unlocks Use; routes take an opaque id behind the
  authenticated provider router. Live-verified on 3002, including a promotion during
  a running turn that left the live process alone until it finished.
  Two follow-ups, both `TODO.md` items rather than reopened phases: Check and Use
  target a derived candidate with nothing in the UI naming which row they act on,
  which turns ambiguous as soon as a third installation is discovered; and the full
  paths wrap to three lines each on a phone.

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
- The Codex account card shows the bundled installation active and the one on `PATH`
  as a candidate — both read 0.147.0, so the real ID is the path. Check passes, Use
  promotes it, and the active installation changes without a CLIde restart and
  without killing a running turn.
- With the promoted installation on 3002: new and resumed Chat, approvals, image and
  file input, abort, rewind, fork, usage, model list, and Shell all work, and Roll
  back returns to bundled.
- Deleting the approved executable makes Codex report unavailable rather than
  silently running the bundled CLI.
