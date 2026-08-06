# Source Control commit-message model selection

- Status: not started
- Next: rebaseline against the post-v1.37 Git module and panel, then build the
  `IProviderJobs` contract.
- Context: adopts the merged Settings IA (Projects & Git screen, depth-two
  navigation, settings registry, one-scroll-container rule — ADRs 0018, 0021)
  · [provider permission and mode surfaces](../maps/provider-permission-modes.md)

**Treat commit-message generation as a provider-neutral ephemeral text job, not
a hidden Chat turn.**

The selected value is a provider/model *pair* — `{ provider, model }` — because
model names are neither stable nor globally unique. Labels read `Claude · Haiku
4.5`, `Codex · GPT-5.4`. Selecting one selects both; there is no separate
provider picker and no silent provider fallback.

The selection is independent of the open Chat session's provider, Chat's
per-provider `<provider>-model` browser keys, a session's desired or effective
active model, and Shell's native state. **Choosing Haiku for cheap commit
messages must not switch the next Claude Chat turn to Haiku**, and choosing Codex
while a Claude chat is open must not mutate that chat or create a Codex sidebar
session.

## Phases

- [ ] **1. Provider job contract.** `IProviderJobs`, capability exposure, error
      types, final-text collector, provider-neutral tests.
- [ ] **2. Claude and Codex adapters.** Preserve Claude non-persistence and remove
      tool access; implement the disposable Codex App Server ephemeral job with
      its protocol field and drift coverage.
- [ ] **3. Artifact proof.** Against fake protocol fixtures, then the isolated
      branch test, prove both adapters return text with **no** native transcript
      and **no** CLIde session artifacts — before any preference or UI state
      exists. This is the gate the rest depends on.
- [ ] **4. Preference persistence.** Schema/migration, repository, deterministic
      legacy default, normalization, authenticated GET/PUT. The branch test uses
      its snapshot; back up the live database before the first production start
      that can run the migration.
- [ ] **5. Resolved Source Control service.** Aggregate preference, job
      capability, auth, and live model catalogs on the backend; use it for both
      GET and generation-time validation.
- [ ] **6. Generation route.** Replace the allowlist/switch, read the
      authenticated user's selection, return requested and effective metadata
      separately, and surface provider failures rather than canned output.
- [ ] **7. Shared preference context.** Lazy synchronized state for Settings and
      the Git composer, without changing Chat selection semantics.
- [ ] **8. Settings child screen.** Register `projects-git.commit-messages`, the
      parent navigation row, selected/enabled controls, search metadata, local
      errors, responsive states.
- [ ] **9. Composer UI.** Compact grouped model selector, awaited selection
      persistence, loading/disabled states, visible errors.
- [ ] **10. Cursor and OpenCode probes.** Evaluate separately. Do **not** simply
      delete Cursor's inherited generator path — either migrate it to a verified
      non-persistent job adapter, or leave it explicitly unsupported with the
      compatibility impact documented.

## Done when

Both Claude and Codex generate a message with no transcript or session artifact
left behind; the selection survives a refresh and a different device; a provider
failure is visible rather than replaced by canned text; and choosing a
commit-message model demonstrably does not alter the next Chat turn. Verified by
focused tests, typecheck, lint, both builds, the isolated branch test on 3002,
then a user-owned production restart and installed-PWA check.

Two lasting architectural claims will be worth an ADR once the first verified
Claude/Codex implementation confirms them: that preference state is
backend-owned and cross-device, and that all commit-message jobs are ephemeral.
The backend job contract, backend-authoritative selection, error surfacing, and
inherited-allowlist removal are upstream candidates.

## Not doing

Synchronizing this selection with Chat or Shell models. Silent failover between
providers or models. Reasoning-effort, permission-mode, or tool controls in the
composer in v1. Creating or resuming a provider conversation for generation.
Redesigning diff truncation, conventional-commit rules, staging, or commit
execution unless testing exposes a blocker. A new top-level Settings destination.
Enabling Cursor or OpenCode without proving non-persistence.
