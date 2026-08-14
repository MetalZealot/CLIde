# Post-v1.37: two ADR decisions left

- Status: 1/2
- Next: decide whether the Codex App Server transport earns its maintenance as the
  *default* Chat transport.
- Context: v1.37 is merged (`658d536`), deployed, and accepted; the model-picker
  storage divergence closed via [ADR 0025](../decisions/0025-session-model-picks-live-in-the-database.md).
  Everything else v1.37 left behind now has its own plan — see
  [the board](README.md).

Both of these are a yes/no, not a build. They are what remains of the v1.37
follow-up queue after the queued work moved into its own plans.

## Phases

- [x] **1. Is ADR 0016 true, or should it be superseded?** True — no superseding
      ADR needed. Repository identity ships as
      `server/modules/projects/services/repository-identity.service.ts`, deriving
      `--git-common-dir` per checkout, and the sidebar groups by it (`175c25a`,
      ADRs 0028/0029/0033/0035). The remaining Git-panel truthfulness gaps 0016
      names are the [Source Control plan](source-control-truthfulness.md)'s
      Phase 0, which this no longer blocks.

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
