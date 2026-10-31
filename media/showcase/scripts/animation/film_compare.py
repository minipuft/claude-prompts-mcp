"""Plate versus film (row 6.9): the key plate (plates-from-poses.mjs, the Python raster) against the film rig's picture of the same key (src/scenes/KeyFilmS01.tsx through FlatFigure and the three.js
PartsFigure), both from one pose function (src/library/motion/partsRig.ts) and one order function. The film frame is mapped into the plate's pixel space with the registration numbers
(skeleton.json) and the placement KeyFilmS01 exports (KEY_FILM, read from that file), its colours are snapped to the five roles and two identity pigments as the plate's are, and the two are compared:
  mad       mean absolute difference of the role colours over the union of the two silhouettes (0-255; a pixel one of them does not draw counts against black)
  centroid  the distance, in plate px, between the centroids of the head (skin pixels about the head joint), each hand (skin beyond the wrist plane) and each foot (everything beyond the ankle plane),
            in the plate and in the film; the bar is one contour width (the model sheet's)
`compare_key` returns the numbers and the verdict; the bar for `mad` is MAD_BAR."""
import json, os, re
import cv2
import numpy as np
from PIL import Image
from plate_tools import ROOT, ROLES, hex2rgb, role_index

# The keys whose film rig agrees with its plate (all eight once the film canvas was widened past the rest figure's box: centroids within 1 plate px, agreeing by eye on the pose sheet) measure
# 7.3-9.6 on this scale; the bar is 10.0, a little over the largest of them (K4, 9.6). The control, K1 with its right hand drawn behind its left upper leg, measures 12.3 and its hand centroid
# moves 6.2 px. A key that exceeds the bar is a pose or a draw order the two rasters do not share: fix the shared code, never the bar. Stated in README.md.
MAD_BAR = 10.0
PARTS_NEAR = 100.0           # mask px about a joint within which a part's pixels are read


def film_params():
    src = open(os.path.join(ROOT, "src/scenes/KeyFilmS01.tsx")).read()
    m = re.search(r"KEY_FILM = \{size: \[(\d+), (\d+)\] as const, scale: ([\d.]+), x: (\d+), y: (\d+)\}", src)
    if not m: raise SystemExit("film_compare: KEY_FILM not found in src/scenes/KeyFilmS01.tsx")
    w, h, s, x, y = (float(v) for v in m.groups())
    reg = json.load(open(os.path.join(ROOT, "assets/human/skeleton.json")))["registration"]
    return {"size": (int(w), int(h)), "scale": s, "x": x, "y": y, "reg": reg}


