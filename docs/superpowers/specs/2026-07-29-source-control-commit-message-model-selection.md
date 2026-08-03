# Source Control commit-message model selection

*Recorded 2026-07-29. Reassessed 2026-07-30 against CLIde `main` after the
Settings information architecture merged, and against bundled Codex SDK,
CLI, and App Server 0.146.0.*

## Status and sequencing

**Ready for a fresh implementation worktree.**

The prerequisite
[Settings information architecture](archive/2026-07-28-settings-information-architecture.md)
is complete and merged into `main`. This feature adopts its finished
**Projects & Git** screen, depth-two navigation, settings registry, navigation
shell, one-scroll-container rule, local save feedback, and shared primitives.

When implementation begins:

1. claim or add the corresponding `TODO.md` item;
2. create a fresh topic worktree from the then-current `main`;
3. preserve unrelated work in the main checkout; and
4. use `cloudcli-branch-test` for the database/server/PWA verification pass.

## Purpose

The Sparkles button in Source Control should generate a commit message with a
model the user selected for that purpose. It must not be implicitly locked to
Claude, inherit an unrelated Chat selection by accident, or create a provider
conversation that appears in the sidebar.

The feature has two coordinated surfaces:

- a compact model selector in the Source Control commit composer; and
- a **Commit message writer** child screen under Settings -> Projects & Git
  that controls the default and which provider/model choices appear.

The everyday interaction stays one click: the composer remembers the last
commit-message model, displays it beside the generation action, and uses it
until the user chooses another one.

## Executive decision

Treat commit-message generation as a provider-neutral **ephemeral text job**,
not as a hidden Chat turn.

The selected value is a provider/model pair:

```ts
type CommitMessageModelRef = {
  provider: LLMProvider;
  model: string;
};
```

The provider is part of the choice because model names alone are not stable or
globally unique. UI labels therefore read like:

- `Claude · Haiku 4.5`
- `Claude · Sonnet`
- `Codex · GPT-5.4`

Selecting `Codex · GPT-5.4` selects both Codex and that model. There is no
separate provider picker and no silent provider fallback.

The commit-message selection is independent from:

- the provider of the currently open Chat session;
- Chat's per-provider `claude-model`, `codex-model`, `cursor-model`, and
  `opencode-model` browser keys;
- a session's desired/effective active model; and
- Shell's native provider state.

Choosing Haiku for inexpensive commit messages must not switch the next Claude
Chat turn to Haiku. Choosing Codex while a Claude chat is open must not mutate
that chat or create a Codex sidebar session.

## Current behavior and why it fails

The current client reads `selected-provider` from local storage and posts it to
`POST /api/git/generate-commit-message`. The route:

- accepts only `claude` and `cursor`;
- rejects `codex` and `opencode` with HTTP 400;
- hardcodes Claude to `model: 'sonnet'`;
- collects normalized assistant text into the commit box; and
- logs generation failures to the browser console instead of displaying them.

That explains the observed Codex behavior: a Codex-selected request is rejected
before any model runs, and the user sees no message or error.

The 2026-07-23 phantom-session fix made the Claude query non-persistent with
`persistSession: false`. That invariant is correct but provider-specific. Adding
`queryCodexJob()` to the existing switch is not sufficient: CLIde's installed
TypeScript SDK wraps `codex exec` and does not expose the CLI's ephemeral flag,
so a normal SDK thread can materialize under `~/.codex/sessions` and be indexed
by the session watcher.

The bundled Codex runtime already has the safe primitive:

- `codex exec --ephemeral`; and
- App Server `thread/start` with `ephemeral: true`.

The generated 0.146.0 App Server schema confirms
`ThreadStartParams.ephemeral?: boolean | null`, and the returned thread also
reports whether it is ephemeral. CLIde's curated `CodexThreadStartParams` type
does not yet carry the field, and the protocol-drift test checks the method but
not this required field.

Upstream `siteboon/claudecodeui` has the same Claude/Cursor allowlist and
provider switch. CLIde's normalized-writer and Claude non-persistence fixes are
fork additions on top of that inherited design.

## Product behavior

### Commit composer

