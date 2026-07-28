# 0014 — The context ring's ceiling is read from the SDK, not derived

- Date: 2026-07-27
- Status: Accepted

## Decision

The token ring's denominator comes from the SDK's own `getContextUsage()`
control request, cached per session by `claude-context-usage.ts`. The request is
fired once per turn and never awaited inline. `resolveClaudeContextCeiling`
(`claude-context-window.ts`) — which derives a ceiling from a hand-mirrored copy
of the SDK's model registry — is demoted to the **fallback** for history reads
and sessions that have not streamed a turn since the process started. The
`CONTEXT_WINDOW` env var still outranks both, as the operator escape hatch.

Where the fallback's arithmetic is asymmetric — the full window below 1M, minus
a 33,000 reserve at 1M — that asymmetry is **calibrated against measurements**,
not recovered from the CLI. It is deliberate; do not "simplify" it.

## Rejected

- **A flat constant.** `CONTEXT_WINDOW || 160000` for every model, which is what
  all three token paths used before `73214c5`. Wrong for every model, and badly
  wrong for the 1M ones (a 121,711-token Opus 5 session read 76% full).
- **Deriving the ceiling as the primary source.** Tried and shipped in
  `73214c5`: mirror the SDK's registry table, reimplement Claude Code's decoded
  algorithm (registry window → auto-compact caps → a 200,000 model-default clamp
  that skips 1M models → subtract the reply budget). It was contradicted by
  measurement within a day.
- **Calling `getContextUsage()` at the terminal `result` message, or after the
  turn.** Both fail; see below.
- **Awaiting the call inside the message loop.** It costs ~1s; every streamed
  frame would queue behind it.

## Why

The derivation was wrong in *both* directions, and its errors did not share a
sign, so no constant correction would have fixed it. Measured with
`scripts/verify-context-usage-sdk.ts` against SDK 0.3.220:

| model | derived (`73214c5`) | SDK `maxTokens` | `autoCompactThreshold` |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | 180,000 | **200,000** | 167,000 |
| `claude-sonnet-5` | 980,000 | **967,000** | 934,000 |

Claude Code holds back no reply reserve at all on a 200K window, and takes
33,000 off the 1M one. `claude-sonnet-5`'s registry `context.window` really is
`1e6` (verified in `sdk.mjs`), so the 967,000 is Claude Code's own subtraction,
not a registry value — the mirrored table was accurate and the *arithmetic on
top of it* was the bug. That is the general problem with the derivation: it
reimplements someone else's private algorithm from the outside, so it can rot
without the table rotting.

Two constraints from the same probe explain the caching:

- The control request only answers **mid-turn**. At the terminal `result`
  message the transport is already closing (`Query closed before response
  received`), and once the generator returns the query is gone
  (`ProcessTransport is not ready for writing`).
- It costs 780–1200ms.

So a turn cannot be billed for it synchronously, and an idle session has nothing
to ask — hence fire-and-forget plus a cache, and hence the derived fallback
survives rather than being deleted.

The request works against the bare **string** prompt the send path already uses,
despite the SDK typing control requests as "only supported when streaming
input/output is used". That is what made this affordable: no migration of the
send path was needed.

Bonus, and the reason this is worth more than 2% accuracy: `autoCompactThreshold`
was not obtainable any other way. The ring now knows where the conversation gets
summarised out from under the user, which is the real end of the road — not the
window. Shipped in `0267856`.
