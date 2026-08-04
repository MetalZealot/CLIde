# 0026 — Android's file chooser can't be shaped from the web; the composer keeps one plain input

- Date: 2026-08-04
- Status: Accepted

## Decision

The composer's paperclip stays a single unrestricted file input that hands
straight off to the OS chooser. On Android that chooser is ugly — two camera
tiles, and the document browser hidden behind a tile labelled "Photos &
videos" — and **that is not fixable from a web page.** Do not try to improve it
with a narrower `accept`, a MIME allowlist, or an in-app source menu.

## Rejected

**A narrower `accept` on the input.** Eleven variants were probed on the
installed PWA (Samsung S20 FE, One UI) via a throwaway page served from
`dist/`: no attribute, explicit `*/*`, `image/*`, `image/*,video/*`, `text/*`,
`application/*`, `text/*,application/pdf,application/json,application/zip`,
that list plus `.md,.ts,.py,…` extensions,
`image/*,video/*,audio/*,text/*,application/*`, and
`application/octet-stream,text/*`.

**Ten of the eleven produced an identical chooser.** Only `accept="image/*"`
alone behaved differently (Camera + My Files + Photos & videos, no camcorder).
Notably `text/*` alone still produced a *camera* tile, which disproves the
intuitive "a capture tile per accepted media family" model. Chrome for Android
appears to narrow the picker only when the accept list is a single recognised
media family; everything else degrades to wide-open with every capture intent
attached.

**An in-app source menu (Take photo / Photos / Files), built and reverted.**
Implemented on 2026-08-04 and backed out the same day. Only one of its three
rows could do anything the plain input can't: `capture="environment"` skips the
chooser and goes straight to the camera. The other two rows led into the same
OS sheet, so the menu was an extra tap in front of an unchanged problem. A
menu that cannot change the outcome is worse than no menu.

**Restoring the pre-v1.37 image-only `accept`.** Would give a tidy chooser but
throw away the any-file uploads v1.37's server side genuinely supports
(`attachmentUpload` in `server/modules/assets/assets.routes.ts` has no
`fileFilter`).

## Why

Upstream `06e7ee9` (#1037) removed the composer's `accept` map to allow any file
type. The mobile consequence was unexamined — upstream has no issue filed on
attachments or the picker — and the wide-open input is the *worst* case for
Android's chooser rather than a neutral one. But every alternative is worse for
a real reason, so the ugly chooser is the accepted cost.

Two constraints on the current component remain load-bearing:

1. **A real input must own the tap** — never a JS `input.click()`; Android
   standalone PWAs drop the result (`d392494`).
2. **Per-input `accept` would be safe if ever needed**: react-dropzone validates
   against the *hook config* (`accept` unset = anything), not the element
   attribute — verified against the real `getInputProps`, not a stub.

The remaining path to a genuinely native file-attach flow is a Web Share Target
(share from My Files/Gallery into CLIde), which sidesteps the chooser entirely
instead of trying to reshape it. Logged in `docs/TODO.md`.

Process note worth keeping: four rounds were spent asserting Chromium's chooser
behaviour from memory and rebuilding one variant at a time. The throwaway probe
page settled the whole matrix in a single sitting. For any OS-level behaviour
that can only be observed on the device, build the probe first.
