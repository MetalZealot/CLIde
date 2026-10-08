# 0072 — The composer has one attach row; no image-only input

- Date: 2026-10-07
- Status: Superseded by 0073

## Decision

The + menu offers only Attach files (ADR 0070's `showOpenFilePicker` row); 0070's Attach
photos row is gone. The profile picture keeps its `accept="image/*"` input.

## Rejected

**An image-only file input for chat.** On Chrome for Android it opens the system Photo
Picker, which hands Chrome a stand-in file whose size comes from the picker's database;
when that size is wrong, every read fails (crbug 428394446). On the S20 that broke the
preview and the upload for an apparently random set of photos, and copying the file at
pick time did not fix it inside the app. **A second row opening the file browser limited
to images** worked, but Grayson rejected it as two buttons to the same place.

## Why

The photo grid cannot be offered reliably for chat. The profile picture reads its one
photo immediately and keeps only a 256px copy, and has shown no failure.
