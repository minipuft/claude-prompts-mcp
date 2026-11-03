#!/usr/bin/env python3
"""Measure a generated model sheet against the D72 clean-up standard.

    model_measure.py <sheet.png> [--row-split 0.36,0.68] [--json out.json]

Finds figure cells as connected components of non-black pixels, groups them into rows by
vertical position, and reports per cell: bounding box, height, estimated head height (the
width of the topmost 12 % of the component, a proxy that is honest about being a proxy),
limb ratios left to the reader; per row: scale agreement (max height drift as % of tallest);
whole sheet: contour weight (median thickness of pale contour pixels, measured as
2 * area / perimeter of the contour mask), target 1/120 of the median figure height.
Exit 0 always; the numbers decide, the prompt judges.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def _unused_components(mask: np.ndarray, min_area: int):
    lab, n = ndi.label(mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < min_area:
            continue
        out.append({"x0": int(xs.min()), "y0": int(ys.min()), "x1": int(xs.max()), "y1": int(ys.max()), "area": int(len(ys)), "label": i})
    return lab, out


def head_px(lab: np.ndarray, c: dict) -> int:
    top = c["y0"] + max(1, int((c["y1"] - c["y0"]) * 0.12))
    sub = lab[c["y0"]:top, c["x0"]:c["x1"] + 1] == c["label"]
    cols = np.where(sub.any(axis=0))[0]
    return int(cols.max() - cols.min() + 1) if len(cols) else 0


def contour_weight(rgb: np.ndarray, fg: np.ndarray) -> float:
    """Pale contour pixels: bright (max channel > 170), low chroma, inside the figure. Cream FILLS are also
    pale, so thickness is read from the distance transform and only thin structures (half-width <= 4 px)
    count: the contour is 2 * the median half-width of those pixels. A proxy, stated as one."""
    mx = rgb.max(axis=2).astype(int)
    mn = rgb.min(axis=2).astype(int)
    pale = (mx > 170) & ((mx - mn) < 90) & fg
    dt = ndi.distance_transform_edt(pale)
    thin = pale & (dt > 0) & (dt <= 4)
    if not thin.any():
        return 0.0
    return round(float(2 * np.median(dt[thin])), 2)


def bands(profile: np.ndarray, gap: int, min_len: int):
    """Runs of non-empty positions in a 1-D occupancy profile, split on gaps >= gap."""
    out, start, empty = [], None, 0
    for i, v in enumerate(profile):
        if v:
            if start is None:
                start = i
            empty = 0
        elif start is not None:
            empty += 1
            if empty >= gap:
                if i - empty - start >= min_len:
                    out.append((start, i - empty))
                start, empty = None, 0
    if start is not None and len(profile) - start >= min_len:
        out.append((start, len(profile) - 1))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--row-gap", type=int, default=14, help="empty rows that separate two layout rows")
    ap.add_argument("--cell-gap", type=int, default=18, help="empty columns that separate two cells in a row")
    ap.add_argument("--min-cell", type=int, default=40, help="ignore cells narrower than this (cell numbers, ruler ticks)")
    ap.add_argument("--ratio", type=float, default=120.0, help="contour standard as 1/ratio of figure height (D76: the approved model sheet's ratio, e.g. 166 for the human)")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    im = np.asarray(Image.open(a.sheet).convert("RGB"))
    fg = im.max(axis=2) > 28
    # baselines and rulers are long horizontal runs: a row where ink covers > 25 % of the width is a line, not a figure
    w = fg.shape[1]
    for y in range(fg.shape[0]):
        row = fg[y]
        if row.sum() < 0.25 * w:
            continue
        # longest contiguous run of ink on this row; a baseline is one run, spread arms are several
        row = ndi.binary_closing(row, structure=np.ones(9))  # an anti-aliased baseline has pixel gaps; close them before measuring the run
        d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        runs = np.where(d == -1)[0] - np.where(d == 1)[0]
        if runs.size and runs.max() > 0.25 * w:
            fg[y] = False
    fg = ndi.binary_closing(fg, iterations=2)
    row_report, comps = [], []
    for (y0, y1) in bands(fg.sum(axis=1) >= 4, a.row_gap, 30):
        band = fg[y0:y1 + 1]
        cells = []
        for (x0, x1) in bands(band.sum(axis=0) >= 4, a.cell_gap, a.min_cell):  # a 1–3 px baseline never counts as a column of ink
            sub = band[:, x0:x1 + 1]
            ys = np.where(sub.any(axis=1))[0]
            cy0, cy1 = y0 + int(ys.min()), y0 + int(ys.max())
            h, w = cy1 - cy0 + 1, x1 - x0 + 1
            if h < 30:
                continue
            top = fg[cy0:cy0 + max(1, int(h * 0.12)), x0:x1 + 1]
            cols = np.where(top.any(axis=0))[0]
            head = int(cols.max() - cols.min() + 1) if len(cols) else 0
            cells.append((x0, cy0, w, h, head, round(h / head, 2) if head else None))
            comps.append(h)
        if not cells:
            continue
        for c in list(cells):
            x0, cy0, w, h, head, heads = c
            if w < 90 and h > 0.8 * (y1 - y0):
                col = fg[cy0:cy0 + h, x0 + w // 2]
                crossings = int(np.count_nonzero(np.diff(col.astype(np.int8)) == 1))
                ruler = {"cell": c, "heads": crossings, "head_px": round(h / crossings, 1) if crossings else None}
                cells.remove(c)
                break
        else:
            ruler = None
        hs = [c[3] for c in cells]
        row_report.append({"y": [y0, y1], "cells": cells, "ruler": ruler, "scale_drift_pct": round(100 * (max(hs) - min(hs)) / max(hs), 1)})
    fig_h = float(np.median([c[3] for c in row_report[0]["cells"]])) if row_report else 0.0  # row 1 = the turnaround
    cw = contour_weight(im, fg)
    target = fig_h / a.ratio if fig_h else 0
    out = {"sheet": a.sheet, "size": [int(im.shape[1]), int(im.shape[0])], "rows": row_report,
           "turnaround_figure_height_px": fig_h, "contour_px": cw, "contour_target_px": round(target, 2),
           "contour_within_20pct": bool(target and abs(cw - target) <= 0.2 * target)}
    print(json.dumps(out, indent=1))
    if a.json:
        open(a.json, "w").write(json.dumps(out, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
