#!/usr/bin/env python3
"""The light layer (row 8.6, D98): a solid occluder darkens the far side of the emitter's light, the shadow is stipple and never a ramp, one bounce stays inside the pair and under the emitter, and the eye still finds the emitter.

usage: probe-light.py <frames-dir> --light v3/light.json --timeline v3/timeline.json [--materials v3/materials.json] [--xsheet out/<shot>-xsheet.json] [--manifest out/<shot>/render-manifest.json [--masks <bundle>/public/lightsdf-in]] [--shot <id>] [--every N] [--only a,b,c] [--margin 0.5] [--roles v3/roles.json] [--json out]
Method, per frame whose xsheet row has an emitter drawn at full strength: the solid occluders are the shadow-casting solids of the occluder mask the light was drawn from (--manifest names the drawing of each frame, --masks the folder
render-cached.mjs served it into; without them the probe estimates the solids from the frame: every pixel that is neither field nor a dot), in connected components of at least 0.2 % of the frame; the light's dots are what a white top-hat (the pixel less its 5 x 5 grey opening) lifts above 0.5 of its own 99th percentile, outside the fixed fills.
  occlusion   behind each occluder, seen from the emitter, a strip as wide as the occluder's core (S, the shadow) is compared with a strip at the SAME distance from the emitter beside it (R, lit): `darkening = 1 - dots(S) / dots(R)`.
              Equal distance takes the falloff out, so only the occluder can make S darker. The strip in front of the occluder (N, near side) is reported. A frame passes when the median darkening of its measurable occluders is at least --margin.
  stipple     the penumbra band beside the shadow, read on a black field (median luma under 30), holds two levels and nothing between: at most 10 % of its pixels sit between 0.2 and 0.8 of the dots' own level, and dots are in it
              (at least 1 %: a band with none is a ramp or unlit, not a stipple). A ramp has no dots and every level between.
  bounce      dots whose chroma is at least 25 and 0.6 of their luma, within 56 px of an occluder are bounce: their hue is inside the beat's pair (probe-colour's pair hues, +-15 degrees) and their 99th-percentile luma is under the direct dots'.
  eye trace   probe-eyetrace's own offset (the brightest region outside the fixed fills against the xsheet emitter, 3 % of the width), the drawn solids counted among the fixed fills; with --base-frames the layer may move it by at most 1 % of the width.
Control first, on planted frames painted in memory from one clean frame (a block of the codex pigment, dots of the light seeded by distance, the shadow painted as the missing dots): the block with its stipple shadow darkens the far side by at least the margin,
the same frame with no block does not, the block with its shadow missing (the defect the probe exists to catch) does not, a ramp shadow is refused, a stipple shadow with a penumbra is accepted, a bounce brighter than the direct dots is refused,
a bounce off the pair's hues is refused and a bounce under the dots inside the pair is accepted. A control that does not trip exits 2 without reporting.
Exit codes: 0 pass, 1 fail, 2 input error or a control that did not trip.
"""
import argparse, importlib.util, os, sys
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_AREA = 0.002                  # a solid is a component of at least this share of the frame
DOT_FLOOR = 25                    # the top-hat level under which nothing is a dot, whatever the 99th percentile says
BOUNCE_CHROMA, BOUNCE_REACH = 25, 56      # a bounce dot is a pair colour (chroma at least 0.6 of its luma, so it reads at any intensity); the direct dots are the emitter's pale colour (chroma about 0.1-0.2 of luma)
MID_MAX, DOTS_MIN = 0.10, 0.01
MIN_DENSITY_R, MIN_FREE = 0.03, 200
TITLE_BOX, TITLE_FRAMES = (430, 130), 215      # stage px of the title lockup and the frames it is on screen (ShotS01Passes titleOpacityAt)
EYE_SLACK = 0.01                                # with base frames: the layer may move the brightest region by at most this share of the width


