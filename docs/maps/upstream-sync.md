# Upstream sync

How CLIde takes work from `siteboon/claudecodeui` today, what has already been
decided about each upstream change, and the traps that cost time when this was
done by feel.

CLIde is a cherry-picking fork, not a tracking one. Version-number parity with
upstream was abandoned; `package.json` keeps its own number and the fork's
`main` is never expected to equal any upstream tag.

## The fork's current position

- **Merge base:** `264e0946`, upstream `v1.37.0`.
- **Structural break:** upstream `#1206` (`99ea0525`, in `v1.37.3`) moved
  `src/components/**` to `src/modules/**` across 702 files, replaced eslint
  with oxlint, and added vitest. CLIde did not follow it.
- **Consequence:** a commit **before** `#1206` can be cherry-picked. A commit
  **after** it lands in paths this fork does not have, so it is read and
  reimplemented, never applied. Check which side of `99ea0525` a commit sits on
  before planning any of it.

## The procedure

`npm run check:upstream` does the mechanical half — fetch, merge base, commit
list, the changelog span, and which PR numbers this fork already carries. It
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
6. **Record the release in the ledger below**, including the items deliberately
   refused. A refusal that is not written down gets rediscovered as a find.

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

**A missing translation key is not automatically a gap.** `#1162` added five
sidebar keys CLIde does not have, because they belong to an archive dialog
CLIde does not have. Porting them adds dead keys. Ask which component consumes
a key before counting it as missing.

**Upstream release plumbing is never a CLIde change.** npm publishing,
release-it, trusted publishing, Electron packaging, and the README rewrite are
their operational surface. The README in particular would restore upstream
branding. These are refused permanently and do not need re-assessing each time.

## Refused permanently

| Upstream | Why it is refused, not deferred |
|---|---|
| `#1159` agent model catalog | CLIde's `getProviderModels` returns `{ models, cache }`; taking it breaks the agent route |
| `#1249` comma-containing answers | CLIde's version also reconstructs custom answers containing `", "` |
| `#1274` plugin commands and skills | CLIde reads both folders and dedupes by command |
| `#1265` OpenCode Go catalog | CLIde reads the live catalog instead of hardcoding it |
| `#1162` archive dialog keys | The dialog they belong to does not exist here |
| Release plumbing, README, Electron | Upstream operations; the README would restore their branding |

## Gap inventory

The nine capabilities upstream has and CLIde does not, each read against what
this fork already ships. Assessed 2026-09-08 under
[the harvest plan](../plans/upstream-feature-harvest.md) phase 1. Everything
listed sits after `99ea0525`, so "where it lives" names research material, never
a cherry-pick source.

### Build

**Composer message recall** (`#1238`, `8f9a2e43`). Arrow keys walk previously
sent messages. Upstream: `useInputHistory.ts` plus a wiring hook and its test,
three self-contained files, no server side. CLIde has nothing — no input-history
state exists anywhere in `src/`. Provider answer: none needed; the composer is
above the adapter boundary. The smallest of the nine and the only one with no
open design question.

**Provider session-id copy** (`#1040`, `428b1052`). CLIde already has a
`copy-id` action in the sidebar row menu, but it copies `session.id` — the app
id — under the label "Copy session ID", which names neither id. The sidebar row
never receives `provider_session_id` at all, so this is a serializer change
before it is a menu change. Exactly the confusion the glossary exists to
prevent, and worth taking for the relabel alone. Provider answer: every adapter
has a provider id; Claude and Codex expose one per session, so the action shows
only when the row carries one.

**Scheduled messages** (`#1206` core, `#1239` interrupt semantics). The
interrupt-versus-wait question the TODO item is blocked on is already answered
here, in the other direction: `useQueuedMessageAutoSend.ts` and the composer's
`queuedDraft` queue a message against a busy session and send it when the run
ends. Upstream chose to interrupt because they had no queue. So scheduling is
"send at time T", a genuinely separate capability, and it should not inherit
`#1239`'s interrupt behaviour. Upstream's server side is four files and a
dispatcher; provider answer: the dispatcher sends through the same chat
websocket path every adapter already uses, so it is provider-neutral.

### Refuse

**Model catalog cached in SQLite** (`#1095`, `0f67810c`). The premise does not
hold here. CLIde already persists the catalog across restarts at
`~/.cloudcli/provider-models-cache.json` — versioned, per-provider entries, a
three-day TTL. Upstream's table buys durability this fork has and adds a
migration. No ADR needed; there is no decision left.

