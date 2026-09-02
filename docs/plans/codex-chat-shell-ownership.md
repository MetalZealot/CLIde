# Codex native compaction and Chat-Shell thread ownership

- Status: not started
- Next: make a failed Codex Shell resume stop instead of silently opening a fresh thread
- Context: [Codex transport map](../maps/2026-07-25-codex-chat-transport-architecture.md), [Codex surface map](../maps/codex-cli-sdk-app-server.md), [ADR 0034](../decisions/0034-codex-managed-native-runtime.md), [official App Server contract](https://developers.openai.com/codex/app-server), [upstream writer-retention issue](https://github.com/openai/codex/issues/37450)

## Required contract

- One provider thread has one write-capable owner: Codex App Server Chat, a CLIde Shell PTY, or an external Codex process.
- Browser tab selection is not ownership. A detached Shell keeps ownership while its PTY lives; an App Server keeps ownership until Codex confirms that the thread is closed.
- A session's checkout is its explicit CLIde project identity, not the working directory of an individual tool call. Sideways work in another checkout never moves the header, session listing, database row, or native thread; any future move is a separate explicit user action.
- Shell opened from an existing session either resumes that session's mapped native thread or stops. The current `codex resume <provider_session_id> || codex` fallback turns any resume failure into an unrelated blank thread and must be removed before ownership handoff work.
- CLIde never deletes Codex lock files, guesses that an owner is stale, kills an active turn, or retries accepted work through another transport.
- A conflict known to CLIde is prevented before a second process starts. An unknown external owner becomes a structured, actionable state instead of raw `already has an active writer` text.
- Manual compaction is a provider action, not assumed prompt syntax. Codex uses `thread/compact/start`; Claude may continue mapping the same intent to its native `/compact` prompt.

## Phases

- [ ] 0. Make failed resume fail closed — remove Codex Shell's command-level fresh-thread fallback when a selected session supplies a mapped `provider_session_id`. A nonzero resume exit must leave the terminal stopped with the real error and must not invoke Codex a second time; opening Shell without a selected session still starts a new thread. Cover both paths in the existing native-runtime and Shell WebSocket test files, then live-check that an App-Server-owned Chat thread cannot turn into an unlabelled blank Shell thread.
- [ ] 1. Prove the lifecycle and freeze the interaction contract — add protocol fixtures for `thread/compact/start`, `contextCompaction`, `thread/unsubscribe`, and `thread/closed`; measure when 0.147 and 0.149 release the writer after unsubscribe, App Server shutdown, TUI `/quit`, PTY exit, socket detach, and the 30-minute retention timeout. Before visual work, agree one compact state near the affected surface: history remains readable, writing is disabled, the current owner is named, and an explicit handoff control warns before ending a live process.
- [ ] 2. Make manual compaction a typed provider action — replace `supportsCompactCommand`'s prompt-only assumption with a provider-neutral manual-compaction capability and backend action. Codex addresses the stored `provider_session_id`, calls `thread/compact/start` on the selected managed runtime, and normalizes `contextCompaction` progress and completion through the existing Chat run. Do not create a fake user turn, feed `/compact` to the model, or accept custom instructions where the native method cannot honor them.
- [ ] 3. Give the backend one ownership registry — place the registry in the Providers module and export only the claim, release, status, and handoff operations needed by the WebSocket module. Key it by provider plus native thread id. Codex Chat claims on successful start/resume and releases only after confirmed unload/close; Shell claims after its resume target resolves and releases on actual PTY exit, not WebSocket disconnect. Wire Shell through injected module-barrel dependencies so neither module deep-imports the other.
- [ ] 4. Add safe handoff and conflict recovery — block Shell startup while Chat has an active turn; when Chat is idle, unsubscribe and wait for `thread/closed` before starting Shell. Block Chat sends while the Shell PTY owns the thread; an explicit handoff ends the PTY only after confirmation, then waits for process exit before resuming Chat. If Codex still reports an active writer while CLIde owns neither side, identify it as an external Codex client and direct the user to exit that client; never remove its lock or auto-retry.
- [ ] 5. Surface ownership without pretending the views mirror — Chat keeps transcript browsing available but disables its composer while Shell owns the thread, naming Shell and offering the agreed handoff action. Shell shows an equivalent non-terminal state while Chat owns the writer. Ownership changes broadcast to every connected browser and survive browser/PWA reconnect because the backend process registry, App Server events, and PTY lifecycle own truth.
- [ ] 6. Close the provider and device gates — cover claim races, disconnect retention, confirmed release, external-owner fallback, native compaction without `turn/start`, exactly-once completion, and no mid-turn takeover. Run the focused Codex suite, WebSocket tests, server/client typechecks and builds, then the isolated live matrix on both managed Codex versions: failed resume never starts fresh, Chat compact then continue, Chat to Shell, Shell `/quit` to Chat, detached Shell to Chat, two browser clients, and installed-PWA reconnect. Update the two Codex maps, compatibility guard, conformance matrix, upgrade ledger, and upstream-candidate classification with verified results.

## Done when

- Opening Shell from an existing Codex session can never fall through to an unrelated fresh thread; a failed resume stops with an honest error.
- `/compact` in Codex Chat compacts through App Server, visibly completes, and the next Chat turn continues the same CLIde session and native thread.
- Chat and Shell cannot concurrently launch writers for a thread CLIde owns; each surface names the current owner and provides the agreed safe next action.
- A detached Shell remains truthfully owned until its PTY exits, while `/quit` makes Chat available without a service restart or timeout.
- An external Codex writer produces an actionable external-owner state and leaves its process and lock untouched.
- Automated contracts pass on 0.147 and 0.149, and Grayson verifies the handoff and compaction flows in the installed PWA.

## Not doing

- Automatically changing a session's checkout, header, or project row from tool-call or transcript working directories.
- Mirroring the Codex TUI transcript, picker state, or every slash command into Chat.
- Supporting simultaneous writers or merging independently appended thread histories.
- Folding the full Codex command-surface audit into this work.
- Opening or updating an upstream issue or PR without explicit approval.
