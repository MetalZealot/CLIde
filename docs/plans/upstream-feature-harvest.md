# Harvest the capabilities CLIde lacks from upstream

- Status: not started
- Next: Inventory every gap with a build/defer/refuse verdict; the
  [v1.37.3 picks](upstream-1373-sync.md) they were blocked on have landed
- Context: [upstream sync map](../maps/upstream-sync.md) holds the buckets and
  the ledger; [provider capability map](../maps/clide-provider-capability-map.md)
  owns what each adapter can be asked to do

Nine capabilities exist upstream and not here. Each was deferred during the
v1.37.3 assessment on cost, not on merit, so "CLIde lacks it" is currently the
only thing recorded about any of them. This turns each one into a decision:
read how upstream built it, decide how CLIde should, then build or refuse in
writing.

**Reading upstream's implementation is research, not a template.** Everything
after `99ea0525` sits in `src/modules/**` and assumes their transcript
architecture. Take the behaviour and the edge cases they hit; leave the
structure.

**Every harvested feature has a provider question upstream does not.** CLIde
ships four adapters. Before building, name where Codex, Cursor and OpenCode
plug in or explicitly no-op, per `AGENTS.md`.

## Phases

- [ ] 1. Each gap has a verdict — one inventory row in the sync map giving what
      upstream ships, where their implementation lives, what CLIde has instead,
      the provider answer, and build/defer/refuse. No gap left in "unknown"
- [ ] 2. For each survivor, a design agreed before code: the integration point,
      the adapter answer, and what it must not inherit from `#1206`
- [ ] 3. Build in the ranked order phase 1 produces, one branch per feature,
      each with its own TODO item and its own verification
- [ ] 4. The transcript-performance question answered separately — profile
      CLIde's own transcript first, then decide

## The gaps

Ranked as they stand today; phase 1 is allowed to reorder this.

- **Composer message recall** (`#1238`). Arrow keys walk sent messages. Three
  self-contained files upstream. Client-only, provider-neutral. **Smallest real
  win of the nine.**
- **Scheduled messages** (`#1206` core, `#1239` interrupt semantics). Already
  an item in `docs/TODO.md`. Decide interrupt-versus-wait *before* building:
  upstream now interrupts a busy run, and that is a behaviour choice, not a
  detail.
- **Recent-conversations feed** (`#1041`, redrawn by `#1157`). Collides with
  CLIde's own sidebar, which already has starring, activity states and its
  action menus. The question is whether recency deserves a surface at all here,
  not how upstream drew it.
- **Provider session-id copy** (`#1040`). Small, and it touches the id space
  the glossary already cares about. Check it copies the provider id and says so
  — the two ids are exactly what `AGENTS.md` warns about confusing.
- **Collapsible model-picker groups** (`#1229`). Upstream solves a flat
  all-provider list. CLIde shows one provider at a time and drills into legacy
  models, so this is only worth it if a large catalog proves awkward in use.
  ADRs 0003 and 0025 constrain anything here.
- **Model catalog cached in SQLite** (`#1095`). CLIde caches in-process and on
  disk at a JSON path. Upstream's table survives a restart and is shared. A
  storage decision with an ADR attached, not a feature.
- **Database-backed drafts and preferences** (`#1206`). Upstream gains
  cross-device sync; CLIde's browser-local drafts keep per-device choices. Both
  are defensible — this is a product decision about who owns a draft.
- **Transcript performance** (`#1206`): server-side history caching, lazy row
  mounting, streaming markdown, scan coalescing. Real work, measured on their
  architecture. **Profile before believing any of it transfers.**
- **Spanish locale** (`#1090`). Blocked behind CLIde's own gap: the sidebar's
  keys are inline `t()` fallbacks in no locale file. Extract first, translate
  second.

## Done when

- Every one of the nine has a recorded verdict in the sync map, including the
  refusals and the reason
- Each "build" verdict has a TODO item naming its provider answer
- No feature was built by copying a post-`#1206` file into `src/components/`

## Not doing

- Adopting `#1206`'s restructure. Harvesting a capability never justifies
  moving the tree; that decision is separate and is not made here
- Re-assessing anything in the sync map's refusal table
- Building anything in phase 1. The inventory is a decision document, and the
  ranking is Grayson's to change before any code is written
