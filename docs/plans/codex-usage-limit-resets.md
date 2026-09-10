# Redeem Codex usage-limit resets inside CLIde

- Status: not started
- Next: add the capability-gated provider mutation and its focused server tests
- Context: [provider capability map](../maps/clide-provider-capability-map.md), [Codex runtime map](../maps/codex-cli-sdk-app-server.md), [code anchors](../maps/code-anchors.md), and [usage dashboard archive](archive/2026-08-17-usage-dashboard.md).

## Phases

- [ ] 1. **Safe provider action.** Add an optional provider capability for consuming an earned usage-limit reset. Codex calls `account/rateLimitResetCredit/consume` with the provider credit id when available and one idempotency key per logical attempt; unsupported runtimes and sign-in methods expose no action. Normalize `reset`, `nothingToReset`, `noCredit`, and `alreadyRedeemed`, then refresh the existing usage cache after a completed attempt.
- [ ] 2. **Usage-page confirmation.** Turn the existing Codex reset-count row on `/usage` into an action that matches the surrounding density and meets the WCAG target-size or spacing rule when at least one reset is available and the reading is fresh. Confirm before submission, showing the provider-supplied expiry and explaining that a full reset refreshes the eligible five-hour and weekly windows and changes the weekly reset date. Disable repeat submission and keep every unsuccessful outcome explicit without subtracting a reset optimistically.
- [ ] 3. **Point-of-need entry and fallback.** When the composer usage summary reports an available Codex reset, link to `/usage`; do not redeem from the compact popover. If the installed Codex runtime cannot consume resets, link to OpenAI Usage instead. Keep billing and purchases under “Manage Plan and Balance,” and keep redemption out of Agent Settings.
- [ ] 4. **Proof and current documentation.** Cover capability gating, idempotent retries, every native outcome, cache refresh, confirmation, stale data, accessibility, and fallback behavior in existing test files. Update the provider and Codex maps, run the focused checks and builds, then serve the isolated worktree for desktop and mobile acceptance.

## Done when

- A connected Codex account with an available banked reset can redeem exactly one from `/usage` after an explicit confirmation.
- A success immediately refreshes the displayed limits and reset count; failures never imply that a reset was spent.
- Older runtimes, API-key accounts, other providers, stale readings, and zero-reset accounts degrade without a broken or misleading button.
- The composer offers a clear route to the action, while Agent Settings and billing links retain their existing responsibilities.

## Not doing

- Buying instant resets or credits, changing plans, scheduling redemption, or handling automatic/global resets.
- Calling OpenAI web endpoints directly, scraping the provider site, or inventing a reset operation for another provider.
