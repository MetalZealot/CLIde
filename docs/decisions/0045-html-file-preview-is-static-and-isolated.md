# 0045 — HTML file preview is static and isolated

- Date: 2026-08-23
- Status: Accepted

## Decision

The HTML Eye toggles a sandboxed inline view of the current editor buffer, and project-relative passive assets are fetched through CLIde's authenticated file API and rewritten to temporary URLs. Workspace scripts, forms, popups, nested frames, and top-level navigation stay disabled; executable applications require a separate development-server preview.

## Rejected

The in-memory popup was rejected because installed PWAs can block it and browser refresh destroys it, while serving project HTML in CLIde's origin or putting the login token in resource URLs would expose the application boundary. A development-server proxy such as upstream's closed PR #1024 solves a different problem and does not replace safe file rendering.

## Why

Firefox and Samsung Internet rendered the popup once but lost it on refresh, the installed Samsung PWA did nothing, and project-relative links failed; the inline static model fixes those failures without letting an opened workspace execute as CLIde.
