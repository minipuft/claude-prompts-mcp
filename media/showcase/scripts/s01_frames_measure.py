#!/usr/bin/env python3
"""Measurements on the rendered frames of s01 that the animation probes do not make (render study evidence), written to out/s01-measure.json.

usage: s01_frames_measure.py                       (reads out/s01-seq, out/s01-fig-seq, out/s01-arrival-overwhelm-xsheet.json, v3/layouts/s01-arrival-overwhelm.json)

1. drawn layer, C16/C27: on the figure-only pass (out/s01-fig-seq) the number of frames on which the figure changes, split by parity; the same on the full
   pass inside the figure crop, where the light shares the pixels (the number the probe sees).
2. light layer, C18: the frame each response starts, against the pop (180): the first frame the pop ring's accent pixels appear, the first frame the lamp's
   white core appears, the first frame the flood's mean blue rises 4 levels over frame 0's, and the grain's first frame (the first frame the field's noise rises).
3. C1: pixels within 6 RGB of each identity pigment on frames 0, 120, 200, 300 and 419 (the pigments must survive the flood).
4. C24, identity-complete: saturated pixels (chroma >= 60, max >= 64) outside the shot's hue pair +-15 deg, with every identity role of the companions and the
   human's palette masked (the probe masks only #4f7df2 and #e8694a).
5. C25: the lamp's centroid on frames 0 and 300 against the layout's seam and dial; the camera's zoom ratio against the layout's figure-height ratio.
6. identity pass, D70: the face (green skin) on frames 0, 104, 190 and 419 cropped at its on-screen size and enlarged 6 x (out/s01-identity-pass.png), with its pixel height.
7. the 12-frame strip (out/s01-strip.png).
"""
import colorsys, glob, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEQ = os.path.join(ROOT, "out/s01-seq"); FIG = os.path.join(ROOT, "out/s01-fig-seq")
XS = {r["frame"]: r for r in json.load(open(os.path.join(ROOT, "out/s01-arrival-overwhelm-xsheet.json")))["rows"]}
LAY = json.load(open(os.path.join(ROOT, "v3/layouts/s01-arrival-overwhelm.json")))
load = lambda d, f: np.asarray(Image.open(os.path.join(d, f"element-{f:03d}.png")).convert("RGB")).astype(np.int16)
out = {}

# 1. drawn layer on the figure-only pass
def parity(dir_, crop):
    prev, odd, even = None, 0, 0
    for f in range(420):
        a = load(dir_, f)
        if crop: x, y, w, h = crop; a = a[y:y + h, x:x + w]
        if prev is not None:
            changed = (np.abs(a - prev).sum(axis=2) > 24).sum() > 4
            if changed: (odd if f % 2 else even).__class__  # noqa
            if changed:
                if f % 2: odd += 1
                else: even += 1
        prev = a
    return odd, even
fo, fe = parity(FIG, None)
out["drawnLayer"] = {"figureOnlyPass": {"oddFramesChanged": fo, "evenFramesChanged": fe}}
# the camera moves on ones, so the figure-only pass changes on odd frames during the widen (frames 150-210): count them apart
cam_odd = sum(1 for f in range(151, 211, 2) if XS[f]["camera"] != XS[f - 1]["camera"])
out["drawnLayer"]["cameraOddFramesDuringWiden"] = cam_odd
fo2, fe2 = 0, 0
prev = None
for f in range(420):
    a = load(FIG, f)
    if prev is not None and (np.abs(a - prev).sum(axis=2) > 24).sum() > 4:
        if f % 2 and not (150 < f <= 210): fo2 += 1
        elif f % 2 == 0: fe2 += 1
    prev = a
out["drawnLayer"]["figureOnlyOutsideWidenOdd"] = fo2

# 2. light layer lag
def yellow(a): return int(((a[..., 0] > 220) & (a[..., 1] > 170) & (a[..., 2] < 90)).sum())
base_blue = load(SEQ, 0)[..., 2].mean()
first = {"popRing": None, "lampCore": None, "floodBlue": None}
for f in range(170, 260):
    a = load(SEQ, f)
    if first["popRing"] is None and yellow(a) > 400 and f >= 178: first["popRing"] = f
    if first["lampCore"] is None and ((a.min(axis=2) > 245).sum() > 1500) and f >= 178: first["lampCore"] = f
    if first["floodBlue"] is None and a[..., 2].mean() > base_blue + 4 and f >= 178: first["floodBlue"] = f
out["lightLag"] = {"pop": 180, **first, "note": "frame of the first response; law 4 asks 2-4 frames after the drawn cause"}

# 3. identity pigments
PIG = {"codex.main1": "#4f7df2", "clawd.main1": "#e8694a", "skin.main1": "#67b479"}
hexrgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])
out["identity"] = {}
for f in (0, 120, 200, 300, 419):
    a = load(SEQ, f)
    out["identity"][f] = {k: int((np.sqrt(((a - hexrgb(v)) ** 2).sum(axis=2)) <= 6).sum()) for k, v in PIG.items()}

