# Codex CLI, SDK, and App Server upgrade ledger

This is the compact decision history for Codex runtime upgrades in CLIde.

- The [living surface map](codex-cli-sdk-app-server.md) is the
  current source of truth for capability mapping and integration destinations.
- This ledger records what changed in each audited release, what CLIde decided,
  and what verification remains.
- Full generated bindings, raw help output, and exhaustive diffs are temporary
  audit artifacts. Git history preserves detailed changes to the living map.

## Entry format

Each stable upgrade records:

- previous and target compatibility pair;
- OpenAI release, compare, tagged source, and current-doc sources;
- SDK, CLI, App Server protocol, and behavioral changes;
- disposition: integrated, mapped candidate, compatibility watch, or no action;
- CLIde commit, automated verification, isolated smoke, and production state.

## Baseline survey — 2026-07-24

- **Observed:** standalone CLI 0.145.0, installed SDK 0.144.6, and a repository
  range/lockfile older than both. The original survey established that the
  TypeScript SDK wraps `codex exec --json` while App Server is the rich-client
  protocol.
- **Decision:** treat SDK plus bundled CLI/App Server as one exact compatibility
  unit; generate bindings from the binary CLIde will ship.
- **Result:** led to the App Server transport, ADR 0011, the curated protocol,
  and the generated drift test.

## 0.145.0 — 2026-07-26

