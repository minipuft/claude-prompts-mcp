"""Shared plumbing for the episode-tier probes (probe-*.py): contract loaders, the figure crop with the camera inverted,
hue arithmetic and the control-first report. Every probe prints one `control:` line before anything else and exits 2
without reporting when that control does not trip (dev-workflow: a null result needs a positive control).

Exit codes: 0 pass, 1 fail, 2 input error or a control that did not trip (a refusal is not a verified negative).
"""
import copy, glob, json, math, os, re, sys
import numpy as np
from PIL import Image

STAGE = (1280, 720)                     # stage pixels; frames are any uniform scale of it
FIGURE_BOX = (380, 0, 500, 720)         # STAGE.figureCrop in src/library/worlds/contract.ts (x, y, w, h)
IDENTITY_PIGMENTS = {"codex": "#4f7df2", "clawd": "#e8694a"}
IDENTITY_RADIUS = 28                    # Euclidean RGB distance counted as the pigment's neighbourhood
WORLDS = ("home", "crayon", "line", "shaded")
HUE_TOLERANCE = 15.0                    # C24
# A camera that moved between two frames resamples the picture at a new sub-pixel phase, so every 1 px ink edge differs by up to its full contrast
# even when nothing was drawn differently. Where the camera moved, change_series compares both crops through a box blur of MOVING_BLUR_STAGE_PX
# (scaled to the frame) and counts a pixel changed only above MOVING_THRESHOLD (summed RGB). Measured on the animatic (0.5 scale, 640x360): odd-frame
# "changes" with the camera moving were 2500-8000 px per frame at the exact 24 threshold and 0 px blurred; the real key changes stayed at 6600-20500 px.
MOVING_BLUR_STAGE_PX = 10
MOVING_THRESHOLD = 96
# A vector figure re-rasterised under a camera that is easing to a stop leaves a sub-pixel edge outline the blurred comparison does not fully absorb: on the s01 shot it measured 0-1 px on
# 29 of 30 odd frames with the camera moving and 37 px on frame 209 (camera dy -1.2 px, zoom -0.001; out/s01-arrival-overwhelm-figure-seq), the outline of the whole figure and no drawing.
# A drawing changes thousands of pixels (the smallest in that shot: 1697), so on an odd frame where the xsheet camera moved a change counts only above this floor.
MOVING_ODD_FLOOR = 64



# ---------- report ----------
class Probe:
    def __init__(self, name, json_out=None):
        self.name, self.json_out = name, json_out
        self.checks, self.control_text, self.control_ok = [], None, None
        self.extra = {}

    def control(self, ok, text):
        self.control_text, self.control_ok = text, bool(ok)
        print(f"control: {text}", flush=True)
        if not ok:
            print(f"refused: {self.name} did not trip its own control, so a pass or a fail from it would mean nothing", flush=True)
            self._write("refused")
            sys.exit(2)

    def note(self, text): print(f"  {text}", flush=True)

    def check(self, name, ok, text):
        self.checks.append({"check": name, "ok": bool(ok), "text": text})
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {text}", flush=True)

    def finish(self, summary):
        bad = [c for c in self.checks if not c["ok"]]
        status = "fail" if bad else "pass"
        print(f"{'FAIL' if bad else 'pass'}: {self.name} - {summary if not bad else f'{len(bad)} of {len(self.checks)} checks failed: ' + ', '.join(c['check'] for c in bad)}", flush=True)
        self._write(status, summary)
        sys.exit(1 if bad else 0)

    def _write(self, status, summary=""):
        if self.json_out:
            with open(self.json_out, "w") as f:
                json.dump({"probe": self.name, "status": status, "control": {"ok": self.control_ok, "text": self.control_text},
                           "summary": summary, "checks": self.checks, **self.extra}, f, indent=2)
                f.write("\n")


def die(msg):
    print(f"input error: {msg}", flush=True)
    sys.exit(2)


# ---------- contracts ----------
def read_json(path, what):
    try:
        with open(path) as f: return json.load(f)
    except (OSError, ValueError) as e:
        die(f"{what} {path}: {e}")


def normalise_timeline(d):
    """Accepts the compiled shape (`durationInFrames`, top-level `crossings` of {from,to,start,end}, per-beat crossingIn/Out [a,b])
    and the brief's shape (`duration`, per-beat `crossing` {from,to,frames:[a,b]}). Windows are [a, b): b is the first frame after."""
    dur = d.get("duration", d.get("durationInFrames"))
    beats = []
    for i, b in enumerate(d.get("beats", [])):
        start = b["start"]; end = b.get("end", start + b.get("frames", 0))
        beats.append({"id": b["id"], "start": start, "end": end, "world": b.get("world"), "worldRaw": b.get("worldRaw", b.get("world")), "intentionalHold": bool(b.get("intentionalHold")),
                      "index": i, "ledgerPath": b.get("ledger")})
    wins, seen = [], set()
    def add(frm, to, a, b):
        if (a, b) in seen: return
        seen.add((a, b)); wins.append({"from": frm, "to": to, "a": a, "b": b})
    for c in d.get("crossings", []):
        a, b = (c["frames"] if "frames" in c else (c["start"], c["end"])); add(c.get("from"), c.get("to"), a, b)
    for i, b in enumerate(d.get("beats", [])):
        c = b.get("crossing")
        if c: add(c.get("from", b["id"]), c.get("to"), c["frames"][0], c["frames"][1])
        if b.get("crossingIn"): add(beats[i - 1]["id"] if i else None, b["id"], *b["crossingIn"])
        if b.get("crossingOut"): add(b["id"], beats[i + 1]["id"] if i + 1 < len(beats) else None, *b["crossingOut"])
    return {"fps": d.get("fps", 30), "duration": dur, "beats": beats, "windows": sorted(wins, key=lambda w: w["a"]), "source": d}


def load_timeline(path):
    return normalise_timeline(read_json(path, "timeline"))


def in_window(tl, f): return any(w["a"] <= f < w["b"] for w in tl["windows"])
def beat_at(tl, f):
    for b in tl["beats"]:
        if b["start"] <= f < b["end"]: return b
    return None


def load_xsheet(path):
    d = read_json(path, "xsheet")
    rows = d["rows"] if isinstance(d, dict) else d
    return {r["frame"]: r for r in rows}


def camera_of(xs, f):
    if not xs or f not in xs: return None
    c = xs[f].get("camera")
    if not isinstance(c, dict): return None
    return {**c, "rot": c.get("rot", c.get("rotation", 0))}           # src/library/animation/camera.ts names it `rotation`


def declared_long_holds(xs, min_len=28):
    """Key rows whose declared hold is >= min_len: explicit `hold` (row or key object), else the span to the next key/breakdown row."""
    if not xs: return []
    frames = sorted(xs); out = []
    marks = [f for f in frames if xs[f].get("key") or xs[f].get("breakdown")]
    for i, f in enumerate(frames):
        r = xs[f]; key = r.get("key")
        if not key: continue
        hold = r.get("hold") or (key.get("hold") if isinstance(key, dict) else None)
        if hold is None:
            nxt = [m for m in marks if m > f]; hold = (nxt[0] if nxt else frames[-1] + 1) - f
        if hold >= min_len:
            out.append({"start": f, "hold": int(hold), "key": key.get("id", key.get("name")) if isinstance(key, dict) else key})
    return out


# ---------- frames ----------
def list_frames(d):
    if not os.path.isdir(d): die(f"frames directory {d} does not exist")
    out = {}
    for p in glob.glob(os.path.join(d, "element-*.png")):
        m = re.search(r"element-(\d+)\.png$", p)
        if m: out[int(m.group(1))] = p
    if not out: die(f"no element-NNN.png frames in {d}")
    return dict(sorted(out.items()))


def load_rgb(p):
    """A path, or an array already in memory (the controls pass fixtures straight from fixtures/make.py)."""
    if isinstance(p, np.ndarray): return p.astype(np.int16)
    return np.array(Image.open(p).convert("RGB")).astype(np.int16)


def parse_crop(s):
    try:
        x, y, w, h = (int(v) for v in s.split(","))
        return x, y, w, h
    except ValueError:
        die(f"--crop wants x,y,w,h in frame pixels, got {s!r}")


# ---------- camera ----------
def camera_identity(cam):
    return cam is None or (cam["x"] == STAGE[0] / 2 and cam["y"] == STAGE[1] / 2 and cam.get("zoom", 1) == 1 and not cam.get("rot", 0))


