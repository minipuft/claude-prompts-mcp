#!/usr/bin/env python3
"""Pose guides for the key sheet: the pose sheet's `solved` joints drawn as a stick figure per key, one image per plate family.

usage: s01_pose_guides.py [--out-dir out/s01-02-guides] [--poses v3/poses/s01-arrival-overwhelm.json]

A guide is an image reference for `imagegen`, not an artwork: a pale stick figure of the spine, shoulders, hips and legs (bones, joint dots, a ring for the head; no arms), the straight hips-to-head chord dim and the spine as one bright curve on a black field with one baseline and
a numeral under each key, at the plate's scale (the figure is `--height-frac` of the image height, default 0.62). The joints are the pose sheet's `solved` ones
(`npm run solve-poses`), so the plate is asked to draw the declared line of action, weight and lead instead of finding them by chance. Prints one line per
family with the file and the keys on it.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.interpolate import CubicSpline

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Spine, shoulders, hips and legs only: the solver builds the line of action, the weight and the stance from the declaration, but its arms are one swing
# and one flex (SOLVE_DEFAULTS), not the key's gesture (crossed forearms, hands to the chest), so the arms are left to the prompt's words.
BONES = [("root", "torso"), ("torso", "neck"), ("neck", "head"), ("shoulderL", "shoulderR"), ("hipL", "hipR"), ("root", "hipL"), ("root", "hipR"),
         ("hipL", "kneeL"), ("kneeL", "ankleL"), ("hipR", "kneeR"), ("kneeR", "ankleR")]
PALE, CREAM = (225, 190, 220), (240, 235, 215)


def draw_key(d, joints, x_mid, base_y, scale, label, font, cls="C"):
    ground = max(joints["ankleL"][1], joints["ankleR"][1])
    mid = (joints["ankleL"][0] + joints["ankleR"][0]) / 2
    P = lambda n: ((joints[n][0] - mid) * scale + x_mid, (joints[n][1] - ground) * scale + base_y)
    for a, b in BONES:
        if (a, b) not in (("root", "torso"), ("torso", "neck"), ("neck", "head")): d.line([P(a), P(b)], fill=PALE, width=5)
    # the line of action: a dim straight chord hips to head, and the spine as one smooth curve through the solved root, shoulder midpoint, torso, neck and head
    smid = tuple((np.array(P("shoulderL")) + np.array(P("shoulderR"))) / 2)
    pts = np.array([P("root"), smid, P("torso"), P("neck"), P("head")], float); chord = pts[-1] - pts[0]
    order = np.argsort((pts - pts[0]) @ chord); pts = pts[order]; t = (pts - pts[0]) @ chord / (chord @ chord)
    # deviation from the chord as a t(1-t) lobe, plus a t(1-t)(1-2t) lobe for an S (ridge-regularised, as spineCurve is): smooth, never a spline through noisy points
    n = np.array([-chord[1], chord[0]]) / np.hypot(*chord); dev = (pts - pts[0]) @ n
    A = np.stack([t * (1 - t), t * (1 - t) * (1 - 2 * t)], axis=1); ridge = np.diag([0.0, 0.02 * float(np.sum(A[:, 1] ** 2)) + 1e-9])
    coef = np.linalg.solve(A.T @ A + ridge, A.T @ dev) if cls == "S" else np.array([float(A[:, 0] @ dev / (A[:, 0] @ A[:, 0])), 0.0])
    ts = np.linspace(0.3 if cls == "S" else 0.0, 1, 60); curve = pts[0] + np.outer(ts, chord) + np.outer(coef[0] * ts * (1 - ts) + coef[1] * ts * (1 - ts) * (1 - 2 * ts), n)
    d.line([tuple(pts[0]), tuple(pts[-1])], fill=(90, 80, 95), width=2)
    d.line([tuple(c) for c in curve], fill=(255, 215, 120), width=7)
    for n in joints:
        if n == "ponchoPoint" or n.startswith(("elbow", "wrist")): continue
        x, y = P(n); d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=CREAM)
    hx, hy = P("head"); nx, ny = P("neck"); r = max(18, abs(hy - ny) * 0.95)
    d.ellipse([hx - r * 0.7, hy - r * 1.05, hx + r * 0.7, hy + r * 0.35], outline=PALE, width=4)
    d.text((x_mid - 18, base_y + 16), label, fill=CREAM, font=font)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out-dir", default="out/s01-02-guides"); ap.add_argument("--poses", default="v3/poses/s01-arrival-overwhelm.json")
    ap.add_argument("--height-frac", type=float, default=0.62); ap.add_argument("--cell", type=int, default=520); ap.add_argument("--h", type=int, default=1024)
    a = ap.parse_args()
    sheet = json.load(open(os.path.join(ROOT, a.poses))); os.makedirs(os.path.join(ROOT, a.out_dir), exist_ok=True)
    try: font = ImageFont.truetype("DejaVuSerif.ttf", 34)
    except OSError: font = ImageFont.load_default()
    fams = {}
    for i, k in enumerate(sheet["keys"], 1): fams.setdefault(k["plateFamily"], []).append((i, k))
    for fam, ks in fams.items():
        w = a.cell * len(ks); im = Image.new("RGB", (w, a.h), (0, 0, 0)); d = ImageDraw.Draw(im); base = int(a.h * 0.80)
        d.line([(40, base), (w - 40, base)], fill=PALE, width=3)
        scale = a.h * a.height_frac / sheet["heightPx"]
        for j, (i, k) in enumerate(ks): draw_key(d, k["solved"], a.cell * (j + 0.5), base, scale, f"K{i}", font, k["lineOfAction"]["class"])
        out = os.path.join(ROOT, a.out_dir, f"{fam}.png"); im.save(out)
        print(f"{fam}: {os.path.relpath(out, ROOT)} {im.size} keys {', '.join('K%d %s' % (i, k['name']) for i, k in ks)}")


if __name__ == "__main__": main()
