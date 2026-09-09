# Harvest the capabilities CLIde lacks from upstream

- Status: 1/4
- Next: Grayson ranks the three "build" verdicts, then each gets a design
  agreed before code
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

- [x] 1. Each gap has a verdict — the [gap inventory](../maps/upstream-sync.md)
      holds all nine: three build, three refuse, three defer. Two premises were
      wrong and are recorded as such — the model-catalog cache and the Spanish
      locale
- [ ] 2. For each survivor, a design agreed before code: the integration point,
      the adapter answer, and what it must not inherit from `#1206`
- [ ] 3. Build in the ranked order phase 1 produces, one branch per feature,
      each with its own TODO item and its own verification
- [ ] 4. The transcript-performance question answered separately — profile
      CLIde's own transcript first, then decide

## The gaps

Verdicts, evidence and the provider answer for each of the nine live in the
[gap inventory](../maps/upstream-sync.md). Summary only:

| Gap | Verdict |
|---|---|
| Composer message recall (`#1238`) | build — smallest, no open design question |
| Provider session-id copy (`#1040`) | build — fixes an ambiguous existing action |
| Scheduled messages (`#1206`, `#1239`) | build — unblocked; CLIde already queues |
| Model catalog in SQLite (`#1095`) | refuse — ours already survives a restart |
| Collapsible model-picker groups (`#1229`) | refuse — the flat list never occurs here |
| Recent-conversations feed (`#1041`, `#1157`) | refuse — three recency surfaces already |
| DB-backed drafts and preferences (`#1206`) | defer — project-scoped or session-scoped is the real question |
| Spanish locale (`#1090`) | defer — 225 strings sit in no locale file; extract first |
| Transcript performance (`#1206`) | defer — phase 4, profile first |

Build order is Grayson's to set; the ranking above is size, not priority.

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