def sibling(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


ET, COL = sibling("probe-eyetrace"), sibling("probe-colour")


def eye_offset(img, em, cam, hexes, plate, solid, n=None):
    """probe-eyetrace's offset with the drawn solids of the occluder mask counted among the fixed fills, except where the pixel is light-like (luma over 200 with chroma under 90: the lamp's own white core sits on the box's seam, the dots
    are never on a solid): a drawn solid is a fixed fill by definition and its shaded or outlined variants (the ribbon's yellow is not the accent hex) are in no colour list."""
    l = luma(img.astype(np.float32)); chroma = img.max(axis=2) - img.min(axis=2)
    masked = cast_mask(img, cam, hexes, plate) | (ndi.binary_dilation(solid, iterations=1) & ~((l > 200) & (chroma < 90)))
    keep = int((~masked).sum())
    share = 0.005 if n is None else min(1.0, n / max(keep, 1))
    c = ET.centroid(img, share, None, BLUR_STAGE_PX, masked)
    H_, W_ = img.shape[:2]; ex, ey = project(cam, em["x"], em["y"]); s = W_ / STAGE[0]
    return (None if c is None else float(np.hypot(c[0] - ex * s, c[1] - ey * s) / W_)), int(np.ceil(0.005 * keep))


def shot_fill_hexes():
    """The shot's own palette (`s01Turrell` of src/library/tokens.ts: the kit, gadget and box role maps, the outline and the stipple's cool tint): fixed fills of the shot that v3/roles.json, written from the settled palette only, does not list
    (the box's yellow ribbon is the kit's accent role and outshines the light's dots). The pair's own radiance and accent are the light's hues and are not masked."""
    import re
    path = os.path.join(os.path.dirname(HERE), "..", "src", "library", "tokens.ts")
    if not os.path.exists(path): return []
    t = open(path).read(); i = t.find("export const s01Turrell")
    if i < 0: return []
    blk = t[i:t.find("as const satisfies", i)]; out = []
    for key in ("kit", "gadget", "box"):
        m = re.search(key + r":\s*\{([^}]*)\}", blk); out += re.findall(r"#[0-9a-fA-F]{6}", m.group(1)) if m else []
    return [h.lower() for h in out + re.findall(r"(?:outline|cool):\s*'(#[0-9a-fA-F]{6})'", blk)]


def luma(img): return 0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]


def tophat(img, free):
    """The light's dots: the pixel less its 5 x 5 grey opening, zero beside a fixed fill (the rim of a pigment is not a dot)."""
    l = luma(img.astype(np.float32)); th = l - ndi.grey_opening(l, size=(5, 5))
    th[ndi.binary_dilation(~free, iterations=3)] = 0
    return th


def dot_level(th):
    v = th[th > 0]
    return float(np.percentile(v, 99)) if v.size > 20 else 0.0


