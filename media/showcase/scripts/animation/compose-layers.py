#!/usr/bin/env python3
"""Compose a shot's frames from cached layer drawings, and compare them with the browser's own frames (row 6.12, D87). Called by render-cached.mjs.

usage: compose-layers.py ingest  <job.json> <result.json>     crop each rendered pass to its alpha box, write it to the cache, hash it
       compose-layers.py compose <job.json> <result.json>     place the cached drawings of every frame over the field colour and write element-NNN.png
       compose-layers.py confirm <job.json> <result.json>     per frame: the composed frame against the browser's, with the layer that owns the largest difference
       compose-layers.py expand  <job.json> <result.json>     place each cropped drawing at its box on a transparent full frame and write it (the occluder masks the light pass reads, D98)

A drawing is a pass drawn by the browser (the back opaque, the others on a transparent frame), cropped to its alpha box (x, y, w, h in frame pixels). The camera is baked into it (src/scenes/shotS01Passes.ts), so
placing it is a copy. Normal passes composite source-over; the light layer's dots (`light-sdf`), the lamp's core and the grain are screen-blended (as the browser does), the grain and the title scaled by the frame's opacity.
Arithmetic is float32 and rounds once at the end, so a composed frame differs from the browser's (which rounds after every draw) by a level at most on soft edges.
A frame whose inputs (drawing hashes, field, opacities, this script) are the same as the manifest recorded, and whose file still has the recorded hash, is not written again.
"""
import hashlib, json, os, sys
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image

SCREEN = ("light-sdf", "light-over", "grain")
LEVELS, SHARE = 2, 0.0001            # the determinism tolerance (probe-determinism.py): 2 levels on at most 0.01 % of the pixels


def sha(b): return hashlib.sha256(b).hexdigest()
def sha_file(p):
    with open(p, "rb") as f: return sha(f.read())


def ingest_one(it):
    img = Image.open(it["src"]).convert("RGBA"); a = np.asarray(img)
    nz = np.argwhere(a[..., 3] > 0)
    os.makedirs(os.path.dirname(it["dst"]), exist_ok=True)
    if len(nz) == 0:
        crop, box = Image.new("RGBA", (1, 1), (0, 0, 0, 0)), (0, 0, 0, 0)
    else:
        y0, x0 = nz.min(axis=0); y1, x1 = nz.max(axis=0) + 1
        crop, box = img.crop((int(x0), int(y0), int(x1), int(y1))), (int(x0), int(y0), int(x1 - x0), int(y1 - y0))
    tmp = it["dst"] + ".part"; crop.save(tmp, format="PNG", compress_level=3); os.replace(tmp, it["dst"])
    return it["id"], {"x": box[0], "y": box[1], "w": box[2], "h": box[3], "sha256": sha_file(it["dst"])}


def cmd_ingest(job):
    with ProcessPoolExecutor(max_workers=job.get("workers", 8)) as ex:
        return {"items": dict(ex.map(ingest_one, job["items"], chunksize=8))}


# ---------- expand ----------
def expand_one(it):
    box = it["box"]; size = it["size"]
    full = Image.new("RGBA", tuple(size), (0, 0, 0, 0))
    if box["w"] > 0:
        full.paste(Image.open(it["src"]).convert("RGBA"), (box["x"], box["y"]))
    os.makedirs(os.path.dirname(it["dst"]), exist_ok=True)
    tmp = it["dst"] + ".part"; full.save(tmp, format="PNG", compress_level=1); os.replace(tmp, it["dst"])
    return it["dst"], sha_file(it["dst"])


def cmd_expand(job):
    with ProcessPoolExecutor(max_workers=job.get("workers", 8)) as ex:
        return {"items": dict(ex.map(expand_one, job["items"], chunksize=8))}


# ---------- compose ----------
_cache = OrderedDict()


def drawing(path, box):
    if path in _cache:
        _cache.move_to_end(path); return _cache[path]
    if box["w"] == 0: arr = None
    else:
        arr = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32)
    _cache[path] = arr
    if len(_cache) > 48: _cache.popitem(last=False)
    return arr


def place(base, arr, box, mode, opacity):
    if arr is None or opacity <= 0: return
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    dst = base[y:y + h, x:x + w]
    a = arr[..., 3:4] / 255.0 * opacity
    c = arr[..., :3]
    if mode == "screen": dst += a * c * (1.0 - dst / 255.0)
    else: dst *= (1.0 - a); dst += a * c


