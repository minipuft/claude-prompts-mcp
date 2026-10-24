#!/usr/bin/env python3
"""Row 4.2b: the crayon world's lit patch changes pixels only inside the emitter's radius.

usage: measure-crayon-light.py <before.png> <after.png> [--x 1040 --y 390 --r 170]   (defaults: the world sheet's join, at the sheet's 170 px radius; stage pixels = frame pixels at 1280x720)
Prints the MAD and the count of differing pixels outside and inside the circle, and the distance of the farthest differing pixel. "Outside" starts MARGIN px past the radius (default 2): the crayon filter displaces what it draws by up to about 2 px, so a stroke thinned just inside the edge lands just outside it. Control: a copy of <after> with one pixel changed just outside the circle must read non-zero outside.
"""
import argparse, sys
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument("before"); ap.add_argument("after")
ap.add_argument("--x", type=float, default=1040); ap.add_argument("--y", type=float, default=390); ap.add_argument("--r", type=float, default=170); ap.add_argument("--margin", type=float, default=2)
ap.add_argument("--side-by-side", default=None, help="also write before | after with the emitter and its radius marked")
a = ap.parse_args()
load = lambda p: np.array(Image.open(p).convert("RGB")).astype(int)
b, c = load(a.before), load(a.after)
if b.shape != c.shape: sys.exit(f"shapes differ: {b.shape} {c.shape}")
yy, xx = np.mgrid[:b.shape[0], :b.shape[1]]; dist = np.hypot(xx + 0.5 - a.x, yy + 0.5 - a.y); inside = dist < a.r + a.margin
def stats(x, y, m): d = np.abs(x - y)[m]; return d.mean(), int((d.sum(axis=1) > 0).sum())
for name, m in (("outside", ~inside), ("inside", inside)):
    mad, n = stats(b, c, m); print(f"{name} the radius ({a.r:g} px at {a.x:g},{a.y:g}{f', plus {a.margin:g} px' if name == 'outside' else ''}): MAD {mad:.4f}, differing pixels {n} of {int(m.sum())}")
changed = np.abs(b - c).sum(axis=2) > 0; print(f"farthest differing pixel: {dist[changed].max():.1f} px from the emitter (radius {a.r:g})")
poke = c.copy(); py = int(a.y); px = int(a.x + a.r + a.margin + 2); poke[py, px] += 1
mad, n = stats(b, poke, ~inside); print(f"control (one pixel nudged by 1 level just outside): outside MAD {mad:.6f}, differing pixels {n} -> {'observed' if n > 0 else 'NOT OBSERVED'}")

if a.side_by_side:
    from PIL import ImageDraw
    panels = []
    for path, label in ((a.before, "before: glow as a darker halo"), (a.after, "after: lit patch")):
        im = Image.open(path).convert("RGB"); d = ImageDraw.Draw(im)
        d.ellipse([a.x - a.r, a.y - a.r, a.x + a.r, a.y + a.r], outline=(255, 0, 140), width=2)
        d.line([a.x - 12, a.y, a.x + 12, a.y], fill=(255, 0, 140), width=3); d.line([a.x, a.y - 12, a.x, a.y + 12], fill=(255, 0, 140), width=3)
        d.rectangle([0, 0, 330, 26], fill=(20, 20, 20)); d.text((8, 7), label + f"  (ring = emitter radius {a.r:g} px)", fill=(255, 255, 255))
        panels.append(im)
    out = Image.new("RGB", (panels[0].width * 2 + 8, panels[0].height), (20, 20, 20)); out.paste(panels[0], (0, 0)); out.paste(panels[1], (panels[0].width + 8, 0)); out.save(a.side_by_side)
    print(f"wrote {a.side_by_side} {out.size}")
