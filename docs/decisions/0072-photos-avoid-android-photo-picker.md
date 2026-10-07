# 0072 — Photos are picked through the file browser, never Android's Photo Picker

- Date: 2026-10-07
- Status: Accepted

## Decision

Attach photos and the profile picture call `showOpenFilePicker` limited to image
types where it exists, so Android opens its file browser. The image-only file input
remains only as the fallback for browsers without that API.

## Rejected

**`accept="image/*"` (0070's photo row).** It opens Android's Photo Picker, which hands
Chrome a stand-in file whose size comes from the picker's database; when that size is
wrong, every read fails (crbug 428394446). On the S20 that broke the preview and the
upload for an apparently random set of camera photos, screenshots and received images
(0 of 3 readable), and copying the file at pick time did not help. **Adding one
non-image type to `accept`** also kept Chrome out of the Photo Picker (3 of 3), but it
depends on Chrome's internal rule for choosing that picker.

## Why

The image-filtered file browser read every file in all three probe rounds, and it is
the same API Attach files already uses. Losing the Photo Picker's grid is the cost.
