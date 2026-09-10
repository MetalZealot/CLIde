# Codex native compaction and thread ownership

- Status: not started
- Next: make a failed Codex Shell resume stop instead of silently opening a fresh thread
- Context: [Codex transport map](../maps/2026-07-25-codex-chat-transport-architecture.md), [Codex surface map](../maps/codex-cli-sdk-app-server.md), [ADR 0034](../decisions/0034-codex-managed-native-runtime.md), [official App Server contract](https://developers.openai.com/codex/app-server), [upstream writer-retention issue](https://github.com/openai/codex/issues/37450)

## What is known

- Codex enforces one active writer per native thread. This lock behavior is observed in current Codex, not documented in the public App Server contract; a browser view is not an owner.
- An external App Server previously kept its writer after its TUI received `/quit`; only ending the identified App Server released it. Visible interaction ending is not release evidence.
- The error later reproduced with no Shell process: port 3003 resumed a thread whose transcript and advisory writer lock production CLIde's App Server held. Its CLIde database and `HOME` were separate, but Codex sessions and writer locks resolved through symlinks to the same real store. Isolation must be judged at Codex storage, not database or tab level.
- Officially, `thread/read` does not load or subscribe while `thread/resume` loads. After the last `thread/unsubscribe`, an inactive thread may stay loaded for 30 minutes before `thread/closed`. Whether writer release coincides with that event needs measurement.

## Required contract

- One native thread has one writer across every CLIde service and external client sharing its Codex storage. A process-local registry cannot enforce this.
- History browsing must not claim the writer. Use the read-only App Server path where possible; resume only for work that needs a loaded thread.
- Tab selection and WebSocket attachment are not ownership. A detached Shell owns while its PTY lives; an App Server potentially owns until lifecycle evidence proves release.
- A session's checkout is its explicit CLIde project identity, not a tool call's working directory. Sideways work never moves its header, database mapping, or native thread.
- Shell opened from an existing session either resumes that session's mapped native thread or stops. The current `codex resume <provider_session_id> || codex` fallback turns any resume failure into an unrelated blank thread and must be removed before handoff work.
- CLIde never deletes Codex lock files, guesses that an owner is stale, kills an active turn, or retries accepted work through another transport.
- Prevent an attributable conflict before a second writer starts. Make an unattributed owner actionable instead of raw error text; another CLIde instance may be the unknown owner.
- Manual compaction is a provider action, not assumed prompt syntax. Codex uses `thread/compact/start`; Claude may continue mapping the same intent to its native `/compact` prompt.

## Phases

- [ ] 0. Make failed resume fail closed — remove Shell's fresh-thread fallback when a selected session supplies `provider_session_id`. A failed resume stops with the real error and never invokes Codex again; Shell without a session still starts fresh. Cover both paths in existing tests, then live-check that an owned thread cannot become an unlabelled blank one.
- [ ] 1. Prove the lifecycle and agree the interaction — add fixtures for read, resume, loaded-list, unsubscribe, closed, compact, and compaction events. On the current managed Codex, measure release after unsubscribe, close, App Server shutdown, TUI `/quit`, PTY exit, socket detach, and retention timeout. Repeat across two CLIde services sharing resolved sessions and locks; record processes, descriptors, lock identity, and events. Agree one UI state: readable history, disabled writing, supported owner label, and a warning before handoff ends a process.
- [ ] 2. Make manual compaction a typed provider action — replace `supportsCompactCommand`'s prompt assumption with a provider-neutral capability and backend action. Codex calls `thread/compact/start` for the stored native id and normalizes progress through the existing Chat run. Do not create a fake turn or feed `/compact` to the model.
- [ ] 3. Establish one ownership authority — coordinate every local CLIde process sharing effective Codex sessions and locks; a per-server map is insufficient. Scope identity by provider, native id, and measured storage identity so isolated stores do not block each other. Chat claims on start/resume and releases after proven unload; Shell claims after resolving its target and releases on PTY exit, not browser disconnect.
- [ ] 4. Add safe handoff and recovery — block a second writer during an active turn; when idle, prove release before starting it. Explicit handoff ends a PTY only after confirmation and waits for exit before Chat resumes. Distinguish a known CLIde service from an external client only with evidence; otherwise report another Codex client. Never remove its lock or auto-retry.
- [ ] 5. Surface ownership without pretending views mirror — keep Chat history readable but disable writing while owned elsewhere. Name Chat, Shell, another CLIde instance, or an unknown client only when supported. Shell shows the equivalent state; backend/App Server/PTY lifecycle, not browser connection, owns truth.
- [ ] 6. Close the gates — cover claim races, cross-process conflict, read without claim, disconnect retention, release, unknown owners, native compaction, and no mid-turn takeover. Run focused Codex/WebSocket tests, typechecks, builds, then live-check failed resume, Chat compact, Chat/Shell handoff, `/quit`, detached Shell, two CLIde services, two browsers, and PWA reconnect. Update the Codex maps, guard, matrix, ledger, and upstream classification.

## Done when

- Opening Shell from an existing Codex session can never fall through to an unrelated fresh thread; a failed resume stops with an honest error.
- Browsing a thread does not claim its writer; starting work either claims it once or reports the actual known ownership class without changing the thread.
- `/compact` in Codex Chat compacts through App Server, visibly completes, and the next turn continues the same CLIde session and native thread.
- Chat, Shell, and separate CLIde services cannot launch concurrent writers against shared storage; each gives a safe next action.
- A detached Shell remains owned until PTY exit; `/quit` releases through the measured lifecycle without restart or guesswork.
- An unattributed writer leaves its process and lock untouched.
- Contracts pass on the current managed Codex, and Grayson verifies handoff and compaction in the installed PWA.

## Not doing

- Automatically changing a session's checkout, header, or project row from tool-call or transcript working directories.
- Mirroring the Codex TUI transcript, picker state, or every slash command into Chat.
- Supporting simultaneous writers or merging independently appended thread histories.
- Treating a separate CLIde database or fake `HOME` as Codex isolation without checking the resolved storage paths.
- Folding the full Codex command-surface audit into this work.
- Opening or updating an upstream issue or PR without explicit approval.
