#!/usr/bin/env python3
"""Silhouette connectivity of a rendered frame sequence (D73): connected components of everything that is not the field colour.

usage: python3 scripts/measure-silhouette.py <dir of element-NN.png frames> [--min-area 12]
Field colour = the top-left pixel of the first frame. Reports 8-connected and 4-connected counts per frame, ignoring blobs under
--min-area px (stray antialiased specks). A positive control runs first: frame 0 with a 4 px band erased across both shins must give
more components than the intact frame, or the probe cannot see a break and the result means nothing.
"""
import glob, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

d = sys.argv[1]
min_area = int(sys.argv[sys.argv.index("--min-area") + 1]) if "--min-area" in sys.argv else 12
files = sorted(glob.glob(f"{d}/element-*.png"))
if not files:
    sys.exit(f"no element-*.png in {d}")

def components(img, field, structure):
    fg = np.abs(img.astype(int) - field.astype(int)).sum(axis=2) > 24
    lab, n = ndi.label(fg, structure=structure)
    if n == 0:
        return 0, fg
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    return int((sizes >= min_area).sum()), fg

s8, s4 = np.ones((3, 3)), None
first = np.array(Image.open(files[0]).convert("RGB"))
field = first[0, 0]
intact8, fg = components(first, field, s8)
cut = first.copy()
ys, xs = np.nonzero(fg)
y_cut = int(ys.min() + 0.75 * (ys.max() - ys.min()))  # across the shins
cut[y_cut:y_cut + 4, :] = field
broken8, _ = components(cut, field, s8)
print(f"positive control: intact frame 0 = {intact8} component(s), same frame with a 4 px band erased across the shins (row {y_cut}) = {broken8}")
if broken8 <= intact8:
    sys.exit("positive control failed: the probe does not see a break")

rows = []
for f in files:
    img = np.array(Image.open(f).convert("RGB"))
    c8, _ = components(img, field, s8)
    c4, _ = components(img, field, s4)
    rows.append((f.rsplit("-", 1)[1].split(".")[0], c8, c4))
bad8 = [r for r in rows if r[1] != 1]
bad4 = [r for r in rows if r[2] != 1]
print(f"frames: {len(rows)}; field colour {tuple(int(v) for v in field)}; blobs under {min_area} px ignored")
print(f"8-connected: min {min(r[1] for r in rows)}, max {max(r[1] for r in rows)}, frames != 1: {[r[0] for r in bad8] or 'none'}")
print(f"4-connected: min {min(r[2] for r in rows)}, max {max(r[2] for r in rows)}, frames != 1: {[r[0] for r in bad4] or 'none'}")
