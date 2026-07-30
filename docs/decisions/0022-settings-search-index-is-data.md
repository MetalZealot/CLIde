# 0022 — The Settings search index is declared data, not screen registration

- Date: 2026-07-29
- Status: Accepted

## Decision

Settings search matches in two passes: screen labels plus the registry's
`keywords`, then individual setting labels. The second pass reads
`src/components/settings/registry/searchIndex.ts` — a flat list of
`{ screenId, labelKey, keywords? }` declared beside the registry — rather than
anything contributed by the screens themselves at runtime.

Matching and ranking live in `registry/search.ts`, which takes a `translate`
callback instead of importing i18n. Both modules are React-free, like the rest of
`registry/`, and are unit-tested with `node:test` against the real `en` bundle.

## Rejected

- **Screens registering their own setting labels**, which is how the IA spec
  described it ("individual setting labels registered by each screen"). It cannot
  work: Settings mounts exactly one screen at a time, so a mounted screen can
  only advertise the settings the user has *already* navigated to. Registration
  would make search find only what you had recently visited — worse than no
  second pass, because the failure is invisible and inconsistent.
- **A module-level side-effecting register call per screen file** (import the
  screen module for its side effect, keep the labels next to the rows they
  describe). It fixes the mounting problem but drags every screen — and therefore
  React, i18n and the whole component tree — into the registry's import graph,
  which is what keeps the registry testable without a renderer. It also makes the
  index's contents depend on module-load order.
- **Deriving the labels from source** (a build step or a codegen script parsing
  `t('…')` calls out of each screen). Real drift protection, but a new build-time
  dependency and a parser to maintain for one feature; the spec's own framing of
  search as "phase 6, small" does not carry that.
- **Only searching screen labels and keywords**, dropping the second pass. The
  spec named "minimap" and "enter to send" as the motivating cases: settings the
  restructure moved *deeper*, whose screen names no longer contain the words the
  user knows them by.

## Why

The registry exists because the previous IA kept its navigation in two
hand-maintained arrays that silently diverged (Voice was in one, not the other,
so the command palette could not reach it). Search is the third consumer of that
data, and the second pass is a fourth kind of entry — so it belongs in the same
place, under the same tests, not scattered across fifteen view files.

## Consequences, stated plainly

The index cannot be checked for **completeness**: nothing knows which rows a
screen actually renders, so a new row can ship without an entry. Tests assert
every entry points at a real screen and resolves to a real `en` key, which
catches rot and typos — the failures that would otherwise surface as a result row
labelled with a raw i18n key — but not omission.

That is accepted because the failure modes are asymmetric. A missing entry
degrades search for one row (the screen is still findable by name and keywords);
a wrong entry would show a broken label. The index is therefore documented as
"labels worth searching for", not an inventory, and its docstring says so for the
next reader who wonders why it is not exhaustive.

Two smaller consequences of the same shape:

- Adding a setting-level search term is a two-file change (screen + index). The
  alternative was zero-file, and unreliable.
- The index resolves labels through the same i18n keys the screens render, so a
  row and its search entry cannot show different text — which is the drift that
  would actually confuse a user.
