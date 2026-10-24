#!/usr/bin/env python3
"""cutout: turn one generated plate into role-bound, movable layers (D65/D68).

usage: cutout.py <plate.png> <asset-dir> [--roles main1=#hex,main2=#hex,shadow=#hex,light=#hex,accent=#hex] [--pin skin=#67b479,skinShadow=#c885c2]
       [--min-area 400] [--no-quantize] [--field black|auto] [--control]

Steps, each receipted in <asset-dir>/parts.json with sha256:
  1. rembg (U2-Net, CPU) removes the field; the alpha mask is kept as mask.png.
  2. Connected components of the mask above --min-area become parts, ordered by area; each is cropped to its own PNG
     with the bounding box, centroid (the default pivot) and area recorded.
  3. Unless --no-quantize, every opaque pixel of a part snaps to the nearest role hex or pinned identity hex (identity
     wins when nearest), so C1/C2 hold after generation; the unquantized crop is kept beside it as the control.
  4. VTracer traces each quantized part to SVG (color mode, few colors) for the contour pass.
--control runs the positive control: a synthetic plate with three known blobs must yield exactly three parts.
"""
import hashlib, json, os, sys
from PIL import Image, ImageDraw
import numpy as np

def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()

def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def remove_field(plate, field="auto", threshold=28):
    """Black-field plates (the bible's default) are cut by a luminance threshold: deterministic, keeps every figure.
    rembg (U2-Net) is kept for plates with a painted field, but it is a salient-object model and drops secondary figures."""
    if field == "black":
        arr = np.array(plate).astype(np.int32)
        a = (arr[..., :3].max(-1) > threshold).astype(np.uint8) * 255
        arr[..., 3] = a
        return Image.fromarray(arr.astype(np.uint8), "RGBA")
    from rembg import remove
    return remove(plate)  # RGBA

def components(alpha, min_area):
    from scipy import ndimage  # rembg depends on scipy via its stack; fall back below if absent
    labels, n = ndimage.label(alpha > 24)
    parts = []
    for i in range(1, n + 1):
        ys, xs = np.where(labels == i)
        if len(xs) < min_area: continue
        parts.append({"label": i, "bbox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                      "pivot": [float(xs.mean()), float(ys.mean())], "area": int(len(xs))})
    parts.sort(key=lambda p: -p["area"])
    return labels, parts

def quantize(rgba, palette):
    arr = np.array(rgba).astype(np.int32)
    rgb = arr[..., :3]; a = arr[..., 3]
    pal = np.array([hex2rgb(h) for h in palette.values()], dtype=np.int32)
    d = ((rgb[..., None, :] - pal[None, None, :, :]) ** 2).sum(-1)
    idx = d.argmin(-1)
    out = pal[idx]
    out[a < 24] = 0
    res = np.concatenate([out, a[..., None]], -1).astype(np.uint8)
    return Image.fromarray(res, "RGBA"), {k: int((idx == i)[a >= 24].sum()) for i, k in enumerate(palette)}

def trace(png, svg):
    import vtracer
    vtracer.convert_image_to_svg_py(png, svg, colormode="color", mode="spline", filter_speckle=8, color_precision=4, corner_threshold=60)

def run(plate_path, asset_dir, roles, pins, min_area, do_quantize, field="auto"):
    os.makedirs(asset_dir, exist_ok=True)
    plate = Image.open(plate_path).convert("RGBA")
    cut = remove_field(plate, field)
    cut.save(os.path.join(asset_dir, "cutout.png"))
    alpha = np.array(cut)[..., 3]
    Image.fromarray(alpha).save(os.path.join(asset_dir, "mask.png"))
    labels, parts = components(alpha, min_area)
    palette = {**pins, **roles}  # pins first so identity wins ties by order in argmin (first index)
    manifest = {"plate": plate_path, "plate_sha256": sha(plate_path), "size": plate.size, "roles": roles, "pins": pins, "parts": []}
    for n, p in enumerate(parts):
        x0, y0, x1, y1 = p["bbox"]
        crop = cut.crop((x0, y0, x1, y1))
        m = (labels[y0:y1, x0:x1] == p["label"])
        arr = np.array(crop); arr[~m] = 0
        crop = Image.fromarray(arr, "RGBA")
        base = f"part{n:02d}"
        ctl = os.path.join(asset_dir, base + "-control.png"); crop.save(ctl)
        entry = {"id": base, "bbox": p["bbox"], "pivot": p["pivot"], "area": p["area"], "control": os.path.basename(ctl), "control_sha256": sha(ctl)}
        if do_quantize and palette:
            q, counts = quantize(crop, palette)
            qp = os.path.join(asset_dir, base + ".png"); q.save(qp)
            entry.update({"png": os.path.basename(qp), "sha256": sha(qp), "role_pixels": counts})
            src = qp
        else:
            src = ctl; entry.update({"png": os.path.basename(ctl), "sha256": entry["control_sha256"]})
        svg = os.path.join(asset_dir, base + ".svg")
        try:
            trace(src, svg); entry.update({"svg": os.path.basename(svg), "svg_sha256": sha(svg)})
        except Exception as e:
            entry["svg_error"] = str(e)[:200]
        manifest["parts"].append(entry)
    json.dump(manifest, open(os.path.join(asset_dir, "parts.json"), "w"), indent=2)
    return manifest

def control(tmpdir):
    """Positive control: three separated blobs on black must become exactly three parts."""
    img = Image.new("RGBA", (400, 300), (0, 0, 0, 255)); d = ImageDraw.Draw(img)
    d.ellipse((20, 40, 120, 140), fill=(103, 180, 121, 255)); d.rectangle((160, 60, 260, 220), fill=(100, 100, 149, 255)); d.ellipse((290, 150, 380, 240), fill=(200, 133, 194, 255))
    p = os.path.join(tmpdir, "control-plate.png"); img.save(p)
    m = run(p, os.path.join(tmpdir, "control-asset"), {"main1": "#646495", "light": "#e7e4da"}, {"skin": "#67b479", "skinShadow": "#c885c2"}, 200, True)
    n = len(m["parts"])
    print(json.dumps({"control": "three blobs", "parts": n, "pass": n == 3, "roles_seen": [e.get("role_pixels") for e in m["parts"]]}))
    return 0 if n == 3 else 1

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--control" in args:
        import tempfile; sys.exit(control(tempfile.mkdtemp(prefix="cutout-control-")))
    plate, asset_dir = args[0], args[1]
    def kv(flag, default):
        if flag in args:
            v = args[args.index(flag) + 1]; return {k: v2 for k, v2 in (x.split("=") for x in v.split(","))}
        return default
    roles = kv("--roles", {}); pins = kv("--pin", {})
    min_area = int(args[args.index("--min-area") + 1]) if "--min-area" in args else 400
    field = args[args.index("--field") + 1] if "--field" in args else "auto"
    m = run(plate, asset_dir, roles, pins, min_area, "--no-quantize" not in args, field)
    print(json.dumps({"parts": len(m["parts"]), "manifest": os.path.join(asset_dir, "parts.json")}))