def world_crop(img, cam, scale, box_px, with_valid=False):
    """The crop `box_px` (x, y, w, h in frame pixels, as if the camera were at rest) read out of a rendered frame with the camera inverted.
    Camera model (xsheet `camera`): {x, y} is the stage point at the frame centre, zoom scales about it, rot (degrees) turns the scene
    clockwise on screen about it; identity is x 640, y 360, zoom 1, rot 0. So a stage point p lands at R(rot)(p - c) zoom + (640, 360)."""
    x0, y0, w, h = box_px
    H, W = img.shape[:2]
    if camera_identity(cam):
        out = img[max(y0, 0):min(y0 + h, H), max(x0, 0):min(x0 + w, W)]
        return (out, np.ones(out.shape[:2], bool)) if with_valid else out
    from scipy import ndimage as ndi
    ii, jj = np.meshgrid(np.arange(y0, y0 + h), np.arange(x0, x0 + w), indexing="ij")
    sx, sy = jj / scale - cam["x"], ii / scale - cam["y"]
    z, th = cam.get("zoom", 1), np.deg2rad(cam.get("rot", 0)); c, s = np.cos(th), np.sin(th)
    fx = (c * sx - s * sy) * z + STAGE[0] / 2; fy = (s * sx + c * sy) * z + STAGE[1] / 2
    u, v = fx * scale, fy * scale
    out = np.empty((h, w, 3), dtype=np.float32)
    for k in range(3):
        out[..., k] = ndi.map_coordinates(img[..., k].astype(np.float32), [v, u], order=1, mode="nearest")
    # source points outside the rendered frame (the camera view does not reach them) are edge copies, not picture: `valid` marks the real ones
    return (out, (u >= 0) & (u <= W - 1) & (v >= 0) & (v <= H - 1)) if with_valid else out


def project(cam, x, y):
    """Stage point -> stage-scale frame point under the camera model above."""
    if camera_identity(cam): return x, y
    z, th = cam.get("zoom", 1), np.deg2rad(cam.get("rot", 0)); c, s = np.cos(th), np.sin(th)
    sx, sy = x - cam["x"], y - cam["y"]
    return (c * sx - s * sy) * z + STAGE[0] / 2, (s * sx + c * sy) * z + STAGE[1] / 2


def crop_box_px(img_shape, crop_arg=None):
    H, W = img_shape[:2]; s = W / STAGE[0]
    if crop_arg: return parse_crop(crop_arg), s
    return tuple(int(round(v * s)) for v in FIGURE_BOX), s


def changed_px(a, b, thresh):
    return int((np.abs(a.astype(np.int32) - b.astype(np.int32)).sum(axis=2) > thresh).sum())


def same_camera(a, b):
    return a == b or (a is not None and b is not None and all(abs(a.get(k, 0) - b.get(k, 0)) < 1e-9 for k in ("x", "y", "zoom", "rot")))


def blurred(a, k):
    from scipy import ndimage as ndi
    return np.stack([ndi.uniform_filter(a[..., c].astype(np.float32), size=k) for c in range(3)], -1)


def change_series(frames, xs, crop_arg, thresh):
    """For each frame f whose predecessor f-1 was also rendered: (pixels that differ inside the figure crop with the camera inverted,
    pixels that differ in the raw frame outside the crop box). The second number is what the camera does; it proves the split sees motion.
    Where the camera moved between the two frames the crops are compared blurred (see MOVING_BLUR_STAGE_PX); where it did not, exactly."""
    out, prev, prev_raw = {}, None, None
    for f, p in frames.items():
        img = load_rgb(p)
        box, s = crop_box_px(img.shape, crop_arg)
        cam = camera_of(xs, f)
        crop, valid = world_crop(img, cam, s, box, with_valid=True)
        if prev is not None and f - 1 in frames and prev[0] == f - 1 and prev[1].shape == crop.shape:
            raw = np.abs(img - prev_raw).sum(axis=2) > thresh
            x0, y0, w, h = box; raw[y0:y0 + h, x0:x0 + w] = False
            both = valid & prev[3]
            if same_camera(cam, prev[2]): fig = int(((np.abs(crop.astype(np.int32) - prev[1].astype(np.int32)).sum(axis=2) > thresh) & both).sum())
            else:
                from scipy import ndimage as ndi
                k = max(3, int(round(MOVING_BLUR_STAGE_PX * s)) | 1)
                both = ndi.binary_erosion(both, structure=np.ones((k, k), bool))          # blur bleeds the edge copies inwards by half a kernel
                fig = int(((np.abs(blurred(crop, k) - blurred(prev[1], k)).sum(axis=2) > max(thresh, MOVING_THRESHOLD)) & both).sum())
            out[f] = (fig, int(raw.sum()))
        prev, prev_raw = (f, crop, cam, valid), img
    return out


def damp_camera_noise(series, xs, floor=MOVING_ODD_FLOOR):
    """`series` (frame -> (figure change, rest)) with the figure change zeroed on every frame where the xsheet camera moved between it and the previous frame and the change is no more than `floor` pixels:
    the sub-pixel outline of a figure re-rasterised under a moving camera, not a drawing (see MOVING_ODD_FLOOR)."""
    if not xs: return series
    return {f: (0 if fig <= floor and not same_camera(camera_of(xs, f), camera_of(xs, f - 1)) else fig, rest) for f, (fig, rest) in series.items()}