def compose_frame(job, row):
    base = np.empty((job["size"][1], job["size"][0], 3), np.float32); base[:] = row["field"]
    for d in row["drawings"]:
        if d["pass"] == "back":                              # the opaque bottom of the stack: the field, the light under and the props around the figure, as the browser drew them
            arr = drawing(d["path"], d["box"]); base[:] = arr[..., :3]; continue
        opacity = row["grainOpacity"] if d["pass"] == "grain" else row["titleOpacity"] if d["pass"] == "title" else 1.0
        place(base, drawing(d["path"], d["box"]), d["box"], "screen" if d["pass"] in SCREEN else "over", opacity)
    return np.clip(np.rint(base), 0, 255).astype(np.uint8)


def write_png(path, arr):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"; Image.fromarray(arr).save(tmp, format="PNG", compress_level=1); os.replace(tmp, path)
    return sha_file(path)


def compose_rows(args):
    job, rows = args
    out = []
    for row in rows:
        for kind in ("full", "figure"):
            spec = row.get(kind)
            if spec is None: continue
            if spec["skipIfKey"] and os.path.exists(spec["path"]) and sha_file(spec["path"]) == spec["skipIfKey"]:
                out.append({"frame": row["frame"], "kind": kind, "outputHash": spec["skipIfKey"], "wrote": False}); continue
            rowk = row if kind == "full" else {**row, "field": job["figureField"], "drawings": [d for d in row["drawings"] if d["pass"] == "figure"]}
            out.append({"frame": row["frame"], "kind": kind, "outputHash": write_png(spec["path"], compose_frame(job, rowk)), "wrote": True})
    return out


def cmd_compose(job):
    rows = job["rows"]; n = job.get("workers", 8)
    size = -(-len(rows) // n)                    # contiguous runs: consecutive frames hold the same drawings, which a worker keeps in its cache
    chunks = [(job, rows[i * size:(i + 1) * size]) for i in range(n)]
    with ProcessPoolExecutor(max_workers=n) as ex:
        results = [r for part in ex.map(compose_rows, chunks) for r in part]
    return {"frames": results}


# ---------- confirm ----------
def confirm_one(args):
    job, row = args
    comp = np.asarray(Image.open(row["composed"]).convert("RGB")).astype(np.int16)
    brow = np.asarray(Image.open(row["browser"]).convert("RGB")).astype(np.int16)
    diff = np.abs(comp - brow).max(axis=2)
    beyond = int((diff > LEVELS).sum()); allowance = int(SHARE * diff.size)
    res = {"frame": row["frame"], "mad": round(float(np.abs(comp - brow).mean()), 5), "beyond": beyond, "allowance": allowance, "largest": int(diff.max()), "differing": int((diff > 0).sum()), "ok": beyond <= allowance}
    mask = diff > LEVELS
    owners = {}
    if beyond:
        # the layer that owns the difference: the one whose drawings cover the most differing pixels (alpha at least 8 / 255), the field and the screen blends counted apart
        covered = np.zeros(diff.shape, bool); counts = {}
        for d in row["drawings"]:
            arr = drawing(d["path"], d["box"])
            if arr is None: continue
            x, y, w, h = d["box"]["x"], d["box"]["y"], d["box"]["w"], d["box"]["h"]
            m = np.zeros(diff.shape, bool); m[y:y + h, x:x + w] = arr[..., 3] >= 8
            hit = int((m & mask).sum()); counts[d["layer"]] = counts.get(d["layer"], 0) + hit
            covered |= m & mask
        counts["(field only)"] = int((mask & ~covered).sum())
        owners = counts
        res["worstLayer"] = max(counts, key=counts.get)
    res["byLayer"] = owners
    return res


def cmd_confirm(job):
    with ProcessPoolExecutor(max_workers=min(8, max(1, len(job["rows"])))) as ex:
        return {"frames": list(ex.map(confirm_one, [(job, r) for r in job["rows"]]))}


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("ingest", "compose", "confirm", "expand"):
        print(__doc__); sys.exit(2)
    with open(sys.argv[2]) as f: job = json.load(f)
    result = {"ingest": cmd_ingest, "compose": cmd_compose, "confirm": cmd_confirm, "expand": cmd_expand}[sys.argv[1]](job)
    with open(sys.argv[3], "w") as f: json.dump(result, f)
