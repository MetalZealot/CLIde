# The last backend JavaScript becomes TypeScript

- Status: not started
- Next: Phase 1 — rename the Codex runtime to `.ts` in its own commit, then type it using upstream's `codex-runtime.provider.ts` as a reference
- Context: [backend module standards](../../.agents/skills/backend-module-standards/SKILL.md), [upstream sync](../maps/upstream-sync.md), [code anchors](../maps/code-anchors.md) for which id a runtime is addressed by

Six server files are still JavaScript, and the server's `checkJs` is off, so
`typecheck` reads none of them. Four are the provider runtimes, the code that
starts each provider's CLI and streams its turn back, where a mixed-up
`session_id` / `provider_session_id` has already caused real defects.

## Rules for every phase

- **Two commits per file:** `git mv` to `.ts` with no other change, then the
  types. History and blame follow the file, and git's rename detection keeps
  upstream fixes to the old `.js` path cherry-pickable.
- **No behaviour change.** A defect found while typing gets its own commit or
  TODO line, never a ride in the conversion.
- Type against the existing `IProviderRuntime` contract and `server/shared/`
  types. A new shared type needs two consumers.
- A test beside its source moves into the module's `tests/` folder as `.ts` in
  the same phase. New cases go into an existing test file.

## Phases

- [ ] 1. Codex runtime (653 lines) and `server/shared/codex-token-usage.js`
  (37) are TypeScript. Upstream converted its copy already, so this moves the
  fork closer to upstream. The runtime has no test; add run and abort cases to
  an existing Codex test file. Proof: a Codex chat turn on 3001 runs, stops
  mid-turn, and resumes.
- [ ] 2. The notification orchestrator (320) is TypeScript. Proof: a push
  notification reaches the phone when a background turn finishes.
- [ ] 3. The Cursor runtime (385) and its test are TypeScript. No Cursor
  account to test live, so the tests are the proof.
- [ ] 4. The OpenCode runtime (437) and its test are TypeScript. Same proof as
  phase 3.
- [ ] 5. The Claude runtime (1,483) is TypeScript. Last and on its own: it is
  the daily driver, and upstream still ships it as JavaScript and keeps fixing
  it, so this is where cherry-picks cost the most afterwards. Split it across
  two sessions if one does not fit. Proof: a Claude turn with a permission
  prompt, a stop, and a resume on 3001.
- [ ] 6. The conversion stays done: a check fails when a `.js` file appears
  under `server/modules/` or `server/shared/`, `allowJs` leaves the server
  tsconfig if nothing else needs it, and `AGENTS.md` drops the JavaScript
  runtime exception.

## Done when

- `find server/modules server/shared -name '*.js'` prints nothing.
- `npm run typecheck` passes with the check from phase 6 in place.
- Claude and Codex chats on 3001 send, stop, and resume.

## Not doing

- Untangling the import loop between each runtime and the provider registry.
  Loading a runtime file directly, without the registry, crashes; the app never
  does that, so it only matters to a test that imports a runtime on its own.
- JavaScript outside `server/` (`scripts/`, the root `shared/`).