The composer shows the active commit-message model close to the Sparkles action:

```text
+------------------------------------------------------+
| Commit message                                   ✨  |
|                                                      |
+------------------------------------------------------+
| Claude · Haiku 4.5 v |  3 files selected   [Commit] |
+------------------------------------------------------+
```

Exact spacing should follow the merged Source Control layout. The behavioral
requirements are:

- clicking Sparkles immediately generates with the displayed model;
- clicking the model control opens a grouped provider/model menu;
- the menu contains only choices enabled in Settings and supported by the
  provider's ephemeral-text-job capability;
- the selected choice is shown as `Provider · Model label`;
- if there is only one enabled and available choice, render the label without
  a misleading dropdown chevron;
- while generation runs, disable both the generation action and selector and
  retain the existing spinner;
- a generated message replaces the textarea contents but remains editable;
- generating again is explicit and may replace the edited text; and
- changing the selector does not generate until Sparkles is activated.

On narrow mobile layouts, the model control and file count may wrap above the
Commit button. Do not shrink the model label into an unlabeled provider icon.
Truncate the model label with a tooltip if necessary.

### Model menu

Group choices by provider and use the live backend model labels:

```text
Claude
  Haiku 4.5
  Sonnet

Codex
  GPT-5.4
```

Do not hardcode model slugs or labels in the Git panel. Consume the resolved
provider groups returned by the commit-message settings endpoint, which in turn
uses the backend model, capability, and auth services.

Provider states:

- **Supported and authenticated:** selectable.
- **Supported but not authenticated/installed:** visible in Settings with its
  reason, but omitted or disabled in the compact composer menu.
- **Model removed from the live catalog:** stale stored reference; reconcile as
  described below.
- **Usage exhausted:** do not silently switch provider/model or hide a
  configured choice based on transient quota state. Attempt generation and
  display the provider's returned limit error.
- **No eligible choices:** disable Sparkles and show `Configure commit-message
  models in Settings`.

The first implementation should not add reasoning-effort controls. Commit
message generation is a short, bounded task; provider defaults are sufficient.
Effort can be added later only if real use shows a need.

### Error behavior

Generation must never fail as an unexplained no-op.

Display an inline error near the composer or through the Git panel's existing
operation-error surface. Preserve useful provider text for:

- authentication or installation failure;
- usage/rate limit reached;
- unsupported ephemeral generation;
- stale or invalid model;
- malformed/empty model output;
- network/process failure; and
- server validation failure.

Do not convert provider failure into the current canned
`chore: update files` message. A deterministic non-AI fallback may be offered as
a separately labelled user action later, but it must not masquerade as a
successful model response.

## Settings design

Add a navigation row to the existing **Projects & Git** screen:

```text
Projects & Git
└── Commit message writer        Claude · Sonnet 5  >
```

The row opens a depth-two screen with stable id
`projects-git.commit-messages`. Use `SettingsNavRow` on the parent and
`SettingsScreen`, `SettingsGroup`, `SettingsRow`, `SettingsSelect`, and
`SettingsToggle` on the child. The child owns the only scroll container; model
groups must not introduce nested scrolling.

Add `commit`, `message`, `writer`, `model`, `Claude`, `Codex`, `Haiku`,
`Sparkles`, and `Source Control` to the registry and setting search data.

### Commit message writer screen

The screen contains:

#### Selected model

A select displaying the current provider/model pair. Changing it saves
immediately and changes the composer selection everywhere. This is the
last-selected/default model; the two concepts intentionally share one value.
The select contains enabled, catalog-valid models. A stale selected model
remains visible as unavailable until the user chooses a replacement.

Help text:

> Used by the Sparkles action in Source Control. Changing this does not change
> your Chat model.

#### Models shown in Source Control

An allowlist editor grouped by provider. The first implementation exposes only
providers whose adapters advertise ephemeral text generation. Claude and Codex
are the initial required implementations, so their combined catalogs are small
enough for divided toggle rows under provider headings.

If later ephemeral-capable providers make the list unwieldy, add filtering or
an `Add model` chooser without introducing a nested scroller. Do not build that
complexity in v1.

