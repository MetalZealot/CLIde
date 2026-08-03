# 0024 — Token rotation does not restart auth bootstrap

- Date: 2026-08-01
- Status: Accepted

## Decision

Authentication bootstrap and authenticated token rotation are separate
lifecycle operations. `checkAuthStatus` reads the current token from storage
when it runs and must keep a stable callback identity across token changes;
adopting a refreshed token may update transport credentials, but must not
rerun the mount-time bootstrap, return `ProtectedRoute` to its loading state,
or unmount the active workspace.

## Rejected

- **Disabling token refresh or the resume keep-alive.** Both are needed for a
  long-lived installed PWA: the refreshed token keeps HTTP auth alive and the
  in-memory update gives WebSocket reconnects current credentials.
- **Treating Android picker return or every visibility change as a fresh app
  boot.** The page and WebSocket can remain healthy while the system picker is
  open; rebuilding the workspace destroys transient composer state, including
  the selected file input.
- **Fixing only the attachment control.** The native overlaid input improved
  picker invocation, but no input implementation can preserve its selection
  if the auth boundary unmounts the entire application immediately afterward.

## Why

Production diagnostics in the installed Samsung Internet PWA recorded one
stable page boot, a healthy service worker and WebSocket, and a valid
`picker.change` carrying one PNG. A refreshed authenticated request then
changed `checkAuthStatus`'s identity; its mount effect ran again and unmounted
the workspace 49 ms after the picker event, causing the logo and “Setting up
workspace” screens to flicker and discarding the attachment.

Commit `4b5ac61` separates the lifecycles by reading token storage at call time
and removing token state from the bootstrap callback's dependencies, while
retaining refreshed-token state for reconnects. The fix was verified live for
cold launch, PWA resume, and image attachment; it is client-only and required
no server restart. Temporary diagnostics were removed in `05cf60c` after
acceptance.
