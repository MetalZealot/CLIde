# Codex CLI, SDK, and App Server upgrade ledger

This is the compact decision history for Codex runtime upgrades in CLIde.

- The [living surface map](2026-07-24-codex-cli-sdk-surface-map.md) is the
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