Requirements:

- only providers advertising ephemeral text generation can be enabled;
- provider and model labels come from the live catalogs;
- at least one choice must remain enabled;
- the selected model's toggle is disabled with guidance to choose another
  default first; never silently select a replacement;
- stale stored choices are shown as unavailable until removed, rather than
  silently disappearing from Settings; and
- changes save immediately, matching the Settings IA save model for selects and
  toggles.

The control's updated value is normal success feedback. Render an inline error
inside this screen if a backend write fails, per ADR 0021; do not restore a
global Settings save indicator.

No separate `Use current Chat model` mode ships. It would recreate the coupling
this feature is intended to remove.

## Preference source of truth

Commit-message preferences are backend-owned and per user. Do not implement
them as new local-storage keys.

Reasons:

- CLIde is used from desktop and an installed mobile PWA;
- a Settings choice should follow the authenticated user across devices;
- the existing browser-local Chat model state is known to drift across clients;
- the generation endpoint must validate the choice anyway; and
- backend ownership prevents a stale browser value from becoming an undeclared
  provider fallback.

Use a narrowly scoped JSON preference row, following the existing notification
preference repository pattern rather than broadening the `users` table with one
column per setting:

```sql
CREATE TABLE IF NOT EXISTS user_source_control_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Before any schema or live-data write, back up `~/.cloudcli/auth.db` as required
by the repository safety rules. Add the schema through the normal migration
path; do not mutate the live database by hand.

Version and normalize the JSON:

```ts
type SourceControlPreferencesV1 = {
  version: 1;
  commitMessage: {
    selectedModel: CommitMessageModelRef;
    enabledModels: CommitMessageModelRef[];
  };
};
```

For an existing user with no row, normalize to the exact legacy behavior:

```ts
{
  version: 1,
  commitMessage: {
    selectedModel: { provider: 'claude', model: 'sonnet' },
    enabledModels: [{ provider: 'claude', model: 'sonnet' }],
  },
}
```

This preserves the model that the old route hardcoded while making future
changes explicit. Do not seed from active Chat and do not silently substitute a
provider catalog default. If the legacy selection is unavailable, generation
stays disabled until the user chooses another enabled model.

The server returns a Source-Control-specific resolved view model rather than
making each client independently join preferences, capabilities, auth, and
model catalogs:

```ts
type CommitMessageModelChoice = {
  ref: CommitMessageModelRef;
  label: string;
  description?: string;
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
};

type CommitMessageProviderGroup = {
  provider: LLMProvider;
  installed: boolean;
  authenticated: boolean;
  supportsEphemeralTextGeneration: boolean;
  models: CommitMessageModelChoice[];
};

type ResolvedCommitMessagePreferences = {
  selectedModel: CommitMessageModelRef;
  enabledModels: CommitMessageModelRef[];
  staleModels: CommitMessageModelRef[];
  selectionSource: 'stored' | 'legacy-default';
  canGenerate: boolean;
  selectionIssue?: string;
  providerGroups: CommitMessageProviderGroup[];
};
```

Endpoints:

```text
GET /api/settings/source-control/commit-message
PUT /api/settings/source-control/commit-message
```

The GET handler uses the existing provider registry, models service,
capabilities service, and auth service to build the resolved response. The PUT
endpoint validates provider IDs, model-reference shape, duplicates, a non-empty
allowlist, and that `selectedModel` belongs to `enabledModels`.

Catalog eligibility, job capability, installation, and authentication are
rechecked at generation time because provider state and dynamic catalogs can
change after preferences are saved. Usage limits are not used to hide choices:
they are transient, sometimes unavailable to CLIde, and should surface as
actionable generation errors.

### Selection reconciliation

Resolve the model in this order:

1. stored `selectedModel`; or
2. the virtual legacy default `Claude · Sonnet` when no row exists.

Once a user selects a commit-message model in either Settings or the composer,
save it as `selectedModel`. Reconciliation determines whether that exact
reference is usable; it never chooses a replacement. A stale, disabled,
unsupported, unauthenticated, or unavailable selection sets `canGenerate:
false` and returns `selectionIssue` so the UI can explain what must change.

## Provider-neutral backend contract

Add an optional job capability to the provider contract instead of extending
the Git route's provider switch:

```ts
type ProviderTextJobInput = {
  prompt: string;
  cwd: string;
  model: string;
  purpose: 'commit-message';
  signal?: AbortSignal;
};