def film_in_plate_space(film_rgba, info, fp):
    """The film frame (h, w, 4 uint8) resampled onto the plate's pixel grid (cropPx, originMask, scale): (rgba uint8)."""
    reg = fp["reg"]; ps = info["scale"]; pw, ph = info["cropPx"]; ox, oy = info["originMask"]
    c = fp["scale"] * reg["scale"] / ps                                   # film px per plate px
    tx = fp["x"] + fp["scale"] * (reg["scale"] * (ox - reg["originMask"][0]) + reg["originCanvas"][0])
    ty = fp["y"] + fp["scale"] * (reg["scale"] * (oy - reg["originMask"][1]) + reg["originCanvas"][1])
    f = film_rgba.astype(np.float32) / 255.0; f[..., :3] *= f[..., 3:4]
    f = cv2.GaussianBlur(f, (0, 0), c / 2.0)
    M = np.array([[c, 0, tx], [0, c, ty]], np.float64)
    out = cv2.warpAffine(f, M, (pw, ph), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a = np.clip(out[..., 3], 0, 1); rgb = np.where(a[..., None] > 1e-4, out[..., :3] / np.maximum(a[..., None], 1e-4), 0)
    return np.dstack([np.clip(rgb * 255, 0, 255), a * 255]).astype(np.uint8)


def snap(rgba):
    """The picture's colours snapped to the palette (alpha >= 0.5 drawn): (rgb uint8, drawn bool, role index)."""
    pal = np.array([hex2rgb(h) for h in ROLES.values()], np.uint8)
    idx = role_index(rgba[..., :3]); drawn = rgba[..., 3] >= 128
    return np.where(drawn[..., None], pal[idx], 0), drawn, idx


def centroids(drawn, idx, joints_plate, scale):
    """{part: (x, y) or None} in plate px: head, handL, handR, footL, footR."""
    names = list(ROLES); skin = idx == names.index("skin")
    H, W = drawn.shape; yy, xx = np.mgrid[0:H, 0:W].astype(float); near = PARTS_NEAR * scale
    out = {}
    def cen(mask): return None if mask.sum() < 6 else (float(xx[mask].mean()), float(yy[mask].mean()))
    hd = np.array(joints_plate["head"])
    out["head"] = cen(skin & drawn & (np.hypot(xx - hd[0], yy - hd[1]) <= 0.8 * near))
    for s in "LR":
        el, wr = np.array(joints_plate[f"elbow{s}"]), np.array(joints_plate[f"wrist{s}"]); u = (wr - el) / np.hypot(*(wr - el))
        out[f"hand{s}"] = cen(skin & drawn & (np.hypot(xx - wr[0], yy - wr[1]) <= near) & (((xx - wr[0]) * u[0] + (yy - wr[1]) * u[1]) >= -10 * scale))
        kn, an = np.array(joints_plate[f"knee{s}"]), np.array(joints_plate[f"ankle{s}"]); v = (an - kn) / np.hypot(*(an - kn))
        out[f"foot{s}"] = cen(drawn & (np.hypot(xx - an[0], yy - an[1]) <= near) & (((xx - an[0]) * v[0] + (yy - an[1]) * v[1]) >= -10 * scale))
    return out


def compare_key(plate_rgba, film_frame, info, joints_key, contour_px):
    """{mad, centroid: {part: px}, worstPart, worstPx, bar, pass}. `film_frame` is the key's KeyFilmS01 frame (h, w, 4 uint8)."""
    fp = film_params(); film = film_in_plate_space(film_frame, info, fp)
    prgb, pdrawn, pidx = snap(plate_rgba); frgb, fdrawn, fidx = snap(film)
    union = pdrawn | fdrawn
    mad = float(np.abs(prgb.astype(int) - frgb.astype(int))[union].mean()) if union.any() else 0.0
    jp = {n: ((np.array(p, float) - info["originMask"]) * info["scale"]) for n, p in joints_key.items()}
    cp, cf = centroids(pdrawn, pidx, jp, info["scale"]), centroids(fdrawn, fidx, jp, info["scale"])
    dist = {}
    for n in cp:
        if cp[n] is None and cf[n] is None: continue
        dist[n] = 999.0 if (cp[n] is None or cf[n] is None) else round(float(np.hypot(cp[n][0] - cf[n][0], cp[n][1] - cf[n][1])), 2)
    worst = max(dist, key=dist.get) if dist else None
    ok = (not dist or dist[worst] <= contour_px) and mad <= MAD_BAR
    return {"mad": round(mad, 2), "centroid": dist, "worstPart": worst, "worstPx": dist[worst] if worst else 0.0, "bar": {"centroidPx": round(contour_px, 2), "mad": MAD_BAR}, "pass": bool(ok)}


def film_frame(shot, index):
    """Frame `index` of out/<shot>-key-film: the name is unpadded below ten frames and padded to the width of the last frame from ten up (remotion pads a sequence to its last frame), so the files are read by number."""
    d = os.path.join(ROOT, "out", f"{shot}-key-film")
    found = {int(m.group(1)): os.path.join(d, n) for n in (os.listdir(d) if os.path.isdir(d) else []) if (m := re.fullmatch(r"element-(\d+)\.png", n))}
    if index not in found: raise SystemExit(f"measure-keys: frame {index} of {os.path.relpath(d, ROOT)} does not exist; run `npm run plates -- {shot}` (it renders KeyFilmS01 with shot={shot}), or `npm run film-keys` for s01")
    return np.asarray(Image.open(found[index]).convert("RGBA"))
