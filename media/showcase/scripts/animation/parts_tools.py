"""The raster half of the parts rig (row 6.9): draws a key plate from the parts of a family, each warped by the ARAP pose the node half solved, composited in the key's draw order.

`load_parts` reads assets/<actor>/families/<family>/parts/ (cut-parts.mjs). `render_parts` takes every part's posed vertices and the order (front first) from `plates-from-poses.mjs`,
which got both from src/library/motion/partsRig.ts, the code the film's MeshFigure runs for the same pins and the same order, and returns the plate (role colours, soft alpha, D71) and the
alpha layer of every part. `part_metrics` measures the tear metrics (inverted, strained, overlap) of each part's own mesh and the limb and head scales C20 reads. `joint_fill` is the hinge
measure: at an elbow, a knee and a shoulder the composite must be filled across the joint and the front part must fade out across a soft overlap, not end in a cut.
Pure numpy/cv2/PIL, no network. Mask space = the pixel space of the family plate.
"""
import json, math, os
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from plate_tools import (ROOT, FLOOR, MARGIN, ALPHA_SIGMA, ROLES, hex2rgb, role_index, triangle_stats, covered_twice, hold_metrics, holds, part_scales, finish_plate)

JOINT_DISC_FILL = 1.0                 # share of the disc about a joint that must be drawn
SEAM_MIN_CONTOURS = 0.5               # the overlap at a joint (the fade of the part in front over the part behind, or the depth the part behind reaches under it) is at least this many contour widths


def load_parts(actor, family):
    """{file, parts: {name: {spec, rgba (h, w, 4) uint8, ramp (h, w) float, owners (h, w) uint8, rest (V, 2), tris (T, 3), uvs}}}; the part PNGs are read once."""
    d = os.path.join(ROOT, "assets", actor, "families", family, "parts")
    meta = json.load(open(os.path.join(d, "parts.json")))
    owners_full = np.asarray(Image.open(os.path.join(d, meta["owners"])))
    parts = {}
    for p in meta["parts"]:
        rgba = np.asarray(Image.open(os.path.join(d, p["png"])).convert("RGBA"))
        ramp = np.asarray(Image.open(os.path.join(d, p["ramp"]))).astype(np.float32) / 255.0
        ox, oy = p["offset"]; h, w = rgba.shape[:2]
        parts[p["name"]] = {"spec": p, "rgba": rgba, "ramp": ramp, "owners": owners_full[oy:oy + h, ox:ox + w],
                            "rest": np.array(p["mesh"]["vertices"], float).reshape(-1, 2), "tris": np.array(p["mesh"]["triangles"], int).reshape(-1, 3)}
    return {"file": meta, "parts": parts, "owners": owners_full}


def part_texture(part, front):
    """The part as role classes (plate_tools.load_texture's two arrays) with the fade applied: the soft alpha is the part's own pixels softened (D71), times 1 - ramp where the part is drawn
    in front of the part that owns the pixel (`front[id]` = 1), so the part that is in front fades out across its reach and the part behind stays opaque there."""
    a = part["rgba"]; al = (a[..., 3] >= 128).astype(np.float32)
    idx = role_index(a[..., :3])
    soft = np.clip(cv2.GaussianBlur(al, (0, 0), ALPHA_SIGMA), 0, 1) if ALPHA_SIGMA else al
    soft = np.where(al > 0, np.maximum(soft, al * 0.5), soft)
    fade = 1.0 - part["ramp"] * np.asarray(front, np.float32)[part["owners"]]
    onehot = np.zeros(a.shape[:2] + (8,), np.float32)
    for r in range(len(ROLES)): onehot[..., r] = (idx == r) * al
    onehot[..., 7] = soft * fade
    return np.ascontiguousarray(onehot[..., :4]), np.ascontiguousarray(onehot[..., 4:])