type ProviderTextJobResult = {
  text: string;
  provider: LLMProvider;
  requestedModel: string;
  /** Present only when the provider reports what actually ran. */
  effectiveModel?: string;
};

interface IProviderJobs {
  readonly supportsEphemeralTextGeneration: boolean;
  generateText(input: ProviderTextJobInput): Promise<ProviderTextJobResult>;
}

interface IProvider {
  // existing members...
  readonly jobs?: IProviderJobs;
}
```

Expose the capability through `provider-capabilities.service.ts`. The frontend
renders the backend-resolved Source Control choices; it must not infer job
support from provider IDs. Where practical, derive the advertised capability
from the registered `jobs` facet or cover the two with a conformance test so
the capability matrix cannot drift from the adapter.

This separate facet follows the
[current provider architecture contract](CLIde_Provider_Architecture_Current_Contract.md):
interactive Chat and small ephemeral jobs have different lifecycle,
persistence, permission, and transport requirements.

The job contract owns:

- model validation;
- least-privilege execution;
- ephemeral/non-persistent behavior;
- provider event-to-final-text collection;
- cancellation/timeout;
- empty-output detection; and
- normalized provider errors.

The Git route owns:

- project and selected-file validation;
- safe repository-relative diff construction;
- prompt construction;
- authoritative preference resolution;
- calling the provider job; and
- cleaning/validating the conventional commit message.

### Claude adapter

Use the existing Claude Agent SDK with:

- `persistSession: false`;
- no file checkpoints;
- the requested validated model instead of hardcoded `sonnet`;
- an empty tool allowlist and no `bypassPermissions`, because the prompt already
  contains the diff and needs no repository tools;
- no CLIde session/database registration.

Retain the transcript-directory verification added for the earlier
phantom-session fix.

### Codex adapter

Do not route ephemeral generation through the current TypeScript
`queryCodexJob()` until the SDK itself exposes ephemeral execution.

Preferred implementation:

- a disposable job-owned `JsonlRpcClient`, following the existing account-usage
  App Server pattern and separate from interactive Chat transport state;
- resolve the CLI bundled with `@openai/codex`, never an unrelated global
  executable;
- `thread/start` with `ephemeral: true`;
- read-only sandbox, network disabled, and approval policy `never`;
- `turn/start` with the requested validated model;
- collect completed `agentMessage` text and finish on `turn/completed`;
- reject unexpected server requests rather than opening an interactive approval
  path that can hang the HTTP request;
- suppress Chat lifecycle notifications and session registration; and
- close the disposable process on success, error, cancellation, or timeout.

Keeping job transport state separate prevents a commit-message request from
changing interactive Chat health/capability diagnostics or sharing its active
turn bookkeeping and failure domain.

Extend the curated `CodexThreadStartParams` type with `ephemeral?: boolean |
null` and add it to the generated-schema drift coverage.

A direct bundled `codex exec --ephemeral --json` runner is an acceptable
fallback design if the job-owned App Server path proves needlessly complex. It
must use the pinned bundled executable and reuse normalized event handling
rather than parsing human terminal output.

### Cursor and OpenCode adapters

Do not infer ephemeral safety from their ability to run a one-shot prompt.
Before advertising the capability:

1. inspect the installed CLI's persistence controls;
2. snapshot the provider's session store;
3. run a generation probe;
4. prove that no session artifact/sidebar row appears; and
5. document the selected non-persistent invocation.

The existing Cursor generator path remains implementation evidence, not proof
that it satisfies the no-phantom-session invariant. Unsupported providers omit
`jobs` or report `supportsEphemeralTextGeneration: false`.

## Generation API

The stored commit-message preference is authoritative. The composer saves a
selection change before enabling Sparkles; generation itself does not accept a
second provider/model value that can drift from Settings.

```ts
type GenerateCommitMessageRequest = {
  project: string;
  files: string[];
};
```

Success response:

```ts
type GenerateCommitMessageResponse = {
  message: string;
  provider: LLMProvider;
  requestedModel: string;
  effectiveModel?: string;
};
```

The route reads the authenticated user's stored or virtual-legacy selection,
revalidates that exact reference, and invokes its provider job. It always
echoes the requested provider/model. It reports `effectiveModel` only when the
provider confirms what actually ran; requested state must never be mislabeled
as effective truth.

If the selected model cannot run, return an actionable error. Do not run
another model or provider and do not report a substitution as if it were the
request.

Use consistent HTTP/error semantics:

- `400` malformed request or invalid file/model reference;
- `401`/`403` authentication/authorization failure where applicable;
- `409` provider installed but ephemeral generation unsupported;
- `429` provider usage limit when it can be identified reliably; and
- `500`/`502` local adapter or upstream provider failure.

The current 4,000-character diff prompt limit may remain in the first
implementation. Improving diff selection/truncation is separate work unless
tests show it prevents useful messages.

## Shared client preference state

Do not copy or extract `useChatProviderState` for this feature. That hook owns
interactive-session desired/effective model behavior, provider-specific browser
keys, effort, permissions, and catalog refresh state that Source Control must
not inherit.

The backend-resolved commit-message endpoint is the only catalog/capability/auth
view model the Source Control UI consumes.

Use one lazy `CommitMessagePreferencesContext` (or equivalently scoped external
store) shared by the Settings portal and Git panel:

```text
useCommitMessagePreferences()
  -> resolved preferences and provider groups
  -> lazy load / refresh
  -> setSelectedModel(ref), awaited PUT
  -> setModelEnabled(ref, enabled), awaited PUT
  -> loading / saving / error
