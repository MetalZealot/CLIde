# 0070 — Attach files uses `showOpenFilePicker`; photos get their own image-only input

- Date: 2026-10-07
- Status: Accepted

## Decision

The composer's + menu has two attach rows. **Attach files** calls
`window.showOpenFilePicker({ multiple: true })` where it exists and falls back
to the unrestricted file input elsewhere. **Attach photos** is a real file
input with `accept="image/*"`.

## Rejected

**Any `accept` on a file input for Attach files.** Re-probed on the installed
PWA (Samsung S20 FE): no `accept` and `*/*` still open the Camera / Camcorder /
Photos & videos chooser. `application/*,text/*` now opens the file browser
directly but greys out images and audio, so it cannot be "any file". Every list
that admits images brings the camera chooser back.

## Why

ADR 0026 assumed a file input was the only way to open a picker from the web.
`showOpenFilePicker` exists in Chrome for Android, opens the file browser
directly with every type selectable, and returned files in both a browser tab
and the installed PWA. `accept="image/*"` now opens Android's photo grid rather
than a chooser, which makes a photo row worth one tap. Constraint 1 of 0026
still binds both input rows: a real input owns the tap, never `input.click()`.
