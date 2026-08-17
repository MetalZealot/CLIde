# System diagnostics and `/status` retirement

- Status: not started
- Next: Phase 1 — move process status out of Commands and into an authenticated
  System contract.
- Context: [Settings navigation](../decisions/0018-settings-drill-down-one-scroll-container.md),
  [one Settings surface](../decisions/0019-quicksettings-removal.md), and the
  [diagnostics flight recorder](diagnostics-flight-recorder.md)

## Phases

- [ ] **1. System-owned diagnostics contract.** Add an authenticated
      `GET /api/system/diagnostics` route backed by a typed System service. Report
      the running server version captured at process start, uptime seconds, Node
      version, platform, RSS memory and PID. Keep `/health` public
      and minimal; stop Commands from reading `package.json` and process state.
- [ ] **2. Settings destination.** Register a top-level Diagnostics screen in the
      System group, with search metadata and locale keys. Show installed UI versus
      running server versions and a restart-required mismatch, then the useful
      server environment fields and a Copy diagnostics action. Keep product/update
      information in About and active provider/model information in the composer;
      do not label a successful request as proof that the whole system is healthy.
- [ ] **3. Retire the Chat-only surface.** Remove `/status` from the visible
      built-in list, Help results and `CommandResultModal`, including its unused
      response fields and presentation types. Retain `/status` as a hidden
      compatibility alias that opens Settings directly at Diagnostics, matching
      the existing hidden `/cost` alias pattern.

## Done when

- Diagnostics opens from Settings without requiring a project, session or Chat.
- It distinguishes installed UI state from the server version actually running
  and produces a copyable troubleshooting snapshot.
- Provider/model remain session-owned Chat information; package name and the
  unconditional Healthy badge are gone.
- `/status` is absent from command discovery but an old invocation lands on the
  canonical Diagnostics screen.
- The flight recorder can add its controls to the same screen without another
  Settings destination or scroll container.

## Not doing

The flight recorder itself, analytics, remote reporting, performance profiling,
continuous monitoring, or health claims about the database, WebSocket and
provider runtimes. Provider-specific runtime diagnostics stay on their provider
Settings screens.
