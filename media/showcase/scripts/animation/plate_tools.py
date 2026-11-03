"""Key plates built from a family mesh (D85): the raster half of `plates-from-poses.mjs`, and the plate measurements `measure-keys.py` reads.

`render_posed` draws a family's mesh with the ARAP-posed vertices the node half solved: every triangle of the rest mesh is warped from the family's plate (premultiplied RGBA) to
where the pose put it, at the mask's own scale, then area-averaged down to the model sheet's scale (plate px per mask px = model.json figureHeightPx / the rest figure's height),
the role colours are snapped to the five roles and two pinned identity pigments (D71, the same palette scripts/cutout.py quantises to), and the alpha is softened (sigma 1.1 px at plate
scale). The plate stands on the baseline row the model sheet stands on: the rest boots' bottom, 951 in mask space.
`hold_metrics` says whether the family's mesh can hold the pose: triangles turned inside out, triangles stretched or crushed, and parts of the mesh drawn on top of each other
(a limb across the torso: no triangle flips, two parts overlap). The thresholds are the ones `HOLD_LIMITS` names and are checked against the rest pose (must hold) and a
crossed-limbs pose (must not) by `hold_control`.
Pure numpy/cv2/PIL, no network. Mask space = the pixel space of assets/<actor>/families/<family>/mesh.json.
"""
import json, math, os
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FLOOR = 951.0                    # the rest boots' bottom in mask space: the baseline every plate stands on (scripts/s01_keys_to_rig.py FLOOR)
REST_HEIGHT = 921.0              # the rest figure's height in mask px (model.json figureHeightPx 437 is this at the model sheet's scale)
MARGIN = 14                      # mask px of empty field around the posed mesh
ALPHA_SIGMA = 1.1                # D71: sigma of the soft alpha, at plate scale
# What "the mesh holds the pose" means, as shares of the mesh: area turned inside out; area strained past STRAIN_BAND (a singular value of the rest -> posed map outside it); drawn
# area covered twice beyond what the rest mesh covers twice. Set on the first eight s01 renders at the onset of visible tearing (the lift reads clean at 0.7 / 4.2 / 0.5 percent, the
# burst reads torn at 5.3 / 15.9 / 6.4): provisional, the owner can move them, and `hold_control` fails the rest pose and a crossed-arm pose against them.
HOLD_LIMITS = {"inverted": 0.01, "strained": 0.06, "overlap": 0.05}
STRAIN_BAND = (0.5, 2.0)
ROLES = {"main1": "#2f45a8", "main2": "#b983c0", "shadow": "#1d1d36", "light": "#e7e4da", "accent": "#d28a21", "skin": "#67b479", "skinShadow": "#c885c2"}   # assets/human/parts.json roles + pins


_MODEL = {}


def model_figure():
    """The model sheet's own turnaround figure, measured on the sheet: {heightPx, baselineRow, topRow, scale} where heightPx is hair top to the baseline the boots stand on and scale is
    plate px per mask px (heightPx over the rest figure's height). model.json's figureHeightPx carries this height (437; it read 470-471 until 2026-10-15, when the numeral that
    scripts/model_measure.py merged into the figure's band was taken out of it); the plates stand at the height the figure is drawn at."""
    if not _MODEL:
        sheet = np.asarray(Image.open(os.path.join(ROOT, "assets/human/model-01.png")).convert("RGB")); fg = sheet.max(axis=2) > 28
        baseline = int(np.where(fg.sum(axis=1) > 0.5 * fg.shape[1])[0].min())               # the long rule the figures stand on
        cell = fg[:baseline, : fg.shape[1] // 3]; top = int(np.where(cell.any(axis=1))[0].min())
        _MODEL.update({"heightPx": baseline - top, "baselineRow": baseline, "topRow": top, "scale": (baseline - top) / REST_HEIGHT})
    return _MODEL


def model_scale():
    """Plate px per mask px of the model sheet: the figure as drawn over the rest figure's height."""
    return model_figure()["scale"]


def hex2rgb(h): return tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))


def load_texture(path):
    """A family plate as role classes: (A, B), two float32 (h, w, 4) arrays. A holds the weights of the first four roles, B the weights of the other three and the alpha; a weight is 1 x alpha
    for the role the pixel is nearest to (the plate's colours snapped to the roles once, at full resolution, so thin contours and fills keep crisp edges through the warp and the
    downsample) and 0 for the others. Alpha is blurred at this resolution (sigma ALPHA_SIGMA, D71: the part PNGs' own scale) before it is warped."""
    a = np.asarray(Image.open(path).convert("RGBA")); al = (a[..., 3] >= 128).astype(np.float32)
    idx = role_index(a[..., :3])
    soft = np.clip(cv2.GaussianBlur(al, (0, 0), ALPHA_SIGMA), 0, 1) if ALPHA_SIGMA else al
    soft = np.where(al > 0, np.maximum(soft, al * 0.5), soft)
    onehot = np.zeros(a.shape[:2] + (8,), np.float32)
    for r in range(len(ROLES)): onehot[..., r] = (idx == r) * al
    onehot[..., 7] = soft
    return np.ascontiguousarray(onehot[..., :4]), np.ascontiguousarray(onehot[..., 4:])


