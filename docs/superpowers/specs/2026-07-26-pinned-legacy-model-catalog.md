# Pinned legacy models in the Claude picker

*Recorded 2026-07-26 against CLIde `main` at `479357e`, immediately after the
Opus 5 catalog refresh (`22080c7`, `479357e`). This is a future implementation
brief, not a completed design decision. Implementation is intended for a fresh
session.*

## Purpose

CLIde's Claude model picker currently offers only **floating aliases** —
`default`, `fable`, `sonnet`, `opus`, `opus[1m]`, `haiku`. Every one of those
silently re-points when Anthropic ships a new generation: the Opus 5 launch
moved `opus` from Opus 4.8 to Opus 5 with no CLIde change, which is why the
catalog labels had to be hand-bumped on 2026-07-26.

That is fine for "give me the current best model" but leaves two gaps:

1. **No pinning.** A user who wants Opus 4.6 specifically — for cost, for
   behavioural consistency across a long-running project, or because a newer
   generation regressed on their workload — cannot select it from CLIde at all.
2. **No archaeology.** Resuming a months-old session whose transcript names
   `claude-opus-4-1-20250805` shows a picker with no matching card.

This spec covers adding explicitly-versioned ("pinned") Claude models to the
catalog alongside the aliases.

Read this alongside:

- [ADR 0003 — Per-session model tracking](../../decisions/0003-per-session-model-tracking.md);
- [Popup model persistence design](2026-07-13-popup-model-persist-design.md);
- [Chat picker state and Shell synchronization](2026-07-26-chat-picker-state-and-shell-sync.md);
- `TODO.md` → "Model picker follow-ups", especially **#3** (1M-context alias
  resolution) and **#12** (context-window ceiling), both of which this work
  collides with directly.

## Executive summary

1. **Claude Code's own `/model` picker does not offer legacy models.** Its
   picker strings in the CLI binary cover only the alias set plus "Opus with 1M
   context". So this is a genuine fork feature, not a matter of catching up to
   upstream behaviour. There is no upstream UI to copy.

2. **The underlying runtime supports it.** The agent SDK and CLI accept a
   concrete model id (`claude-opus-4-6`) anywhere an alias is accepted, and the
   bundled model registry carries every id, window, price, and capability set
   CLIde would need.

3. **The blocking work is not the list — it is `resolveClaudeModelAlias`.** Its
   current substring matching will mis-resolve pinned ids onto alias cards
   (a transcript naming `claude-opus-4-1-20250805` would highlight the "Opus 5"
   card). That function must become an exact/longest-match resolver *before* any
   pinned entry is added, or per-session model tracking regresses.

4. **Effort levels must be gated per model.** Legacy models have materially
   different capability sets — Opus 4.6 supports `max` but not `xhigh`; Opus 4.5
   and older support no effort levels at all. The catalog's current practice of
   copy-pasting a five-level `effort` block onto every card would produce
   selections the API rejects with a 400.

5. **Recommend a conservative initial set** (six pinned entries: Opus 4.8, 4.7,
   4.6; Sonnet 4.6, 4.5; Haiku 4.5-pinned) rather than the full registry.
   Pre-4.5 models carry 8K–32K output ceilings, no effort support, and real
   retirement risk; they add maintenance surface for a user CLIde does not have.

## Current state (verified)

### The catalog

`server/modules/providers/list/claude/claude-models.provider.ts` exports
`CLAUDE_FALLBACK_MODELS`, a hardcoded `ProviderModelsDefinition`. Both picker
surfaces render whatever `GET /api/providers/claude/models` returns from it:

- **New-session picker** — `ProviderSelectionEmptyState.tsx`. A `cmdk`
  `Command` list grouped by *provider*, with a search box
  (`modelSearchFilter`). It renders `model.label` only; the `description` render
  is commented out in-place.
- **`/model` popup** — `CommandResultModal.tsx` (`kind: 'models'`). Flat list
  with its own `SearchField` and a "no models match that search" empty state.

Neither surface has any notion of sections or sub-grouping within a provider.
Both already have search, which is what makes a longer list tolerable.

`ProviderModelOption` (`server/shared/types.ts:73`) is deliberately minimal:

```ts
type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  effort?: { default?: string; values: { value: string; description?: string }[] };
};
```

There is no field for grouping, badges, or deprecation. Adding pinned models
means either extending this shared type (it is provider-agnostic — Codex,
Cursor, and OpenCode all consume it) or encoding the distinction in the label.

