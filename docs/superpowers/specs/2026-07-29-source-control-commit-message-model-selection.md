# Source Control commit-message model selection

*Recorded 2026-07-29 against CLIde `main`, the in-progress Settings information
architecture worktree, and bundled Codex CLI/App Server 0.145.0.*

## Status and sequencing

**Deferred follow-on. Do not implement this inside the Settings IA worktree.**

Implementation starts only after the
[Settings information architecture](2026-07-28-settings-information-architecture.md)
branch has been completed, verified, and merged into `main`. That work
deliberately reorganizes existing settings without adding new ones. This
feature is additive: it adopts the finished **Projects & Git** screen, settings
registry, navigation shell, and shared settings primitives rather than
expanding the active worktree's scope.

When implementation begins:

1. claim or add the corresponding `TODO.md` item;
2. create a fresh topic worktree from the then-current `main`;
3. inspect the merged Settings IA component names instead of assuming the
   provisional names in this document survived unchanged; and
4. preserve unrelated work in the main checkout.

## Purpose

The Sparkles button in Source Control should generate a commit message with a
model the user selected for that purpose. It must not be implicitly locked to
Claude, inherit an unrelated Chat selection by accident, or create a provider
conversation that appears in the sidebar.

The feature has two coordinated surfaces:

- a compact model selector in the Source Control commit composer; and
- a **Commit messages** group in Settings -> Projects & Git that controls which
  provider/model choices appear.

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

The generated 0.145.0 App Server schema includes the field, although CLIde's
curated `CodexThreadStartParams` type does not yet carry it.

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

Do not hardcode model slugs or labels in the Git panel. Reuse
`GET /api/providers/:provider/models` and the backend capability matrix.

Provider states:

- **Supported and authenticated:** selectable.
- **Supported but not authenticated/installed:** visible in Settings with its
  reason, but omitted or disabled in the compact composer menu.
- **Model removed from the live catalog:** stale stored reference; reconcile as
  described below.
- **Usage exhausted:** do not silently switch provider/model. If current usage
  data can establish the state, show it as temporarily unavailable; otherwise
  attempt generation and display the provider's returned limit error.
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

After Settings IA merges, add a third group to **Projects & Git**:

1. Project list
2. Git identity
3. Commit messages

Use the merged `SettingsGroup`, `SettingsRow`, `SettingsSelect`, and navigation
patterns. Add `commit`, `message`, `model`, `Claude`, `Codex`, `Haiku`, and
`Source Control` to the screen/setting search keywords.

### Commit messages group

The group contains:

#### Selected model

A select displaying the current provider/model pair. Changing it saves
immediately and changes the composer selection everywhere. This is the
last-selected/default model; the two concepts intentionally share one value.

Help text:

> Used by the Sparkles action in Source Control. Changing this does not change
> your Chat model.

#### Models shown in Source Control

An allowlist editor grouped by provider. Prefer selected chips plus an `Add
model` control over a permanent wall of checkboxes if the live catalogs are
large.

Requirements:

- only providers advertising ephemeral text generation can be enabled;
- provider and model labels come from the live catalogs;
- at least one enabled choice is required while generation is enabled;
- removing the currently selected choice requires choosing a replacement in
  the same interaction, or automatically selects the first remaining choice
  with a clear confirmation;
- stale stored choices are shown as unavailable until removed, rather than
  silently disappearing from Settings; and
- changes save immediately, matching the Settings IA save model for selects and
  toggles.

