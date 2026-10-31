#!/usr/bin/env python3
"""Registers a plate family's joints by fitting a pose's solved joints to the plate's mask (scale and translation only), and says whether the fit may be believed.

usage: fit-family.py <plate.png> <joints.json> <out-mask.png> <result.json>
joints.json = {joint: [x, y]} (the solved joints of the key the plate was asked to draw, in key space). Writes the plate's mask (alpha >= 128) to <out-mask.png> for the mesher.
Method (the registration `fit`, used where the skeleton toolchain of v3/studies/tech-rig-01.md is not installed): over the three parameters (scale, tx, ty) maximise the share of
bone samples (12 per bone) that lie inside the mask, spine, legs and arms weighted equally, by a coarse grid and then a halving local search. It places no joint: it moves the whole
solved skeleton as one body. The fit is believed only when the plate agrees with the skeleton, by two numbers:
  coverage   the share of each group's bone samples inside the mask (spine = root-torso-neck-head, legs, arms): every group at least 0.90;
  explained  the share of the mask within 0.13 of the figure height of a bone (the poncho and the hair swoop stand that far from the bones): at least 0.80 (the home plate reads 0.87), so a skeleton shrunk into one corner of a larger figure does not pass.
Control first: the home family's own plate with its own skeleton must fit at scale 1.00 +- 0.12 and translation under 50 px (the home joints are the D73 skeleton placed by hand on the plate
and are not the ridge of its mask, so the fit lands near them, not on them: that is the precision of this registration) and pass; the same skeleton held 90 px off must fail.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GROUPS = {"spine": [("root", "torso"), ("torso", "neck"), ("neck", "head")],
          "legs": [("hipL", "kneeL"), ("kneeL", "ankleL"), ("hipR", "kneeR"), ("kneeR", "ankleR")],
          "arms": [("shoulderL", "elbowL"), ("elbowL", "wristL"), ("shoulderR", "elbowR"), ("elbowR", "wristR")]}
COVER_MIN, EXPLAINED_MIN, EXPLAIN_R = 0.90, 0.80, 0.13


def samples(J):
    out = {}
    for g, bones in GROUPS.items():
        out[g] = np.array([np.array(J[a], float) * (1 - t) + np.array(J[b], float) * t for a, b in bones for t in np.linspace(0, 1, 12)])
    return out


def inside(mask, P):
    P = np.round(P).astype(int); ok = (P[:, 0] >= 0) & (P[:, 0] < mask.shape[1]) & (P[:, 1] >= 0) & (P[:, 1] < mask.shape[0])
    r = np.zeros(len(P), bool); r[ok] = mask[P[ok, 1], P[ok, 0]]; return r


_TREE = {}


def explained_share(mask, S, s, t, fig_h):
    """Share of (a fixed sample of) the mask's pixels within EXPLAIN_R of the figure height of a bone sample."""
    from scipy.spatial import cKDTree
    key = id(mask)
    if key not in _TREE:
        ys, xs = np.nonzero(mask); rng = np.random.default_rng(7); pick = rng.choice(len(xs), size=min(600, len(xs)), replace=False)
        _TREE[key] = np.column_stack([xs[pick], ys[pick]]).astype(float)
    pts = _TREE[key]; bones = np.vstack([S[g] * s + t for g in S])
    d, _ = cKDTree(bones).query(pts)
    return float((d <= EXPLAIN_R * fig_h).mean())


_RIDGE = {}


def centredness(mask, S, s, t):
    """How near the bone samples run to the mask's medial ridge: the distance to the outline over the largest such distance within 15 px, averaged (1 on the ridge). A limb's bone runs down
    the middle of the limb, so a skeleton of the wrong size leaves the ridge even where it stays inside the mask."""
    key = id(mask)
    if key not in _RIDGE:
        dt = ndi.distance_transform_edt(mask); _RIDGE[key] = (dt, ndi.maximum_filter(dt, size=31))
    dt, loc = _RIDGE[key]
    P = np.round(np.vstack([S[g] * s + t for g in S])).astype(int); ok = (P[:, 0] >= 0) & (P[:, 0] < mask.shape[1]) & (P[:, 1] >= 0) & (P[:, 1] < mask.shape[0])
    v = np.zeros(len(P)); v[ok] = dt[P[ok, 1], P[ok, 0]] / np.maximum(loc[P[ok, 1], P[ok, 0]], 1.0)
    return float(v.mean())


