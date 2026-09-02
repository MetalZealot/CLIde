# Context-correct skills settings

- Status: 3/4
- Next: Phase 4 — isolated acceptance and documentation.
- Note: the picker was accepted from a static probe before building; the
  screen itself is still unverified in the running app. See Phase 4.
- Context: [provider skills contract](../../server/modules/providers/README.md),
  [Settings navigation](../decisions/0018-settings-drill-down-one-scroll-container.md),
  [mobile Back ownership](../decisions/0040-settings-root-owns-back-gesture.md),
  [UI standards](../maps/ui-standards.md),
  [Codex skills](https://learn.chatgpt.com/docs/build-skills),
  [Claude Code skills](https://code.claude.com/docs/en/slash-commands),
  [Cursor skills](https://cursor.com/docs/skills), and
  [Copilot CLI skills](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#skills-reference)

CLIde's provider Settings screen currently asks for global skills, then asks
again for every saved project and worktree and flattens all responses into one
list. A runtime resolves skills for one active working directory, not for the
application's project catalog. Worktree copies are valid independent files and
must not be hidden by content hashes; the listing must stop combining contexts.

## Visible contract

Each Agent > Skills screen has one **Context** choice:

- **Global** is selected whenever the screen opens. It lists only that
  provider's user, plugin, admin, enterprise, and system scopes.
- Choosing one project or worktree lists the effective global skills plus the
  repository/project skills available when that exact path is the working
  directory. No other saved project is scanned.
- Project choices show the CLIde display name as the primary label and the
  checkout path as detail, so the main checkout and its worktrees remain
  distinguishable.
- A same-name skill is shown, shadowed, qualified, or repeated according to the
  selected provider's runtime rules. CLIde never substitutes cross-project
  hash deduplication for those rules.

UI buckets before implementation:

- **External requirements:** the Context picker has an accessible name,
  keyboard navigation, Escape dismissal, visible focus, and compliant target
  sizes.
- **House conventions:** reuse `SettingsChoicePopover`, retain the one
  `SettingsScreen` scroll container, and use the existing project/worktree
  identity vocabulary.
- **Maintainer choice:** Global is the stable default; inspecting local skills
  is an explicit one-project/worktree action, not an aggregate dashboard.

## Phases

- [x] **1. Truthful provider results.** Keep no-workspace requests global-only
      and make Claude read only the active plugin paths recorded in
      `installed_plugins.json`, taking each install's `skills/` and legacy
      `commands/` with skills winning a same-namespace collision. Add collision
      fixtures around Codex's path-distinct same-name entries within one
      working-directory hierarchy, and around same-name variants inside one
      Cursor workspace. Keep malformed or missing skill folders isolated from
      valid siblings. **A discovery root is only added with a provider doc or
      an observed runtime behind it** — see Corrections.
- [x] **2. One client target per request.** Replace `currentProjects` aggregation
      in `useProviderSkills` with an explicit Global-or-workspace target. Cache
      by provider and selected target, cancel stale target loads, and issue one
      request per refresh. The Skills summary row on the parent Agent screen
      reports the Global count and must not scan every project just to render a
      number. Keep the Chat slash-command path workspace-scoped and unchanged.
- [x] **3. Context choice on every supported Agent screen.** Put one searchable
      Context row above the existing skill search/add/refresh controls for
      Claude, Codex, and Cursor through their shared screen. Global comes first;
      each saved project/worktree follows with its path as detail. Reset to
      Global when the screen is reopened or the provider changes. Preserve
      source paths and scope badges, empty/loading/error states, Add Skill's
      global destination, one scroll owner, and mobile reflow.
- [ ] **4. Isolated acceptance and documentation.** Add focused backend
      provider cases plus client hook, parent-count, picker interaction, stale
      response, and narrow-screen tests without creating a near-empty test
      file. Build and serve the topic worktree on port 3002. Verify Global and
      two worktree contexts for Claude and Codex on the installed PWA; verify
      Cursor from source/tests while its runtime is unavailable. Update the
      provider map and move the TODO item only after the visible behavior is
      accepted. Merge, push, and production deployment remain separate.

## Corrections

Reviewed 2026-09-01, after Phases 1-2 landed in one commit (`4289d1f4`).
Three changes were reverted because nothing outside their own new tests
supported them. Do not reintroduce them without a provider doc line or an
observed runtime:

- **Claude project skills walking cwd up to the Git root.** Back to
  `<workspace>/.claude/skills`. Codex documents that upward walk; Claude does
  not.
- **Cursor reading Claude's and Codex's roots**, at four ancestor levels and
  recursively. Back to `<workspace>/.agents/skills`, `<workspace>/.cursor/skills`,
  and `~/.cursor/skills`. The cross-agent root list belongs to OpenCode, which
  documents it; borrowing it for Cursor advertised skills Cursor may never run.
- **Claude same-name precedence (`resolveSkillSourcePrecedence`).** It deleted
  the losing rows, so a project skill vanished from Settings with nothing to say
  why. Claude does not document how personal, synced, and project skills resolve
  a collision, so all variants are now listed. If Claude's rule is ever
  confirmed, mark the loser shadowed rather than dropping it — Settings exists
  to report what is on disk.

The plugin fix in the same commit is correct and stays: the previous code
scanned every cached *version* folder of a plugin and skipped a plugin's
`skills/` whenever it also had `commands/`. `claude-md-management` has exactly
that shape, and Claude exposes both its command and its skill.

Lesson for the remaining phases: a provable scoping fix and an unverifiable
behavior rewrite do not belong in one phase, or one commit.

## Done when

- Opening Claude Skills shows its personal and active plugin skills, but no
  `session-forensics` project copies until a project is selected.
- Opening Codex Skills shows its user and system skills, but no
  `backend-module-standards` repository copies until a worktree is selected.
- Selecting CLIde or one worktree adds only that path's local skills; switching
  targets cannot leave results from the previous target behind.
- A provider's legitimate same-name variants within one selected workspace are
  represented according to that provider's invocation rules.
- Parent Agent rows do not trigger an all-project scan, and Add Skill continues
  to install in the provider's global managed location.

## Not doing

Hashing or collapsing skills across worktrees. Deleting repository skill files,
replacing them with symlinks, or forcing worktrees to share one mutable copy.
Changing runtime skill discovery merely to simplify Settings. Combining all
providers into one skills catalog. Adding an OpenCode Skills screen before the
provider exposes that capability. Turning Skills into a general project or
worktree manager.
