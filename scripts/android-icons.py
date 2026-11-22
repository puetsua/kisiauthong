#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 kisiauthong contributors
"""Draw the Android launcher icon of the Tauri app (apps/tauri, issue #54).

The icon is an adaptive icon in three layers, each a 108dp square:

  ic_launcher_background  the purple gradient of web/icon.svg, full bleed
  ic_launcher_foreground  the page and the coin on transparency
  ic_launcher_monochrome  the same shapes as one opaque silhouette, which
                          Android 13+ tints for themed icons

Launchers show only the middle 72dp of the layers through their own mask
(circle, squircle, rounded square, ...) and guarantee only a 66dp circle in
the middle. The page and the coin are drawn from the geometry of web/icon.svg
(a 64-unit square) at 1dp per unit, centred, so the farthest point (the edge
of the coin) is 29.5dp from the centre, inside the 33dp safe radius. The
gradient spans the visible 72dp, so the visible icon has the colours of the
web icon. The legacy ic_launcher.png and ic_launcher_round.png (48dp, unused
on Android 10+ but kept for completeness) are the middle 72dp behind a
rounded square or a circle.

The files are written to apps/tauri/src-tauri/icons/android/ and to the
committed Android project in apps/tauri/src-tauri/gen/android/. Run it from
the repository root after changing web/icon.svg (needs Python 3 and Pillow):

    python3 scripts/android-icons.py
"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [
    os.path.join(ROOT, "apps/tauri/src-tauri/icons/android"),
    os.path.join(ROOT, "apps/tauri/src-tauri/gen/android/app/src/main/res"),
]
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
SS = 8  # supersampling factor for smooth edges

CANVAS = 108  # dp, the adaptive icon layers
VIEW = 72  # dp, what a launcher shows
LEGACY = 48  # dp, ic_launcher.png
UNIT = 1.0  # dp per web/icon.svg unit
OFFSET = CANVAS / 2 - 32 * UNIT  # web/icon.svg centre (32, 32) on the canvas centre

# web/icon.svg
GRAD_FROM, GRAD_TO = (0x6D, 0x3A, 0xA0), (0x2A, 0x17, 0x40)
PAGE, LINE = (0xFF, 0xFF, 0xFF), (0xB9, 0xA6, 0xD1)
COIN, RIM, MARK = (0xF2, 0xB5, 0x3C), (0x2A, 0x17, 0x40), (0x7A, 0x4A, 0x00)
PAGE_BOX, PAGE_R = (13, 11, 45, 53), 4
LINES, LINE_W = [((19, 21), (39, 21)), ((19, 29), (39, 29)), ((19, 37), (30, 37))], 3
COIN_C, COIN_R, RIM_W = (44, 44), 11, 3
MARKS, MARK_W = [((44, 38), (44, 50)), ((40.5, 41.5), (47.5, 41.5)), ((40.5, 46.5), (47.5, 46.5))], 2.4


def stroke_box(seg, width):
    """A straight stroke with round caps as a rounded rectangle (x0, y0, x1, y1), radius."""
    (x0, y0), (x1, y1), h = seg[0], seg[1], width / 2
    return (min(x0, x1) - h, min(y0, y1) - h, max(x0, x1) + h, max(y0, y1) + h), h


class Pen:
    """Draws web/icon.svg units onto a supersampled foreground canvas."""

    def __init__(self, draw, px_per_dp):
        self.draw, self.k = draw, px_per_dp * SS

    def xy(self, x, y):
        return (OFFSET + x * UNIT) * self.k, (OFFSET + y * UNIT) * self.k

    def rrect(self, box, r, fill):
        (x0, y0), (x1, y1) = self.xy(box[0], box[1]), self.xy(box[2], box[3])
        self.draw.rounded_rectangle((x0, y0, x1, y1), radius=r * UNIT * self.k, fill=fill)

    def disc(self, c, r, fill):
        (x, y), rr = self.xy(*c), r * UNIT * self.k
        self.draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=fill)


def foreground(px):
    big = Image.new("RGBA", (px * SS, px * SS), (0, 0, 0, 0))
    pen = Pen(ImageDraw.Draw(big), px / CANVAS)
    pen.rrect(PAGE_BOX, PAGE_R, PAGE + (255,))
    for seg in LINES:
        pen.rrect(*stroke_box(seg, LINE_W), LINE + (255,))
    pen.disc(COIN_C, COIN_R + RIM_W / 2, RIM + (255,))
    pen.disc(COIN_C, COIN_R - RIM_W / 2, COIN + (255,))
    for seg in MARKS:
        pen.rrect(*stroke_box(seg, MARK_W), MARK + (255,))
    return big.resize((px, px), Image.LANCZOS)


def monochrome(px):
    """Opaque where the icon is, transparent in the lines, the rim and the coin's mark."""
    big = Image.new("L", (px * SS, px * SS), 0)
    pen = Pen(ImageDraw.Draw(big), px / CANVAS)
    pen.rrect(PAGE_BOX, PAGE_R, 255)
    for seg in LINES:
        pen.rrect(*stroke_box(seg, LINE_W), 0)
    pen.disc(COIN_C, COIN_R + RIM_W / 2, 0)
    pen.disc(COIN_C, COIN_R - RIM_W / 2, 255)
    for seg in MARKS:
        pen.rrect(*stroke_box(seg, MARK_W), 0)
    alpha = big.resize((px, px), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


def background(px):
    """The diagonal gradient of web/icon.svg across the visible 72dp, clamped outside it."""
    d = px / CANVAS
    lo = (CANVAS - VIEW) / 2
    ramp = []
    for s in range(2 * px - 1):  # s = x + y in pixels
        t = ((s + 1) / d - 2 * lo) / (2 * VIEW)
        t = min(1.0, max(0.0, t))
        ramp.append(tuple(round(a + (b - a) * t) for a, b in zip(GRAD_FROM, GRAD_TO)) + (255,))
    img = Image.new("RGBA", (px, px))
    img.putdata([ramp[x + y] for y in range(px) for x in range(px)])
    return img


def legacy(px, round_):
    """The middle 72dp of the layers behind a rounded square or a circle, 2dp padding."""
    full = round(px * CANVAS / LEGACY)  # the 108dp canvas at this density
    icon = Image.alpha_composite(background(full), foreground(full))
    cut = round(full * (CANVAS - VIEW) / 2 / CANVAS)
    icon = icon.crop((cut, cut, full - cut, full - cut))
    pad = round(px * 2 / LEGACY)
    size = px - 2 * pad
    icon = icon.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * SS, size * SS), 0)
    md = ImageDraw.Draw(mask)
    if round_:
        md.ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
    else:
        md.rounded_rectangle((0, 0, size * SS - 1, size * SS - 1), radius=size * SS * 0.18, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(icon, (pad, pad), mask)
    return out


ADAPTIVE = """<?xml version="1.0" encoding="utf-8"?>
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 kisiauthong contributors -->
<!-- Drawn by scripts/android-icons.py; the foreground and monochrome layers keep inside the 66dp safe zone. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@mipmap/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
"""


def main():
    for out in OUT:
        for name, d in DENSITIES.items():
            folder = os.path.join(out, "mipmap-" + name)
            os.makedirs(folder, exist_ok=True)
            layer = round(CANVAS * d)
            small = round(LEGACY * d)
            files = {
                "ic_launcher_background.png": background(layer),
                "ic_launcher_foreground.png": foreground(layer),
                "ic_launcher_monochrome.png": monochrome(layer),
                "ic_launcher.png": legacy(small, False),
                "ic_launcher_round.png": legacy(small, True),
            }
            for file, img in files.items():
                img.save(os.path.join(folder, file), optimize=True)
        folder = os.path.join(out, "mipmap-anydpi-v26")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "ic_launcher.xml"), "w", encoding="utf-8") as f:
            f.write(ADAPTIVE)
        old = os.path.join(out, "values", "ic_launcher_background.xml")  # the old #FFFFFF colour layer
        if os.path.exists(old):
            os.remove(old)
            if not os.listdir(os.path.dirname(old)):
                os.rmdir(os.path.dirname(old))
        print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