### The registry

Authoritative model facts live in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` as an inline catalog
(`pricing_tiers`, `models[]`, `aliases`, `latest_per_family`). See memory
`claude-model-registry-in-sdk`. Grep it; never write these values from memory.

Candidate legacy models, as the registry has them today:

| id | display_name | context window | `[1m]` suffix | max output (upper) | pricing | effort capabilities |
|---|---|---|---|---|---|---|
| `claude-opus-4-8` | Opus 4.8 | 1M native | yes | 128000 | $5/$25 | effort, max, **xhigh**, fast_mode |
| `claude-opus-4-7` | Opus 4.7 | 1M native | yes | 128000 | $5/$25 | effort, max, **xhigh**, fast_mode (`default_effort: xhigh`) |
| `claude-opus-4-6` | Opus 4.6 | 200K (1M beta) | yes | 128000 | $5/$25 | effort, max — **no xhigh** |
| `claude-opus-4-5` | Opus 4.5 | 200K | yes | 64000 | $5/$25 | **none** |
| `claude-opus-4-1` | Opus 4.1 | 200K | yes | 32000 | $15/$75 | **none** |
| `claude-opus-4-0` | Opus 4 | 200K | yes | 32000 | $15/$75 | **none** |
| `claude-sonnet-4-6` | Sonnet 4.6 | 200K (1M beta) | yes | 128000 | $3/$15 | effort, max — **no xhigh** |
| `claude-sonnet-4-5` | Sonnet 4.5 | 200K (1M beta) | yes | 64000 | $3/$15 | **none** |
| `claude-sonnet-4-0` | Sonnet 4 | 200K (1M beta) | yes | 64000 | $3/$15 | **none** |
| `claude-3-7-sonnet` | Sonnet 3.7 | no `context` block | no | 64000 | $3/$15 | **none** |
| `claude-3-5-sonnet` | Sonnet 3.5 | no `context` block | no | 8192 | $3/$15 | **none** |
| `claude-haiku-4-5` | Haiku 4.5 | 200K | yes | 64000 | $1/$5 | **none** (`context_management` only) |
| `claude-3-5-haiku` | Haiku 3.5 | no `context` block | no | 8192 | $0.80/$4 | **none** |
| `claude-mythos-5` | Mythos 5 | 1M native | no | 128000 | $10/$50 | **none**; first-party provider id only, absent from `aliases` |

Two structural notes:

- **Provider ids diverge from registry ids.** Newer models use bare ids
  (`first_party: "claude-opus-4-6"`), but pre-4.5 models use dated ones
  (`claude-opus-4-1-20250805`, `claude-sonnet-4-20250514`). A transcript records
  the wire id, so resolution must handle both forms.
- **The registry schema already models this problem.** Its Zod schema includes
  an optional `picker: { section: 'main' | 'overflow' | 'deprecated', badge?,
  disabled_reason?, tiers? }`. No shipped model currently populates it, but it
  is a strong hint at the intended shape: a main set, an overflow set, and a
  deprecated set with a reason string. CLIde should borrow that vocabulary
  rather than invent one.

### Why not just ask the SDK

`query().supportedModels()` exists and returns `ModelInfo[]`, which is a near
exact fit for `ProviderModelOption` — `value`, `displayName`, `description`,
`supportsEffort`, `supportedEffortLevels`, and `resolvedModel` (documented as
"lets hosts match a persisted explicit id against the alias row that covers
it", i.e. precisely the alias-resolution problem below).

It is already wired up and **deliberately commented out** in
`ClaudeProviderModels.getSupportedModels()`, because calling it spawns a stray
session and writes a JSONL file, which pollutes the sidebar with a phantom
project. That blocker is unrelated to this spec and should not be re-litigated
here.

It also would not solve this spec's problem: `supportedModels()` returns the
picker set, which — per the CLI binary strings — is the alias set. Legacy
pinning needs explicit CLIde-side entries regardless.

## Design

### Scope: which models to offer

**Recommended initial set — six pinned entries:**

| picker `value` | label |
|---|---|
| `claude-opus-4-8` | Opus 4.8 |
| `claude-opus-4-7` | Opus 4.7 |
| `claude-opus-4-6` | Opus 4.6 |
| `claude-sonnet-4-6` | Sonnet 4.6 |
| `claude-sonnet-4-5` | Sonnet 4.5 |
| `claude-haiku-4-5` | Haiku 4.5 (pinned) |

Rationale for the cut line:

- Everything at or above 4.5 has a ≥64K output ceiling and a real
  `context_management` capability, so it behaves like a current model.
- Opus 4.8 and 4.7 are the immediately-superseded generation — the most likely
  thing a user actually wants to pin after an Opus 5 rollout.
- Opus 4.6 and Sonnet 4.6 are the last generation with `effort` support and a
  200K window, which makes them the natural "cheaper/steadier" picks.
- Pre-4.5 (`opus-4-0`, `opus-4-1`, `sonnet-4-0`, and all 3.x) offer no effort
  levels, 8K–32K output, and carry retirement risk. Excluded until asked for.
- `claude-mythos-5` is excluded: it has a first-party-only provider id, no
  alias entry, and empty capabilities — it is not a model a Claude Code user is
  expected to be able to select. Do not surface it speculatively.

`claude-haiku-4-5` is included as a *pinned duplicate* of the existing `haiku`
alias card on purpose: it costs nothing, and it means the "Legacy" group is not
a trap where `haiku` silently re-points at Haiku 5 later while the pinned row
keeps working.

**Explicitly out of scope:** `[1m]` variants of pinned models. Most legacy
models set `supports_1m_suffix`, so `claude-opus-4-6[1m]` is a legal value —
but shipping twelve cards instead of six for a feature no one has asked for is
not worth the picker real estate. Revisit if requested.

### Representation

Add pinned entries to `CLAUDE_FALLBACK_MODELS.OPTIONS` using the **bare
registry id** as `value`. That is what the SDK accepts and what current
transcripts report.

Ordering: aliases first (unchanged), pinned entries after, newest first. Both
picker surfaces render in array order, so array order *is* the UI order.

### Grouping in the UI

Three options, in increasing cost:

1. **Label-only (recommended for v1).** No shared-type change. Ship the pinned
   entries after the aliases with a clear label convention, and let the existing
   search boxes do the work. Cheapest, ships in one commit, provider-agnostic by
   construction.
2. **Add an optional `group?: string` to `ProviderModelOption`.** Render a
   section header when `group` changes between consecutive options. Touches
   provider-agnostic shared surface, so per the multi-provider goal in
   CLAUDE.md it must degrade cleanly for Codex/Cursor/OpenCode — which it does,
   since `group` would be undefined for all of them and the header never
   renders. Modest cost, much better at ten-plus entries.
3. **Port the registry's `picker` shape** (`section` + `badge` +
   `disabled_reason`) wholesale. Correct long-term, over-built for six rows.

Recommend **(1) for the first commit, (2) as an immediate follow-up** if the
list grows past roughly ten rows. Do not build (3) yet.

If (1): the new-session picker renders `label` alone (its `description` render
is commented out), so the label must carry everything. Use the plain display
name — `Opus 4.6` — which reads unambiguously against the versioned alias
labels (`Opus 5`, `Sonnet 5`) established by `479357e`.

### Effort gating

This is the correctness-critical part. Attach `effort` **only** where the
registry's `capabilities` support it, and only the levels it supports:

| model | `effort` block |
|---|---|
| `claude-opus-4-8`, `claude-opus-4-7` | low, medium, high, xhigh, max |
| `claude-opus-4-6`, `claude-sonnet-4-6` | low, medium, high, max — **omit `xhigh`** |
| `claude-sonnet-4-5`, `claude-haiku-4-5` | **omit the `effort` block entirely** |

Rule: `effort` capability gates the block; `xhigh_effort` and `max_effort` gate
those individual levels. Deriving these by hand is what the memory note warns
about — read them out of `capabilities` for each id at implementation time,
because the registry moves.

Note the pre-existing residual recorded in TODO #6: the **Default** card offers
all five levels unconditionally, which is already wrong when the configured
default resolves to Haiku 4.5. This spec does not fix that, but the same helper
introduced here should be reusable for it.

## The alias-resolution trap

`resolveClaudeModelAlias` (`claude-models.provider.ts:128`) maps a transcript's
model id back onto a catalog card. Today:

```ts
const family = option.value.replace(/\[1m\]$/, '');
if (lowered.includes(family) && option.value.endsWith('[1m]') === wantsLongContext) {
  return option.value;
}
```

Substring matching over alias values works only because the alias values
(`opus`, `sonnet`, `haiku`, `fable`) are family names. Adding pinned ids breaks
it in both directions:

- **Dated ids fall through to the alias card.** For `claude-opus-4-1-20250805`,
  no pinned option matches exactly; the loop then reaches the `opus` option,
  `includes('opus')` is true, and it returns `opus` — so a session pinned to
  Opus 4.1 displays and, per TODO #2's escalation, can *resume* as Opus 5.
- **Order becomes load-bearing.** The first `includes` hit wins, so the result
  depends on array position rather than specificity.

**Required change, before any pinned entry lands:**

1. Exact match on `option.value` (already the early return — keep it).
2. Then match the transcript id against each option's known wire ids, including
   the dated `provider_ids.first_party` form. A prefix test
   (`transcriptId.startsWith(optionValue)`) covers `claude-opus-4-1` →
   `claude-opus-4-1-20250805` without a second table.
3. Only then fall back to family-substring matching against alias options,
   and only after all pinned options have been tried — i.e. **longest/most
   specific value first**.
4. Preserve the existing `[1m]` symmetry check throughout.

TODO **#3** (Shell `/model` reporting "Sonnet 4.5 (1M context)" as prose rather
than a `[1m]` token) lives in this same function. Fix both in one pass; they
share the test file and touching this function twice is wasted risk.

## Interaction with the context-ring work (TODO #12)

Pinned models make TODO #12 *more* necessary and slightly harder. The chosen
fix there is to derive the token-ring denominator from the session's active
model. Once pinned ids are selectable, that resolver must handle:

- bare pinned ids (`claude-opus-4-6` → 200K);
- dated wire ids from old transcripts (`claude-opus-4-1-20250805` → 200K);
- registry entries with **no `context` block at all** (the 3.x models) — needs a
  documented default rather than `undefined`; and
- the same 1M-vs-200K split the aliases already have.

Sequencing: **do TODO #12 first.** It builds the model → window resolver that
this spec's cards then feed, and it is the higher-value fix (the ring is
currently ~6× wrong for Opus 5). Building pinned models first means writing the
alias resolver twice.

## Implementation plan

Roughly one working session, in this order:

1. **Harden `resolveClaudeModelAlias`** for specificity and dated ids, plus the
   TODO #3 "(1M context)" phrasing. Extend
   `server/modules/providers/tests/claude-models.test.ts` first — it already
   covers this function and the Opus 5 refresh added cases to it.
2. **Add a capability-derived effort helper** in the Claude provider module so
   effort blocks stop being copy-pasted, and use it for the six new cards.
3. **Add the six pinned entries** to `CLAUDE_FALLBACK_MODELS`, after the
   aliases, newest first, with registry-sourced pricing in `description`.
4. **Update the doc comment** at the top of `CLAUDE_FALLBACK_MODELS` (it
   currently explains only the alias-label-bumping convention) and the model
   list in `server/routes/agent.js:649`.
5. **Typecheck, lint, test, `npm run build:server`.** This is a server-side
   change, so it needs an **SSH restart** — client-only fast-path does not
   apply.

Deferred to a follow-up unless the list grows: optional `group` on
`ProviderModelOption` plus section headers in both picker surfaces.

## Verification

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/*.test.ts`
- `GET /api/providers/claude/models` returns eleven options in the intended
  order, with effort blocks only where the registry allows them.
