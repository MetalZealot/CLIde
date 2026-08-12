# Codex 0.147 and managed native runtime

- Status: complete
- Next: none
- Context: [Codex surface map](../../maps/codex-cli-sdk-app-server.md), [upgrade ledger](../../maps/codex-upgrade-ledger.md), [chat transport map](../../maps/2026-07-25-codex-chat-transport-architecture.md), [provider contract §5](../../maps/CLIde_Provider_Architecture_Current_Contract.md), and [ADR 0034](../../decisions/0034-codex-managed-native-runtime.md).

This branch pinned the bundled runtime to 0.147.0, made App Server question
timing consume the new native field, and routed every Codex facet through one
explicitly approved installation.

## Decisions — do not re-open these

- `isBlocking: true` waits indefinitely. `isBlocking: false` auto-answers with
  empty responses after `autoResolutionMs`, or 120 seconds when null. A missing
  field keeps the older timeout behavior.
- The native runtime is selected, never followed. Discovery cannot promote.
- Missing, changed, or incompatible selection means Codex unavailable; there is
  no silent bundled fallback.
- Browser mutations carry opaque installation ids, never executable paths.
- Chat, Shell, jobs, models, authentication, and usage use one installation.
- Active turns finish before a pending promotion recycles App Server.
- `approvalsReviewer: 'user'` remains explicit; `--approve-for-me` is unmapped.

## Phases

- [x] 1. **`isBlocking` honored without changing 0.146 behavior** — `448e1ab`,
  live-verified on 3002.

- [x] 2. **Pinned to 0.147.0** — `56bf5bf`. SDK, bundled CLI, platform packages,
  diagnostics, and drift contract moved together. Zero-time questions resolve
  inside Codex without changing Claude's shared no-timer contract. New and
  resumed Chat passed on 3002.

- [x] 3. **Codex MCP edits preserve unknown native keys** — `2a4a727`. Edits
  merge over the existing record and clear only Codex-owned fields. List, edit,
  and native re-read passed on 3002.

- [x] 4. **One reusable compatibility check** — `3c932a9`.
  `checkCodexAppServerCompatibility` validates any candidate executable and
  reports the first missing method or field.

- [x] 5. **One managed runtime serves every Codex facet** — `c0b8d5a`. A shared
  resolver persists the selected fingerprint and real path, seeds bundled on a
  new store, rejects silent fallback, and waits for idle before recycling Chat.
  Chat, Shell, models, and usage resolved one executable on 3002.

- [x] 6. **The account card checks, selects, and rolls back by installation** —
  `b0d4f54` plus the final client follow-up. Path-distinct installations expose
  row-local Check and Use, each Use stays locked until that row passes, compact
  paths disclose their full value, and Roll back selects the previous record.
  Check → Use → Roll back passed in the rendered 3002 UI.

- [x] 7. **Documents match reality.** ADR 0034 supersedes the opt-in transport
  decision; provider contract §5 defines approved selection instead of `PATH`
  precedence; current Codex, permission, capability, architecture, and upgrade
  maps record 0.147 behavior and evidence.

## Done when

- Build-mode 0.147 questions auto-resolve and Plan-mode questions wait.
- Reloading during a question preserves its request and timing state.
- Exact SDK/bundled pins and generated protocol compatibility pass automated
  checks.
- Codex MCP edits preserve unmodelled native keys.
- Two same-version installations remain distinct by path; Check gates Use;
  promotion changes every facet without interrupting an active turn; Roll back
  restores the previous selection.
- A broken approved executable reports unavailable rather than running bundled.
