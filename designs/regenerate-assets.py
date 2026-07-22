#!/usr/bin/env python3
"""Regenerate every CLIde icon/logo asset from the master SVGs in designs/.

Usage (from repo root):
    python3 designs/regenerate-assets.py

Masters:
    designs/clide-logo_dark.svg   — WHITE glyph, TRANSPARENT background, 512x512.
                                    Source of truth for all app assets.
    designs/clide-logo_light.svg  — #141414 glyph, transparent. No app consumer yet
                                    (for docs/README on light surfaces).

Outputs (all derived from the dark master):
    public/icons/icon-{72..512}.png          rounded 25%, #141414 bg  (PWA manifest, purpose "any")
    public/icons/apple-touch-icon-{152,180}.png  opaque FULL-BLEED square (iOS masks itself;
                                             transparency turns black on iOS — never round these)
    public/favicon.png (32) + favicon.svg    rounded, #141414 bg
    public/logo.svg                          white glyph, transparent (auth screens + sidebar tile)
    public/logo-128.png                      white glyph, transparent (sw.js notification BADGE —
                                             Android tints badges to a silhouette)
    public/logo-{32,64,256,512}.png          rounded, #141414 bg (logo-256 = sw.js notification icon)

Gotchas learned 2026-07-21 (don't relearn these):
  * manifest icons must stay purpose "any" — "maskable" causes the Samsung splash white-box.
  * Icon bg #141414 == manifest background_color, so rounded corners are invisible on the
    splash screen; they only matter on launchers/desktop.
  * If Samsung's launcher ever shows white corner slivers, flatten the manifest set to
    opaque squares (set ROUNDED_FRAC = None) — that was the pre-2026-07-21 shipped state.
  * Keep the master a plain filled path (flatten stroke tricks via Inkscape
    Stroke-to-Path + Difference) so this script stays dumb. Inkscape is installed on the
    Pi for exactly that kind of path surgery; rendering here uses rsvg-convert + Pillow.

Requires: rsvg-convert (librsvg2-bin), Pillow.
"""

import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "designs" / "clide-logo_dark.svg"
PUB = ROOT / "public"
BG = (20, 20, 20, 255)  # #141414
ROUNDED_FRAC = 0.25  # corner radius as a fraction of icon size; None = opaque square

MANIFEST_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
APPLE_SIZES = [152, 180]
LOGO_PNG_SIZES = [32, 64, 256, 512]  # logo-128 is the transparent badge, handled separately


def render(svg: Path, size: int, out: Path) -> None:
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), str(svg), "-o", str(out)],
        check=True,
    )


def glyph(size: int) -> Image.Image:
    tmp = ROOT / "designs" / ".glyph-tmp.png"
    render(MASTER, size, tmp)
    im = Image.open(tmp).convert("RGBA")
    tmp.unlink()
    return im


def icon(size: int, rounded: float | None) -> Image.Image:
    im = Image.new("RGBA", (size, size), BG)
    im.alpha_composite(glyph(size))
    if rounded:
        ss = 4  # supersampled mask for clean antialiasing
        mask = Image.new("L", (size * ss, size * ss), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size * ss - 1, size * ss - 1], radius=int(size * ss * rounded), fill=255
        )
        im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


def master_geometry() -> tuple[str, str]:
    """Extract the glyph path + layer transform from the master (Inkscape SVG)."""
    src = MASTER.read_text()
    d = re.search(r'<path[^>]*?\sd="(m [^"]+)"', src, re.S).group(1)
    tf = re.search(r'<g[^>]*transform="(translate\([^)]+\))"', src, re.S)
    return d, (f' transform="{tf.group(1)}"' if tf else "")


def main() -> None:
    for s in MANIFEST_SIZES:
        icon(s, ROUNDED_FRAC).save(PUB / "icons" / f"icon-{s}x{s}.png")
    for s in APPLE_SIZES:
        icon(s, None).save(PUB / "icons" / f"apple-touch-icon-{s}x{s}.png")
    icon(32, ROUNDED_FRAC).save(PUB / "favicon.png")
    for s in LOGO_PNG_SIZES:
        icon(s, ROUNDED_FRAC).save(PUB / f"logo-{s}.png")
    glyph(128).save(PUB / "logo-128.png")

    d, tf = master_geometry()
    (PUB / "logo.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n'
        f'<path{tf} fill="#ffffff" d="{d}"/>\n</svg>\n'
    )
    (PUB / "favicon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n'
        f'<rect width="512" height="512" rx="128" ry="128" fill="#141414"/>\n'
        f'<path{tf} fill="#ffffff" d="{d}"/>\n</svg>\n'
    )
    print("Regenerated all assets. Remember: npm run build:client + SSH restart of 3001;")
    print("the S20 PWA icon updates when the WebAPK refreshes (or reinstall to force it).")


if __name__ == "__main__":
    sys.exit(main())
