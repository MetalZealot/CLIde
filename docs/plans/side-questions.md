# /btw — side questions beside a running conversation

- Status: 4/7
- Next: phase 4 — the sheet reads the server's history
- Context: Claude Code ships `/btw` and Codex ships `/side`. CLIde matches
  Claude Code's behaviour; the mechanism is per provider

A side question is asked and answered beside the conversation. It never enters
the transcript, never appears in the sidebar, and the main run is not paused to
answer it. Unlike a single throwaway answer, side questions keep a history for
the session, so answers can be re-read and followed up.

## What each provider gives us

Measured 2026-09-14 against Claude Code 2.1.270 / Agent SDK 0.3.258 and Codex
0.154.0; Claude Code's history behaviour read from its binary 2026-09-19.

- **Claude** has a native call: `askSideQuestion()` on a query. It shares the
  conversation and the prompt cache, has no tools, and is told to say so when an
  answer would need them. Verified by probe on an idle session (answered from the
  resumed conversation, no transcript row) and mid-run on a two-turn session
  (answered while the run kept going). It sees the conversation up to the turn in
  flight, not that turn's own message. Absent from the SDK's published types.
- **Claude Code keeps a per-session side-question history** in memory: earlier
  exchanges go to each new question as context, `/btw` alone reopens the last
  answer, a question in flight survives closing the panel, and the panel offers
  copy, fork, and clear history. The SDK call takes a `history` option,
  `{ question, response, fallback_notice? }` per exchange — read from the binary,
  confirmed by probe: a follow-up answered correctly with it and not without.
- **Codex** has no one-shot. `/side` is an ephemeral fork (`thread/fork` with
  `ephemeral: true`) carrying a boundary instruction: don't continue the parent
  task, don't mutate anything, no sub-agents. Nothing forbids forking while the
  parent turn runs. A fork re-reads the thread, so it is not free the way
  Claude's is.
- **Cursor and OpenCode** have neither, and get no command.

## Contract every provider keeps

- No tools, or tools that cannot mutate. Never a permission prompt.
- Nothing on disk: no transcript row, no session row, no sidebar entry.
- History lives in server memory per app session id. It survives closing the
  sheet, a refresh, and moving between devices, and clears on a CLIde restart —
  the same lifetime Claude Code gives it.
- Each new question carries the earlier exchanges, so a follow-up works.
- Asking never interrupts, steers, or delays the main run.
- Closing the sheet never cancels a question; the answer lands in the history.
  Clear is the only cancel.

## Phases

- [x] 0. **The Claude ask path, server-side.** Running session: the live query
      from the runtime's session registry (keyed by the app id). Idle session:
      resume the stored `provider_session_id` with a prompt stream that never
      yields, ask, tear down. An SDK without the call degrades to "side
      questions are unavailable". — `38ba3172`
- [x] 1. **Route and capability.** `supportsSideQuestion` in the capability
      matrix — Claude true, the rest false — one authenticated POST route, and
      `/btw` in the command menu only where the flag is true. — `f5afc006`
- [x] 2. **A first sheet.** Bottom sheet over the chat with its own input.
      Entries live only in the client and are discarded on close; phases 3–4
      replace that. The route's cancel fix is `c024d761`.
- [x] 3. **History on the server.** An in-memory store keyed by app session id,
      capped to the most recent exchanges. Asking appends a pending entry,
      passes the earlier answered exchanges as `history`, and fills the entry in
      when the answer lands — whether or not anyone is still waiting on the
      request. A GET returns the history, a DELETE clears it and cancels anything
      in flight. Unit-tested, plus a test that fails if an SDK bump drops the
      undocumented call or its `history` field.
- [ ] 4. **The sheet reads the server.** Opening loads the history; while an
      entry is pending the sheet refreshes until it lands. `/btw` with no text
      opens the sheet on the history. Each answer has a copy button; the header
      has Clear. The "nothing here is saved" line becomes "Not added to the
      conversation".
- [ ] 5. **Codex.** Same route and store, adapter-side: ephemeral fork with the
      boundary instructions and a read-only sandbox, earlier exchanges prepended
      to the question, one turn, collect the assistant text for that thread id,
      discard the fork. Flag flips true for Codex.
- [ ] 6. **Fork a side conversation into a real session.** Starts a new session
      seeded with the side exchanges, the way Claude Code's `f` does.
- [ ] 7. **Acceptance on the phone.** Installed PWA against production: ask
      during a long run, close the sheet before it answers, reopen with `/btw`,
      ask a follow-up, and confirm the chat is unchanged throughout.

## Done when

- A side question asked from the phone can be re-read on the laptop.
- Closing the sheet mid-answer and reopening shows the answer.
- A follow-up that depends on the previous side answer is answered correctly.

## Risks this plan accepts

- `askSideQuestion` and its `history` option are undocumented. The degrade path
  and a test reading the installed SDK bundle are the mitigation.
- The idle path spawns a CLI process per question — seconds, not instant.
- Server-memory history means a restart clears it. That matches Claude Code and
  keeps side chat off disk; if it proves annoying, persisting it is a separate
  decision.