# 4. C24 identity-complete
IDENT = ["#4f7df2", "#2c49b8", "#1f2f7a", "#8fb1ff", "#9fe8ff", "#e8694a", "#c94a2f", "#8c2f1c", "#ffa184", "#2a1410", "#67b479", "#4f9a62", "#c885c2", "#9fd9a8", "#1d1d36",
         "#2f45a8", "#b983c0", "#e7e4da", "#d28a21", "#131818"]
pair = [hue for hue in (222.0, 50.0)]
def hue_arr(a):
    r, g, b = (a[..., i].astype(np.float32) for i in range(3)); mx = a.max(axis=-1).astype(np.float32); mn = a.min(axis=-1).astype(np.float32); d = np.where(mx == mn, 1, mx - mn)
    return np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
bad = []
for f in range(0, 420, 6):
    a = load(SEQ, f)
    sat = ((a.max(axis=2) - a.min(axis=2)) >= 60) & (a.max(axis=2) >= 64)
    ident = np.zeros(sat.shape, bool)
    for h in IDENT: ident |= np.sqrt(((a - hexrgb(h)) ** 2).sum(axis=2)) <= 40
    m = sat & ~ident
    h = hue_arr(a)[m]
    if h.size < 30: continue
    d = np.min([np.minimum(np.abs(h - p) % 360, 360 - np.abs(h - p) % 360) for p in pair], axis=0)
    outside = int((d > 15).sum())
    bad.append((f, outside, int(h.size)))
worst = max(bad, key=lambda t: t[1] / t[2])
out["colourPairIdentityComplete"] = {"framesChecked": len(bad), "framesOver2pct": [b for b in bad if b[1] > 0.02 * b[2]][:20], "worstFrame": worst, "worstShare": round(worst[1] / worst[2], 4)}

# 5. C25
def lamp(a):
    lum = a.mean(axis=2); thr = np.sort(lum.ravel())[-4608]
    ys, xs = np.where(lum >= thr); return float(xs.mean()), float(ys.mean())
c25 = {}
for f, want in ((0, (LAY["emitter"]["startXY"][0] * 1280, LAY["emitter"]["startXY"][1] * 720)), (300, (LAY["emitter"]["endXY"][0] * 1280, LAY["emitter"]["endXY"][1] * 720))):
    got = lamp(load(SEQ, f)); e = XS[f]["emitter"]
    c25[f] = {"brightest0.5pctCentroid": [round(got[0], 1), round(got[1], 1)], "xsheetEmitter": [e["x"], e["y"]] if e else None, "layout": [round(want[0], 1), round(want[1], 1)],
              "offsetPctOfWidth": round(100 * float(np.hypot(got[0] - want[0], got[1] - want[1])) / 1280, 2), "xsheetOffsetPctOfWidth": round(100 * float(np.hypot(e["x"] - want[0], e["y"] - want[1])) / 1280, 2) if e else None}
cams = XS[419]["camera"]
c25["zoomEnd"] = cams["zoom"]; c25["layoutFigureRatio"] = round(LAY["figure"]["endHeightPct"] / LAY["figure"]["startHeightPct"], 4)
out["c25"] = c25

# 6. identity pass
tiles, faces = [], {}
for f in (0, 104, 190, 419):
    a = load(SEQ, f).astype(np.uint8)
    r, g, b = (a[..., i].astype(int) for i in range(3))
    m = (g - r > 28) & (g - b > 12) & (g > 105)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    best = None
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < 12: continue
        if best is None or ys.min() < best[1]: best = (xs.mean(), ys.min(), xs.min(), xs.max(), ys.max(), len(ys))
    if best:
        cx, cy = int(best[0]), int((best[1] + best[4]) / 2)
        faces[f] = {"centre": [cx, cy], "heightPx": int(best[4] - best[1] + 1), "widthPx": int(best[3] - best[2] + 1), "pixels": best[5]}
        crop = Image.fromarray(a).crop((cx - 40, cy - 40, cx + 40, cy + 40)).resize((480, 480), Image.NEAREST)
        d = ImageDraw.Draw(crop); d.text((8, 8), f"f{f}  face {faces[f]['widthPx']}x{faces[f]['heightPx']} px", fill=(255, 255, 255))
        tiles.append(crop)
out["identityPass"] = faces
if tiles:
    sheet = Image.new("RGB", (480 * len(tiles), 480))
    for i, t in enumerate(tiles): sheet.paste(t, (i * 480, 0))
    sheet.save(os.path.join(ROOT, "out/s01-identity-pass.png"))

# 7. the strip
STRIP = [0, 42, 66, 104, 154, 180, 190, 210, 228, 272, 330, 419]
tiles = []
for f in STRIP:
    im = Image.open(os.path.join(SEQ, f"element-{f:03d}.png")).convert("RGB").resize((640, 360), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 120, 20], fill=(0, 0, 0)); d.text((6, 4), f"f{f}", fill=(255, 255, 255)); tiles.append(im)
strip = Image.new("RGB", (640 * 4, 360 * 3))
for i, t in enumerate(tiles): strip.paste(t, ((i % 4) * 640, (i // 4) * 360))
strip.save(os.path.join(ROOT, "out/s01-strip.png"))
json.dump(out, open(os.path.join(ROOT, "out/s01-measure.json"), "w"), indent=1)
print(json.dumps(out, indent=1)[:6000])