No separate `Use current Chat model` mode ships initially. It would recreate
the coupling this feature is intended to remove. The initial selection may be
seeded from the active Chat model only when no commit-message preference has
ever been stored; after that, the commit setting is authoritative.

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
    selectedModel: CommitMessageModelRef | null;
    /**
     * null means every currently eligible model until the user customizes the
     * list. An array is the explicit allowlist.
     */
    enabledModels: CommitMessageModelRef[] | null;
  };
};
```

The server returns normalized preferences plus live resolution information:

```ts
type ResolvedCommitMessagePreferences = {
  selectedModel: CommitMessageModelRef | null;
  enabledModels: CommitMessageModelRef[];
  staleModels: CommitMessageModelRef[];
  selectionSource: 'stored' | 'active-chat-seed' | 'provider-default' | 'none';
};
```

Suggested endpoints:

```text
GET /api/settings/source-control-preferences
PUT /api/settings/source-control-preferences
```

The PUT endpoint validates provider IDs, model-reference shape, and duplicates.
Catalog eligibility is rechecked at generation time because installed CLIs,
authentication, and dynamic model catalogs can change after preferences are
saved.

### Selection reconciliation

Resolve the model in this order:

1. stored `selectedModel`, if it is enabled, catalog-valid, supported, and
   available;
2. active Chat's provider/model, only when no preference row has ever existed
   and it supports ephemeral generation;
3. an eligible provider catalog default; or
4. `null`, disabling generation with configuration guidance.

Once a user selects a commit-message model in either Settings or the composer,
save it as `selectedModel`. A stale selection does not authorize silently
switching providers. If reconciliation must choose a replacement, return the
reason so the UI can say what changed.

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
  model: string;
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
renders eligible choices from backend capabilities and catalogs; it must not
branch on provider IDs.

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
- preference/request selection;
- calling the provider job; and
- cleaning/validating the conventional commit message.

### Claude adapter

Use the existing Claude Agent SDK with:

- `persistSession: false`;
- no file checkpoints;
- the requested validated model instead of hardcoded `sonnet`;
- the least tool access needed for a prompt that already contains the diff; and
- no CLIde session/database registration.

Retain the transcript-directory verification added for the earlier
phantom-session fix.

### Codex adapter

Do not route ephemeral generation through the current TypeScript
`queryCodexJob()` until the SDK itself exposes ephemeral execution.

Preferred implementation:

- a job-owned App Server client/transport separate from interactive Chat
  transport state;
- resolve the CLI bundled with `@openai/codex`, never an unrelated global
  executable;
- `thread/start` with `ephemeral: true`;
- read-only sandbox and no approval path that can hang an HTTP request;
- `turn/start` with the requested validated model;
- collect the final assistant message;
- suppress Chat lifecycle notifications and session registration; and
- close/unload job state when complete.

Keeping job transport state separate prevents a commit-message request from
making SDK-configured interactive Chat falsely advertise App Server runtime
capabilities.

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

Evolve the request to carry an explicit model:

```ts
type GenerateCommitMessageRequest = {
  project: string;
  files: string[];
  provider: LLMProvider;
  model: string;
};
```

Success response:

```ts
type GenerateCommitMessageResponse = {
  message: string;
  provider: LLMProvider;
  model: string;
};
```

The response echoes the **effective** provider/model so the composer can confirm
what actually ran. If the requested model cannot run, return an actionable
error; do not report another model as if it were the request.

Use consistent HTTP/error semantics:

- `400` malformed request or invalid file/model reference;
- `401`/`403` authentication/authorization failure where applicable;
- `409` provider installed but ephemeral generation unsupported;
- `429` provider usage limit when it can be identified reliably; and
- `500`/`502` local adapter or upstream provider failure.

The current 4,000-character diff prompt limit may remain in the first
implementation. Improving diff selection/truncation is separate work unless
tests show it prevents useful messages.

## Shared client model-catalog state

Today `useChatProviderState` owns the four-provider model-catalog fetch and
reconciliation logic. The Git composer and Settings screen must not copy that
large hook or maintain a second hardcoded catalog.

Extract the reusable catalog/capability read into a focused shared hook or
context, for example:

```text
useProviderCatalogs()
  -> catalogs
  -> capabilities
  -> auth status needed for eligibility
  -> loading/refresh state
```

Chat keeps its session-specific desired/effective model logic. Source Control
uses only catalog/capability/auth data plus its own backend preference.

Delete `useSelectedProvider` from the commit-generation path once the explicit
provider/model preference is wired. It may remain elsewhere only if another
consumer still needs it.

## Implementation sequence

1. **Adopt merged Settings IA.** Re-read the resulting registry, Projects & Git
   screen, primitives, save behavior, and tests. Update this spec's provisional
   component names if necessary.
2. **Preference persistence.** Back up the database, add schema/migration,
   repository, normalization, and authenticated GET/PUT routes.
3. **Provider job contract.** Add `IProviderJobs`, capability exposure, error
   types, final-text collector, and provider-neutral tests.
4. **Claude and Codex adapters.** Preserve Claude non-persistence; implement
   Codex App Server ephemeral generation and protocol drift coverage.
5. **Generation route.** Replace the allowlist/switch, accept model, return
   effective metadata, and surface provider failures.
6. **Shared catalogs.** Extract the reusable client catalog/capability loader
   without changing Chat selection semantics.
7. **Settings group.** Add selected-model and enabled-model controls to
   Projects & Git, registry search metadata, and responsive states.
8. **Composer UI.** Add the compact model selector, remembered selection,
   loading/disabled states, and visible errors.
9. **Provider probes.** Evaluate Cursor and OpenCode separately; enable only
   those proven ephemeral.
10. **Verification and rollout.** Focused tests, typecheck, lint, client/server
    builds, isolated branch test, merge to `main`, then user-owned production
    restart and installed-PWA verification.

## Verification

### Backend unit/integration coverage

- Preference JSON defaults, normalization, duplicate removal, and versioning.
- A stored provider/model round-trips per authenticated user.
- Stale models are reported and never sent to an adapter.
- Generation rejects a provider without ephemeral job capability.
- Requested provider/model reaches the correct adapter.
- Effective provider/model is echoed in success.
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
- Commit-message selection does not mutate Chat model/provider state.
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
- Do not add the new settings to the active Settings IA worktree.
- Do not enable Cursor/OpenCode without proving non-persistence.
- Do not open or update an upstream PR without explicit user approval.

## Classification and decision record

The backend provider-job contract, explicit provider/model request, error
surfacing, and inherited allowlist removal are candidates for upstreaming.
The exact Settings placement and presentation depend on CLIde's fork-specific
Settings IA and Source Control direction.

Backend-owned cross-device preference state and the rule that all commit-message
jobs must be ephemeral are lasting architectural decisions. When implementation
begins, decide whether to record them in a short ADR after the first verified
Claude/Codex implementation confirms the contract.
