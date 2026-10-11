# Probes

A probe is a throwaway page that puts every variant of an unsettled UI choice on
one screen, so Grayson can pick on his phone before the real thing is built.
Probes build with the app, from its own stylesheet and components, so what he
picks is what ships.

- `probe.html` lists every probe in the checkout, newest first.
- `probe.html?p=<name>` opens one. The URL keeps the chosen options and theme.
- On a phone, the tab on the left edge opens the options. On a wider screen, the
  frame is drawn phone-sized beside them.

## Writing one

Copy `harness/example.probe.tsx` to `src/probes/<name>.probe.tsx`. It appears
in the list on the next build or dev-server reload; nothing to register.

- **Axes** are the questions; each option gets a short label and a one-line
  meaning. Single-letter keys (`A`, `B`) show on the button; longer keys don't.
- **`render`** draws the content between the real header and the real composer.
  The frame supplies the header, kebab, composer and bottom nav on fake data;
  `frame` options hide any of them or pick the active tab.
- **Build variants from real components and named classes.** Import the
  component under test and pass it fake props. Where it cannot mount outside a
  live session, write the variant with the classes the implementation will use,
  never a pixel value guessed to look right.
- Shared fixtures (`ProbeChat`, `ProbeComposer`, `fixtures.ts`) live in
  `harness/`. Grow them there when a second probe needs the same thing.

## Building the chosen variant

Move the winning variant's code into the app. A size, colour or spacing that
changes on the way is a new decision and goes back to Grayson.

## Housekeeping

`src/probes/*.probe.tsx` is in `.git/info/exclude` and outside typecheck, so a
stale probe never blocks anyone. Delete one when its decision has shipped.
`harness/` is tracked and typechecked: when a component's props change, the
fixture fails typecheck instead of drifting.
