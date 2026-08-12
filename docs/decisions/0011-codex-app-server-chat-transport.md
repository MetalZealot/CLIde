# 0011 — Codex App Server is the opt-in interactive Chat transport

- Date: 2026-07-25
- Status: Superseded by 0034

## Decision

CLIde uses a backend-owned, long-lived `codex app-server` JSONL stdio process
for interactive Codex Chat only when
`CLIDE_CODEX_CHAT_TRANSPORT=app-server`; the TypeScript SDK remains the
default. CLIde's `session_id` stays app-facing and stable, while the App Server
thread id is persisted as `provider_session_id`. The first rollout includes
core thread/turn parity, Plan collaboration mode, structured questions, and
interactive approvals; initialization may fall back to the SDK only before
App Server has accepted any thread or turn work.

## Rejected

- Replacing the SDK transport immediately, before isolated and live rollout
  verification.
- Exposing App Server's experimental WebSocket directly to browsers.
- Treating the provider thread id as CLIde's public session identity.
- Falling back to the SDK after a thread/turn has been accepted, which can
  execute one user instruction twice.
- Making the short-lived account-usage reader share Chat's long-lived process;
  usage remains independently bounded and disposable.

## Why

The TypeScript SDK wraps `codex exec --json` and cannot round-trip the
approvals or structured questions a first-class CLIde Chat needs. App Server
is Codex's rich-client protocol, while CLIde's authenticated WebSocket and
stable session mapping already provide the correct browser and persistence
boundaries. Pinning the SDK and its bundled CLI to 0.144.6, checking in a
curated typed subset, and regenerating bindings in a drift test make the
experimental Plan field explicit without coupling CLIde to the full generated
surface. The opt-in flag and startup-only SDK fallback keep the first release
reversible without risking duplicate turns.