- **From/to:** SDK/bundled CLI 0.144.6-era integration to an exact 0.145.0 pair.
- **Sources:** [release](https://github.com/openai/codex/releases/tag/rust-v0.145.0),
  [tagged SDK](https://github.com/openai/codex/tree/rust-v0.145.0/sdk/typescript),
  generated default/experimental App Server bindings, and official docs.
- **Material changes:** `thread/fork.beforeTurnId` enabled direct
  edit-before-turn rewind; token usage added `cacheWriteInputTokens`.
- **Disposition:** integrated both consumed fields; pinned SDK/CLI and all
  platform packages; exposed SDK and bundled CLI versions in diagnostics.
- **CLIde commit:** `cd3b710`.
- **Verification:** 31 focused Codex tests, typecheck, lint, client/server
  builds, SDK import, bundled CLI checks, and isolated live App Server
  new/resumed Chat plus SDK-fallback smoke passed.
- **Production state at close:** port 3001 intentionally untouched during the
  isolated verification.

## 0.146.0 — 2026-07-29

- **From/to:** exact SDK/bundled CLI 0.145.0 to 0.146.0.
- **Sources:** [release](https://github.com/openai/codex/releases/tag/rust-v0.146.0),
  [compare](https://github.com/openai/codex/compare/rust-v0.145.0...rust-v0.146.0),
  [tagged SDK](https://github.com/openai/codex/tree/rust-v0.146.0/sdk/typescript),
  [tagged protocol](https://github.com/openai/codex/tree/rust-v0.146.0/codex-rs/app-server-protocol),
  generated default/experimental bindings, and official docs.
- **SDK:** public declarations unchanged; package and bundled runtime versions
  only.
- **CLI:** top-level and `exec` help unchanged; App Server added
  `--code-mode-host <WS_URL>`.
- **App Server:** default client requests increased from 92 to 93 and
  experimental requests from 129 to 130; server requests and notifications
  remained 10/11 and 72. Additions and enrichments include native thread
  pinning, external-import history attribution/recording, managed requirement
  fields, plugin/app/skill metadata, and trusted plugin-script attribution.
- **Disposition:** no consumed Chat-contract change required. Native pinning is
  mapped as a candidate bridge to CLIde stars; plugin attribution and expanded
  requirements are compatibility watches/deferred integration inputs; remote
  Code Mode is no action for the current local-runtime boundary.
- **Behavioral watches:** proxy routing, MCP refresh/reconnection, interrupted
  message/final-response preservation, imported timestamps, and fork history.
- **CLIde commit:** `d4cb53b`.
- **Automated verification:** 31 focused Codex tests, typecheck, lint, server
  build, SDK import, bundled ARM64 CLI version, and a read-only account-usage
  App Server handshake passed. The focused generated-protocol test was rerun
  2026-07-30 and passed 2/2.
- **Production state checked 2026-07-30:** the running App Server reports
  `codex-cli 0.146.0` and port 3001 returns HTTP 200. Post-restart installed-app
  new-chat and resumed-chat smoke remains to be recorded.

## 0.147.0 — 2026-08-12

- **From/to:** exact SDK/bundled CLI 0.146.0 to 0.147.0; bundled and standalone
  targets both report 0.147.0 but remain distinct installations by path.
- **Sources:** [release](https://github.com/openai/codex/releases/tag/rust-v0.147.0),
  [compare](https://github.com/openai/codex/compare/rust-v0.146.0...rust-v0.147.0),
  [tagged SDK](https://github.com/openai/codex/tree/rust-v0.147.0/sdk/typescript),
  [tagged protocol](https://github.com/openai/codex/tree/rust-v0.147.0/codex-rs/app-server-protocol),
  generated default/experimental bindings, and official docs.
- **SDK/CLI:** the pair and platform packages are pinned to 0.147.0. The CLI
  adds portable plugin/search and `--approve-for-me` surfaces, import/sync work,
  and removes `codex exec --full-auto`; CLIde retains explicit user review and
  explicit sandbox/approval mappings.
- **App Server:** default client requests increased from 93 to 98 and
  experimental requests from 130 to 136; server requests and notifications
  remain 10/11 and 72. Structured questions add consumed `isBlocking` timing;
  persistent ordered sections replace native pinning as the current metadata
  opportunity. MCP 2026-07-28 and plugin/import surfaces remain watches or
  deferred work.
- **Integrated:** Codex handles zero-time auto-resolution locally without
  changing Claude's shared no-timer contract; MCP edits preserve unknown native
  keys; one compatibility checker guards the committed protocol and promotion;
  one approved installation supplies Chat, Shell, jobs, models, auth, and usage.
- **CLIde commits:** `56bf5bf` (pin and question semantics), `2a4a727` (MCP
  preservation), `3c932a9` (compatibility guard), `c0b8d5a` (managed resolver),
  and `b0d4f54` (selection UI and routes).
- **Automated verification:** focused compatibility/runtime/UI coverage, full
  server and client suites, typecheck, lint, and client/server builds passed
  during the phased rollout.
- **Isolated live evidence:** on 3002, new/resumed Chat passed after the pin;
  Chat, Shell, model list, and account usage resolved the same executable; Check,
  Use, mid-turn idle promotion, and Roll back changed selection without
  interrupting the running turn.
- **Production state:** port 3001 was intentionally untouched; branch-server
  evidence is not production acceptance.

## SDK and CLI 0.150.0 — 2026-08-26

- **SDK/CLI:** the pin moves 0.147.0 → 0.150.0; `@openai/codex` follows as a
  transitive dependency. `ThreadOptions` adds `threadSource`, `CodexOptions`
  adds raw `configOverrides`, and `ModelReasoningEffort` gains `max` and
  `ultra`.
- **App Server:** the committed subset regenerates and verifies unchanged
  against 0.150.0. Generated experimental client requests grew 136 → 156 and
  notifications 72 → 81 in both modes; default client requests (98) and server
  requests (10/11) held. Nothing new is consumed.
- **Models.** The live cache now lists `gpt-5.6-sol`, `-terra` and `-luna`
  alongside 5.5/5.4/5.4-mini; the first two support `ultra`, Luna stops at
  `max`. The live path already carried these through, since each model's own
  `supported_reasoning_levels` outranks any local list. Both stale fallbacks
  were refreshed to match: the server catalog and the client's per-provider
  effort floor.
- **One pinned literal.** `EXPECTED_CODEX_VERSION` in the drift contract is now
  the only place the version is asserted; the transport-diagnostics test reads
  the installed packages instead of repeating it.
- **Dispositions recompiled at 0.150.0**, across the 0.148.0–0.150.0 notes.
  - **The thread store moved.** `~/.codex/session_index.jsonl` no longer exists
    on a current install; `~/.codex/state_*.sqlite` holds a `threads` table with
    `title`, `archived`, `updated_at`, `cwd`, `model` and `reasoning_effort`.
    Upstream's own test removes the JSONL and asserts naming still resolves from
    SQLite, so it is a legacy mirror. CLIde's Codex name lookup reads that path
    and silently gets nothing, falling through to the last agent message.
    **Candidate** — and the filename carries a schema counter, so a reader must
    resolve the newest `state_*.sqlite`.
  - **`Interrupt` hooks are not a candidate.** A hook is the runtime's own
    extension point in the user's `config.toml`; CLIde issues the abort itself
    and already knows the turn ended. The 0.150.0 entry above called them one;
    that reading was wrong.
  - **The resume permission-profile fix is invisible here, verified.**
    `resumeThread` is always passed a `sandboxMode`/`approvalPolicy` derived from
    the composer's mode, and CLIde keeps its own per-session mode. Coherent,
    except that the store is `localStorage`: the same session resumed on another
    device falls back to the provider-wide last mode.
  - **Candidate:** per-thread credits and cost, which `/status` gained at 0.148
    and CLIde has no Codex equivalent for.
  - The rest is TUI, Vim, Windows sandbox, Bedrock and free runtime fixes with
    no CLIde surface.
- **Verification:** typecheck, lint, 520 server and 262 client tests, 0
  failures; `build` clean. Not yet exercised in a live Codex turn.

## 0.150.0 → 0.152.1 — 2026-09-01

- **Version set:** pin `@openai/codex-sdk` 0.150.0 → 0.152.1, with
  `@openai/codex` 0.152.1 transitively; the standalone install on `PATH` moved
  0.149.1 → 0.152.1. `EXPECTED_CODEX_VERSION` moved with them, and the
  app-server protocol drift test passes unchanged at 0.152.1 — no Chat method or
  field CLIde depends on moved.
- **The planning tool is off by default at 0.152.0** (`tools.update_plan.enabled`).
  CLIde already lists `update_plan` among the hidden exec-control wrappers, so
  it silently stops appearing rather than breaking. **No action.**
- **Package-style MCP server names** (`:`, `@`, `/`, `.`) are accepted
  throughout at 0.152.0. CLIde does not validate the name at all and writes
  `mcp_servers` through `@iarna/toml`, which quotes a dotted key correctly, so
  such names already round-trip. **No action, verified by inspection.**
- **Candidates.**
  - `thread/shellCommand` timeouts are now configurable by app-server clients,
    including deadlines past an hour (0.152.0). CLIde is an app-server client and
    sets none, so long commands sit on the default.
  - Per-MCP-tool `output_token_limit` with truncation held consistent across
    resumes (0.152.0) — the Codex counterpart of the Claude per-server timeout
    candidate.
- **Watches.**
  - Nested subagent token usage now counts toward root goal budgets (0.151.0);
    CLIde's Codex usage totals may read differently from 0.150.0's for the same
    work.
  - Remote sandbox enforcement moved onto the executor's real home directory, OS
    and path conventions, and `/cd` can no longer weaken sandbox restrictions
    (0.151.0). CLIde derives `sandboxMode` per turn from the composer's mode; the
    permission-mode map's Codex rows are still measured at 0.147.0.
- **Extensions processing MCP tool results (0.151.0) is not a candidate** — it is
  the runtime's own extension point, the same reading applied to `Interrupt`
  hooks at 0.150.0.
- **Post-upgrade regression:** 0.152.1 stopped writing the duplicate
  `event_msg/user_message` row. The canonical response-item user row remained,
  but CLIde's reload and session-title paths ignored it. Both now accept the
  canonical row after `turn_context`. The first fix exposed pre-0.152 rollouts'
  per-turn `<environment_context>` row as a user bubble and showed each older
  prompt twice (the legacy row lands ~1 ms after the canonical one); both paths
  now skip Codex's injected wrapper tags and dedupe by content within a turn.
- **Usage-limit failures showed three times.** App Server sends an `error`
  notification and a failed `turn/completed` for one failure, and the
  notification's object body rendered as a JSON block; the transport now emits
  one text error per turn. The third copy seen live on 2026-09-01 is
  unexplained until the next limit is captured with the fix deployed.
- The rest is TUI, Vim, Windows sandbox, Guardian and rate-limit-banner work
  with no CLIde surface.
- **Verification:** the post-regression gate passed 566 server and 303 client
  tests, the 314-check Codex integration suite, server typecheck/build, lint
  with no errors, and exact snapshot reloads of five affected transcripts.
  Grayson then confirmed the restored messages by reopening affected sessions
  on the isolated port-3006 server. Production acceptance remains separate.

## 0.152.1 → 0.153.4 — 2026-09-06

- **Sources:** [official changelog](https://learn.chatgpt.com/docs/changelog),
  [0.153.4 release](https://github.com/openai/codex/releases/tag/rust-v0.153.4),
  [compare](https://github.com/openai/codex/compare/rust-v0.152.1...rust-v0.153.4),
  [tagged SDK](https://github.com/openai/codex/tree/rust-v0.153.4/sdk/typescript),
  [tagged protocol](https://github.com/openai/codex/tree/rust-v0.153.4/codex-rs/app-server-protocol),
  the [GPT-6-Astra guide](https://developers.openai.com/api/docs/guides/latest-model),
  and OpenAI's post-tag [TUI answer/queue implementation](https://github.com/openai/codex/pull/42903).
- **Version set:** exact SDK and transitive bundled CLI pins move together to
  0.153.4. The discovered standalone CLI already reports 0.153.4.
- **Protocol and SDK:** generated method counts move to 102/10/83 by default and
  158/11/83 with experimental features. The sole method addition is deferred
  `plugin/reconcile`; the curated contract now also guards the async-question
  fields CLIde consumes. Published SDK declaration differences are comments only.
- **Integrated:** the runtime model catalog now exposes `gpt-6-astra` first and
  as default, with low through ultra reasoning. Dynamic discovery needed no
  change; the offline server catalog and client's pre-catalog seed now match.
  Existing sessions remain governed by transcript/provider truth.
- **Dispositions:** asynchronous structured questions use separate
  `agentMessage.questions` metadata; CLIde preserves it through live delivery
  and transcript reload. CLIde now presents each pending question sequentially
  above the composer, preserves its draft and handled state across reload,
  steers an accepted answer into the active turn, or persists it in a separate
  FIFO that releases one answer per later turn. The original transcript card
  remains the durable informational record rather than the input owner.
  Thread-reported model/effort does not replace transcript truth. Remote plugins
  and experimental context management remain deferred; TUI, Bedrock listing,
  and Fast-mode copy changes need no shared UI.
  Guardian, MCP approval, reconnect, fork, compaction, and subagent fixes are
  inherited compatibility watches covered by regression smoke.
- **Automated verification:** the 332-check Codex gate, typecheck, lint with no
  errors, client/server build, docs check, package/version report, and generated
  protocol measurement pass.
- **Isolated live evidence:** Grayson confirmed the Astra default, a successful
  new Chat session, and the async-question card with all suggested answers on
  mobile. Three fresh desktop Chats then confirmed that Send now enters the
  active turn without stopping its work, Queue waits for natural completion,
  and a queued composer message runs before a queued async answer. All three
  fresh transcripts had no fork parent; rewinding one remapped its sole CLIde
  row to a native child carrying the original thread as `forked_from_id`.
  The focused 32-client regression file now covers the queue collision; the
  requested 23-client and 21-server checks plus client typecheck pass from the
  checkout shell. The same commands initially could not start inside these live
  turns because the branch-test fake home lacked shell startup files: login Bash
  replaced the inherited Node 24 path with Debian's Node 20 path, where npm is
  absent. The host harness now generates minimal `.profile` and `.bashrc` files
  restoring its selected Node directory; both slots and an ephemeral low-effort
  Codex execution returned npm 11.13.0 without linking worktree dependencies.
  After rebasing onto the complete rewind-lineage fix and rebuilding slot B, one
  low-effort Auto-in-Workspace Chat ran npm 11.13.0, retained its single CLIde
  id and tool rendering across reload and resume, then explicit `/fork` created
  a separate CLIde row whose native `forked_from_id` points to the parent. The
  service ran the checkout-bundled Codex App Server 0.153.4 throughout.
  Broader conformance rows and production deployment remain separate, and
  production is unchanged.