# ---------- colour ----------
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def valid_hex(s): return isinstance(s, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", s) is not None


def hue_of(rgb):
    r, g, b = (v / 255 for v in rgb); mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn: return None
    d = mx - mn
    h = ((g - b) / d) % 6 if mx == r else (b - r) / d + 2 if mx == g else (r - g) / d + 4
    return 60.0 * h


def hue_dist(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def signed_hue_diff(a, b):
    """b - a on the shortest arc, in (-180, 180]."""
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def chroma_of(rgb): return max(rgb) - min(rgb)


def hue_array(a):
    r, g, b = (a[..., i].astype(np.float32) for i in range(3))
    mx, mn = a.max(axis=-1).astype(np.float32), a.min(axis=-1).astype(np.float32)
    d = np.where(mx == mn, 1, mx - mn)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    return h


ROLES_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "v3", "roles.json")
_LUTS = {}


def fixed_role_hexes(path=None, sheets=False, plates=True):
    """The fixed colours the frame probes mask: the identity pigments, the human's roles, the kit's and the gadget's, and each world's texture colours (v3/roles.json, written by compile-roles.mjs from
    tokens.ts). These do not grade per beat (C1, C2), so they are neither light (C29) nor a hue the beat's pair must hold (C24, C30). Falls back to the two identity pigments
    when the file is absent, and the caller says so (`roles_source`)."""
    path = path or ROLES_FILE
    if not os.path.exists(path): return list(IDENTITY_PIGMENTS.values())
    d = read_json(path, "roles")
    out = [h for grp in d.get("identity", {}).values() for h in grp] + list(d.get("human", [])) + list(d.get("kit", [])) + list(d.get("gadget", [])) + [h for grp in d.get("worlds", {}).values() for h in grp]
    root = os.path.dirname(os.path.dirname(path))                              # the project root: roles.json lives in <root>/v3
    if plates: out += [h for png in d.get("plates", []) for h in plate_palette(png, root)]
    if sheets: out += [h for png in d.get("sheets", []) for h in plate_palette(png, root, SHEET_MIN_SHARE)]       # a world sheet holds lit pale colours too: only the saturated-pixel check may mask them
    return sorted(set(h.lower() for h in out))


PLATE_BIN, PLATE_MIN_SHARE, SHEET_MIN_SHARE = 16, 0.001, 0.0002          # a sheet carries many small things (a ring's lit core is 0.03 % of it), a plate one figure


def plate_palette(png, root, min_share=None):
    """The colours a drawn plate is made of: its opaque pixels binned to PLATE_BIN levels per channel (bin centres), every bin holding at least PLATE_MIN_SHARE of them. The human's cutout
    carries a pale contour and shading that are not its five role colours (the contour reads (222, 198, 198) in a frame, no role within 28), and it is the figure a light must not be mistaken for."""
    im = np.array(Image.open(os.path.join(root, png)).convert("RGBA")); px = im[im[..., 3] > 200][:, :3].astype(np.int32)
    bins = (px // PLATE_BIN) * PLATE_BIN + PLATE_BIN // 2
    key = bins[:, 0] * 65536 + bins[:, 1] * 256 + bins[:, 2]
    vals, counts = np.unique(key, return_counts=True)
    return ["#%02x%02x%02x" % (v >> 16, (v >> 8) & 255, v & 255) for v, n in zip(vals, counts) if n >= (PLATE_MIN_SHARE if min_share is None else min_share) * len(px)]


def roles_source(path=None): return os.path.relpath(path or ROLES_FILE) if os.path.exists(path or ROLES_FILE) else "the two identity pigments (no v3/roles.json: run `npm run roles`)"


def _lut(hexes, radius):
    """A 256^3 boolean table: True where a colour is within `radius` (Euclidean RGB) of any of `hexes`. Built once per set; a frame is masked by one lookup."""
    key = (tuple(hexes), radius)
    if key not in _LUTS:
        lut = np.zeros((256, 256, 256), bool); r = int(radius)
        for hx in hexes:
            c = np.array(hex_rgb(hx))
            lo, hi = np.maximum(c - r, 0), np.minimum(c + r + 1, 256)
            g = np.mgrid[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
            near = ((g[0] - c[0]) ** 2 + (g[1] - c[1]) ** 2 + (g[2] - c[2]) ** 2) <= radius ** 2
            lut[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] |= near
        _LUTS[key] = lut
    return _LUTS[key]


def fixed_fill_hexes(path=None):
    """The colours the fixed fills are DRAWN in, for the blend mask below: the role maps and the worlds' texture and emissive colours (not the cutout's palette, which is already a sample of what the
    human is drawn in)."""
    path = path or ROLES_FILE
    if not os.path.exists(path): return list(IDENTITY_PIGMENTS.values())
    d = read_json(path, "roles")
    out = [h for grp in d.get("identity", {}).values() for h in grp] + list(d.get("human", [])) + list(d.get("kit", [])) + list(d.get("gadget", [])) + [h for grp in d.get("worlds", {}).values() for h in grp] + list(d.get("emissive", []))
    return sorted(set(h.lower() for h in out))


_BLEND_LUTS = {}
BLEND_RADIUS = 16
BLEND_STEP = 4


def _blend_lut(hexes, radius):
    """A 256^3 table: True within `radius` of a point on a segment from any colour of `hexes` to black, to white or brightened to three times itself (an additive bloom, clipped at 255), or between any two of them: what the anti-aliased edge of a fixed fill,
    its stipple and its bloom are made of (a fill meeting the dark field, a lit edge, one fill meeting another). The glow of a light is a colour on its own ray, not between these fills."""
    import itertools
    from scipy import ndimage as ndi
    key = (tuple(hexes), radius)
    if key not in _BLEND_LUTS:
        cols = [np.array(hex_rgb(h)) for h in hexes]; pts = []
        def seg(a, b):
            n = max(2, int(np.linalg.norm(a - b) / BLEND_STEP) + 1)
            pts.extend(np.round(a + (b - a) * t).astype(int) for t in np.linspace(0, 1, n))
        for c in cols: seg(c, np.array([0, 0, 0])); seg(c, np.array([255, 255, 255])); seg(c, np.minimum(c * 3, 255))      # to black, to white, and brightened past itself (additive bloom clips at 255)
        for a, b in itertools.combinations(cols, 2): seg(a, b)
        grid = np.zeros((256, 256, 256), bool); P = np.clip(np.array(pts), 0, 255); grid[P[:, 0], P[:, 1], P[:, 2]] = True
        _BLEND_LUTS[key] = ndi.distance_transform_edt(~grid) <= radius
    return _BLEND_LUTS[key]


def fixed_fill_mask(a, hexes, radius=IDENTITY_RADIUS, blend=None):
    """Pixels of `a` that are a fixed fill (within `radius` of a colour of `hexes`) or a blend of fixed fills: `blend` is the list the fills are drawn in (`fixed_fill_hexes`), else no blend mask."""
    m = role_mask(a, hexes, radius)
    if blend:
        lut = _blend_lut(tuple(sorted(blend)), BLEND_RADIUS); q = np.clip(a, 0, 255).astype(np.uint8)
        m = m | lut[q[..., 0], q[..., 1], q[..., 2]]
    return m


def role_mask(a, hexes, radius=IDENTITY_RADIUS):
    """Pixels of `a` (H x W x 3) within `radius` of any colour in `hexes`."""
    lut = _lut(tuple(sorted(hexes)), radius)
    q = np.clip(a, 0, 255).astype(np.uint8)
    return lut[q[..., 0], q[..., 1], q[..., 2]]


BLUR_STAGE_PX = 8


def brightest_region(img, hexes=None, share=0.005, blur=BLUR_STAGE_PX, masked=None):
    """Mask of the brightest `share` of the pixels outside the fixed fills `hexes` (None: nothing masked), ranked by luminance box-blurred over `blur` stage pixels (0: unblurred); masked pixels
    count as black in the blur and are never members. The region, not the pixel: the anti-aliased edge where a fill meets its neighbour is a bright speck a light is not. Used by the eye
    trace (where the light is) and the colour probe (what colour it is)."""
    from scipy import ndimage as ndi
    a = img.astype(np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    keep = ~masked if masked is not None else ~role_mask(img, hexes) if hexes else np.ones(lum.shape, bool)
    k = max(1, int(round(blur * img.shape[1] / STAGE[0]))) | 1 if blur > 0 else 1
    if k > 1: lum = np.where(keep, ndi.uniform_filter(np.where(keep, lum, 0.0), size=k), 0.0)
    vals = lum[keep]
    if vals.size == 0: return None
    thr = np.sort(vals)[-max(1, int(np.ceil(vals.size * share)))]
    return keep & (lum >= thr)


def plate_hexes(path=None):
    """Only the colours the human's cutout is drawn in (`plates` of v3/roles.json), for `cast_mask`."""
    path = path or ROLES_FILE
    if not os.path.exists(path): return []
    d = read_json(path, "roles"); root = os.path.dirname(os.path.dirname(path))
    return sorted(set(h.lower() for png in d.get("plates", []) for h in plate_palette(png, root)))


def role_split(path=None):
    """(everywhere, owned): the fixed colours split by whether a pale light can be mistaken for them. `owned` are the kit's and the gadget's role colours that no identity, human or world colour also
    names: a role file lists them as RGB spheres, and the pale ones (kit.light, gadget.light, the box tape lit at three strengths) are also the lamp's own halo, so masked everywhere they take the lamp with
    them (D100, p007). They count only where the prop that draws them is (`prop_region_from_blocking`, or the layer's own silhouette); `everywhere` is every other fixed colour, masked wherever it appears.
    No roles file: the two identity pigments, nothing owned."""
    path = path or ROLES_FILE
    allh = fixed_role_hexes(path, plates=False)
    if not os.path.exists(path): return allh, []
    d = read_json(path, "roles")
    elsewhere = {h.lower() for grp in d.get("identity", {}).values() for h in grp} | {h.lower() for h in d.get("human", [])} | {h.lower() for grp in d.get("worlds", {}).values() for h in grp}
    owned = sorted({h.lower() for h in list(d.get("kit", [])) + list(d.get("gadget", []))} - elsewhere)
    return sorted(set(allh) - set(owned)), owned


PROP_PAD = 12                           # stage px a prop's crop is padded by: the outline and the anti-aliased edge are outside the native box
FRAME_BAR = 20                          # stage px of the frame prop's bar inwards (Frame.tsx bar 14 + its 5 px contour): the interior is where a frame's light is, not the prop
GATE_CARVE = 1.7                        # on a beat whose emitter is the gates, a gate is lit by it: its disc (r x this) is never a prop's region
# actors.tsx: per prop, the anchor's offset inside the prop's native box and the box (px at scale 1): the box stands on it (foot of the front face), the bubble is centred on it, the gadget hangs from its dial,
# the stalk grows from its root (5.2 x 64 px tall, a spiral about 260 wide), the structure stands on its base centre (the outer arch 220 x 300) and the heap's mound lies on its bottom centre (168 x 66, measured on the restaged beat 4's frames).
PROP_NATIVE = {"box": ((95, 160), (220, 170)), "bubble": ((140, 140), (280, 280)), "gadget": ((108, 190), (200, 260)), "stalk": ((130, 360), (260, 370)), "structure": ((110, 300), (220, 300)), "heap": ((84, 64), (168, 66)), "lid": ((78, 23), (186, 91)), "arch": ((62, 172), (124, 175)), "ring": ((53, 53), (106, 106)), "patch": ((58, 90), (116, 92)), "patch-2": ((58, 90), (116, 92)), "patch-3": ((58, 90), (116, 92)), "bead": ((8, 8), (156, 55))}


# Codex and Clawd: the box they are drawn in, from the anchor, in native px at scale 1 ((x0, y0), (x1, y1)); read off the animatic's frames (Codex at scale 1.8 spans +15..+175 by +45..+240 stage px, Clawd at 1.5 +35..+195 by +30..+155).
CAST_NATIVE = {"codex": ((0, 15), (110, 145)), "clawd": ((15, 10), (140, 115))}


# ---------- the blocking on one frame (the mirror of resolveBlocking in src/library/animation/blocking.ts; the one copy every probe reads) ----------
def _smooth(t): return t * t * (3 - 2 * t)


def placed_at(base, keys, f):
    """Where something stands on film frame `f`: its base before the first key, the last key after it, a smooth move between two keys. `f` None or infinity: the last key (None: the base)."""
    x, y = base["x"], base["y"]
    if not keys or f is None or f < keys[0]["frame"]: return x, y
    i = max(n for n, k in enumerate(keys) if k["frame"] <= f)
    a = keys[i]; b = keys[i + 1] if i + 1 < len(keys) else None
    ay = a.get("y", y)
    if b is None: return a["x"], ay
    t = _smooth((f - a["frame"]) / (b["frame"] - a["frame"]))
    return a["x"] + (b["x"] - a["x"]) * t, ay + (b.get("y", y) - ay) * t


def _is_num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)


def resolve_blocking_at(bl, f):
    """The blocking as it stands on film frame `f`: a prop that is not on stage is gone, everything with position keys is where its keys put it (Codex, Clawd, the frame, the human's `figure`, whose `figureCrop` travels with it), and a
    frame with `carriedBy: clawd` moves with Clawd's offset from his last key. `f` None is the file read as it is (nothing timed). A copy: the argument is not changed."""
    if f is None or bl is None: return bl
    out = copy.deepcopy(bl)
    for who in ("codex", "clawd"):
        if isinstance(bl.get(who), dict) and _is_num(bl[who].get("x")): out[who]["x"], out[who]["y"] = placed_at(bl[who], bl[who].get("at"), f)
    fr = bl.get("frame")
    if isinstance(fr, dict) and _is_num(fr.get("x")):
        x, y = placed_at(fr, fr.get("at"), f)
        if fr.get("carriedBy") == "clawd" and isinstance(bl.get("clawd"), dict):
            cx, cy = placed_at(bl["clawd"], bl["clawd"].get("at"), f); ex, ey = placed_at(bl["clawd"], bl["clawd"].get("at"), math.inf) if bl["clawd"].get("at") else (bl["clawd"]["x"], bl["clawd"]["y"])
            x, y = x + cx - ex, y + cy - ey
        out["frame"]["x"], out["frame"]["y"] = x, y
    hm = bl.get("figure")
    if isinstance(hm, dict) and _is_num(hm.get("x")) and hm.get("at"):
        x, y = placed_at(hm, hm["at"], f); out["figure"]["x"], out["figure"]["y"] = x, y
        if isinstance(bl.get("figureCrop"), dict): out["figureCrop"]["x"] += x - hm["x"]; out["figureCrop"]["y"] += y - hm["y"]
    if isinstance(bl.get("actors"), dict):
        out["actors"] = {n: {**a, **dict(zip(("x", "y"), placed_at(a, a.get("at"), f)))} for n, a in bl["actors"].items() if isinstance(a, dict) and (a.get("on") is None or a["on"] <= f) and (a.get("off") is None or f < a["off"])}
    return out


def blocking_prop_rects(b):
    """The stage rectangles where a beat's blocking draws a prop that wears kit or gadget roles, and the ones carved out of them (a gate is a light): ([(x0, y0, x1, y1, inset)], [(x0, y0, x1, y1)]).
    `inset` > 0 makes the rectangle a ring of that bar width (the frame: its interior is the light's, not the prop's). The actors (`blocking.actors`, `PROP_NATIVE`), Codex and Clawd (`CAST_NATIVE`), the human's crop, the frame, the two blocks, the arch and the floor (everything below `floor.y`); the gates are carved out of them only on a beat whose emitter anchor names the gates."""
    add, carve = [], []
    for name, a in (b.get("actors") or {}).items():
        if name not in PROP_NATIVE: die(f"blocking actor {name!r} has no native size in probe_common.PROP_NATIVE (actors.tsx draws {sorted(PROP_NATIVE)})")
        (ox, oy), (w, h) = PROP_NATIVE[name]; s = a.get("scale", 1.0)
        add.append((a["x"] - ox * s, a["y"] - oy * s, a["x"] - ox * s + w * s, a["y"] - oy * s + h * s, 0))
    for who, ((x0, y0), (x1, y1)) in CAST_NATIVE.items():                         # the cast wears kit.light as its contour in the reduced line world
        c = b.get(who)
        if c: s = c.get("scale", 1.0); add.append((c["x"] + x0 * s, c["y"] + y0 * s, c["x"] + x1 * s, c["y"] + y1 * s, 0))
    fc = b.get("figureCrop")
    if fc: add.append((fc["x"], fc["y"], fc["x"] + fc["width"], fc["y"] + fc["height"], 0))              # the human's own crop (FIGURE_BOX)
    fr = b.get("frame")
    if fr: add.append((fr["x"], fr["y"], fr["x"] + fr["width"], fr["y"] + fr["height"], FRAME_BAR))
    for k in b.get("blocks") or []: add.append((k["x"], k["y"], k["x"] + k["width"], k["y"] + k["height"], 0))
    ar = b.get("arch")
    if ar: add.append((ar["x"], ar["y"], ar["x"] + ar["width"], ar["y"] + ar["height"], 0))
    fl = b.get("floor")
    if fl: add.append((0, fl["y"], STAGE[0], STAGE[1], 0))                                               # the line world draws its floor grid in kit.light
    if "gate" in str((b.get("emitter") or {}).get("anchor", "")).lower():                              # the emitter lives on the gates (the programming world): their lit rings are the light, not the prop
        for g in b.get("gates") or []: carve.append((g["x"] - GATE_CARVE * g["r"], g["y"] - GATE_CARVE * g["r"], g["x"] + GATE_CARVE * g["r"], g["y"] + GATE_CARVE * g["r"]))
    return add, carve


def stage_box_px(shape, cam, x0, y0, x1, y1):
    """(row0, row1, col0, col1) of a stage rectangle in frame pixels: the bounding box of its corners projected through the camera, clipped to the frame."""
    H, W = shape[:2]; sc = W / STAGE[0]
    pts = [project(cam, px, py) for px, py in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return (int(max(0, min(p[1] for p in pts) * sc)), int(min(H, max(p[1] for p in pts) * sc + 1)), int(max(0, min(p[0] for p in pts) * sc)), int(min(W, max(p[0] for p in pts) * sc + 1)))


def prop_region_from_blocking(shape, cam, b):
    """Boolean mask (frame pixels) of where the beat's props are drawn, from the blocking (`blocking_prop_rects`), each crop padded by PROP_PAD stage px and projected through the camera as the
    bounding box of its corners; the lit gates' discs carved out."""
    H, W = shape[:2]; m = np.zeros((H, W), bool)
    box = lambda x0, y0, x1, y1: stage_box_px(shape, cam, x0, y0, x1, y1)
    add, carve = blocking_prop_rects(b)
    for x0, y0, x1, y1, bar in add:
        r0, r1, c0, c1 = box(x0 - PROP_PAD, y0 - PROP_PAD, x1 + PROP_PAD, y1 + PROP_PAD); m[r0:r1, c0:c1] = True
        if bar:
            r0, r1, c0, c1 = box(x0 + bar, y0 + bar, x1 - bar, y1 - bar)
            if r1 > r0 and c1 > c0: m[r0:r1, c0:c1] = False
    for x0, y0, x1, y1 in carve:
        r0, r1, c0, c1 = box(x0, y0, x1, y1); m[r0:r1, c0:c1] = False
    return m


def cast_region_from_blocking(shape, cam, b, who):
    """Mask (frame pixels) of the cast crops the eye is asked to find (`who`: "human" the human's crop, `figureCrop`; "trio" that and Codex's and Clawd's crops, `CAST_NATIVE`), each padded by PROP_PAD,
    from the beat's blocking; None when the blocking lacks one of them."""
    rects = []
    fc = b.get("figureCrop")
    if fc: rects.append((fc["x"], fc["y"], fc["x"] + fc["width"], fc["y"] + fc["height"]))
    if who == "trio":
        for name, ((x0, y0), (x1, y1)) in CAST_NATIVE.items():
            c = b.get(name)
            if c: s_ = c.get("scale", 1.0); rects.append((c["x"] + x0 * s_, c["y"] + y0 * s_, c["x"] + x1 * s_, c["y"] + y1 * s_))
        if len(rects) < 3: return None
    if not rects: return None
    m = np.zeros(shape[:2], bool)
    for x0, y0, x1, y1 in rects:
        r0, r1, c0, c1 = stage_box_px(shape, cam, x0 - PROP_PAD, y0 - PROP_PAD, x1 + PROP_PAD, y1 + PROP_PAD); m[r0:r1, c0:c1] = True
    return m


_LAYER_INDEX = {}


OCCLUDER_GROUP_ORDER = ("figure", "codex", "clawd", "gadget", "box", "pieces", "bubble")      # GROUP_ORDER of src/library/light/sdf.ts: a group's index is what the occluder mask's blue channel carries (byte // 32); change both or neither


def cast_region_from_occluders(path, shape, who, grow=6):
    """Mask (frame pixels) of the cast the eye is asked to find on a real shot's frame, from the occluder mask the light was drawn from (`light-sdf` input: alpha the solid, blue its group): "human" is the `figure`
    group, "trio" adds `codex` and `clawd`; grown by `grow` px so a body and its outline are one region. Colour cannot find them: the flood is Codex's blue."""
    from scipy import ndimage as ndi
    im = Image.open(path).convert("RGBA")
    if (im.size[1], im.size[0]) != tuple(shape[:2]): im = im.resize((shape[1], shape[0]), Image.NEAREST)
    a = np.asarray(im); groups = a[..., 2] // 32; want = [OCCLUDER_GROUP_ORDER.index(g) for g in (("figure",) if who == "human" else ("figure", "codex", "clawd"))]
    return ndi.binary_dilation((a[..., 3] > 127) & np.isin(groups, want), iterations=grow)


def layer_prop_region(man, root, f, shape, grow=2):
    """Boolean mask (frame pixels) of where the layers that draw the shot's props and title drew something on frame `f`, read from the render manifest `man` and the drawing cache under `root`/out/cache/<shot>:
    the props layer's `back` drawing (opaque: the field and the props behind the figure) wherever it is not the field colour, its `front` drawing (the props in front) wherever it has alpha, and the
    world layer's title drawing wherever it has alpha; grown by `grow` px for the anti-aliased edge. The light layers are not in it, so the lamp's halo never is. Region plus colour for a real shot, where the
    blocking does not describe the staging (`blocking_describes`)."""
    from PIL import Image
    from scipy import ndimage as ndi
    r = next((x for x in man["frames"] if x["frame"] == f), None)
    if r is None: return None
    H, W = shape[:2]; m = np.zeros((H, W), bool); fld = [float(v) for v in re.findall(r"[\d.]+", r["params"]["field"])[:3]] if not r["params"]["field"].startswith("#") else [int(r["params"]["field"][i:i + 2], 16) for i in (1, 3, 5)]
    for layer, passes in (("props", ("back", "front")), ("world", ("title",))):
        L = man["layers"].get(layer)
        if not L: continue
        d = os.path.join(root, "out", "cache", man["shot"], layer, L["cacheKey"][:16])
        if d not in _LAYER_INDEX: _LAYER_INDEX[d] = read_json(os.path.join(d, "index.json"), "drawing index")
        for i in r["layers"].get(layer, []):
            kind = i.split("-")[0]
            if kind not in passes or i not in _LAYER_INDEX[d]: continue
            b = _LAYER_INDEX[d][i]
            if b["w"] == 0: continue
            a = np.asarray(Image.open(os.path.join(d, i + ".png")).convert("RGBA")).astype(np.int32)
            drawn = (np.abs(a[..., :3] - np.array(fld)).max(axis=2) > 6) & (a[..., 3] > 0) if kind == "back" else a[..., 3] > 0
            m[b["y"]:b["y"] + b["h"], b["x"]:b["x"] + b["w"]] |= drawn[: H - b["y"], : W - b["x"]]
    return ndi.binary_dilation(m, iterations=grow) if grow else m


def load_blocking(timeline_path):
    """{beat id: blocking} from v3/blocking beside the timeline (empty when the directory is absent)."""
    d = os.path.join(os.path.dirname(os.path.abspath(timeline_path)), "blocking"); out = {}
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json"):
                b = read_json(os.path.join(d, fn), "blocking"); out[b.get("id", fn[:-5])] = b
    return out


def emitter_expected(bl, beat, f):
    """Where the blocking puts the emitter on film frame `f` of `beat` (the mirror of emitterPointAt in src/library/animation/blocking.ts): a straight line from `emitter.start` to `emitter.end` across the beat, moved with
    the frame it follows (`follows: frame`) by the frame's displacement from where it ends. None when the beat has no emitter."""
    e = bl.get("emitter")
    if not e: return None
    t = 0.0 if beat["end"] - beat["start"] <= 1 else max(0.0, min(1.0, (f - beat["start"]) / (beat["end"] - beat["start"] - 1)))
    fr, own = (resolve_blocking_at(bl, f).get("frame") if e.get("follows") == "frame" else None) or bl.get("frame"), bl.get("frame")
    dx, dy = (fr["x"] - own["x"], fr["y"] - own["y"]) if fr and own else (0, 0)
    return e["start"][0] + (e["end"][0] - e["start"][0]) * t + dx, e["start"][1] + (e["end"][1] - e["start"][1]) * t + dy


def blocking_describes(tl, xs, blocking, tol=3.0):
    """The beats whose frames are drawn from `blocking` (the animatic stages every prop at the blocking's anchors): the xsheet emitter, on the beat's first frame that carries one, sits within `tol` stage px of
    where the blocking puts it on that frame (`emitter_expected`: `emitter.start` at a beat's first frame, moved with the frame it follows). A real shot (s01) has its own staging and its own emitter track, so its beats are not in the
    set and no prop crop is read from a blocking that does not describe them."""
    out = set()
    for b in tl["beats"]:
        bl = blocking.get(b["id"]) or {}
        if not (bl.get("emitter") or {}).get("start"): continue
        hit = next(((f, r["emitter"]) for f, r in ((f, xs.get(f)) for f in range(b["start"], b["end"])) if r and isinstance(r.get("emitter"), dict) and r["emitter"].get("x") is not None), None) if xs else None
        if not hit: continue
        want = emitter_expected(bl, b, hit[0])
        if want and np.hypot(hit[1]["x"] - want[0], hit[1]["y"] - want[1]) <= tol: out.add(b["id"])
    return out


def cast_mask(img, cam, hexes, plate, box=FIGURE_BOX, owned=None, region=None):
    """The fixed fills a pale light must not be confused with: the role colours (`hexes`: identity, human, kit, gadget, worlds) everywhere, and the human's cutout palette (`plate`) only inside the
    human's own crop (`box`, stage pixels, projected through the camera as the bounding box of its corners). The cutout carries pale contour and shading colours a pale emitter's glow passes
    through; masked everywhere they would take the glow's core with them, so they are masked where the human is. The same for `owned` (`role_split`: the kit's and the gadget's pale roles) with `region`
    (a frame-sized mask of where those props are drawn): region plus colour. `owned` with no `region` is masked everywhere, as `hexes` is, so a caller that has no region reads as it always did."""
    m = role_mask(img, hexes) if hexes else np.zeros(img.shape[:2], bool)
    if owned: m = m | (role_mask(img, owned) & (region if region is not None else True))
    if plate:
        H, W = img.shape[:2]; sc = W / STAGE[0]; x, y, w, h = box
        pts = [project(cam, px, py) for px, py in ((x, y), (x + w, y), (x, y + h), (x + w, y + h))]
        x0, x1 = int(max(0, min(p[0] for p in pts) * sc)), int(min(W, max(p[0] for p in pts) * sc + 1)); y0, y1 = int(max(0, min(p[1] for p in pts) * sc)), int(min(H, max(p[1] for p in pts) * sc + 1))
        if x1 > x0 and y1 > y0: m[y0:y1, x0:x1] |= role_mask(img[y0:y1, x0:x1], plate)
    return m


def identity_mask(a, radius=IDENTITY_RADIUS, hexes=None):
    """The mask of the identity pigments, or of `hexes` (the fixed roles) when given."""
    return role_mask(a, list(IDENTITY_PIGMENTS.values()) if hexes is None else hexes, radius)


def path_direction(hues):
    """+1 or -1: the way a hue path travels, from the sum of its consecutive signed steps (not from its two ends, which cannot say when the arc is near 180 degrees)."""
    return 1 if sum(signed_hue_diff(a, b) for a, b in zip(hues, hues[1:])) >= 0 else -1


def check_path_monotone(hues, slack=5.0, direction=None):
    """Hue samples along a crossing: returns (ok, reason). The path runs on the shortest arc from the first to the last sample, in one direction, never behind the start or past the end by more than
    `slack` degrees (a detour through a third hue shows as either). `direction` (+1 or -1) fixes the way the path is meant to travel, as the light contract's own path says (`path_direction`):
    the two ends alone cannot, when the arc between them is near 180 degrees and a few degrees of measurement decide which way round is shorter."""
    if len(hues) < 2: return True, "fewer than two samples"
    if direction:
        d = direction; p = [((h - hues[0]) * d) % 360 for h in hues]; p = [v - 360 if v > 180 else v for v in p]; total = p[-1]
    else:
        total = signed_hue_diff(hues[0], hues[-1]); d = 1 if total >= 0 else -1
        p = [d * signed_hue_diff(hues[0], h) for h in hues]
    for i, v in enumerate(p):
        if v < -slack: return False, f"sample {i} ({hues[i]:.0f} deg) sits {-v:.0f} deg behind the start"
        if v > abs(total) + slack: return False, f"sample {i} ({hues[i]:.0f} deg) overshoots the end by {v - abs(total):.0f} deg"
        if i and v < p[i - 1] - slack: return False, f"sample {i} ({hues[i]:.0f} deg) turns back {p[i - 1] - v:.0f} deg"
    return True, f"{hues[0]:.0f} -> {hues[-1]:.0f} deg, {abs(total):.0f} deg {'up' if d > 0 else 'down'}, no detour"


def add_common(ap, frames=True, xsheet=True):
    if frames: ap.add_argument("frames", help="directory of element-NNN.png (npx remotion render --sequence --image-format=png)")
    ap.add_argument("--timeline", default="v3/timeline.json")
    if xsheet: ap.add_argument("--xsheet", default=None, help="v3/xsheet.json (rows with frame, beat, world, key, camera, emitter, phase)")
    ap.add_argument("--json", default=None, help="write the result as JSON")
    ap.add_argument("--shot", default=None, help="measure one shot's slice of the timeline (a shot id of v3/shots.json, or the `shot` of v3/blocking/<beat>.json): its beats' frames only")
    return ap


# ---------- shots: a slice of the timeline ----------
def shot_beat_ids(timeline_path, shot_id):
    """The beats of a shot: `beat` of its v3/shots.json entry, plus every beat whose v3/blocking/<beat>.json names it as its `shot`."""
    base = os.path.dirname(os.path.abspath(timeline_path)); ids = []
    sp = os.path.join(base, "shots.json")
    if os.path.exists(sp):
        for sh in read_json(sp, "shots").get("shots", []):
            if sh.get("id") == shot_id: ids += list(sh.get("beat", []))
    bd = os.path.join(base, "blocking")
    if os.path.isdir(bd):
        for fn in sorted(os.listdir(bd)):
            if fn.endswith(".json"):
                b = read_json(os.path.join(bd, fn), "blocking")
                if b.get("shot") == shot_id and b.get("id", fn[:-5]) not in ids: ids.append(b.get("id", fn[:-5]))
    return ids


def slice_timeline(tl, beat_ids):
    """The timeline restricted to `beat_ids`: those beats, the crossing windows that touch them (a window the slice ends inside is kept and marked `partial`: its other beat is outside),
    and `duration` of the slice's last frame. Returns (timeline, (first frame, last frame + 1))."""
    keep = [b for b in tl["beats"] if b["id"] in beat_ids]
    if not keep: die(f"none of the beats {sorted(beat_ids)} are on the timeline")
    lo, hi = min(b["start"] for b in keep), max(b["end"] for b in keep)
    ids = {b["id"] for b in keep}
    wins = [{**w, "partial": not (w["from"] in ids and w["to"] in ids)} for w in tl["windows"] if w["a"] < hi and w["b"] > lo and (w["from"] in ids or w["to"] in ids)]
    return {**tl, "beats": keep, "windows": wins, "duration": hi, "slice": (lo, hi)}, (lo, hi)


def apply_shot(args, tl, xs=None, frames=None):
    """With --shot: (timeline slice, xsheet rows and frames inside it, note); without: the inputs and None."""
    shot = getattr(args, "shot", None)
    if not shot: return tl, xs, frames, None
    ids = shot_beat_ids(args.timeline, shot)
    if not ids: die(f"--shot {shot}: no beat of {args.timeline} belongs to it (v3/shots.json `beat`, or `shot` in v3/blocking/<beat>.json)")
    sl, (lo, hi) = slice_timeline(tl, set(ids))
    xs2 = {f: r for f, r in xs.items() if lo <= f < hi} if xs else xs
    fr2 = {f: p for f, p in frames.items() if lo <= f < hi} if frames is not None else frames
    if frames is not None and not fr2: die(f"--shot {shot}: no rendered frame in {lo}..{hi - 1}")
    return sl, xs2, fr2, f"shot {shot}: beats {ids}, frames {lo}..{hi - 1}"


def default_xsheet(args):
    """--xsheet, else v3/xsheet.json beside the timeline when it exists."""
    if args.xsheet: return load_xsheet(args.xsheet)
    guess = os.path.join(os.path.dirname(os.path.abspath(args.timeline)), "xsheet.json")
    return load_xsheet(guess) if os.path.exists(guess) else None


# ---------- poses (the formulas of src/library/animation/pose.ts; change both or neither) ----------
SPINE_RIDGE = 0.05                      # SPINE_FIT.ridge: ridge on the S term of the spine fit
SPINE_SPEAK = 0.0962250449              # SPINE_FIT.sPeak: peak of t(1-t)(1-2t)
SPINE_STRAIGHT_BOW = 0.04               # SPINE_FIT.straightBow: below this the spine is straight, class I
SPINE_LOBE = 0.03                       # SPINE_FIT.lobe: each lobe of an S reaches this fraction of the figure
SPINE_SAMPLES = 201                     # SPINE_FIT.samples
TWIN_DEGREES = 40                       # TWIN_DEGREES in pose.ts: mean mirror/parallel difference at which twinning reaches 0
TWIN_MAX = 0.7                          # a pose scoring above this must say why it is twinned
BOW_MIN = 0.06                          # a measured bow below this is a straight spine unless the key declares class I and says why
PAIRS = (("shoulder", "elbow"), ("elbow", "wrist"), ("hip", "knee"), ("knee", "ankle"))


def spine_basis(t):
    t = np.asarray(t, float)
    return 4 * t * (1 - t), t * (1 - t) * (1 - 2 * t) / SPINE_SPEAK


def classify_profile(alpha, beta):
    """Class, bow, sign and inflection of the deviation alpha*C(t) + beta*S(t) (classifyProfile in pose.ts)."""
    ts = np.linspace(0, 1, SPINE_SAMPLES); c, s = spine_basis(ts); dev = alpha * c + beta * s
    pos, neg = max(0.0, dev.max()), max(0.0, (-dev).max()); bow = max(pos, neg)
    if bow < SPINE_STRAIGHT_BOW: return {"class": "I", "bow": bow, "sign": 1 if pos >= neg else -1}
    if pos >= SPINE_LOBE and neg >= SPINE_LOBE:
        first = next(d for d in dev if abs(d) > 1e-9)
        cross = next((i for i, d in enumerate(dev) if i > 0 and np.sign(d) == -np.sign(first) and abs(d) > 1e-12), 0)
        return {"class": "S", "bow": bow, "sign": 1 if first > 0 else -1, "inflection": float(ts[max(0, cross - 1)])}
    return {"class": "C", "bow": bow, "sign": 1 if pos >= neg else -1}


def keys_hash(joints_a, joints_b):
    """sha256 of the joints of the two keys a move runs between (first key, then second), the identity of what an authored breakdown was built on. Each joint is `name=x,y` at two decimals in name
    order, the keys joined by `|`: scripts/animation/author-breakdowns.mjs writes the same string, so a sheet authored there verifies here."""
    import hashlib
    one = lambda j: ";".join(f"{n}={j[n][0]:.2f},{j[n][1]:.2f}" for n in sorted(j))
    return hashlib.sha256((one(joints_a) + "|" + one(joints_b)).encode()).hexdigest()


def spine_curve(j, height_px=None):
    """The line of action a pose draws: least squares of alpha*C(t) + beta*S(t) (ridge on beta) to the offsets of the shoulder midpoint, torso and neck
    from the root-to-head chord, in fractions of height_px (or of the chord when absent). Same formula and constants as spineCurve in pose.ts."""
    P = lambda n: np.array(j[n], float)
    root, head = P("root"), P("head"); chord = head - root; norm = float(np.hypot(*chord))
    if norm < 1e-6: raise ValueError("root and head coincide")
    n = np.array([-chord[1], chord[0]]) / norm
    pts = ([(P("shoulderL") + P("shoulderR")) / 2] if "shoulderL" in j and "shoulderR" in j else []) + [P("torso"), P("neck")]
    t = np.array([(p - root) @ chord / norm ** 2 for p in pts]); d = np.array([(p - root) @ n for p in pts]) / (height_px if height_px and height_px > 0 else norm)
    c, s = spine_basis(t)
    cc, cs, ss, cd, sd = c @ c, c @ s, s @ s + SPINE_RIDGE, c @ d, s @ d
    det = cc * ss - cs * cs
    return classify_profile((cd * ss - cs * sd) / det, (cc * sd - cs * cd) / det)


def twinning_score(j):
    """0 (nothing alike) to 1 (a perfect twin): mean over upper arm, forearm, thigh, shin of the smaller of the mirrored and the parallel angle between the
    left and right bone, read against the spine axis, as 1 - mean/40 degrees (twinningScore in pose.ts)."""
    P = lambda n: np.array(j[n], float)
    ax = P("head") - P("root"); ax = ax / np.hypot(*ax) if np.hypot(*ax) > 1e-9 else np.array([0.0, -1.0])
    fr = lambda v: np.array([v @ ax, ax[0] * v[1] - ax[1] * v[0]])
    ang = lambda a, b: abs(np.arctan2(a[0] * b[1] - a[1] * b[0], a @ b))
    tot = 0.0
    for near, far in PAIRS:
        l, r = (fr(P(far + s) - P(near + s)) for s in "LR")
        tot += min(ang(np.array([l[0], -l[1]]), r), ang(l, r))
    return max(0.0, 1 - np.degrees(tot / len(PAIRS)) / TWIN_DEGREES)


def arc_deviation(path):
    """Largest perpendicular distance of a path's points from the chord between its first and last point (arcDeviation in pose.ts); 0 under 3 points."""
    p = np.asarray(path, float)
    if len(p) < 3: return 0.0
    c = p[-1] - p[0]; n = float(np.hypot(*c))
    if n < 1e-9: return float(np.hypot(*(p - p[0]).T).max())
    return float((np.abs(c[0] * (p[:, 1] - p[0, 1]) - c[1] * (p[:, 0] - p[0, 0])) / n).max())


ARC_ZERO_PX = 1.0        # a deviation under this is zero: drawings are quantised and the rig rounds to 0.001 but a hand-set pose is not exact
ARC_BACK_FRAC = 0.005    # a step back along the chord counts only above max(ARC_ZERO_PX, this x heightPx): 4.4 px at 880, above the kick-back a lagging part makes
ARC_MAX_TURN_DEG = 90.0  # the turn between two consecutive segments of an arc
ARC_MIN_SEGMENT_PX = 1.0 # a segment shorter than this (or than the back-step bar, when that is larger) has no direction worth a turn


def reversal_points(kinds):
    """Indexes of the path points a declared reversal makes: a drawing of kind `anticipation` or `overshoot`, and the point right after an overshoot (the settle, else the key):
    the step INTO an anticipation goes back along the chord, the step OUT of an overshoot comes back from past the key, and the path turns there."""
    if kinds is None: return set()
    return {i for i, k in enumerate(kinds) if k in ("anticipation", "overshoot") or (i and kinds[i - 1] == "overshoot")}


def arc_faults(path, frames=None, need=0.0, kinds=None, height_px=None):
    """Why a path is not an arc: [(letter, text)] (empty: it is). A path is one joint over a move: the pose before it, then one position per drawing; `frames[i]` is the
    frame path point i is drawn on (None for the pose before) and `kinds[i]` the declared kind of the breakdown that point shows (`anticipation`, `passing`, `overshoot`,
    `settle`; None for the pose before and the key itself). An arc over a move has, with the chord from the first to the last point:
      a  one sign: the signed perpendicular deviation of every interior point is on the same side of the chord (|deviation| < ARC_ZERO_PX is zero), a bow and not a zigzag;
      b  monotone progress: the projection onto the chord never goes back by more than max(ARC_ZERO_PX, ARC_BACK_FRAC x height_px) from one drawing to the next, except into a declared
         anticipation and out of a declared overshoot (`reversal_points`): those are the reversals the move's timing shape declares, and any other step back fails;
      c  no hairpin: the turn between consecutive segments never exceeds ARC_MAX_TURN_DEG (segments under ARC_MIN_SEGMENT_PX or the back-step bar have no direction and are skipped), except at the
         vertex of a declared reversal;
      d  reach: the largest deviation is at least `need` (arcDeviation in pose.ts)."""
    p = np.asarray(path, float); fr = list(frames) if frames is not None else [None] * len(p)
    at = lambda i: "the pose before the move" if fr[i] is None else f"frame {fr[i]}"
    kd = list(kinds) if kinds is not None else None
    declared = reversal_points(kd); bar = max(ARC_ZERO_PX, ARC_BACK_FRAC * (height_px or 0.0))
    out = []
    c = p[-1] - p[0]; n = float(np.hypot(*c))
    if len(p) < 3 or n < 1e-9: return [("d", f"it has {len(p)} points and a {n:.0f} px chord: nothing to bow")] if need > 0 else out
    u = c / n; rel = p - p[0]
    proj = rel @ u; dev = (c[0] * rel[:, 1] - c[1] * rel[:, 0]) / n
    inner = [(i, float(dev[i])) for i in range(1, len(p) - 1) if abs(dev[i]) >= ARC_ZERO_PX]
    pos, neg = [x for x in inner if x[1] > 0], [x for x in inner if x[1] < 0]
    if pos and neg:
        out.append(("a", "it bows to both sides of its chord (a zigzag, not an arc): " + ", ".join(f"{at(i)} {d:+.1f} px" for i, d in inner)))
    back = [(i, float(proj[i] - proj[i - 1])) for i in range(1, len(p)) if proj[i] - proj[i - 1] < -bar and not (kd and (kd[i] == "anticipation" or kd[i - 1] == "overshoot"))]
    if back:
        out.append(("b", f"it moves back along its chord (undeclared; over {bar:.1f} px): " + ", ".join(f"{at(i - 1)} to {at(i)} by {abs(d):.1f} px" for i, d in back)))
    seg = [(i, p[i + 1] - p[i]) for i in range(len(p) - 1) if float(np.hypot(*(p[i + 1] - p[i]))) >= max(ARC_MIN_SEGMENT_PX, bar)]
    sharp = []
    for (i, s0), (j, s1) in zip(seg, seg[1:]):
        turn = float(np.degrees(np.arccos(np.clip(float(s0 @ s1) / (np.hypot(*s0) * np.hypot(*s1)), -1, 1))))
        if turn > ARC_MAX_TURN_DEG and j not in declared: sharp.append((j, turn))
    if sharp:
        out.append(("c", "it turns sharply: " + ", ".join(f"{turn:.0f} degrees at {at(j)}" for j, turn in sharp) + f" (the most an arc turns between drawings is {ARC_MAX_TURN_DEG:.0f})"))
    dmax = arc_deviation(p)
    if dmax < need: out.append(("d", f"it leaves its {n:.0f} px chord by {dmax:.1f} px, needs {need:.1f}"))
    return out


def spacing_profile(path):
    """Distance between each pair of consecutive drawings of a path (spacingProfile in pose.ts)."""
    p = np.asarray(path, float)
    return [float(x) for x in np.hypot(*(p[1:] - p[:-1]).T)] if len(p) > 1 else []


# ---------- timing shape (the formulas of TIMING_SHAPE, chordPosition and timingFaults in src/library/animation/pose.ts; change both or neither) ----------
TIMING_DRAWINGS = (3, 6)                                  # C28: a move between two holds
TIMING_BANDS = {"anticipation": (-0.15, -0.05), "passing": (0.25, 0.75), "overshoot": (1.05, 1.15), "settle": (0.9, 1.0)}
TIMING_RANK = {"anticipation": 0, "passing": 1, "overshoot": 2, "settle": 3}
REACH_PAST = 0.25                                         # REACH_PAST in pose.ts


def chord_position(kind, favour):
    """Where along the chord (first key 0, second key 1) a breakdown draws; the stored favour is positive for every kind."""
    return -REACH_PAST * favour if kind == "anticipation" else 1 + REACH_PAST * favour if kind == "overshoot" else favour


def timing_moves(poses, holds=None):
    """[(from key, to key, hold end frame, marks)] for every pair of consecutive pose keys: marks are the drawings the chart plays between the hold's end and the next key
    ({frame, kind, favour, between}): the authored breakdowns, else the two automatic thirds (kind "automatic"), as `marksIn` does. `holds` maps a key name to its hold in frames
    (the key sheet's); else the pose key's own."""
    keys = sorted(poses["keys"], key=lambda k: k["frame"]); out = []
    for a, b in zip(keys, keys[1:]):
        hold = (holds or {}).get(a["name"], a.get("hold")) or 0; start = a["frame"] + hold
        own = sorted((x for x in poses.get("breakdowns", []) if a["frame"] < x["frame"] < b["frame"]), key=lambda x: x["frame"])
        marks = [{"frame": x["frame"], "kind": x["kind"], "favour": x["favour"], "between": list(x["between"])} for x in own] or \
                [{"frame": int(np.floor(np.floor(start + (b["frame"] - start) * f + 0.5) / 2) * 2), "kind": "automatic", "favour": f, "between": None} for f in (1 / 3, 2 / 3)]
        out.append((a, b, start, marks))
    return out


def timing_shape(a, b, start, marks, hold_known=True):
    """(ok, line, faults) for one move: the drawings in order with their positions along the chord, and every way the move breaks the timing shape."""
    at = f'{a["name"]} -> {b["name"]}'; lo, hi = TIMING_DRAWINGS; faults = []
    if not lo <= len(marks) <= hi:
        faults.append(f"{len(marks)} drawings, a move uses {lo}-{hi} (C28)" + (" (none authored: the chart adds two thirds)" if any(m["kind"] == "automatic" for m in marks) else ""))
    kinds = [m for m in marks if m["kind"] != "automatic"]
    for m in kinds:
        if m["kind"] not in TIMING_BANDS: faults.append(f'unknown kind {m["kind"]!r} on frame {m["frame"]}'); continue
        pos = chord_position(m["kind"], m["favour"]); band = TIMING_BANDS[m["kind"]]
        if not band[0] - 1e-9 <= pos <= band[1] + 1e-9:
            faults.append(f'{m["kind"]} on frame {m["frame"]} draws at {pos:+.3f} along the chord (favour {m["favour"]}), the band is {band[0]} to {band[1]}')
        if list(m["between"]) != [a["name"], b["name"]]: faults.append(f'the breakdown on frame {m["frame"]} names {m["between"]}, not the keys its frame sits between')
        if hold_known and m["frame"] < start: faults.append(f'{m["kind"]} on frame {m["frame"]} sits inside the hold of {a["name"]!r} (it ends on frame {start})')
    for m0, m1 in zip(marks, marks[1:]):
        if m0["frame"] == m1["frame"]: faults.append(f'two drawings on frame {m1["frame"]}')
    for kind in ("anticipation", "overshoot", "settle"):
        n = sum(1 for m in kinds if m["kind"] == kind)
        if n > 1: faults.append(f"{n} {kind} drawings, at most one")
    for m0, m1 in zip(kinds, kinds[1:]):
        if m0["kind"] in TIMING_RANK and m1["kind"] in TIMING_RANK and TIMING_RANK[m0["kind"]] > TIMING_RANK[m1["kind"]]:
            faults.append(f'{m1["kind"]} on frame {m1["frame"]} comes after a {m0["kind"]}: the order is anticipation, passing, overshoot, settle')
    for m0, m1 in zip(marks, marks[1:]):
        if m0["favour"] == m1["favour"]: faults.append(f'the drawing on frame {m1["frame"]} has the favour {m1["favour"]} of the one before it: the exposure sheet marks a breakdown only where the favour changes, so it would not show')
    passing = [m for m in kinds if m["kind"] == "passing"]
    for m0, m1 in zip(passing, passing[1:]):
        if m1["favour"] <= m0["favour"]: faults.append(f'passing {m1["favour"]} on frame {m1["frame"]} does not rise past {m0["favour"]}')
    desc = ", ".join(f'{m["kind"]} {chord_position(m["kind"], m["favour"]):+.2f}@{m["frame"]}' if m["kind"] in TIMING_BANDS else f'{m["kind"]} {m["favour"]:.2f}@{m["frame"]}' for m in marks)
    return not faults, f'{at}: {len(marks)} drawings [{desc}]' + ("" if not faults else "; " + "; ".join(faults)), faults


def lead_arm_faults(poses):
    """[(move, text)] for every move whose to-key lead arm has a joint in a secondary that lags on it (leadArmFaults in pose.ts): a secondary is exempt on a move its `side` leads."""
    out = []
    for a, b, _, _ in timing_moves(poses):
        arm = (b.get("lead") or {}).get("arm", "none")
        if arm not in ("L", "R"): continue
        for c in poses.get("secondaries", []):
            if c.get("side") == arm: continue
            held = [j for j in c["joints"] if j in (f"shoulder{arm}", f"elbow{arm}", f"wrist{arm}")]
            if held: out.append((f'{a["name"]} -> {b["name"]}', f'{a["name"]} -> {b["name"]}: the lead arm ({arm}) joint {", ".join(held)} belongs to secondary {c["name"]!r}, which lags on that move; give it side {arm!r} or leave the arm out'))
    return out


# ---------- secondaries made of a material (D97; lagFramesOf and `Secondary` in src/library/animation/pose.ts) ----------
MATERIALS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "v3", "materials.json")
_MATERIALS = {}


def load_materials(path=None):
    """v3/materials.json (or `path`) as {id: material}; read once per path."""
    path = path or MATERIALS_FILE
    if path not in _MATERIALS: _MATERIALS[path] = read_json(path, "materials file")
    return _MATERIALS[path]


def material_motion(materials, mid):
    """{lagFrames, settleFrames, overshoot} a material declares, or None when it does not exist or declares no lag or settle (the materials a secondary can be made of)."""
    m = (materials or {}).get(mid)
    if not m or not m.get("lagFrames") or not m.get("settleFrames"): return None
    return {"lagFrames": m["lagFrames"]["value"], "settleFrames": m["settleFrames"]["value"], "overshoot": (m.get("overshoot") or {}).get("value", 0)}


def secondary_lag_frames(c, materials=None):
    """Frames a secondary trails its primary: its material's declared lag, else the sheet's lagDrawings x 2 (with both, the material is the lag and the sheet's number the floor)."""
    if c.get("material"):
        mo = material_motion(materials if materials is not None else load_materials(), c["material"])
        if mo: return mo["lagFrames"]
    return 2 * c["lagDrawings"]


def secondary_follows(c, move_start):
    """False once a secondary has dropped (`dropsAt`): a move that starts on or after that frame does not lag it, it is a prop by then."""
    return c.get("dropsAt") is None or move_start < c["dropsAt"]
