# Upstream sync

How CLIde takes work from `siteboon/claudecodeui`, and the traps that cost time
when this was done by feel. What has been decided about each upstream change is in
[`upstream-verdicts.tsv`](upstream-verdicts.tsv), which `check:upstream` reads.

CLIde is a cherry-picking fork, not a tracking one. Version-number parity with
upstream was abandoned; `package.json` keeps its own number and the fork's
`main` is never expected to equal any upstream tag.

## The fork's current position

- **Merge base:** `check:upstream` prints it.
- **Structural break:** upstream `#1206` (`99ea0525`, in `v1.37.3`) moved
  `src/components/**` to `src/modules/**` across 702 files, replaced eslint
  with oxlint, and added vitest. CLIde did not follow it.
- **Consequence:** a commit **before** `#1206` can be cherry-picked. A commit
  **after** it lands in paths this fork does not have, so it is read and
  reimplemented, never applied. Check which side of `99ea0525` a commit sits on
  before planning any of it.
- **Runtime layer off upstream (ADR 0065):** provider runtime adapters, the chat
  gateway and run registry, and the chat message and event types are never
  cherry-picked. An upstream change there is read, then reimplemented or skipped,
  with a verdict line recorded.

## The procedure

`npm run check:upstream` does the mechanical half — fetch, merge base, commit
list, the changelog span, and which upstream commits already have a verdict or are
carried in git. It
reports and never gates, like `check:providers`. What follows is the judgement
half.

1. **Run `npm run check:upstream`.** Read the whole changelog span between the
   merge base and the newest tag, not just the newest entry. Upstream squashes
   a release's worth of work into a few PRs, so one entry routinely hides a
   restructure.
2. **Sort every commit into one of four buckets** before assessing any of them:
   already ours, not applicable, take, or fork-diverged. The fourth is the
   expensive one — it is where an upstream fix and a CLIde fix solve the same
   problem differently and the comparison is real work.
3. **For "already ours", find the code, not the commit message.** Upstream
   sometimes lands a fix this fork sent them, sometimes lands the same fix
   independently, and sometimes lands a narrower version of ours. Grep the
   symbol and read both.
4. **For "take", check whether the patch applies *and* whether it is correct
   here.** These are different questions — see the trap below.
5. **Ship the small ones on one branch**, and give anything with phases its own
   plan. Add a `docs/TODO.md` item for every deferred take, so a later session
   does not re-derive it.
6. **Record every call.** Take a patch with `git cherry-pick -x`; give a
   reimplementation's commit an `Upstream: #1234` footer. Everything else gets a
   line in [`upstream-verdicts.tsv`](upstream-verdicts.tsv), refusals included: a
   refusal that is not written down gets rediscovered as a find.

## Traps

**A patch that applies cleanly and typechecks can still be wrong.** Upstream
`#1159` removed a `.models` unwrap from the agent route. Applied to CLIde it
conflicts with nothing, because the line is textually identical, and it
compiles, because `.models` is a valid property of the type either way. It is
still a defect here: upstream dropped the unwrap because their own `#1095`
changed their return shape, and CLIde's `getProviderModels` still returns
`{ models, cache }`. Testing a cherry-pick in a disposable clone proves the
patch applies; it does not prove the surrounding code means the same thing.
**Read the type and at least one other call site before taking any patch that
changes how a shared service's result is consumed.**

**Upstream hardcodes where CLIde queries.** `#1265` added twenty-nine OpenCode
model rows as literals; CLIde spawns `opencode models --verbose` and parses the
catalog. The upstream diff looks like a large gain and is a regression here.
When an upstream change adds a table of provider facts, check whether this fork
already derives them.

**CLIde is English-only.** Upstream changes to other locales, the language list
or the language picker are refused. An English key upstream adds is a gap only
if a CLIde component reads it: `#1162` added five sidebar keys for an archive
dialog CLIde does not have, and porting them would add dead keys.

**Areas CLIde removed are refused permanently.** The desktop app, the Docker
sandbox, npm release tooling, upstream's README, changelog, issue templates and
workflows, and CloudCLI's own plugin system (`server/modules/plugins`, the
plugin tabs, `plugins/starter`) were deleted on 2026-10-05; the external agent
API (`server/modules/agent`, its API keys and `api-docs.html`) on 2026-10-06. Upstream changes to
them have nothing to apply to; `check:upstream` marks a commit `removed` when
every file it touches is in one of them. Claude Code's and Codex's plugins are
a separate system and stay in scope.
