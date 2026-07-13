# Persist mid-session model picks as the new-session default

**Date:** 2026-07-13
**Status:** Approved (design)
**Scope:** Frontend only — `src/components/chat/hooks/useChatProviderState.ts`

## Problem

CloudCLI has two model pickers that behave differently from the Claude Code CLI:

- **New-session picker** (top of a fresh chat) reads the per-browser localStorage key
  `<provider>-model` and decides what a brand-new session starts with.
- **Builtin `/models` popup** (mid-session) writes only the server-side per-session cache
  (`~/.cloudcli/provider-session-active-model-changes.json`), which
  `resolveResumeModel` injects on every resumed turn of *that session*.

Because the popup never touches localStorage, a model chosen mid-session applies to the
current session but does **not** become the default for future sessions. The Claude Code
CLI does the opposite: running `/model` persists the choice as the default for new
sessions (its output literally says "saved as your default for new sessions"). This
mismatch is a usability gap for anyone coming from the CLI.

## Goal

Make a successful mid-session model pick in the `/models` popup also become the
new-session default, for **all providers** (Claude, Cursor, Codex, OpenCode), while
keeping the choice per-browser (never machine-global).

Non-goal: changing where the current session reads its model from (that already works via
the per-session cache). Non-goal: any server, DB, or auth change. Non-goal: effort
handling (the popup does not control effort).

## Design

`selectProviderModel` in `useChatProviderState.ts` already has two branches:

- **No session id:** calls `setStoredProviderModel(targetProvider, model)` — persists to
  localStorage. (This is the new-session picker path.)
- **Has session id:** POSTs to the `active-model` endpoint (per-session cache) and returns
  without touching localStorage.

The change adds a single persistence call to the session branch, after the server confirms
the change is supported:

```js
const resolvedModel = body.data.model || model;
setStoredProviderModel(targetProvider, resolvedModel); // NEW — persist as new-session default
return { scope: 'session', changed: body.data.changed === true, model: resolvedModel };
```

`setStoredProviderModel` is already in the `useCallback` dependency array, so no wiring
changes are required. Both branches now converge on the same persistence helper.

### Why Approach A

- Reuses the existing `setStoredProviderModel` helper — no new concept or state.
- Keeps "what counts as the new default" owned by the one hook that already owns model
  persistence, rather than scattering it to the modal/call site (Approach B).
- Persisting via localStorage keeps the choice per-browser, avoiding the machine-global
  footgun of writing `~/.claude/settings.json` server-side (Approach C), where one user's
  mid-session pick would change the default for every session/user on the instance.

## Resulting behavior

- Pick *Opus* in the popup → session still runs Opus next turn (unchanged) **and**
  `localStorage['<provider>-model'] = 'opus'`, so new sessions start on Opus and the
  new-session picker shows Opus selected.
- Pick the *Default* card → persists `'default'`, so new sessions go back to following
  `settings.json`. "default" is just another stored value and round-trips correctly.
- Per-browser only; no leak to other devices/users on the instance.

## Edge cases

- `changed: false` (re-picking the already-active model) → still persists; idempotent and
  harmless.
- Error / unsupported model → the existing guard throws before the new persistence call, so
  nothing is written (unchanged from today).
- **Effort:** the new-session effort selector already reconciles the stored effort against
  the stored model via `reconcileStoredEffort`, so persisting a new model needs no effort
  handling — it self-clamps for providers whose effort options differ by model.

## Testing / verification

No frontend test harness exists (no vitest/jest/testing-library; all current tests are
server-side `node:test`). The change is a single `setStoredProviderModel` call — too thin to
justify extracting a testable helper. Verification is behavioral, via the running app:

1. Pick a non-default model in the mid-session `/models` popup; confirm it applies to the
   current session on the next turn (existing behavior, must not regress).
2. Open a new session; confirm the new-session picker now reflects that model.
3. Pick the *Default* card mid-session, open a new session, and confirm it follows
   `settings.json` again.
4. Confirm the choice is per-browser (a different browser/device is unaffected).

## Blast radius

One function, frontend-only. No server, DB, or auth changes. The only behavior change is
that mid-session picks now persist to the per-browser new-session default.
