# Reliable HTML file preview

- Status: complete
- Next: none — implementation and device acceptance are complete
- Context: [UI standards](../../maps/ui-standards.md), [ADR 0045](../../decisions/0045-html-file-preview-is-static-and-isolated.md)

## Phases

- [x] 1. Static HTML is prepared with scripts and navigation capabilities disabled, while project-relative passive assets are fetched through the authenticated file API.
- [x] 2. The editor Eye toggles an inline preview of the current buffer; Reload refetches dependencies, project links open in CLIde, fragments stay in the document, and external HTTPS links use the browser.
- [x] 3. Focused tests and the client build pass; Firefox, Samsung Internet, and a Samsung-installed PWA agree on rendering, Code/Preview switching, and project-document links.

## Done when

- The HTML Eye never depends on a popup, and failures are visible.
- Unsaved HTML and project-relative CSS, images, fonts, and media render without exposing an authentication token in a URL.
- Project-file links, including Markdown, open in CLIde; fragment links remain in the preview.
- Workspace HTML cannot run scripts, submit forms, open popups, or navigate CLIde.
- The generated project dashboard remains paused until the preview is accepted on device.

## Not doing

- Running project JavaScript or development servers inside the file preview.
- Building a dashboard-specific renderer or resuming dashboard work.
- Adding a public or token-bearing project-file URL.