def warp_part(part, tex, posed, lo, size):
    """The part drawn alone into a (h, w) canvas of `size` whose origin is `lo` in mask space: (weights (h, w, 7), alpha (h, w)); triangles turned inside out first, so the others stay on top."""
    texA, texB = tex; ox, oy = part["spec"]["offset"]; rest = part["rest"] - [ox, oy]; tris = part["tris"]
    w, h = size
    canA = np.zeros((h, w, 4), np.float32); canB = np.zeros((h, w, 4), np.float32)
    st = triangle_stats(part["rest"], posed, tris)
    for t in np.argsort(st["det"] >= 0, kind="stable"):
        dst = (posed[tris[t]] - lo).astype(np.float32); src = rest[tris[t]].astype(np.float32)
        bx, by = (max(0, int(v) - 1) for v in np.floor(dst.min(0)))
        ex, ey = min(w, int(np.ceil(dst[:, 0].max())) + 2), min(h, int(np.ceil(dst[:, 1].max())) + 2)
        if ex <= bx or ey <= by: continue
        M = cv2.getAffineTransform(dst, src)
        M[:, 2] += M[:, :2] @ np.array([bx, by], np.float64)
        m = np.zeros((ey - by, ex - bx), np.uint8)
        poly = np.round((dst - [bx, by]) * 16).astype(np.int32)
        cv2.fillConvexPoly(m, poly, 255, lineType=cv2.LINE_8, shift=4)
        cv2.polylines(m, [poly], True, 255, 1, lineType=cv2.LINE_8, shift=4)
        sel = m > 0
        for can, tx in ((canA, texA), (canB, texB)):
            patch = cv2.warpAffine(tx, M, (ex - bx, ey - by), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            can[by:ey, bx:ex][sel] = patch[sel]
    return np.concatenate([canA, canB[..., :3]], axis=2), np.clip(canB[..., 3], 0, 1)


def render_parts(P, posed, order, front, scale, floor=FLOOR, keep_layers=False):
    """(plate RGBA uint8, info, layers). `posed` {part: (V, 2) mask-space vertices}; `order` the parts front first; `front` {part: flags} (flags[id] = 1 where the part is drawn in front of that id).
    Parts are composited back to front with the over operator on the role weights and the alpha; `layers` (when asked) holds each part's own alpha at mask scale and the canvas origin."""
    allv = np.concatenate([posed[n] for n in order])
    lo = np.floor(allv.min(0) - MARGIN); hi = np.ceil(allv.max(0) + MARGIN)
    hi[1] = max(hi[1], floor + 6); lo = lo.astype(int); hi = hi.astype(int)
    w, h = int(hi[0] - lo[0]), int(hi[1] - lo[1])
    W = np.zeros((h, w, 7), np.float32); A = np.zeros((h, w), np.float32); layers = {}
    for name in reversed(order):
        part = P["parts"][name]
        wt, al = warp_part(part, part_texture(part, front[name]), posed[name], lo, (w, h))
        a = al[..., None]
        W = W * (1 - a) + wt * a; A = al + A * (1 - al)
        if keep_layers: layers[name] = al
    pw, ph = int(round(w * scale)), int(round(h * scale))
    smallW = np.concatenate([cv2.resize(W[..., :4], (pw, ph), interpolation=cv2.INTER_AREA), cv2.resize(W[..., 4:], (pw, ph), interpolation=cv2.INTER_AREA)], axis=2); smallA = np.clip(cv2.resize(A, (pw, ph), interpolation=cv2.INTER_AREA), 0, 1)
    out = finish_plate(smallW, smallA)
    info = {"cropPx": [pw, ph], "baselineInCrop": int(round((floor - lo[1]) * scale)), "scale": round(scale, 4), "originMask": [int(lo[0]), int(lo[1])]}
    return out, info, ({"alpha": layers, "lo": lo, "alphaAll": A} if keep_layers else None)


LIMB_CHAINS = {"armL": ("upperArmL", "foreArmL"), "armR": ("upperArmR", "foreArmR"), "legL": ("upperLegL", "lowerLegL"), "legR": ("upperLegR", "lowerLegR")}


def part_metrics(P, posed, joints_rest, scale_space=1.0):
    """Per part: the tear metrics of its own mesh (plate_tools.hold_metrics: inverted, strained, overlap) and whether it holds; the worst of each over the parts; and the C20 scales:
    the head part's local scale, and each limb's stretch along its two bones (upper and lower part). Returns {"parts": {name: {...}}, "worst": {metric: (value, part)}, "holds": bool, "scales": {...}}."""
    out = {}; worst = {k: (0.0, None) for k in ("inverted", "strained", "overlap")}
    for name, part in P["parts"].items():
        m = hold_metrics(part["rest"], posed[name], part["tris"])
        out[name] = {**m, "holds": holds(m)}
        for k in worst:
            if m[k] > worst[k][0]: worst[k] = (m[k], name)
    scales = {}
    hp = P["parts"]["head"]; st = triangle_stats(hp["rest"], posed["head"], hp["tris"])
    scales["head"] = round(float(np.sqrt(np.abs(st["det"])).mean()), 4)
    for chain, names in LIMB_CHAINS.items():
        vals = []
        for n in names:
            part = P["parts"][n]; a, b = part["spec"]["bone"]
            ps = part_scales(part["rest"], posed[n], part["tris"], joints_rest, {n: ("bone", joints_rest[a], joints_rest[b], 0.04 * 922)})
            vals.append(ps[n])
        scales[chain] = round(float(np.nanmean(vals)), 4)
    return {"parts": out, "worst": {k: {"value": v[0], "part": v[1]} for k, v in worst.items()}, "holds": all(p["holds"] for p in out.values()), "scales": scales}


JOINT_PAIRS = {"shoulderL": ("upperArmL", "poncho"), "shoulderR": ("upperArmR", "poncho"), "elbowL": ("upperArmL", "foreArmL"), "elbowR": ("upperArmR", "foreArmR"),
               "kneeL": ("upperLegL", "lowerLegL"), "kneeR": ("upperLegR", "lowerLegR")}


def overlap_measure(front, back, lo, joint, cap, overlap):
    """(fade, depth) in mask px about `joint`, within its reach (cap + overlap + 4 px), over the limb's width there (twice the cap radius over 0.9, the cap being 0.9 of the half width):
    `fade` the mean width of the soft band the part drawn in front makes over the part behind (the area of the pixels where the front alpha is between 0.1 and 0.9 and the part behind is
    opaque), `depth` how far the part behind reaches under the front one (the area where both are opaque). A cut ends the front part in a line one or two pixels wide and the part behind
    stops there: both measures are about 2 px. A joint whose front part ends in a drawn contour (the sleeve's hem) has no fade and the whole reach of the part behind as depth."""
    r = cap + overlap + 4
    x0, y0 = int(joint[0] - lo[0] - r), int(joint[1] - lo[1] - r); n = int(2 * r) + 1
    sl = (slice(max(0, y0), y0 + n), slice(max(0, x0), x0 + n))
    f, b = front[sl], back[sl]
    yy, xx = np.mgrid[sl[0], sl[1]].astype(float)
    disc = np.hypot(xx + lo[0] - joint[0], yy + lo[1] - joint[1]) <= r
    width = max(1.0, 2 * cap / 0.9)
    fade = float(((f > 0.1) & (f < 0.9) & (b >= 0.95) & disc).sum()) / width
    depth = float(((f >= 0.95) & (b >= 0.95) & disc).sum()) / width
    return fade, depth


def joint_fill(P, plate_rgba, info, joints_key, posed_order, layers, contour_px):
    """The hinge measure. For the shoulders, elbows and knees of a drawn key: `fill` is the share of the disc one contour width wide about the joint (plate px) that is drawn (alpha >= 0.5), and
    `fade` the width, in contour widths, of the soft band the part drawn in front of the other makes over it and `depth` how far the part behind reaches under the front one (overlap_measure); the
    seam passes when the larger is at least SEAM_MIN_CONTOURS. A hinge reads as a disc with a hole in it or an overlap of no width. Returns {joint: {fill, fade, front}} and whether every joint holds."""
    alpha = plate_rgba[..., 3] >= 128
    rank = {n: i for i, n in enumerate(posed_order)}
    rad = contour_px; res = {}
    yy, xx = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]].astype(float)
    for j, (a, b) in JOINT_PAIRS.items():
        pj = (np.array(joints_key[j], float) - info["originMask"]) * info["scale"]
        disc = np.hypot(xx - pj[0], yy - pj[1]) <= rad
        fill = float(alpha[disc].mean()) if disc.any() else 0.0
        front = a if rank[a] < rank[b] else b
        back = b if front == a else a
        reach = P["parts"][front]["spec"]["reaches"][back]
        cap = reach.get("capPx") or P["parts"][back]["spec"]["reaches"][front].get("capPx") or P["file"]["overlapPx"]
        fade_px, depth_px = overlap_measure(layers["alpha"][front], layers["alpha"][back], layers["lo"], np.array(joints_key[j], float), cap, P["file"]["overlapPx"])
        fade, depth = fade_px * info["scale"] / contour_px, depth_px * info["scale"] / contour_px
        res[j] = {"fill": round(fill, 3), "fade": round(fade, 2), "depth": round(depth, 2), "front": front, "pass": fill >= JOINT_DISC_FILL and max(fade, depth) >= SEAM_MIN_CONTOURS}
    return res, all(v["pass"] for v in res.values())