**Collapsible model-picker groups** (`#1229`, `66c0e4df`). Upstream is solving a
flat list of every provider's models at once. `ComposerModelMenu.tsx` is one
popover with three panes — the current provider's models, a providers pane, and
a legacy pane — so the problem does not occur. Revisit only if one provider's
own catalog grows awkward, which ADRs 0003 and 0025 already constrain.

**Recent-conversations feed** (`#1041`, redrawn by `#1157`). Recency already has
several surfaces here: an urgency-ordered Activity section, Pinned, starring,
persistent search, and the archive. Upstream added a feed to a sidebar that had
none of it. Adding a fourth recency surface competes with the three that work.

### Defer

**Database-backed drafts and preferences** (`#1206`). Two differences, and the
smaller one is the storage. CLIde keys drafts by `projectId` in `localStorage`;
upstream keys them per session in SQLite. Whether a draft belongs to a project
or to a conversation is a product decision, not a storage one, and it has to be
settled before the storage question is worth asking. Blocked on that answer,
not on cost.

**Spanish locale** (`#1090`). Reframed by measurement: 225 `t(key, 'fallback')`
calls across `src/components/` carry their English inline and exist in no locale
file, 122 of them in the sidebar. All nine non-English locales already render
English for those strings, so this is not a Spanish gap — adding a tenth locale
would inherit the same holes. Extract to keys first; translating is the cheap
half.

**Transcript performance** (`#1206`). Unchanged from the ledger above: server-
side history caching, lazy row mounting, streaming markdown and scan coalescing
are real, and every measurement behind them is upstream's architecture. Phase 4
of the harvest plan profiles CLIde's own transcript before any of it is
believed.

## Ledger

### v1.37.1 – v1.37.3, assessed 2026-09-08

- **Span:** 37 commits, `264e0946..5e73a49b`. Independently assessed twice, by
  Claude and by Codex, and the two disagreed on three items; the disagreements
  are what produced the traps above.
- **Already ours:** `#1074`, `#1078`, `#1085`, `#1115`, `#1036`, `#1084`,
  `#1207`, `#1274`, `#1249`, `#1265`.
- **Taken:** `#1223` editor highlighting for `.mts`/`.cts`/`.mjs`/`.cjs`. Its
  commit `aa2755b8` lands after `#1206`, in `src/modules/`, so the four `case`
  lines were applied by hand like everything else on that side of the break.
  `#1220` archived-session rescan, hand-ported — the rule and its three tests
  are upstream's, the surrounding repository is not.
  `0d517749`, which stops a failed server build destroying the running one;
  found by `check:upstream`, not by either assessment, because it carries no PR
  number and sat between two release commits. Its staging half only — the
  `preserver` recover hook fires from `npm run server`, which no CLIde
  deployment uses.
- **Deferred with a TODO item:** `#1238` composer history recall; the sidebar
  localization gap that `#1192` pointed at; `#1239` scheduled-message
  interrupt semantics, blocked on the interrupt-versus-wait decision.
- **Owned by another branch:** `#1289` GPT-6 Astra and `#1290` Codex SDK
  0.153.x. The Astra worktree owns both; this fork's adapter reads the Codex
  catalog live, so upstream's replacement runtime adapter is not the route.
- **Considered, not taken — fork has diverged by choice:** `#1041` and `#1157`
  recent-conversation rows, against CLIde's own sidebar with starring and its
  action menus; `#1229` collapsible model groups, against a picker that shows
  one provider at a time; `#1040` provider session-id copy, whose host row
  `#1157` then rewrote; `#1153` chat-view and bandwidth work, too entangled to
  separate; `#1114`, which recommends a plugin tab CLIde does not have;
  `#1020`, `#997` and `#1090` locale completions, which target upstream's key
  namespace. Revisit any of these only if the fork's own version proves worse
  in use.
- **Refused:** the table above. Upstream release commits, `release-it`, npm
  publishing and Electron packaging are classified automatically by subject
  and never need re-listing.
- **Not adopted, reconsider only on evidence:** `#1206`'s transcript
  performance work — server-side history caching, lazy row mounting, streaming
  markdown, scan coalescing. Real, but measured on upstream's architecture.
  Profile CLIde first; the restructure is the cost of entry.
- **Gap inventory:** all nine have verdicts — see the section below.
- **Structural note:** `#1206` is the reason this map exists. Everything after
  it is a reimplementation, and the fork should expect that permanently.