def role_index(rgb):
    pal = np.array([hex2rgb(h) for h in ROLES.values()], np.int32)
    d = ((rgb.astype(np.int32)[..., None, :] - pal[None, None]) ** 2).sum(-1)
    return d.argmin(-1)


def triangle_stats(rest, posed, tris):
    """Per triangle: the signed rest area, the determinant of the rest->posed map and its singular values."""
    r = rest[tris]; p = posed[tris]
    e0r, e1r = r[:, 1] - r[:, 0], r[:, 2] - r[:, 0]; e0p, e1p = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    dr = e0r[:, 0] * e1r[:, 1] - e0r[:, 1] * e1r[:, 0]
    dp = e0p[:, 0] * e1p[:, 1] - e0p[:, 1] * e1p[:, 0]
    # F = P R^-1 with P = [e0p e1p], R = [e0r e1r]
    inv = np.stack([np.stack([e1r[:, 1], -e1r[:, 0]], 1), np.stack([-e0r[:, 1], e0r[:, 0]], 1)], 1) / dr[:, None, None]      # R^-1 rows
    P = np.stack([np.stack([e0p[:, 0], e1p[:, 0]], 1), np.stack([e0p[:, 1], e1p[:, 1]], 1)], 1)
    F = P @ inv
    sv = np.linalg.svd(F, compute_uv=False)
    return {"area": np.abs(dr) / 2, "det": np.linalg.det(F), "sv": sv}


def covered_twice(posed, tris):
    """Share of the drawn area covered by two or more triangles, each shrunk 12 % about its centre so triangles that only share an edge do not count."""
    lo = posed.min(0) - 2; hi = posed.max(0) + 2
    w, h = int(math.ceil(hi[0] - lo[0])), int(math.ceil(hi[1] - lo[1]))
    count = np.zeros((h, w), np.uint8)
    for t in tris:
        pts = posed[t]; c = pts.mean(0); pts = c + (pts - c) * 0.88
        poly = np.round((pts - lo) * 16).astype(np.int32)
        m = np.zeros((h, w), np.uint8); cv2.fillConvexPoly(m, poly, 1, lineType=cv2.LINE_8, shift=4)
        count += m
    return float((count >= 2).sum()) / max(1, int((count >= 1).sum()))


def hold_metrics(rest, posed, tris, rest_overlap=None):
    """{inverted, strained, overlap}: shares in 0-1 of the mesh (HOLD_LIMITS). `overlap` is `covered_twice` of the pose over that of the rest mesh (`rest_overlap`, measured when not given):
    a rest mesh covers itself twice a little where thin triangles meet, and only the excess is a part drawn over another."""
    st = triangle_stats(rest, posed, tris); area = st["area"]; total = float(area.sum())
    inverted = float(area[st["det"] < 0].sum() / total)
    out = (st["sv"][:, 1] < STRAIN_BAND[0]) | (st["sv"][:, 0] > STRAIN_BAND[1])
    base = covered_twice(rest, tris) if rest_overlap is None else rest_overlap
    return {"inverted": round(inverted, 4), "strained": round(float(area[out].sum() / total), 4), "overlap": round(max(0.0, covered_twice(posed, tris) - base), 4)}


def holds(metrics): return all(metrics[k] <= HOLD_LIMITS[k] for k in HOLD_LIMITS)


def part_scales(rest, posed, tris, joints, parts):
    """Local scale of the triangles whose rest centroid lies inside each part: {part: ratio}. `parts` maps a name to ("disc", centre, radius): the mean sqrt(|det|), the length ratio the
    mesh draws; or ("bone", a, b, radius): over the middle 80 % of the bone, the mean stretch ALONG it, |F u| for the bone's rest direction u, which is the limb length ratio C20 asks for."""
    st = triangle_stats(rest, posed, tris); cen = rest[tris].mean(1); out = {}
    r0, p0 = rest[tris], posed[tris]
    e_r = np.stack([r0[:, 1] - r0[:, 0], r0[:, 2] - r0[:, 0]], 2); e_p = np.stack([p0[:, 1] - p0[:, 0], p0[:, 2] - p0[:, 0]], 2)
    F = e_p @ np.linalg.inv(e_r)
    for name, spec in parts.items():
        if spec[0] == "disc":
            sel = np.hypot(*(cen - np.array(spec[1])).T) <= spec[2]
            out[name] = float(np.sqrt(np.abs(st["det"][sel])).mean()) if sel.any() else float("nan")
        else:
            a, b = np.array(spec[1], float), np.array(spec[2], float); ab = b - a; u = ab / np.hypot(*ab)
            raw = ((cen - a) @ ab) / (ab @ ab); t = np.clip(raw, 0, 1); d = np.hypot(*(cen - (a + t[:, None] * ab)).T)
            sel = (d <= spec[3]) & (raw >= 0.1) & (raw <= 0.9)          # the limb's own shaft: the joint ends bend, and the cloth at the shoulder is not the limb
            out[name] = float(np.hypot(*(F[sel] @ u).T).mean()) if sel.any() else float("nan")
    return out


