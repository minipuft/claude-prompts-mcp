#!/usr/bin/env python3
"""Measure a world sheet against the D78 contract fields.

    world_measure.py <plate.png> [--torso x,y,w,h] [--ratio 166] [--json out.json] [--ink #hex]
    world_measure.py direction <image.png> --torso x,y,w,h        # stroke direction and anisotropy inside the box
    world_measure.py direction --control                          # positive control: synthetic hatch images
    world_measure.py width --control                              # positive control for ink_px: synthetic lines of known width

Reports: field colour (median of the outer 4 % border), contour weight (2 x median half-width of thin
contour pixels, where contour = pixels that differ strongly from both neighbours along x or y), the fill
language from the count of distinct quantised colours inside the torso box (<= 6 flat, 7-12 stepped,
> 40 stroked), and whether the identity pigments are present (pixels within RGB distance 28 of each hex,
as a fraction of the plate). Proxies, stated as proxies. Exit 0.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

IDENTITY = {"codex": "#4f7df2", "codex_accent": "#9fe8ff", "clawd": "#e8694a", "skin": "#67b479", "skin_shadow": "#c885c2"}


def hex_rgb(h: str):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])


def structure_tensor(gray: np.ndarray, edge: float = 0.04, grow: int = 4, sigma: float = 0.8):
    """Stroke direction (degrees, 0 = +x, positive = clockwise on screen because y runs down, so a rising "/" stroke is negative)
    and anisotropy (ratio of the structure tensor's eigenvalues, >= 1) of a grey image in 0..1, read from the texture only: pixels within
    `grow` px of a strong colour edge (gradient of the image blurred at sigma 2 above `edge`: the poncho's panel borders, the contour)
    are left out, because a few long straight edges would otherwise own the tensor and the question is the stroke texture inside the fills."""
    sm = ndi.gaussian_filter(gray, 2.0)
    my, mx = np.gradient(sm)
    keep = (~ndi.binary_dilation(np.hypot(mx, my) > edge, iterations=grow)).astype(float)
    g = ndi.gaussian_filter(gray, sigma)
    gy, gx = np.gradient(g)
    gx, gy = gx * keep, gy * keep
    jxx, jyy, jxy = (gx * gx).sum(), (gy * gy).sum(), (gx * gy).sum()
    theta_grad = 0.5 * np.arctan2(2 * jxy, jxx - jyy)  # dominant gradient orientation
    tr, det = jxx + jyy, jxx * jyy - jxy * jxy
    disc = np.sqrt(max(tr * tr / 4 - det, 0.0))
    l1, l2 = tr / 2 + disc, max(tr / 2 - disc, 1e-12)
    stroke = (np.degrees(theta_grad) + 180.0) % 180.0 - 90.0
    return float(stroke), float(l1 / l2)


def direction_main(argv) -> int:
    ap = argparse.ArgumentParser(prog="world_measure.py direction")
    ap.add_argument("image", nargs="?")
    ap.add_argument("--torso", default="")
    ap.add_argument("--control", action="store_true")
    a = ap.parse_args(argv)
    if a.control:
        yy, xx = np.mgrid[0:240, 0:240].astype(float)
        rng = np.random.default_rng(1)
        ok = True
        for deg in (-35.0, 0.0, 50.0, -80.0):
            t = np.radians(deg)
            across = -np.sin(t) * xx + np.cos(t) * yy  # distance across a stroke running at `deg`
            img = 0.5 + 0.2 * np.sin(across * 2 * np.pi / 6.0) + rng.normal(0, 0.02, xx.shape)
            ang, ratio = structure_tensor(np.clip(img, 0, 1))
            hit = abs(((ang - deg) + 90) % 180 - 90) <= 3
            ok &= bool(hit)
            print(f"control: synthetic hatch at {deg:+.0f} deg -> measured {ang:+.1f} deg, anisotropy {ratio:.1f} {'ok' if hit else 'MISSED'}")
        iso = rng.normal(0.5, 0.1, (240, 240))
        ang, ratio = structure_tensor(np.clip(iso, 0, 1))
        print(f"control: isotropic noise -> anisotropy {ratio:.2f} (must be near 1)")
        return 0 if ok and ratio < 1.3 else 1
    im = np.asarray(Image.open(a.image).convert("L")).astype(float) / 255.0
    if a.torso:
        x, y, tw, th = [int(v) for v in a.torso.split(",")]
        im = im[y:y + th, x:x + tw]
    ang, ratio = structure_tensor(im)
    print(json.dumps({"image": a.image, "torso": a.torso, "stroke_angle_deg": round(ang, 1), "anisotropy": round(ratio, 3)}))
    return 0


def width_control() -> int:
    from skimage.morphology import skeletonize

    for w in (2, 3, 4, 5, 6, 8):
        horizontal = np.zeros((60, 200), bool)
        horizontal[20:20 + w, 10:190] = True
        yy, xx = np.mgrid[0:200, 0:200]
        diagonal = np.abs((yy - xx) / np.sqrt(2)) < w / 2
        read = [round(float(np.median(2 * ndi.distance_transform_edt(m)[skeletonize(m)] - 0.5)), 2) for m in (horizontal, diagonal)]
        print(f"control: synthetic {w} px line -> ink_px {read[0]} (horizontal), {read[1]} (diagonal)")
    return 0


def main() -> int:
    if len(sys.argv) > 2 and sys.argv[1] == "width":
        return width_control()
    if len(sys.argv) > 1 and sys.argv[1] == "direction":
        return direction_main(sys.argv[2:])
    ap = argparse.ArgumentParser()
    ap.add_argument("plate")
    ap.add_argument("--torso", default="", help="x,y,w,h of the human's torso in plate pixels")
    ap.add_argument("--ratio", type=float, default=166.0)
    ap.add_argument("--figure-height", type=float, default=0.0, help="human height in px on this plate (for the contour target)")
    ap.add_argument("--json", default="")
    ap.add_argument("--ink", default="", help="hex of the contour ink; adds ink_px, the stroke thickness along the ink's centre lines")
    a = ap.parse_args()
    im = np.asarray(Image.open(a.plate).convert("RGB")).astype(int)
    h, w, _ = im.shape
    b = max(4, int(0.04 * min(h, w)))
    border = np.concatenate([im[:b].reshape(-1, 3), im[-b:].reshape(-1, 3), im[:, :b].reshape(-1, 3), im[:, -b:].reshape(-1, 3)])
    field = np.median(border, axis=0).astype(int)
    # contour: strong local change
    gx = np.abs(np.diff(im, axis=1)).sum(axis=2)
    gy = np.abs(np.diff(im, axis=0)).sum(axis=2)
    edge = np.zeros((h, w), bool)
    edge[:, :-1] |= gx > 90
    edge[:-1, :] |= gy > 90
    dark = im.sum(axis=2) < field.sum() - 120 if field.sum() > 380 else im.sum(axis=2) > field.sum() + 120
    contour = edge & dark
    dt = ndi.distance_transform_edt(contour)
    thin = contour & (dt > 0) & (dt <= 4)
    contour_px = round(float(2 * np.median(dt[thin])), 2) if thin.any() else 0.0
    out = {"plate": a.plate, "size": [w, h], "field": "#%02x%02x%02x" % tuple(field), "contour_px": contour_px}
    if a.ink:
        from skimage.morphology import skeletonize

        ink = np.abs(im - hex_rgb(a.ink)).sum(axis=2) < 90
        skel = skeletonize(ink)
        # the proxy above reads only the two edges of a stroke, so it saturates near 2 px on any thick line. The stroke's own thickness is
        # the distance to the nearest non-ink pixel along its centre line (2 x edt - 0.5: within +-0.5 px on synthetic 3..8 px lines, h and
        # diagonal), which, unlike ink area over length, does not shrink when hatching knocks pieces out of the stroke
        out["ink_px"] = round(float(np.median(2 * ndi.distance_transform_edt(ink)[skel] - 0.5)), 2)
    if a.figure_height:
        out["contour_target_px"] = round(a.figure_height / a.ratio, 2)
    if a.torso:
        x, y, tw, th = [int(v) for v in a.torso.split(",")]
        box = im[y:y + th, x:x + tw]
        q = (box // 24).reshape(-1, 3)
        keys, counts = np.unique(q, axis=0, return_counts=True)
        share = counts / counts.sum()
        colours = int((share >= 0.02).sum())  # colours that own at least 2 % of the box; anti-aliasing and stipple fall below
        minor = int(((share < 0.02) & (share >= 0.002)).sum())  # many small-share colours = strokes
        out["torso_dominant_colours"] = colours
        out["torso_minor_colours"] = minor
        out["fills"] = "stroked" if minor > 40 else "flat" if colours <= 6 else "stepped" if colours <= 12 else "mixed"
    pig = {}
    flat = im.reshape(-1, 3)
    for name, hx in IDENTITY.items():
        d = np.abs(flat - hex_rgb(hx)).sum(axis=1)
        pig[name] = {"hex": hx, "fraction": round(float((d < 28 * 3).mean()), 5)}
    out["identity_pigments"] = pig
    print(json.dumps(out, indent=1))
    if a.json:
        open(a.json, "w").write(json.dumps(out, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
