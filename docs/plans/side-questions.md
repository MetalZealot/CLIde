# /btw — a side question that leaves no trace

- Status: 1/5
- Next: phase 1 — route, capability flag, and the command in the menu
- Context: Claude Code ships `/btw` and Codex ships `/side`. CLIde copies the
  intent, not either mechanism

A side question is one question, one answer, discarded. It never enters the
conversation, never reaches a transcript, never appears in the sidebar, and the
main run is not paused to answer it. Anything needing follow-ups or file access
is a fork, which `/rewind` and the New Session launcher already cover.

## What each provider gives us

Measured 2026-09-14 against Claude Code 2.1.270 / Agent SDK 0.3.258 and Codex
0.154.0.

- **Claude** has a native one-shot: `askSideQuestion()` on a query. It shares the
  conversation and the prompt cache, has no tools, and is told to say so when an
  answer would need them. Verified by probe: on an *idle* session, resuming with
  a prompt stream that never yields and asking still answers from the resumed
  history, and writes nothing to the transcript. The method is absent from the
  SDK's published types — phase 0 owns that risk.
- **Codex** has no one-shot. `/side` is an ephemeral fork (`thread/fork` with
  `ephemeral: true`) carrying a boundary instruction: don't continue the parent
  task, don't mutate anything, no sub-agents. Read from its source: nothing
  forbids forking while the parent turn runs. A fork re-reads the thread, so a
  Codex side question is not free the way Claude's is.
- **Cursor and OpenCode** have neither, and get no command.

## Contract every provider keeps

The app owns the promise; the adapter picks the mechanism.

- One question in, one answer out, no follow-ups on the same panel entry.
- No tools, or tools that cannot mutate. Never a permission prompt.
- Nothing persisted: no transcript row, no session row, no sidebar entry.
- Asking never interrupts, steers, or delays the main run.
- Closing the panel abandons the answer; a question already sent is cancelled.

## Phases

- [x] 0. **The Claude ask path, server-side.** One service taking the app
      session id and a question. Running session: `askSideQuestion` on the live
      query from the runtime's session registry (keyed by the app id). Idle
      session: resume the stored `provider_session_id` with a non-yielding
      prompt stream, ask, tear down. Returns the answer plus the model-fallback
      notice when there is one. Unit-tested against a stubbed query, including
      the case where the SDK no longer exposes the method — that must degrade to
      "side questions are unavailable", never crash a chat. Verified end to end
      against a real idle session: answered from the resumed conversation and the
      transcript kept exactly its original two rows.
- [ ] 1. **Route and capability.** `supportsSideQuestion` in the capability
      matrix — Claude true, the rest false — and one authenticated POST route
      returning the answer, with an abort on client disconnect. `/btw` (alias
      `/side`) appears in the command menu only where the flag is true.
- [ ] 2. **The panel.** A bottom sheet over the chat, main stream untouched underneath.
      Shows the question, a thinking state, then the answer as markdown. Earlier
      side questions in that session stay listed while the panel lives and are
      gone when it closes. Answer never enters the message list. Verified in the
      Browser tab on a branch-test slot, on a session with a run in flight.
- [ ] 3. **Codex.** Same route, adapter-side: ephemeral fork with the boundary
      instructions and a read-only sandbox, one turn, collect the assistant text
      for that thread id, discard the fork. Flag flips true for Codex. Same
      panel, no UI change.
- [ ] 4. **Acceptance on the phone.** Installed PWA against production: ask
      during a long run, confirm the run is unaffected and the chat is unchanged
      after closing the panel.

## Risks this plan accepts

- `askSideQuestion` is undocumented in the SDK types. Phase 0's degrade path and
  a unit test are the whole mitigation; the upgrade ledger gets a line so the
  next SDK bump re-checks it.
- The idle path spawns a CLI process per question — seconds, not instant. If
  that reads badly in use, the fix is the panel's waiting state, not a different
  mechanism.
- A Codex side question costs a full re-read of the thread. Phase 3 says so in
  the panel rather than pretending parity.
