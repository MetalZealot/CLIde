# Opt-in diagnostics flight recorder

- Status: not started
- Next: Phase 0 — re-audit bootstrap, Settings registry, auth refresh, WebSocket
  and service-worker boundaries against post-v1.37 `main` before writing code.
- Context: the temporary recorder that proved the method — added `30f3498`,
  integrated `929a2dc`, removed after acceptance in `8aee41e`/`05cf60c`

**Why this is worth building:** the throwaway version earned its keep. During the
Samsung Internet attachment investigation it captured a stable page boot, a
healthy service worker and WebSocket, and a valid `picker.change` — then an
authenticated token refresh followed by the workspace unmounting 49 ms later.
That timeline disproved the picker and service-worker hypotheses and identified
auth bootstrap as the cause.

Use those commits as evidence and a source of tested ideas, **not a patch to
cherry-pick**. The old implementation was coupled to that one investigation and
carried behaviour-changing experimental resume-probe switches that have no place
in a permanent observation mode.

Size is not the risk. The old core and panel were 16 KB of source, ~4.6 KB
gzipped, against a main bundle of 2.8 MB raw / 848 KB gzipped. The real
constraints are **runtime inertness, privacy, event quality, and maintenance**.

## Phases

- [ ] **0. Post-v1.37 re-audit.** Map the final bootstrap, Settings registry, auth
      refresh, WebSocket, service worker, router, root boundaries, and attachment
      implementation. Re-measure the bundle baseline. Check whether upstream added
      diagnostics, error boundaries, or logging utilities worth adapting rather
      than duplicating. Confirm the URL query parameter does not collide with
      upstream.
- [ ] **1. Recorder core.** Versioned enable/report storage; typed events,
      redaction, ordering, bounded retention, batching, flushing, corruption
      recovery, export; idempotent `startDiagnostics()`/`stopDiagnostics()`; query
      activation *before* React bootstrap. Unit tests before any probe exists.
- [ ] **2. Baseline probes.** Lifecycle/environment, service worker, auth,
      WebSocket, app-boundary, navigation, minimal user actions — each installed
      at its real ownership boundary, each with symmetric cleanup and no duplicate
      listeners under Strict Mode or remounts. Keep provider-specific logic behind
      adapters or typed categories; shared diagnostic events must not become
      Claude-only.
- [ ] **3. Settings screen.** Extend the Diagnostics destination from the
      [system diagnostics plan](system-diagnostics.md) with the recorder toggle,
      status, count, Copy, Clear and Reload actions; if that plan has not landed,
      register the same destination once. Add an enabled-only compact affordance
      outside remount-prone content; retain one scroll container, i18n keys in
      every locale, accessibility and safe-area coverage.
- [ ] **4. Isolated live acceptance.** Serve the worktree on the branch-test
      server, have Grayson run the real device flows and copy a report. Fix only
      diagnostic-mode defects on this branch — do not opportunistically repair
      unrelated failures the report happens to expose. Installed-PWA acceptance
      against the production build is a separate later milestone.

## Done when

Diagnostics is discoverable in Settings, visibly indicates active recording,
starts early enough to catch boot and installed-PWA lifecycle failures, keeps
events ordered across workspace remounts and page resumes, and stays effectively
inert while disabled. Reports remain local and explicitly user-exported. The URL
escape hatch works when Settings itself cannot open.

## Not doing

Analytics, crash reporting, usage telemetry, or any remote upload. Recording
prompts, responses, tool arguments or results, transcripts, or user documents.
Replacing server logs, provider-native diagnostics, Browser MCP, or performance
profiling. Monkey-patching `fetch`, WebSocket, React, or browser APIs to capture
everything automatically. Behaviour-changing experiment switches in permanent
Settings. A server-side report collector in v1. Restoring the old 650-line patch
unchanged.