```

Mount the provider inside the authenticated application tree, but defer its
GET until the Git composer or Projects & Git settings first consumes it. This
avoids querying provider auth/catalog state on every CLIde page load while
still keeping Settings and the composer synchronized in one browser window.

Delete `useSelectedProvider` from the commit-generation path once the explicit
commit-message preference is wired. It may remain elsewhere only if another
consumer still needs it. Do not mutate Chat's `selected-provider` or
per-provider model local-storage keys.

## Implementation sequence

1. **Claim and isolate.** Add/claim the `TODO.md` item and create a fresh topic
   worktree from current `main`.
2. **Provider job contract.** Add `IProviderJobs`, capability exposure, error
   types, final-text collector, and provider-neutral tests.
3. **Claude and Codex adapters.** Preserve Claude non-persistence and remove
   tool access; implement the disposable Codex App Server ephemeral job,
   protocol field, and drift coverage.
4. **Artifact proof.** Against fake protocol fixtures and then the isolated
   branch test, prove both adapters return text without native transcript or
   CLIde session artifacts before adding preference/UI state.
5. **Preference persistence.** Add schema/migration, repository, deterministic
   legacy default, normalization, and authenticated GET/PUT routes. The branch
   test uses its database snapshot; back up the live database before the first
   production start that can run the migration.
6. **Resolved Source Control service.** Aggregate preference, job capability,
   auth, and live model catalogs on the backend; use it for both GET and
   generation-time validation.
7. **Generation route.** Replace the allowlist/switch, read the authenticated
   user's selected model, return requested/effective metadata separately, and
   surface provider failures without canned output.
8. **Shared preference context.** Add lazy synchronized state for Settings and
   the Git composer without changing Chat selection semantics.
9. **Settings child screen.** Register `projects-git.commit-messages`, add the
   parent navigation row, selected/enabled controls, search metadata, local
   errors, and responsive states.
10. **Composer UI.** Add the compact grouped model selector, awaited selection
    persistence, loading/disabled states, and visible errors.
11. **Provider probes.** Evaluate Cursor and OpenCode separately. Do not simply
   delete Cursor's inherited generator path; either migrate it to a verified
   non-persistent job adapter or leave it explicitly unsupported with the
   compatibility impact documented.
12. **Verification and rollout.** Focused tests, typecheck, lint, client/server
    builds, isolated branch test, merge to `main`, then user-owned production
    restart and installed-PWA verification.

## Verification

### Backend unit/integration coverage

- Preference JSON defaults, normalization, duplicate removal, and versioning.
- An absent row resolves to exactly Claude/Sonnet selected and enabled.
- A stored provider/model round-trips per authenticated user.
- The PUT route rejects an empty allowlist or a selection outside it.
- Stale models are reported and never sent to an adapter.
- Generation rejects a provider without ephemeral job capability.
- The stored requested provider/model reaches the correct adapter without a
  client-supplied provider/model override.
- Requested model is always echoed; effective model is present only when the
  provider confirms it.
- Provider errors reach the response; canned fallback is not returned.
- Empty assistant output is an error.
- Only selected files contribute diff context.
- Existing repository path-containment checks remain enforced.
- Claude generation creates no new transcript or file checkpoints.
- Codex generation creates no rollout JSONL, state row that the watcher indexes,
  or CLIde session row.
- Codex job execution does not mutate interactive Chat transport diagnostics.
- Protocol drift coverage proves `thread/start.ephemeral` remains available in
  the pinned bundled CLI.

### Client coverage

- Composer renders enabled models grouped by provider.
- Selecting a model updates the displayed choice and persists it.
- Settings and composer reflect the same backend preference.
- Projects & Git displays the selected model and opens the registered
  depth-two writer screen.
- The writer screen and its model groups introduce no nested scroll container.
- Commit-message selection does not mutate Chat model/provider state.
- The selected model cannot be disabled until another default is chosen.
- A removed model reconciles visibly.
- Unsupported/unauthenticated choices cannot be invoked.
- Usage/auth/generation errors render in the Git panel.
- Loading prevents duplicate requests.
- Generated text remains editable.
- One-choice and no-choice states render coherently.
- Mobile wrapping preserves readable provider/model labels and the Commit
  action.

### Live isolated verification

Use `cloudcli-branch-test` on port 3002 because this work changes the backend and
database. Its database snapshot isolates preference and CLIde session rows, but
provider homes are shared, so transcript/rollout verification must use obvious
test prompts and compare provider artifacts before and after each run.

Minimum live matrix:

1. Claude + a low-cost model such as Haiku: real message, no Claude transcript.
2. Codex + one current model: real message, no Codex rollout/sidebar session.
3. Switch Claude -> Codex in the composer without changing the active Chat.
4. Exhausted/unavailable provider: visible error, no silent fallback.
5. Desktop and mobile Settings select the same backend preference.
6. Installed mobile PWA: selector/menu fit, keyboard does not obscure controls,
   and safe-area padding remains correct.

### Build and deployment

Run with the repository's Node 24 environment:

```text
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <focused tests>
npm run typecheck
npm run lint
npm run build:client
npm run build:server
```

This is a client-and-server feature. A production rollout requires the built
server plus a service restart. Per repository practice, the user owns the
production `cloudcli.service` restart from SSH; an agent should report that
remaining step rather than restarting it.

## Non-goals

- Do not synchronize commit-message selection with Chat or Shell models.
- Do not silently fail over between providers or models.
- Do not add reasoning-effort, permission-mode, or tool controls to the
  composer in v1.
- Do not create or resume a provider conversation for generation.
- Do not redesign diff truncation, conventional-commit rules, staging, or
  commit execution unless focused testing exposes a blocker.
- Do not create a new top-level Settings destination; adopt the merged
  Projects & Git drill-down.
- Do not enable Cursor/OpenCode without proving non-persistence.
- Do not open or update an upstream PR without explicit user approval.

## Classification and decision record

The backend provider-job contract, backend-authoritative provider/model
selection, error surfacing, and inherited allowlist removal are candidates for
upstreaming.
The exact Settings placement and presentation depend on CLIde's fork-specific
Settings IA and Source Control direction.

Backend-owned cross-device preference state and the rule that all commit-message
jobs must be ephemeral are lasting architectural decisions. When implementation
begins, decide whether to record them in a short ADR after the first verified
Claude/Codex implementation confirms the contract.