- New-session picker: all six pinned rows visible; searching "4.6" finds Opus
  4.6 and Sonnet 4.6 and nothing else.
- `/model` popup on an existing session: pick `claude-opus-4-6`, send, and
  confirm the JSONL records Opus 4.6 rather than Opus 5. This is the test that
  proves the resolver change, and it is the one that actually matters.
- Regression: open a session whose transcript names a *dated* legacy id and
  confirm the picker highlights the pinned card, not the alias card.
- Regression: the alias cards (`opus`, `sonnet`, `haiku`, `fable`, `opus[1m]`)
  still resolve exactly as before.

## Open questions

1. **Cost visibility.** Legacy Opus 4/4.1 are $15/$75 — 3× Opus 5. If they are
   ever added, the label (not just the hidden description) should say so, since
   the new-session picker never renders descriptions.
2. **Retirement handling.** A pinned id will eventually stop being served and
   fail at send time with an opaque API error. Is a `disabled_reason`-style
   affordance worth building before that happens, or is a one-line catalog
   deletion on the next refresh enough? Current recommendation: the latter.
3. **Whether `default` should ever resolve to a pinned id.** It reads
   `~/.claude/settings.json`'s `model` key verbatim, so a user who pins there
   already gets a pinned default — the "currently X" description string handles
   it, but the effort block on the Default card does not (TODO #6 residual).
