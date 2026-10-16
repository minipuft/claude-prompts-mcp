#!/usr/bin/env python3
"""Measurements of the s01 human key sheets (showcase_key_sheet's checks), written to out/s01-keys-measure.json.

C20 figure height: hair top to baseline of each key crop over the plate's own scale (plate px per rest-mask px: 0.5114 for the sheets, 1.245 for the regenerated
single plates) against the rest figure's 921 mask px; upright keys only (a stoop or crouch is shorter by pose). C20 limbs: the one-sided reach test of
scripts/s01_keys_to_rig.py. C22: contour width = 2 x the mean distance-transform value on the skeleton of the thin pale structures (the model sheet's
own value measured the same way is the standard, D76), per key as a ratio to the model's width over figure height. C21: silhouettes are viewed
(out/s01-keys-silhouettes.png), not scored here. Frame thumbnails (row 2, sheets A and B): the seam or dial centroid as a fraction of the thumbnail.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KD = os.path.join(ROOT, "assets/human/keys/s01-arrival-overwhelm")
PLATES = json.load(open(os.path.join(KD, "plates.json")))
C20 = json.load(open(os.path.join(ROOT, "out/s01-keys-c20.json")))
LAYOUT = json.load(open(os.path.join(ROOT, "v3/layouts/s01-arrival-overwhelm.json")))


def contour_width(rgb, fg):
    mx = rgb.max(axis=2).astype(int); mn = rgb.min(axis=2).astype(int)
    pale = (mx > 170) & ((mx - mn) < 90) & fg
    dt = ndi.distance_transform_edt(pale)
    thin = pale & (dt <= 4 * max(1.0, rgb.shape[0] / 470 / 2.0))    # thin structures scale with the plate
    v = dt[skeletonize(thin) & (dt > 0)]
    return float(2 * np.mean(v)) if v.size else 0.0


def main():
    out = {"keys": {}, "frames": {}}
    model = np.asarray(Image.open(os.path.join(ROOT, "assets/human/model-01.png")).convert("RGB"))
    cell = model[: int(model.shape[0] * 0.40), : model.shape[1] // 3]
    mfg = cell.max(axis=2) > 40
    ys = np.where(mfg.any(axis=1))[0]
    m_h = int(ys.max() - ys.min() + 1); m_w = contour_width(cell, mfg)
    out["model"] = {"figureHeightPx": m_h, "contourPx": round(m_w, 2), "ratio": round(m_h / m_w, 1)}
    for p in PLATES:
        k = p["key"]
        rgb = np.asarray(Image.open(os.path.join(KD, f"{k}-crop.png")).convert("RGB")); fg = rgb.max(axis=2) > 40
        ys = np.where(fg.any(axis=1))[0]
        h = int(ys.max() - ys.min() + 1)
        w = contour_width(rgb, fg)
        out["keys"][k] = {"name": C20[k]["name"], "plateScale": p["scale"], "figureHeightPx": h, "figureHeightMaskPx": round(h / p["scale"], 1), "figureHeightVsModelPct": round(100 * (h / p["scale"]) / 921 - 100, 1),
                          "contourPx": round(w, 2), "contourRatio": round(h / w, 1), "contourVsModelPct": round(100 * ((h / w) / out["model"]["ratio"]) - 100, 1), "reachRatios": C20[k]["reachRatios"], "over105": C20[k]["over105"]}
    # row 2 thumbnails of the two sheets
    for tag, first in (("a", 1), ("b", 5)):
        a = np.asarray(Image.open(os.path.join(KD, f"sheet-{tag}-01.png")).convert("RGB")).astype(int)
        H, W = a.shape[:2]
        pale = (a.max(axis=2) > 200) & ((a.max(axis=2) - a.min(axis=2)) < 60)
        y0 = int(H * 0.62)
        lab, n = ndi.label(ndi.binary_dilation(pale[y0:], iterations=1))
        boxes = []
        for i in range(1, n + 1):
            yy, xx = np.where(lab == i)
            if xx.max() - xx.min() > 300 and yy.max() - yy.min() > 150: boxes.append((int(xx.min()), int(yy.min()) + y0, int(xx.max()), int(yy.max()) + y0))
        boxes.sort()
        for i, (x0, y1, x1, y2) in enumerate(boxes):
            sub = a[y1 + 3:y2 - 2, x0 + 3:x1 - 2]; h, w = sub.shape[:2]
            r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
            yel = (r > 220) & (g > 170) & (b < 90)
            blue = (b > 220) & (r < 120) & (g < 170)
            rec = {"box": [x0, y1, x1, y2]}
            if yel.sum() > 80:
                yy, xx = np.where(yel); rec["dial"] = {"x": round(float(xx.mean()) / w, 3), "y": round(float(yy.mean()) / h, 3), "px": int(yel.sum())}
            if blue.sum() > 40:
                yy, xx = np.where(blue); rec["blueBrightest"] = {"x": round(float(xx.mean()) / w, 3), "y": round(float(yy.mean()) / h, 3), "px": int(blue.sum())}
            out["frames"][f"F{first + i}"] = rec
    json.dump(out, open(os.path.join(ROOT, "out/s01-keys-measure.json"), "w"), indent=1)
    print(json.dumps(out["model"]))
    for k, v in out["keys"].items(): print(k, v["name"], "height vs model %+.1f %%" % v["figureHeightVsModelPct"], "contour ratio 1/%.0f (%+.0f %% vs model)" % (v["contourRatio"], v["contourVsModelPct"]), "over105", v["over105"])
    for k, v in out["frames"].items(): print(k, {kk: vv for kk, vv in v.items() if kk != "box"})


if __name__ == "__main__":
    main()
