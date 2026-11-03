#!/usr/bin/env python3
"""The frames of a rendered shot as they are WITHOUT the light layer (D98): the same cached drawings, the same compositor (`compose-layers.py`), every drawing of the `light-sdf` layer left out.
usage: compose-without-light-sdf.py out/<shot>/render-manifest.json <out dir> [--frames a,b,c]      writes <out dir>/element-NNN.png
This is the 'before' of the light layer: a probe or a study that wants to say what the layer changed compares a frame here with the same frame of `out/<shot>-seq`. Exit 0 written, 2 input error."""
import argparse, importlib.util, json, os, re, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("compose_layers", os.path.join(os.path.dirname(os.path.abspath(__file__)), "compose-layers.py"))
cl = importlib.util.module_from_spec(spec); spec.loader.exec_module(cl)
ap = argparse.ArgumentParser(); ap.add_argument("manifest"); ap.add_argument("out"); ap.add_argument("--frames", default=None)
a = ap.parse_args()
m = json.load(open(a.manifest)); shot = m["shot"]
want = {int(x) for x in a.frames.split(",")} if a.frames else None
order = ["back", "figure", "front", "light-over", "grain", "title"]      # PASSES without the light layer's two
layer_of = {"back": "props", "figure": "figure", "front": "props", "light-over": "light", "grain": "light", "title": "world"}
box = {}; path = {}; hashes = {}
for layer, L in m["layers"].items():
    key = L["cacheKey"][:16]; d = os.path.join(ROOT, "out", "cache", shot, layer, key)
    if not os.path.exists(os.path.join(d, "index.json")): continue
    idx = json.load(open(os.path.join(d, "index.json")))
    for k, v in idx.items(): box[(layer, k)] = v; path[(layer, k)] = os.path.join(d, k + ".png")
os.makedirs(a.out, exist_ok=True)
size = [1280, 720]
for r in m["frames"]:
    f = r["frame"]
    if want is not None and f not in want: continue
    ds = []
    for p in order:
        for i in r["layers"][layer_of[p]]:
            if i.startswith(p + "-"): ds.append({"pass": p, "path": path[(layer_of[p], i)], "box": box[(layer_of[p], i)]})
    row = {"frame": f, "field": [7, 6, 12], "grainOpacity": r["params"]["grainOpacity"], "titleOpacity": r["params"]["titleOpacity"], "drawings": ds}
    fld = r["params"]["field"]
    row["field"] = [int(fld[i:i + 2], 16) for i in (1, 3, 5)] if fld.startswith("#") else [float(x) for x in re.findall(r"[\d.]+", fld)[:3]]      # the compositor's own parse (render-cached.mjs parseRgb)
    cl.write_png(os.path.join(a.out, f"element-{f:03d}.png"), cl.compose_frame({"size": size}, row))
print(f"wrote {len([n for n in os.listdir(a.out) if n.endswith('.png')])} frames to {a.out}")
