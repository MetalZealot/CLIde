# One generated page answers "where does this project stand"

- Status: 1/4
- Next: paused by choice — use the generated page for real project work before adding anything to it
- Context: [plans board](README.md), [maps index](../maps/README.md), [ADR 0045](../decisions/0045-html-file-preview-is-static-and-isolated.md)

Answering "what am I on, what's half-done, what's next" currently means opening
`TODO.md`, several plans, and the maps index. The dashboard aggregates what those
already say into one self-contained HTML file.

**Markdown is the authority; HTML is a lens over it.** The generator reads only
documents CLIde already maintains, so the dashboard can never be a second place
project state is kept, and disagreement always resolves to the Markdown.

## Phases

- [x] 0. A generated page renders active plans with their `Status` and `Next`, the
      backlog's shape by section and size, the maps index, and recent ADRs, each
      linking back to its source file — `scripts/build-project-dashboard.mjs`,
      `npm run docs:dashboard`, output ignored under `.generated/`. Parsers are
      unit-tested (`npm run test:docs:dashboard`); viewing it inside CLIde is what
      required the editor's HTML preview.
- [ ] 1. Use it, unchanged, for real project work. Everything below is speculative
      until that says which parts are read and which are decoration.
- [ ] 2. Surface documentation health by sharing `check-docs.mjs`'s existing rules
      rather than reimplementing them — size budgets met, and which files carry
      acknowledged debt.
- [ ] 3. Decide whether `plans/README.md` keeps its hand-maintained board. Plan
      files already own machine-readable `Status` and `Next`, so the board is a
      synchronization point the generated page could take over — leaving that
      README to own what a plan *is*, its lifecycle, and its limits.

## Done when

- Opening one file establishes what is active, where it stands, and the next
  action, without opening several Markdown files to reconstruct it.
- Editing a plan's `Status` and regenerating changes the page, with no second
  place to update.
- The generator reads only existing docs and Git: no YAML, JSON, or SQLite state
  store, since that would reintroduce the synchronization problem the Markdown
  structure already solves.

## Not doing

- Editing anything from the HTML — task state, plan phases, priorities. A page
  that writes back is a project manager, and that is a different project.
- Reproducing every TODO item, or copying map and ADR contents. The page carries
  metadata and links; archives stay unread by default, which is their point.
- A framework, a database, or a documentation website. One page, minimal
  JavaScript, useful with no interaction at all.
