# Archived plans

Nothing here is read by default. Completed plans are frozen; current behavior belongs in source, tests, maps, and ADRs.

| Plan | Archived | Current authority |
|---|---|---|
| [Auto-Continue offered, remembered, and defaulted](2026-09-29-auto-continue.md) | 2026-09-29 | [Code anchors](../../maps/code-anchors.md) and Auto-Continue source/tests; live limit stops accepted on Claude and Codex |
| [Chat shows activities, not raw tool calls](2026-09-29-tool-activity-display.md) | 2026-09-29 | [ADR 0059](../../decisions/0059-activity-operations-expand-inline-on-every-screen.md), [ADR 0060](../../decisions/0060-a-calls-detail-opens-flat-in-place.md), [tool activity map](../../maps/tool-activity-stream.md) |
| [A running turn shows what the provider is actually doing](2026-09-29-turn-liveness-and-usage-warnings.md) | 2026-09-29 | [Tool activity map](../../maps/tool-activity-stream.md), [Claude SDK](../../maps/claude-agent-sdk.md) and [Codex surface](../../maps/codex-cli-sdk-app-server.md) maps |
| [Context-correct skills settings](2026-09-29-skills-settings-discovery-scope.md) | 2026-09-29 | [ADR 0018](../../decisions/0018-settings-drill-down-one-scroll-container.md), [ADR 0040](../../decisions/0040-settings-root-owns-back-gesture.md), and source/tests |
| [Self-hosted dictation and read-aloud](2026-09-29-self-hosted-voice.md) | 2026-09-29 | [ADR 0050](../../decisions/0050-voice-runtime-owns-shared-settings.md), [ADR 0051](../../decisions/0051-voice-studio-is-a-standalone-personal-tool.md), and the voice shim README |
| [Auditable text-to-speech preparation](2026-09-29-tts-speech-front-end.md) | 2026-09-29 | Speech front-end source and tests; [pronunciation findings](../tts-pronunciation-findings.md) |
| [`/btw` side questions](2026-09-29-side-questions.md) | 2026-09-29 | Side-question source and focused tests |
| [One Tools page per provider](2026-09-29-provider-tools-page.md) | 2026-09-29 | [ADR 0018](../../decisions/0018-settings-drill-down-one-scroll-container.md) and source/tests; controls are a [TODO item](../../TODO.md) |
| [Scheduled messages and Auto-Continue](2026-09-29-scheduled-messages.md) | 2026-09-29 | [Upstream sync map](../../maps/upstream-sync.md), [the edit model plan](../message-edit-model.md), and source/tests |
| [Upstream v1.37.3 sync](2026-09-29-upstream-1373-sync.md) | 2026-09-29 | [Upstream sync map](../../maps/upstream-sync.md) |
| [Phone chat text selection](2026-09-29-mobile-chat-page-scroll.md) | 2026-09-29 | [ADR 0056](../../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md) and source/tests |
| [Codex usage-limit resets](2026-09-13-codex-usage-limit-resets.md) | 2026-09-13 | [Provider capability map](../../maps/clide-provider-capability-map.md), Codex provider source and focused tests |
| [Mobile bottom navigation](2026-09-13-mobile-bottom-navigation.md) | 2026-09-13 | [ADR 0048](../../decisions/0048-mobile-navbar-five-roles-plugin-overflow.md), UI source and focused client tests |
| [Find text in the open Chat](2026-09-11-find-in-chat.md) | 2026-09-11 | Find-in-Chat source and focused client tests |
| [Playwright MCP bridge with a monitored Browser tab](2026-09-08-browser-mcp-hardening.md) | 2026-09-08 | [ADR 0053](../../decisions/0053-browser-tools-are-official-playwright-mcp-over-http.md) and source/tests |
| [Bounded, lazy project files](2026-08-30-lazy-file-tree-loading.md) | 2026-08-30 | [ADR 0049](../../decisions/0049-file-tree-loads-folders-not-projects.md) and source/tests |
| [Provider upgrade debt](provider-upgrade-debt.md) | 2026-08-27 | [Claude](../../maps/claude-upgrade-ledger.md) and [Codex](../../maps/codex-upgrade-ledger.md) ledgers, the [command surface](../../maps/claude-command-surface.md) and [Codex surface](../../maps/codex-cli-sdk-app-server.md) maps, and source/tests |
| [HTML file preview](2026-08-23-html-file-preview.md) | 2026-08-23 | [ADR 0045](../../decisions/0045-html-file-preview-is-static-and-isolated.md) and source/tests |
| [Auto-compact visibility](2026-08-23-autocompact-visibility.md) | 2026-08-23 | [code anchors](../../maps/code-anchors.md) and source/tests |
| [WebSocket liveness](2026-08-27-websocket-liveness.md) | 2026-08-27 | [ADR 0006](../../decisions/0006-app-level-ws-liveness.md) and [ADR 0047](../../decisions/0047-ws-liveness-probe-clears-on-any-frame.md) |
| [Per-session effort tracking](2026-08-18-session-effort-tracking.md) | 2026-08-18 | [ADR 0003](../../decisions/0003-per-session-model-tracking.md), [ADR 0025](../../decisions/0025-session-model-picks-live-in-the-database.md), and source/tests |
| [Checkout naming](2026-08-17-checkout-naming.md) | 2026-08-17 | [ADR 0041](../../decisions/0041-checkouts-are-named-by-place-and-state.md) and source/tests |
| [Chat export](2026-08-17-chat-export.md) | 2026-08-17 | Chat export source and focused client tests |
| [Usage dashboard and reset notifications](2026-08-17-usage-dashboard.md) | 2026-08-17 | [ADR 0039](../../decisions/0039-provider-reset-timestamps-no-catch-up.md), [provider capability map](../../maps/clide-provider-capability-map.md), and source/tests |
| [Claude Agent SDK 0.3.165 → 0.3.233](2026-08-17-claude-sdk-0.3.233-upgrade.md) | 2026-08-17 | [Claude upgrade ledger](../../maps/claude-upgrade-ledger.md) and [Claude SDK map](../../maps/claude-agent-sdk.md) |
| [Test and validation workflow](2026-08-15-test-validation-workflow.md) | 2026-08-15 | [Test suite map](../../maps/test-suite.md) and the verification section of `AGENTS.md` |
| [Post-v1.37 ADR reassessment](post-v1-37-adr-reassessment.md) | 2026-08-13 | ADRs [0011](../../decisions/0011-codex-app-server-chat-transport.md), [0012](../../decisions/0012-codex-rewind-and-fork-session-identity.md) and [0016](../../decisions/0016-repository-grouped-checkouts.md), all of which stand |
| [Codex 0.147 and managed native runtime](codex-0-147-managed-native-runtime.md) | 2026-08-12 | [ADR 0034](../../decisions/0034-codex-managed-native-runtime.md), [Codex surface map](../../maps/codex-cli-sdk-app-server.md), and source/tests |
| [Composer edits merge readiness](2026-08-09-composer-edits-merge-readiness.md) | 2026-08-09 | [ADR 0032](../../decisions/0032-summary-first-composer-usage-popover.md), [permission map](../../maps/provider-permission-modes.md), and source/tests |
| [Settings information architecture](2026-07-28-settings-ia-build-plan.md) | 2026-08-01 | ADRs 0018–0022 and the completion ledger |
| [Sidebar status colour language](2026-08-08-sidebar-status-color-language.md) | 2026-08-08 | [ADR 0031](../../decisions/0031-theme-relative-selection-and-symbolic-sidebar-status.md) and sidebar source/tests |
