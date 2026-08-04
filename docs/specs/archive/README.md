# Archived specifications

This directory holds completed, superseded, or historical CLIde specifications
that should remain available for provenance without crowding the active
implementation queue in the parent `specs/` directory.

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
| [Post-v1.37 main divergence and merge handoff](2026-08-01-post-v1-37-main-divergence-and-merge-handoff.md) | 2026-08-04 | v1.37 merged (`658d536`), deployed to 3001, and its model-picker follow-up closed by [ADR 0025](../../decisions/0025-session-model-picks-live-in-the-database.md). Open items continue in [Post-v1.37 remaining work](../2026-08-04-post-v1-37-remaining-work.md). |