def finish_plate(weights, alpha):
    """The plate RGBA (uint8) of role weights (h, w, 7) and a soft alpha (h, w) at plate scale: each pixel takes the role of its largest weight (the soft fringe of the alpha the role nearest to the
    figure, the pale contour, never an arbitrary one), the five roles and two identity pigments of the palette, the alpha as given."""
    ph, pw = alpha.shape
    role = weights.argmax(-1)
    core = weights.sum(-1) > 0.35
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    role = role[idx[0], idx[1]]
    pal = np.array([hex2rgb(h) for h in ROLES.values()], np.uint8)
    out = np.zeros((ph, pw, 4), np.uint8)
    out[..., :3] = pal[role]; out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    out[out[..., 3] == 0, :3] = 0
    return out


def render_posed(tex, rest, posed, tris, scale, floor=FLOOR):
    """(plate RGBA uint8, info). `tex` is load_texture of the family plate; rest and posed are (V, 2) mask-space vertices. info: cropPx, baselineInCrop, scale, originMask."""
    texA, texB = tex
    lo = np.floor(posed.min(0) - MARGIN); hi = np.ceil(posed.max(0) + MARGIN)
    hi[1] = max(hi[1], floor + 6); lo = lo.astype(int); hi = hi.astype(int)
    w, h = int(hi[0] - lo[0]), int(hi[1] - lo[1])
    canA = np.zeros((h, w, 4), np.float32); canB = np.zeros((h, w, 4), np.float32)
    st = triangle_stats(rest, posed, tris)
    order = np.argsort(st["det"] >= 0, kind="stable")           # turned-over triangles first, so the ones that kept their orientation are drawn on top
    for t in order:
        dst = (posed[tris[t]] - lo).astype(np.float32); src = rest[tris[t]].astype(np.float32)
        bx, by = (max(0, int(v) - 1) for v in np.floor(dst.min(0)))
        ex, ey = min(w, int(np.ceil(dst[:, 0].max())) + 2), min(h, int(np.ceil(dst[:, 1].max())) + 2)
        if ex <= bx or ey <= by: continue
        M = cv2.getAffineTransform(dst, src)                    # dst -> src
        M[:, 2] += M[:, :2] @ np.array([bx, by], np.float64)
        m = np.zeros((ey - by, ex - bx), np.uint8)
        poly = np.round((dst - [bx, by]) * 16).astype(np.int32)
        cv2.fillConvexPoly(m, poly, 255, lineType=cv2.LINE_8, shift=4)
        cv2.polylines(m, [poly], True, 255, 1, lineType=cv2.LINE_8, shift=4)       # one pixel of overlap hides the seam between neighbours
        sel = m > 0
        for can, tx in ((canA, texA), (canB, texB)):
            patch = cv2.warpAffine(tx, M, (ex - bx, ey - by), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            can[by:ey, bx:ex][sel] = patch[sel]
    pw, ph = int(round(w * scale)), int(round(h * scale))
    smallA = cv2.resize(canA, (pw, ph), interpolation=cv2.INTER_AREA); smallB = cv2.resize(canB, (pw, ph), interpolation=cv2.INTER_AREA)
    weights = np.concatenate([smallA, smallB[..., :3]], axis=2)                    # the seven role weights
    out = finish_plate(weights, np.clip(smallB[..., 3], 0, 1))
    info = {"cropPx": [pw, ph], "baselineInCrop": int(round((floor - lo[1]) * scale)), "scale": round(scale, 4), "originMask": [int(lo[0]), int(lo[1])]}
    return out, info


def contour_px(rgb):
    """The contour's width in pixels: twice the mean distance-transform value on the skeleton of the thin pale structures (scripts/s01_keys_measure.py contour_width, the measure the key
    sheets were graded with). Continuous, unlike model_measure.contour_weight, which returns twice a median of a few distance values and so reads 2.0, 2.83 or 4.0."""
    fg = rgb.max(axis=2) > 28
    mx = rgb.max(axis=2).astype(int); mn = rgb.min(axis=2).astype(int)
    pale = (mx > 170) & ((mx - mn) < 90) & fg
    dt = ndi.distance_transform_edt(pale)
    thin = pale & (dt <= 4 * max(1.0, rgb.shape[0] / 470 / 2.0))
    v = dt[skeletonize(thin) & (dt > 0)]
    return float(2 * np.mean(v)) if v.size else 0.0


def model_contour(model):
    """The model sheet's own contour by the same measure, on each turnaround figure above the baseline: (mean px, per-figure list)."""
    sheet = np.asarray(Image.open(os.path.join(ROOT, model["sheet"])).convert("RGB")); mf = model_figure(); W = sheet.shape[1]
    each = [contour_px(sheet[: mf["baselineRow"], i * W // 3:(i + 1) * W // 3]) for i in range(3)]
    return float(np.mean(each)), each


def on_black(rgba):
    """The plate over a pure black field, RGB."""
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.round(rgba[..., :3].astype(np.float32) * a).astype(np.uint8)


def save_png(arr, path, mode):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr, mode).save(path, optimize=True)
