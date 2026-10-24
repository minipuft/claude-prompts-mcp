#!/usr/bin/env python3
"""Measurements `layout_measure.py` cannot make on the s01 cinematography sheet (a blue field full of ink, a figure hidden behind a box).

    s01_layout_measure.py <sheet.png> <model-sheet.png> [--json out.json]

Reuses `layout_measure.panels` for the four panel rectangles, then:
- face: the topmost large skin-green component in a panel (the green identity pigment is hue 100-170 with g well above r and b);
- figure height: the face's height times the model sheet's figure-height-to-face-height ratio (cell 1 of the model sheet, measured the same way), so a
  figure whose legs are hidden or whose panel is crowded still has a height; panel 4 (clean black) also gets the figure measured directly as the check;
- the seam in panel 1: the brightest blue pixels (b > 200, r < 120, g < 170) right of Codex (x > 0.38 of the panel) and left of Clawd;
- the dial in panel 2: the centroid of the yellow accent pixels (r > 220, g > 170, b < 90) inside the bounding box of the largest yellow disc.
Every figure is a fraction of the panel's own inner height / width.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layout_measure as lm


def green_mask(a):
    r, g, b = (a[..., i].astype(int) for i in range(3))
    return (g - r > 28) & (g - b > 12) & (g > 105)


def top_face(a):
    """The topmost green component with a face-sized area (not a hand: hands are lower or smaller)."""
    lab, n = ndi.label(green_mask(a), structure=np.ones((3, 3)))
    cands = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < 60: continue
        cands.append((int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max()), int(len(ys))))
    cands.sort()
    return cands[0] if cands else None


def figure_extent(a, x0, x1):
    """Rows of non-black ink inside columns x0..x1 (direct measurement on a clean black panel)."""
    ink = a[:, x0:x1].max(axis=2) > 45
    ys = np.where(ink.any(axis=1))[0]
    return (int(ys.min()), int(ys.max())) if ys.size else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet"); ap.add_argument("model"); ap.add_argument("--json", default="")
    ap.add_argument("--box-lo", type=float, default=0.38); ap.add_argument("--box-hi", type=float, default=0.72)
    a = ap.parse_args()
    im = np.asarray(Image.open(a.sheet).convert("RGB"))
    mx, mn = im.max(axis=2).astype(int), im.min(axis=2).astype(int)
    boxes = lm.panels((mx > 60) & ((mx - mn) < 80))
    out = {"sheet": a.sheet, "panels": []}
    # model sheet: figure height / face height in cell 1 (front view), same face detector
    mod = np.asarray(Image.open(a.model).convert("RGB"))
    cell = mod[:int(mod.shape[0] * 0.40), : mod.shape[1] // 3]
    face = top_face(cell)
    fig = figure_extent(cell, 0, cell.shape[1])
    ratio = (fig[1] - fig[0] + 1) / (face[1] - face[0] + 1)
    out["model"] = {"face_h_px": face[1] - face[0] + 1, "figure_h_px": fig[1] - fig[0] + 1, "figure_over_face": round(ratio, 3)}
    for n, (x0, y0, x1, y1) in enumerate(boxes, 1):
        sub = im[y0:y1 + 1, x0:x1 + 1]
        H, W = sub.shape[:2]
        row = {"n": n, "box": [x0, y0, x1, y1], "inner_h": H, "inner_w": W}
        f = top_face(sub) if n in (1, 2) else None
        if f:
            fh = f[1] - f[0] + 1
            row["face_h_px"] = fh
            row["figure_h_est_px"] = round(fh * ratio, 1)
            row["figure_h_est_pct"] = round(100 * fh * ratio / H, 1)
            row["face_xy_frac"] = [round((f[2] + f[3]) / 2 / W, 3), round((f[0] + f[1]) / 2 / H, 3)]
        if n == 1:
            r, g, b = (sub[..., i].astype(int) for i in range(3))
            m = (b > 200) & (r < 120) & (g < 170)
            m[:, : int(a.box_lo * W)] = False; m[:, int(a.box_hi * W):] = False
            ys, xs = np.where(m)
            if ys.size: row["seam_frac"] = {"x": round(float(xs.mean()) / W, 3), "y": round(float(ys.mean()) / H, 3), "pixels": int(ys.size)}
            ink = sub.max(axis=2) > 45
            lab, k = ndi.label(ndi.binary_closing(ink[:, int(0.36 * W):int(0.68 * W)], iterations=2))
            # the box: the lowest component spanning > 20 % of the panel width
            best = None
            for i in range(1, k + 1):
                ys2, xs2 = np.where(lab == i)
                if xs2.max() - xs2.min() > 0.2 * W and (best is None or ys2.max() > best[3]): best = (int(xs2.min() + 0.36 * W), int(ys2.min()), int(xs2.max() + 0.36 * W), int(ys2.max()))
            if best: row["box_frac"] = {"x": [round(best[0] / W, 3), round(best[2] / W, 3)], "top": round(best[1] / H, 3), "floor": round(best[3] / H, 3)}
        if n == 2:
            r, g, b = (sub[..., i].astype(int) for i in range(3))
            y = (r > 220) & (g > 170) & (b < 90)
            lab, k = ndi.label(y)
            sizes = ndi.sum(y, lab, range(1, k + 1)) if k else []
            if k:
                i = int(np.argmax(sizes)) + 1
                ys, xs = np.where(lab == i)
                row["dial_frac"] = {"x": round(float(xs.mean()) / W, 3), "y": round(float(ys.mean()) / H, 3), "pixels": int(len(ys)), "radius_frac_of_width": round(float(np.sqrt(len(ys) / np.pi)) / W, 4)}
        if n == 4:
            cols = (sub.max(axis=2) > 45).any(axis=0)
            d = np.diff(np.concatenate(([0], ndi.binary_closing(cols, iterations=20).astype(int), [0])))
            starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
            runs = [(int(s), int(e)) for s, e in zip(starts, ends) if e - s > 80]
            row["strip_runs"] = runs
            people = []
            for s, e in runs:
                ext = figure_extent(sub, s, e)
                ff = top_face(sub[:, s:e])
                if ext and ff:
                    people.append({"cols": [s, e], "rows": list(ext), "height_pct": round(100 * (ext[1] - ext[0] + 1) / H, 1), "face_h_px": ff[1] - ff[0] + 1,
                                   "est_from_face_pct": round(100 * (ff[1] - ff[0] + 1) * ratio / H, 1)})
            row["strip_people"] = people
        out["panels"].append(row)
    print(json.dumps(out, indent=1))
    if a.json: open(a.json, "w").write(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
