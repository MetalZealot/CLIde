# Archived specifications

**`docs/specs/` is retired as a category** (2026-08-06). Active work now lives as
plans in [`../../plans/`](../../plans/), current-state reference in
[`../../maps/`](../../maps/), and decisions in [`../../decisions/`](../../decisions/),
under the caps in [the plan format](../../plans/README.md). This directory is the
frozen record of the spec era.

Nothing here is read by default. Archived documents are exempt from the size and
shape rules for exactly that reason — open one deliberately, when the index row
below says it holds something you need.

This directory holds completed, superseded, or historical CLIde specifications
that should remain available for provenance without crowding the active
implementation queue.

A spec belongs here when either:

- its implementation and required acceptance have been completed;
- its proposal was superseded or reverted and the current authority is linked;
  or
- its current contract has been extracted into a maintained document.

Before archiving a spec, update its status, repair inbound and relative links,
and move any completed backlog item to `docs/todo-done.md`. Archiving does not
mean that every possible follow-up in the same product area is complete; new
work should receive its own bounded TODO item or spec.

## Archive index

| Spec | Archived | Reason / current authority |
| --- | --- | --- |
| [Popup model persistence design](2026-07-13-popup-model-persist-design.md) | 2026-08-01 | Implemented in `d4cd982`, reverted in `cc9ba04`, and superseded by per-session model tracking. |
| [Files multi-selection and organization](2026-07-26-files-multi-selection-and-organization.md) | 2026-08-01 | Phases 1–3 merged in `63655cb`; desktop flow confirmed by Grayson. No separate touch-PWA claim is made. |
| [Context-usage live refresh](2026-07-28-context-usage-live-refresh.md) | 2026-08-01 | Both phases shipped in `c59de63` and `af82aad`; live behavior confirmed by Grayson. |
| [Settings information architecture](2026-07-28-settings-information-architecture.md) | 2026-08-01 | Implemented in `19d078a` through `41e77af`, corrected in `3b892ec`, and confirmed in the installed PWA. |
| [Browser MCP token-bloat investigation](2026-07-29-browser-mcp-tool-result-token-bloat-investigation.md) | 2026-08-01 | Investigation completed; fix `ef604c5` passed focused, build, and isolated live MCP verification. |
| [Upstream v1.37.0 integration](2026-07-29-upstream-1-37-integration.md) | 2026-08-04 | Integrated in `658d536`, deployed to port 3001, and accepted by Grayson. Its [Review 2026-07-30 harvest table](2026-07-29-upstream-1-37-integration.md#review-2026-07-30-what-upstream-ships-and-what-to-keep) remains the live authority for the open worktree-foundations TODO item. |
| [Provider Architecture Consolidation Spec](CLIde_Provider_Architecture_Consolidation_Spec.md) | 2026-08-01 | Historical audit; the maintained authority is the [current provider architecture contract](../../maps/CLIde_Provider_Architecture_Current_Contract.md). |
| [Git source-control and workspace UX](2026-07-26-git-source-control-workspace-ux.md) | 2026-08-06 | Split: identity model and truth gaps → [map](../../maps/repository-checkout-identity.md); phases → [plan](../../plans/source-control-truthfulness.md). Its 7.5 KB "Git mental model" chapter was deliberately not carried forward. |
| [Post-v1.37 Source Control and worktree review](2026-07-30-post-v1-37-source-control-worktree-review.md) | 2026-08-06 | Described the same sequence as the document above with a second, differently numbered set of phases. Merged into [the Source Control plan](../../plans/source-control-truthfulness.md). |
| [Post-v1.37 WebSocket liveness review](2026-07-30-post-v1-37-websocket-liveness-review.md) | 2026-08-06 | Fully carried into [the liveness plan](../../plans/websocket-liveness.md); its "why this is deferred" section is moot now v1.37 has merged. |
| [Browser MCP hardening](2026-07-29-browser-mcp-hardening.md) | 2026-08-06 | → [plan](../../plans/browser-mcp-hardening.md). Full tool-contract schemas and the verification matrix were dropped; regenerate them at implementation time against the then-current code. |
| [MCP scope storage collisions](2026-07-30-mcp-scope-storage-collisions.md) | 2026-08-06 | → [plan](../../plans/mcp-scope-storage-collisions.md). The detailed per-provider test plan was dropped in favour of naming the six cases. |
| [Commit-message model selection](2026-07-29-source-control-commit-message-model-selection.md) | 2026-08-06 | → [plan](../../plans/commit-message-model-selection.md). The API schemas, Settings-screen layout, and preference-reconciliation tables were dropped; rebaseline them on the post-v1.37 Git module. |
| [Opt-in diagnostics flight recorder](2026-08-01-opt-in-diagnostics-flight-recorder.md) | 2026-08-06 | → [plan](../../plans/diagnostics-flight-recorder.md), trimmed hard at Grayson's request. The full baseline event model and privacy boundary live here if the design is revisited. |
| [Typography system](2026-07-20-typography-system.md) | 2026-08-06 | → [plan](../../plans/typography-system.md). Near-verbatim; only the study recap was dropped. |
| [Background-session notifications](2026-07-21-background-session-notifications.md) | 2026-08-06 | → [plan](../../plans/background-session-notifications.md). The transport trace and the two-flavour build-up were dropped; the plan keeps the resulting order. |
| [Self-hosted voice (whisper.cpp + Piper)](2026-07-21-self-hosted-voice-piper-whisper.md) | 2026-08-06 | Not app code — no `src/` or `server/` change is needed to use voice. Moved to the host-local `CLAUDE.md`, where its paths, units, and deploy steps belong. Its status was also stale: much of the stack is built, but CLIde was never wired to it. |
| [Post-v1.37 remaining work](2026-08-04-post-v1-37-remaining-work.md) | 2026-08-06 | Its queued items became individual plans and its ordering became [the plans board](../../plans/README.md); the two open decisions became [the ADR reassessment plan](../../plans/post-v1-37-adr-reassessment.md). |
| [Pinned legacy model catalog](2026-07-26-pinned-legacy-model-catalog.md) | 2026-08-06 | Not pursued — Grayson's call, since older models lose access anyway. Its one durable finding, the alias-resolution trap that breaks `resolveClaudeModelAlias` for any non-alias id, is in [code anchors](../../maps/code-anchors.md). |
| [Chat picker state and Shell synchronization](2026-07-26-chat-picker-state-and-shell-sync.md) | 2026-08-06 | Fix not queued. The defect survey — effort keyed per provider not per session, unpromoted permission keys, the disconnected Settings value, no requested-versus-effective distinction — is in [code anchors](../../maps/code-anchors.md) as current behaviour. |
| [Agentic coding UX reference](2026-07-25-agentic-coding-ux-reference.md) | 2026-08-06 | Its "CLIde today" and capability sections duplicated [the provider capability map](../../maps/clide-provider-capability-map.md) and were free to drift. Still worth opening deliberately before a large UI reshape for its eight product principles (task lifecycle, tangible context, legible run state, changes as artifacts, one recovery contract, attention before parallelism, visible provider strengths, the mobile advantage). |
| [Typography study](2026-07-20-typography-study.md) | 2026-08-06 | The claude.ai-era study written without codebase context. Superseded by [the typography plan](../../plans/typography-system.md); read it only for the family rationale (why Figtree over Manrope, why Iosevka over JetBrains Mono). |
| [Post-v1.37 main divergence and merge handoff](2026-08-01-post-v1-37-main-divergence-and-merge-handoff.md) | 2026-08-04 | v1.37 merged (`658d536`), deployed to 3001, and its model-picker follow-up closed by [ADR 0025](../../decisions/0025-session-model-picks-live-in-the-database.md). Open items continue in [Post-v1.37 remaining work](2026-08-04-post-v1-37-remaining-work.md). |
