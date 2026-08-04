# Cross-provider chat handoff

- Date: 2026-08-04
- Status: Deferred implementation spec; re-verify before coding.
- Goal: start a new CLIde chat with another provider/model, seeded with a
  safe, chat-only projection of a selected source conversation.

## Product boundary

Handoff creates a **new** stable CLIde session in the source session's project
and leaves the source untouched. It is not a provider-native resume, rewind, or
fork. The new session must appear in the sidebar before its first target-provider
turn, then navigate to it and continue normally.

The handoff UI chooses target provider and model, then offers a bounded source
range (full conversation, last *N* turns, or through a selected turn). Its first
version transfers only authored user and assistant text, in chronological order.
It excludes thinking, tool calls/results, permission and collaboration plumbing,
and subagent activity. Do not silently truncate an over-budget handoff: show the
estimate and require a smaller range or an explicit future summarization flow.

Do not reuse the upstream **Export as** menu as the transport. It is a
client-side archive formatter over the currently loaded message list, not a
provider-neutral complete-history projection.

## Current evidence to re-verify

- `POST /api/providers/sessions` already allocates a new app-owned session id
  before any `chat.send`; the normal new-chat flow then places it in the URL and
  sidebar. Re-check this contract and its watcher/replay behavior.
- `sessionsService.fetchHistory` and the provider session adapters can read
  persisted histories, but verify every provider's normalization for a
  projection that contains only real user/assistant turns. Do not build from a
  paginated browser list.
- Model selection belongs to the target provider's normal send path. Confirm
  current ready/auth/capability checks and each target runtime's text-input
  limit before promising every provider/model.
- ADR 0012's same-provider fork identity rules remain separate. A durable
  parent-handoff relation is not required for the first version; if one is
  wanted, make an explicit schema/ADR decision rather than overloading
  `provider_session_id` or provider-native fork metadata.

## Minimal implementation plan

1. Add a tested server-side transcript projector with provider fixtures:
   user/assistant only, chronological, bounded, and no tool/output leakage.
2. Add a thin handoff endpoint/service that validates a finished source and a
   ready target, allocates the target session, and returns the projected initial
   prompt plus its size estimate. Use the existing session gateway; do not
   change its source-to-provider-id mapping.
3. Add a restrained `Handoff...` action beside export: target provider/model,
   range, estimate/error state, then create, navigate, and send through the
   ordinary chat path. Title the new session `Handoff: <source title>`.
4. Verify with real Claude and Codex sessions first, then the enabled
   Cursor/OpenCode targets. Check source immutability, one new sidebar row,
   model selection, complete expected chat context, excluded tool data, a
   context-limit refusal, refresh/reopen, and installed-PWA behavior.

## Out of scope

Raw tool-trace transfer, automatic LLM summarization, cross-provider native
resume, file-state/checkpoint transfer, and a permanent lineage graph. Each
needs its own privacy, size, and provider-semantics decision.

## References

- [ADR 0012: Codex rewind and fork session identity](../decisions/0012-codex-rewind-and-fork-session-identity.md)
- [Provider session gateway](../../../server/modules/providers/services/sessions.service.ts)
- [Upstream export formatter](../../../src/components/chat/utils/chatExport.ts)
