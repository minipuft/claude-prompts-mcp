#!/usr/bin/env python3
"""Joint placement over the key plates of s01 (the 17 joints of assets/human/skeleton.json), by measurement on the plate.

    s01_joints.py grid <K-number> [--scale 2]        write /tmp/s01/grid-K<n>.png: the crop enlarged with a 50 px grid (crop pixels) and the green skin components marked
    s01_joints.py overlay <out.png> K1 K2 ...        draw each key's placed joints and bones over its crop, side by side

Joints are typed into v3/keys/s01-arrival-overwhelm.plate-joints.json as {"K1": {"head": [x, y], ...}} in crop pixels. The skin detector (the green
identity pigment) gives the face and the two hands as components; those centroids are the only automatic input, the rest is read off the plate by eye.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KD = os.path.join(ROOT, "assets/human/keys/s01-arrival-overwhelm")
PJ = os.path.join(ROOT, "v3/keys/s01-arrival-overwhelm.plate-joints.json")
SK = json.load(open(os.path.join(ROOT, "assets/human/skeleton.json")))["skeleton"]
PARENT = {j["name"]: j["parent"] for j in SK}
NAMES = [j["name"] for j in SK]


def skin_components(a):
    r, g, b = (a[..., i].astype(int) for i in range(3))
    m = (g - r > 28) & (g - b > 12) & (g > 105)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < 80: continue
        out.append({"area": int(len(ys)), "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "centroid": [round(float(xs.mean()), 1), round(float(ys.mean()), 1)]})
    return sorted(out, key=lambda c: c["bbox"][1])


def grid(k, scale):
    im = Image.open(os.path.join(KD, f"K{k}-crop.png")).convert("RGB")
    a = np.asarray(im)
    big = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    big = Image.eval(big, lambda v: min(255, int(v * 1.15) + 18))
    d = ImageDraw.Draw(big)
    step = 50 if im.height < 700 else 100
    for x in range(0, im.width, step):
        d.line([(x * scale, 0), (x * scale, big.height)], fill=(90, 90, 60), width=1); d.text((x * scale + 2, 2), str(x), fill=(255, 255, 120))
    for y in range(0, im.height, step):
        d.line([(0, y * scale), (big.width, y * scale)], fill=(90, 90, 60), width=1); d.text((2, y * scale + 2), str(y), fill=(255, 255, 120))
    comps = skin_components(a)
    for c in comps:
        x0, y0, x1, y1 = c["bbox"]; d.rectangle([x0 * scale, y0 * scale, x1 * scale, y1 * scale], outline=(255, 80, 60), width=1)
        d.text((c["centroid"][0] * scale, c["centroid"][1] * scale), f"{c['area']}", fill=(255, 80, 60))
    out = f"/tmp/s01/grid-K{k}.png"; big.save(out); print(out, im.size, json.dumps(comps))


def overlay(out, keys):
    pj = json.load(open(PJ))
    tiles = []
    for k in keys:
        im = Image.open(os.path.join(KD, f"{k}-crop.png")).convert("RGB")
        im = Image.eval(im, lambda v: min(255, int(v * 1.1) + 14))
        d = ImageDraw.Draw(im)
        j = pj.get(k, {})
        for n in NAMES:
            p = PARENT[n]
            if p and n in j and p in j: d.line([tuple(j[p]), tuple(j[n])], fill=(255, 70, 50), width=3)
        for n in NAMES:
            if n in j:
                x, y = j[n]; d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 255, 0), width=2); d.text((x + 7, y - 6), n.replace("shoulder", "sh").replace("elbow", "el").replace("wrist", "wr").replace("ankle", "an").replace("poncho", "pn"), fill=(255, 255, 0))
        tiles.append(im)
    H = max(t.height for t in tiles); W = sum(t.width for t in tiles) + 10 * len(tiles)
    sheet = Image.new("RGB", (W, H), (20, 20, 30)); x = 0
    for t in tiles: sheet.paste(t, (x, 0)); x += t.width + 10
    sheet.save(out); print(out, sheet.size)


if __name__ == "__main__":
    if sys.argv[1] == "grid":
        grid(int(sys.argv[2]), float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 2)
    elif sys.argv[1] == "overlay":
        overlay(sys.argv[2], sys.argv[3:])
