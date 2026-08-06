# Post-v1.37: two ADR decisions left

- Status: 0/2
- Next: decide ADR 0016 — build Phase 0 so its `Accepted` status becomes true, or
  write a superseding ADR recording the deferral.
- Context: v1.37 is merged (`658d536`), deployed, and accepted; the model-picker
  storage divergence closed via [ADR 0025](../decisions/0025-session-model-picks-live-in-the-database.md).
  Everything else v1.37 left behind now has its own plan — see
  [the board](README.md).

Both of these are a yes/no, not a build. They are what remains of the v1.37
follow-up queue after the queued work moved into its own plans.

## Phases

- [ ] **1. Is ADR 0016 true, or should it be superseded?** Status says `Accepted`,
      yet there is no `git-common-dir` or `commonDir` anywhere in `server/`,
      `src/`, or `shared/` (re-verified 2026-08-04), and it is what blocks adopting
      upstream's worktrees module. The exit originally proposed — "downgrade it to
      Proposed" — **is not available**: [the decision log](../decisions/README.md)
      is append-only and recognises only `Accepted` or `Superseded by NNNN`. The
      two exits that fit are to build
      [Phase 0 of the Source Control plan](source-control-truthfulness.md) so the
      status becomes true, or to write a superseding ADR recording the deferral
      and harvest upstream's `listWorktrees` descriptor and test harness under it.
      **Blocks the Source Control plan.**

- [ ] **2. Does the Codex App Server transport earn its maintenance?** (ADRs 0011
      and 0012.) **Reframed 2026-08-04 — the original "it is opt-in" premise was
      stale.** Since `cbf2960` it is the *default* interactive Chat transport:
      `getConfiguredCodexChatTransport` (`codex-chat-transport-state.ts`) returns
      `app-server` unless `CLIDE_CODEX_CHAT_TRANSPORT=sdk`, and the SDK path is
      described in its own comment as an explicit emergency escape hatch. So this
      is not "drop a side experiment" — it is "revert the default path to the
      escape hatch". It is 1,840 lines behind 1,005 lines of tests, with a startup
      fallback to the SDK already built in. Against: upstream does not know it
      exists, and it broke during the v1.37 merge because upstream changed a
      runtime contract it could not see (`3e84bd7`). For: see
      [the transport architecture map](../maps/2026-07-25-codex-chat-transport-architecture.md)
      — its own outstanding work is verification, not code.

## Done when

Each has either produced a superseding ADR or been confirmed by making the
existing one true. Neither should sit as a standing question for another release.
