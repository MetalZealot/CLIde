# Post-v1.37: two ADR decisions left

- Status: complete
- Next: nothing — both decisions are settled; ADRs 0011, 0012 and 0016 all stand.
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

- [x] **2. Does the Codex App Server transport earn its maintenance?** (ADRs 0011
      and 0012.) Yes — retained as the default Chat transport, decided 2026-08-13.
      Collaboration modes, permission requests, rewind and fork are all gated on it
      in `provider-capabilities.service.ts`; the SDK path cannot express them, so
      reverting the default is a feature removal, not a simplification. The
      maintenance premise was also wrong: of 18 commits touching these files since
      2026-07-01, twelve add features, three are SDK version bumps, and three are
      breakage fixes clustered on the v1.37 merge. Drift is guarded by
      `codex-app-server-compatibility.ts`, which asserts against Codex's own
      generated schema. The standing hazard is unchanged — upstream cannot see this
      code, so rebases break it in files that merge cleanly (`3e84bd7`), which is
      an argument for those contract tests, not against the transport.

## Done when

Each has either produced a superseding ADR or been confirmed by making the
existing one true. Neither should sit as a standing question for another release.