def mask_solids(path, shape):
    """The shadow-casting solids of an occluder mask (`light-sdf` input, full frame RGBA: alpha the solid, green the shadow class), scaled to `shape`."""
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    if (im.size[1], im.size[0]) != tuple(shape[:2]): im = im.resize((shape[1], shape[0]), Image.NEAREST)
    a = np.asarray(im)
    solid = (a[..., 3] > 127) & (a[..., 1] >= 40)
    return solid, np.where(solid, a[..., 2] // 32, -1)


def estimated_solids(img, th):
    """Without the mask: what is neither the field (luma under 20 and little chroma) nor a dot, in blobs a 5 x 5 opening keeps."""
    l = luma(img.astype(np.float32)); chroma = img.max(axis=2) - img.min(axis=2)
    drawn = (l > 20) | (chroma > 25)
    return ndi.binary_opening(drawn & ~(th > DOT_FLOOR), structure=np.ones((5, 5), bool))


def components(solid, min_area, groups=None):
    """Connected solids of at least `min_area` pixels; with `groups` (the mask's group per pixel) a component is one group's, so a figure standing on a box is two occluders, not one."""
    out = []
    for g in ([None] if groups is None else sorted(set(np.unique(groups)) - {-1})):
        lab, n = ndi.label(ndi.binary_closing(solid if g is None else solid & (groups == g), iterations=2))
        out += [m for m in (lab == i for i in range(1, n + 1)) if m.sum() >= min_area]
    return out


def sector(shape, e, u, r_range, phi_range):
    """Pixels whose distance from the emitter is in r_range and whose angle from u (the direction of the occluder's centre, seen from the emitter) is in phi_range (radians). A shadow is a wedge from the emitter, so a strip across it
    is a sector, and two sectors at one radius are at one distance from the emitter."""
    yy, xx = np.indices(shape); vx, vy = xx - e[0], yy - e[1]
    r = np.hypot(vx, vy); phi = np.arctan2(vx * -u[1] + vy * u[0], vx * u[0] + vy * u[1])
    return (r >= r_range[0]) & (r <= r_range[1]) & (phi >= phi_range[0]) & (phi <= phi_range[1])


def density(dots, region, free):
    r = region & free
    n = int(r.sum())
    return (float(dots[r].mean()) if n else None), n


def measure_occluder(img, th, level, solid_all, comp, e, free, scale=1.0):
    """The occlusion reading of one occluder: dict(darkening, S, R, N densities, the penumbra band) or None when it cannot be measured (the emitter sits in it, nothing lit beside it, out of the frame).
    S is the sector behind the occluder as wide as its core, R a sector of the same width at the same distance beside the wedge (the lit side with the most dots), N the sector in front of it."""
    ys, xs = np.nonzero(comp)
    c = np.array([xs.mean(), ys.mean()]); v = c - np.array(e); dc = float(np.hypot(*v))
    if dc < 60 * scale: return None
    if float(np.min(np.hypot(xs - e[0], ys - e[1]))) < 12 * scale: return None        # the emitter sits in it: it lets its light out (SDF.ownerSeatPx)
    u = v / dc
    r = np.hypot(xs - e[0], ys - e[1]); phi = np.arctan2((xs - e[0]) * -u[1] + (ys - e[1]) * u[0], (xs - e[0]) * u[0] + (ys - e[1]) * u[1])
    near, far = float(np.percentile(r, 2)), float(np.percentile(r, 98))
    lo, hi = float(np.percentile(phi, 1)), float(np.percentile(phi, 99)); mid, a = (lo + hi) / 2, max((hi - lo) / 2, 0.02)
    half = 0.35 * a
    r_far = (far + 15 * scale, far + 85 * scale)
    shape = img.shape[:2]
    dots = th > max(0.5 * level, DOT_FLOOR)
    S = sector(shape, e, u, r_far, (mid - half, mid + half))
    r_mid = (r_far[0] + r_far[1]) / 2; gap = 60 * scale / r_mid
    best = None
    for side in (-1, 1):
        off = mid + side * (a + gap + half)
        R = sector(shape, e, u, r_far, (off - half, off + half))
        d, n = density(dots, R, free)
        if n >= MIN_FREE and (best is None or d > best[1]): best = (R, d, n)     # the lit side: the one beside the shadow with the most dots
    if best is None: return None
    dS, nS = density(dots, S, free); dR = best[1]
    dN = density(dots, sector(shape, e, u, (near - 85 * scale, near - 15 * scale), (mid - half, mid + half)), free)[0] if near > 100 * scale else None
    if dS is None or nS < MIN_FREE or dR is None or dR < MIN_DENSITY_R: return None
    edge = 45 * scale / r_mid
    pen = sector(shape, e, u, r_far, (mid + 0.8 * a, mid + a + edge)) | sector(shape, e, u, r_far, (mid - a - edge, mid - 0.8 * a))
    return {"darkening": 1.0 - dS / dR, "S": dS, "R": dR, "N": dN, "penumbra": pen & free, "t_far": far}


def stipple_reading(img, zone, level, base=None):
    """(two-peaked?, informative?, text) for the luma of `zone`: almost nothing between the field and the dots' own level. With `base` (the same frame without the light layer) the layer's own contribution is read
    (what it added to each pixel), so the lamp's smooth halo, which is not the layer's, is not mistaken for a ramp. A band is informative when dots are in it (at least 1 %): a band wholly in shadow or past the
    reach holds none and says nothing either way; a ramp has no dots and a share of its pixels between the levels, so it is refused whatever its dots."""
    l = luma(img.astype(np.float32))
    if base is not None: l = np.clip(l - luma(base.astype(np.float32)), 0, None)
    l = l[zone]
    if l.size < 100: return None, False, "too small to read"
    lo, hi = float(np.percentile(l, 2)), max(level, 1.0)
    mid = float(((l > lo + 0.2 * hi) & (l < lo + 0.8 * hi)).mean()); dots = float((l >= lo + 0.8 * hi).mean())
    ok = level >= DOT_FLOOR and mid <= MID_MAX
    return ok, dots >= DOTS_MIN, f"{100 * dots:.1f} % at the dot level, {100 * mid:.1f} % between (at most {100 * MID_MAX:.0f} %), field {lo:.0f}, dots {hi:.0f}"


def bounce_reading(img, th, level, solid, free, pair, scale=1.0):
    """(hue of the bounce dots within the pair?, bounce luma p99, direct luma p99, count) over dots of chroma >= BOUNCE_CHROMA near a solid."""
    dots = th > max(0.5 * level, DOT_FLOOR)
    near = ndi.binary_dilation(solid, iterations=int(BOUNCE_REACH * scale)) & free
    rgb = img.astype(np.int32); chroma = rgb.max(axis=2) - rgb.min(axis=2)
    tinted = (chroma >= BOUNCE_CHROMA) & (chroma > 0.6 * luma(img.astype(np.float32)))
    b = dots & near & tinted; d = dots & ~tinted & free
    if b.sum() < 12: return None
    hues = hue_array(img[b]); pair_h = COL.pair_hues(pair)
    outside = float(np.mean([min(hue_dist(h, p) for p in pair_h) > HUE_TOLERANCE for h in hues])) if pair_h else 1.0
    lb = float(np.percentile(luma(img[b].astype(np.float32)), 99)); ld = float(np.percentile(luma(img[d].astype(np.float32)), 99)) if d.sum() >= 12 else None
    return {"outside": outside, "bounce": lb, "direct": ld, "n": int(b.sum())}


# ---------- planted frames ----------
W, H = 320, 180
E = (60, 90)                       # the emitter, left of the block
BLOCK = (130, 75, 160, 105)        # x0, y0, x1, y1: a solid of the codex pigment between the emitter and the far field
DIRECT = (205, 208, 220)           # the dots' colour, the emitter's colour at its intensity (luma ~ 208)


def planted(block=True, shadow="stipple", bounce=None, seed=3):
    """A frame the shader would draw: dots of the light, seeded white noise under a density that falls with distance, with the lee of the block (a wedge from the emitter past its corners) emptied as the shadow,
    or ramped, or left lit when `shadow` is 'none'. `bounce` is the (colour) of weak dots on the lit face."""
    rng = np.random.default_rng(seed)
    img = np.empty((H, W, 3), np.uint8); img[:] = make.FIELD
    yy, xx = np.indices((H, W)); d = np.hypot(xx - E[0], yy - E[1])
    dens = np.clip(1 / (1 + (d / 70) ** 2), 0.08, 1) * (1 - np.clip((d - 160) / 40, 0, 1))
    x0, y0, x1, y1 = BLOCK
    # the lee: angle from the emitter within the block's corners, farther than the block's far face; the penumbra is a 12-degree band at each edge where the density ramps
    corners = [np.arctan2(y - E[1], x - E[0]) for x in (x0, x1) for y in (y0, y1)]
    a = np.arctan2(yy - E[1], xx - E[0]); lo, hi = min(corners), max(corners); band = np.radians(12)
    inside = np.clip(np.minimum(a - lo, hi - a) / band, 0, 1)            # 0 at the edge of the wedge, 1 well inside
    lee = (xx > x1) & (a > lo - band) & (a < hi + band)
    vis = np.where(lee, 1 - inside, 1.0) if shadow != "none" else np.ones((H, W))
    dots = rng.random((H, W)) < dens * (vis if shadow == "stipple" else 1.0)
    img[dots] = DIRECT
    if shadow == "ramp":
        # a smooth ramp in place of the stipple: luma falls from 150 at the wedge's edge to 15 inside it
        ramp = (15 + 135 * (1 - inside))[..., None]
        img = np.where(lee[..., None], np.clip(np.array(make.FIELD) + ramp, 0, 255), img).astype(np.uint8)
    if bounce is not None:
        face = (np.abs(xx - (x0 - 6)) < 1.5) & (yy >= y0) & (yy < y1)
        rr = (np.abs(xx - (x0 - 6)) < 18) & (yy >= y0 - 6) & (yy < y1 + 6) & (rng.random((H, W)) < 0.5)
        img[rr] = bounce
    if block: img[y0:y1, x0:x1] = make.CODEX
    return img


def plant_reading(img, shadow_zone=True):
    """The darkening and stipple reading of a planted frame, the solid being the block whether or not it is painted."""
    free = np.ones(img.shape[:2], bool); x0, y0, x1, y1 = BLOCK
    solid = np.zeros(img.shape[:2], bool); solid[y0:y1, x0:x1] = True; free[solid] = False
    th = tophat(img, free); level = dot_level(th)
    m = measure_occluder(img, th, level, solid, solid, E, free, scale=0.25)
    return m, th, level, free, solid


def control(pr, a):
    margin = a.margin
    ok = {}
    m, _, lvl, free, solid = plant_reading(planted(True, "stipple"))
    ok["shadowed"] = m is not None and m["darkening"] >= margin
    d_shadow = m["darkening"] if m else float("nan")
    m0, *_ = plant_reading(planted(False, "none"))
    ok["no block"] = m0 is not None and m0["darkening"] < margin
    d_none = m0["darkening"] if m0 else float("nan")
    mx, *_ = plant_reading(planted(True, "none"))
    ok["block, no shadow drawn"] = mx is not None and mx["darkening"] < margin
    d_lit = mx["darkening"] if mx else float("nan")
    # the stipple reading: the penumbra band of the stippled frame is two-peaked, a ramp frame's is not
    img = planted(True, "stipple"); m, th, lvl, free, solid = plant_reading(img)
    st, st_inf, st_text = stipple_reading(img, m["penumbra"], lvl)
    imgr = planted(True, "ramp"); mr, thr, lvlr, *_ = plant_reading(imgr)
    zone = mr["penumbra"] if mr else np.zeros(imgr.shape[:2], bool)
    rst, _, rst_text = stipple_reading(imgr, zone, max(lvlr, 1.0))
    ok["stipple accepted"] = st is True and st_inf
    ok["ramp refused"] = rst is False
    # bounce
    out = {}
    for name, colour in (("above", (255, 235, 20)), ("under", (130, 110, 4)), ("offpair", (30, 200, 60))):
        img = planted(True, "stipple", bounce=colour); m, th, lvl, free, solid = plant_reading(img)
        out[name] = bounce_reading(img, th, lvl, solid, free, {"radiance": "#0a51fb", "accent": "#fad204"}, scale=0.25)
    b_ok = lambda r: r is not None and r["outside"] <= 0.02 and r["direct"] is not None and r["bounce"] < r["direct"]
    ok["bounce under the dots, inside the pair, accepted"] = b_ok(out["under"])
    ok["bounce brighter than the dots refused"] = out["above"] is not None and not b_ok(out["above"]) and out["above"]["bounce"] >= out["above"]["direct"]
    ok["bounce off the pair refused"] = out["offpair"] is not None and out["offpair"]["outside"] > 0.5
    detail = {k: v for k, v in ok.items()}
    text = (f"a solid between the emitter and the far field with its stipple shadow darkens the far side by {100 * d_shadow:.0f} % (margin {100 * margin:.0f} %); the same frame with no block {100 * d_none:.0f} % -> not darkened; "
            f"the block with its shadow missing {100 * d_lit:.0f} % -> not darkened, so the probe would FAIL it; a stipple penumbra reads two-peaked ({st_text}); a ramp shadow -> refused ({rst_text}); "
            f"a bounce at luma {out['above']['bounce']:.0f} against dots at {out['above']['direct']:.0f} -> refused, one at {out['under']['bounce']:.0f} inside the pair -> accepted, one off the pair's hues ({100 * out['offpair']['outside']:.0f} % outside +-{HUE_TOLERANCE:.0f} degrees) -> refused"
            if all(out.get(k) for k in ("above", "under", "offpair")) else "a planted frame could not be read")
    pr.control(all(ok.values()) and all(out.get(k) for k in ("above", "under", "offpair")), text + ("" if all(ok.values()) else f" [not as wanted: {', '.join(k for k, v in ok.items() if not v)}]"))


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter), frames=False)
    ap.add_argument("frames", nargs="?"); ap.add_argument("--light", default="v3/light.json"); ap.add_argument("--materials", default="v3/materials.json")
    ap.add_argument("--roles", default=None); ap.add_argument("--margin", type=float, default=0.5)
    ap.add_argument("--every", type=int, default=1, help="measure every Nth frame of the directory"); ap.add_argument("--only", default=None, help="comma list of frame numbers to measure (default: all)")
    ap.add_argument("--manifest", default=None, help="the render manifest of the frames: names the occluder mask each frame's light was drawn from"); ap.add_argument("--masks", default=None, help="folder of the served occluder masks (default: out/cache/<shot>/bundle/*/public/lightsdf-in)")
    ap.add_argument("--base-frames", default=None, help="the same frames without the light layer (compose-without-light-sdf.py): the eye trace then asks that the layer moved the brightest region by at most 1 % of the width, instead of the 3 % the light track allows (the shot's own fills, the yellow ribbon of the box, sit outside v3/roles.json and are brighter than the emitter's dots on frame 0)")
    ap.add_argument("--tolerance", type=float, default=0.03, help="eye trace, share of the frame width")
    ap.add_argument("--control-only", action="store_true")
    a = ap.parse_args()
    pr = Probe("light", a.json)
    control(pr, a)
    if a.control_only: print("control-only"); sys.exit(0)
    light = read_json(a.light, "light contract"); materials = read_json(a.materials, "materials")
    tl = load_timeline(a.timeline); xs = default_xsheet(a) or die("no xsheet: pass --xsheet (the emitter per frame lives there)")
    frames = list_frames(a.frames)
    tl, xs, frames, note = apply_shot(a, tl, xs, frames)
    want = {int(x) for x in a.only.split(",")} if a.only else None
    hexes = fixed_role_hexes(a.roles, plates=False); plate = plate_hexes(a.roles); eye_hexes = sorted(set(hexes) | set(shot_fill_hexes()))
    occ_of, mask_dir = {}, None
    if a.manifest:
        man = read_json(a.manifest, "render manifest"); root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(a.manifest))))
        for r in man["frames"]:
            ids = [i for i in r["layers"].get("light-sdf", []) if i.startswith("occluders-")]
            if ids: occ_of[r["frame"]] = ids[0]
        import glob
        cands = [a.masks] if a.masks else sorted(glob.glob(os.path.join(root, "out", "cache", man["shot"], "bundle", "*", "public", "lightsdf-in")))
        mask_dir = cands[-1] if cands else die("--manifest given but no served occluder masks found (--masks)")
    solid_materials = sorted(k for k, v in materials.items() if v["occluder"]["value"] == "solid")
    rows, bad_occ, bad_stipple, bad_bounce, bad_eye, skipped, measured = [], [], [], [], [], 0, 0
    stipple_n = stipple_quiet = bounce_n = occ_n = 0
    worst_eye = (-1.0, None); occ_all = []; eye_rows = []
    base = list_frames(a.base_frames) if a.base_frames else None
    for i, (f, p) in enumerate(frames.items()):
        if i % a.every or (want is not None and f not in want): continue
        em = (xs.get(f) or {}).get("emitter")
        if not isinstance(em, dict) or em.get("x") is None or em.get("strength", 1.0) < 1.0: skipped += 1; continue
        img = load_rgb(p); H_, W_ = img.shape[:2]; sc = W_ / STAGE[0]
        if f < TITLE_FRAMES: img[: int(TITLE_BOX[1] * sc), : int(TITLE_BOX[0] * sc)] = make.FIELD      # the title lockup (world layer, white, in no role) is not the light
        cam = camera_of(xs, f); ex, ey = project(cam, em["x"], em["y"]); e = (ex * sc, ey * sc)
        fixed = cast_mask(img, cam, hexes, plate)
        if mask_dir:
            if f not in occ_of: skipped += 1; continue
            solid, groups = mask_solids(os.path.join(mask_dir, occ_of[f] + ".png"), img.shape)
        else:
            solid, groups = estimated_solids(img, tophat(img, np.ones(img.shape[:2], bool))), None
        free = ~ndi.binary_dilation(solid, iterations=1)
        th = tophat(img, free); level = dot_level(th)
        comps = components(solid, int(MIN_AREA * W_ * H_), groups)
        measured += 1
        base_img = None
        if base and f in base:
            base_img = load_rgb(base[f])
            if f < TITLE_FRAMES: base_img[: int(TITLE_BOX[1] * sc), : int(TITLE_BOX[0] * sc)] = make.FIELD
        readings = [r for r in (measure_occluder(img, th, level, solid, c, e, free, sc) for c in comps) if r]
        if readings:
            med = float(np.median([r["darkening"] for r in readings])); occ_n += 1; occ_all.append((f, med, len(readings)))
            if med < a.margin: bad_occ.append((f, round(100 * med)))
            for r in readings:
                black = float(np.median(luma(img.astype(np.float32))[r["penumbra"]])) < 30 if r["penumbra"].sum() > 100 else False
                if black:
                    ok_, informative, txt = stipple_reading(img, r["penumbra"], level, base_img)
                    if ok_ is not None:
                        stipple_n += int(informative); stipple_quiet += int(not informative)
                        if not ok_: bad_stipple.append((f, txt))
        beat = beat_at(tl, f); pair = (light["beats"].get(beat["id"]) or {}).get("pair") if beat else None
        if pair:
            b = bounce_reading(img, th, level, solid, free, pair, sc)
            if b:
                bounce_n += 1
                if b["outside"] > 0.02 or (b["direct"] is not None and b["bounce"] >= b["direct"]): bad_bounce.append((f, round(100 * b["outside"]), round(b["bounce"]), None if b["direct"] is None else round(b["direct"])))
        n_top, d0 = None, None
        if base:
            if f not in base: continue
            b_img = load_rgb(base[f])
            if f < TITLE_FRAMES: b_img[: int(TITLE_BOX[1] * sc), : int(TITLE_BOX[0] * sc)] = make.FIELD
            d0, n_top = eye_offset(b_img, em, cam, eye_hexes, plate, solid)
        d, _ = eye_offset(img, em, cam, eye_hexes, plate, solid, n_top)
        if d is not None:
            eye_rows.append((f, d, d0))
            if d > worst_eye[0]: worst_eye = (d, f)
            if d > a.tolerance and (d0 is None or d > d0 + EYE_SLACK): bad_eye.append((f, round(100 * d, 1), None if d0 is None else round(100 * d0, 1)))
    pr.note(f"frames {len(frames)}{'; ' + note if note else ''}; measured {measured} with an emitter at full strength, skipped {skipped}; solid materials {', '.join(solid_materials)}; fixed fills from {roles_source(a.roles)}")
    pr.check("measured something", measured > 0, f"{measured} frames carry an emitter")
    far = [m for _, m, _ in occ_all]
    pr.check("far side darker", bool(occ_all) and not bad_occ, (f"{occ_n} frames with a measurable solid; median darkening over them {100 * float(np.median(far)):.0f} % (lowest {100 * min(far):.0f} %, highest {100 * max(far):.0f} %) against a margin of {100 * a.margin:.0f} %" if occ_all else "no frame had a solid with light beside it: nothing was observed")
             + (f"; under the margin at {bad_occ[:10]}" if bad_occ else ""))
    pr.check("shadows are stipple", stipple_n > 0 and not bad_stipple, f"{stipple_n} penumbra bands with dots in them read on black-field frames ({stipple_quiet} more held no dots: wholly in shadow or past the reach, not informative); " + ("; ".join(f"frame {f}: {t}" for f, t in bad_stipple[:4]) if bad_stipple else f"every one holds two levels and nothing between (at most {100 * MID_MAX:.0f} % between)" if stipple_n else "none could be read: nothing was observed"))
    pr.check("bounce inside the pair and under the dots", not bad_bounce, f"{bounce_n} frames carry bounce dots" + (f"; refused at (frame, % outside the pair, bounce luma, direct luma) {bad_bounce[:6]}" if bad_bounce else "; all inside the pair's hues and under the direct dots") if bounce_n else "no bounce dots found on a measured frame")
    if base:
        moved = max(((d - d0, f) for f, d, d0 in eye_rows if d0 is not None), default=(0.0, None))
        pr.check("eye trace holds", bool(eye_rows) and not bad_eye, f"{len(eye_rows)} frames compared with the same frames without the layer (the top set is the same number of pixels, 0.5 % of what the frame without the layer holds outside the fixed fills: the layer's own dots are light and would otherwise let a dimmer fill in); a frame holds when the brightest region is within {100 * a.tolerance:.0f} % of the emitter or the layer moved it by at most {100 * EYE_SLACK:.0f} % of the width: {sum(1 for _, d, _ in eye_rows if d <= a.tolerance)} within {100 * a.tolerance:.0f} % with the layer ({sum(1 for _, _, d0 in eye_rows if d0 is not None and d0 <= a.tolerance)} without it), layer moved it most {100 * moved[0]:.1f} % (frame {moved[1]}); offset worst {100 * worst_eye[0]:.1f} % at frame {worst_eye[1]} with the layer, {100 * max(d0 for _, _, d0 in eye_rows if d0 is not None):.1f} % without" + (f"; {len(bad_eye)} frames over on both counts, {sum(1 for _, _, d0 in bad_eye if d0 is not None and d0 <= 100 * a.tolerance)} of them within {100 * a.tolerance:.0f} % without the layer; first (frame, with %, without %) {bad_eye[:8]}" if bad_eye else ""))
    else:
        pr.check("eye trace holds", not bad_eye and worst_eye[1] is not None, f"worst offset {100 * worst_eye[0]:.1f} % of the width at frame {worst_eye[1]} (limit {100 * a.tolerance:.0f} %)" + (f"; over at {bad_eye[:8]}" if bad_eye else ""))
    pr.extra.update({"eye": [{"frame": f, "with": d, "without": d0} for f, d, d0 in eye_rows], "measured": measured, "darkening": [{"frame": f, "median": m, "occluders": n} for f, m, n in occ_all]})
    pr.finish(f"a solid occluder darkens the far side of the light by a median {100 * float(np.median(far)):.0f} % on {occ_n} measured frames, the penumbra is stipple, the bounce stays inside the pair and under the dots, and the eye still finds the emitter" if occ_all else "nothing measured")


if __name__ == "__main__": main()
