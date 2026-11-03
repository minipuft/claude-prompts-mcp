#!/usr/bin/env python3
"""Measure a four-panel cinematography sheet (D77).

    layout_measure.py <sheet.png> [--json out.json]

Panels are found as the rectangles bounded by long pale border lines (2 x 2 grid). In panels 1 and 2:
the lead figure is the largest connected component that contains skin-green pixels; its height is
reported as percent of the panel's inner height. The emitter is the centroid of the brightest cyan
pixels (value > 200, blue > red + 60). Panel 3's camera arrow direction is left to the reader.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def long_lines(mask: np.ndarray, axis: int, frac: float) -> list[int]:
    n = mask.shape[1 - axis]
    out = []
    for i in range(mask.shape[axis]):
        line = mask[i] if axis == 0 else mask[:, i]
        line = ndi.binary_closing(line, structure=np.ones(9))
        d = np.diff(np.concatenate(([0], line.astype(np.int8), [0])))
        runs = np.where(d == -1)[0] - np.where(d == 1)[0]
        if runs.size and runs.max() > frac * n:
            out.append(i)
    return out


def group(idx: list[int], gap: int = 6) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return [(g[0], g[-1]) for g in out]


def panels(pale: np.ndarray) -> list[tuple[int, int, int, int]]:
    rows = group(long_lines(pale, 0, 0.35))
    cols = group(long_lines(pale, 1, 0.3))

    def spans(groups, min_len):
        """Greedy: a border opens a panel, the next border farther than min_len closes it and opens the next."""
        out, i = [], 0
        while i < len(groups):
            a1 = groups[i][1]
            j = next((k for k in range(i + 1, len(groups)) if groups[k][0] - a1 > min_len), None)
            if j is None:
                break
            out.append((a1 + 1, groups[j][0] - 1))
            i = j
        return out

    boxes = []
    for (y0, y1) in spans(rows, 150):
        for (x0, x1) in spans(cols, 200):
            boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda b: (b[1] // 100, b[0]))
    return boxes


def figure_height(rgb: np.ndarray) -> dict:
    """Tallest ink component in the panel. Under a shot's radiance the skin is tinted, so colour cannot find the
    figure; in a medium shot the lead actor is the tallest drawn thing. If a prop touches the figure the two merge:
    the report carries the component's width so a reader can tell."""
    ink = rgb.max(axis=2) > 45
    lab, n = ndi.label(ndi.binary_closing(ink, iterations=2))
    best = None
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        h = int(ys.max() - ys.min() + 1)
        w = int(xs.max() - xs.min() + 1)
        touches = xs.min() <= 2 or xs.max() >= rgb.shape[1] - 3 or ys.min() <= 2
        if len(ys) > 400 and w >= 12 and not touches and (best is None or h > best["h"]):
            best = {"h": h, "x": [int(xs.min()), int(xs.max())], "y": [int(ys.min()), int(ys.max())], "area": int(len(ys))}
    return best or {"h": 0}


def emitter(rgb: np.ndarray) -> dict | None:
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    cy = (rgb.max(axis=2) > 200) & (b > r + 60)
    if not cy.any():
        return None
    ys, xs = np.where(cy)
    return {"x_frac": round(float(xs.mean()) / rgb.shape[1], 3), "y_frac": round(float(ys.mean()) / rgb.shape[0], 3), "pixels": int(cy.sum())}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    im = np.asarray(Image.open(a.sheet).convert("RGB"))
    mx, mn = im.max(axis=2).astype(int), im.min(axis=2).astype(int)
    pale = (mx > 60) & ((mx - mn) < 80)
    boxes = panels(pale)
    report = {"sheet": a.sheet, "size": [int(im.shape[1]), int(im.shape[0])], "panels": []}
    for n, (x0, y0, x1, y1) in enumerate(boxes, 1):
        sub = im[y0:y1 + 1, x0:x1 + 1]
        fig = figure_height(sub) if n in (1, 2) else {"h": 0}
        report["panels"].append({"n": n, "box": [x0, y0, x1, y1], "inner_h": int(y1 - y0 + 1),
                                 "figure_h_px": fig["h"], "figure_h_pct": round(100 * fig["h"] / (y1 - y0 + 1), 1) if fig["h"] else None,
                                 "figure_box": {k: v for k, v in fig.items() if k != "h"}, "emitter": emitter(sub) if n in (1, 2) else None})
    print(json.dumps(report, indent=1))
    if a.json:
        open(a.json, "w").write(json.dumps(report, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