def score(mask, S, s, t):
    """Mean coverage of the three groups, the share of the mask the skeleton explains and half of how centred the bones run: coverage alone is maximal for a skeleton
    shrunk to a point inside the figure."""
    ys = np.nonzero(mask.any(axis=1))[0]; fig_h = ys.max() - ys.min() + 1
    return float(np.mean([inside(mask, S[g] * s + t).mean() for g in S])) + explained_share(mask, S, s, t, fig_h) + 0.5 * centredness(mask, S, s, t)


def fit(mask, J, scale_range=(0.3, 1.3)):
    S = samples(J); ys, xs = np.nonzero(mask); fig_h = ys.max() - ys.min() + 1
    allS = np.vstack(list(S.values())); skel_c = (allS.min(0) + allS.max(0)) / 2; mask_c = np.array([(xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2])
    best = (-1, None, None); win = 0.2 * fig_h; step = fig_h / 50
    for s in np.linspace(*scale_range, 26):
        c0 = mask_c - skel_c * s
        for dx in np.arange(-win, win + 1, step):
            for dy in np.arange(-win, win + 1, step):
                sc = score(mask, S, s, c0 + [dx, dy])
                if sc > best[0]: best = (sc, s, c0 + [dx, dy])
    sc, s, t = best; step_s, step_t = 0.02, step
    for _ in range(14):
        improved = False
        for ds in (-step_s, 0, step_s):
            for dx in (-step_t, 0, step_t):
                for dy in (-step_t, 0, step_t):
                    c = score(mask, S, s + ds, t + [dx, dy])
                    if c > sc + 1e-9: sc, s, t, improved = c, s + ds, t + [dx, dy], True
        if not improved: step_s, step_t = step_s / 2, step_t / 2
    return s, t


def judge(mask, J, s, t):
    S = samples(J); cover = {g: round(float(inside(mask, S[g] * s + t).mean()), 2) for g in S}
    ys, xs = np.nonzero(mask); fig_h = ys.max() - ys.min() + 1
    bone = np.zeros(mask.shape, bool)
    for pts in S.values():
        P = np.round(pts * s + t).astype(int); ok = (P[:, 0] >= 0) & (P[:, 0] < mask.shape[1]) & (P[:, 1] >= 0) & (P[:, 1] < mask.shape[0]); bone[P[ok, 1], P[ok, 0]] = True
    near = ndi.distance_transform_edt(~bone) <= EXPLAIN_R * fig_h
    explained = round(float((near & mask).sum() / max(1, mask.sum())), 2)
    return {"coverage": cover, "explained": explained, "pass": min(cover.values()) >= COVER_MIN and explained >= EXPLAINED_MIN}


def control():
    home = json.load(open(os.path.join(ROOT, "assets/human/families/home/joints.json")))
    mask = np.asarray(Image.open(os.path.join(ROOT, "assets/human/families/home/plate.png")).convert("RGBA"))[..., 3] >= 128
    x0, y0, x1, y1 = home["figure"]["region"]; only = np.zeros_like(mask); only[y0:y1, x0:x1] = mask[y0:y1, x0:x1]; mask = only      # the home plate file carries the whole parts sheet
    s, t = fit(mask, home["joints"]); good = judge(mask, home["joints"], s, t)
    # a skeleton shifted before the fit is found again (translation is free), so the negative control is the same skeleton held 90 px off
    held = judge(mask, home["joints"], 1.0, np.array([90.0, 0.0]))
    ok = abs(s - 1.0) <= 0.12 and np.hypot(*t) < 50.0 and good["pass"] and not held["pass"]
    return ok, (f"the home plate with its own skeleton fits at scale {s:.3f}, translation ({t[0]:.1f}, {t[1]:.1f}) px and passes ({good}); the same skeleton held 90 px off is refused ({held})")


def main():
    plate, joints, mask_out, result = sys.argv[1:5]
    ok, text = control(); print("control:", text)
    if not ok: print("refused: the fit did not trip its control"); sys.exit(2)
    a = np.asarray(Image.open(plate).convert("RGBA"))[..., 3] >= 128
    Image.fromarray((a * 255).astype(np.uint8), "L").save(mask_out)
    J = json.load(open(joints)); s, t = fit(a, J); j = judge(a, J, s, t)
    out = {"scale": round(float(s), 4), "translate": [round(float(t[0]), 2), round(float(t[1]), 2)], **j, "maskPx": int(a.sum()), "bboxH": int(np.ptp(np.nonzero(a.any(axis=1))[0]) + 1)}
    json.dump(out, open(result, "w"), indent=1); print(json.dumps(out)); sys.exit(0 if j["pass"] else 1)


if __name__ == "__main__": main()
