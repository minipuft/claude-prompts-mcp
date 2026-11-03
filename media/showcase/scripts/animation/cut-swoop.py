#!/usr/bin/env python3
"""The one-piece figure without its poncho (the Swoop), for the worlds that draw the single mesh: `assets/human/cutout-swoop.png` and `assets/human/swoop.json`.

usage: cut-swoop.py [--check]
The garment flip of beats-v2 (`human.garment`, scope permanent) takes the poncho off at the rise of beat 4 and it stays off. Beat 4's home world draws the parts rig without the `poncho` part; the contour
worlds (a crossing's line phase, the line, crayon and shaded worlds) and every frame after beat 4 draw the one-piece mesh (`assets/human/mesh.json`, texture `cutout.png`), which still carries the poncho.
This writes what that mesh needs to lose exactly what the parts rig loses:
  cutout-swoop.png   (and its public/assets/human mirror) `cutout.png` with the alpha of every pixel the parts rig's `owners.png` gives to the `poncho` part set to 0: the fill and the colour-region edges the figure shader reads
  swoop.json         the mesh's triangles without those whose visible pixels are all poncho (SHARE 1.0): the silhouette contour is the mesh's boundary edges (`outline.ts`), so it stops
                     running round a poncho that is gone. A triangle that is part poncho and part something else stays (its poncho pixels are transparent now). The share is 1.0 and not lower because the
                     figure under the poncho is not drawn (the plate has no torso or hips there): the visible pixels left are four separate pieces, and at SHARE 0.9 the mesh split in two (423 and 92 triangles),
                     which the line world's loop-closure probe (C23, one closed outline) reads as an open figure on every line-phase frame after the drop; at 0.99 and 1.0 it stays one piece.
`--check` writes nothing and exits 1 when either file differs from what the inputs give (the inputs' sha256 are recorded in swoop.json). Control first: a planted owners map with a 10 x 10 poncho patch
inside a 20 x 20 triangle clears exactly the patch's alpha and drops that triangle only at a share of 0.25 and not at 1.0.
"""
import argparse, hashlib, json, os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
A = lambda *p: os.path.join(ROOT, "assets", "human", *p)
MIRROR = os.path.join(ROOT, "public", "assets", "human", "cutout-swoop.png")      # the film loads textures by staticFile: public/ mirrors assets/<actor> (as cut-parts.mjs and plates-from-poses.mjs do)
SHARE = 1.0


def sha(path):
    with open(path, "rb") as f: return hashlib.sha256(f.read()).hexdigest()


def clear_owned(rgba, owners, part_id):
    """`rgba` with the alpha of the pixels `owners` gives to `part_id` set to 0."""
    out = rgba.copy(); out[owners == part_id, 3] = 0
    return out


def kept_triangles(vertices, triangles, rgba, owners, part_id, share):
    """The flat triangle index list of the mesh without the triangles whose visible pixels (alpha > 0 in `rgba`) are `share` or more owned by `part_id`; and how many were dropped."""
    h, w = owners.shape; visible = rgba[..., 3] > 0; owned = owners == part_id; keep, dropped = [], 0
    for t in triangles:
        im = Image.new("L", (w, h), 0); ImageDraw.Draw(im).polygon([tuple(vertices[i]) for i in t], fill=1)
        tri = np.asarray(im, bool); seen = int((tri & visible).sum()); gone = int((tri & visible & owned).sum())
        if seen and gone / seen >= share: dropped += 1
        else: keep.extend(int(i) for i in t)
    return keep, dropped


def control():
    own = np.zeros((40, 40), np.uint8); own[5:15, 5:15] = 4; rgba = np.zeros((40, 40, 4), np.uint8); rgba[..., 3] = 255
    v = [(0, 0), (20, 0), (0, 20), (30, 30), (39, 30), (30, 39)]; tri = [(0, 1, 2), (3, 4, 5)]
    cleared = clear_owned(rgba, own, 4); alpha_gone = int((cleared[..., 3] == 0).sum())
    k_all, d_all = kept_triangles(v, tri, rgba, own, 4, 0.25); k_default, d_default = kept_triangles(v, tri, rgba, own, 4, SHARE)
    ok = alpha_gone == 100 and d_all == 1 and k_all == [3, 4, 5] and d_default == 0 and len(k_default) == 6
    print(f"control: a 10 x 10 poncho patch inside a 20 x 20 triangle clears {alpha_gone} alpha pixels; the triangle is dropped at share 0.25 ({d_all} dropped) and kept at {SHARE} ({d_default} dropped)" + ("" if ok else " -> NOT AS EXPECTED"))
    if not ok: sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); ap.add_argument("--check", action="store_true")
    a = ap.parse_args(); control()
    parts = json.load(open(A("families", "home", "parts", "parts.json"))); part = next(p for p in parts["parts"] if p["name"] == "poncho")
    owners = np.asarray(Image.open(A("families", "home", "parts", parts["owners"]))); rgba = np.asarray(Image.open(A("cutout.png")).convert("RGBA"))
    mesh = json.load(open(A("mesh.json"))); vertices = np.array(mesh["vertices"], float).reshape(-1, 2); triangles = np.array(mesh["triangles"]).reshape(-1, 3)
    if owners.shape != rgba.shape[:2]: print(f"input error: owners {owners.shape} and cutout {rgba.shape[:2]} are not the same plate"); sys.exit(2)
    cleared = clear_owned(rgba, owners, part["id"]); keep, dropped = kept_triangles(vertices, triangles, rgba, owners, part["id"], SHARE)
    meta = {"garment": "poncho", "partId": part["id"], "share": SHARE, "dropped": dropped, "of": len(triangles), "triangles": keep,
            "sources": {"cutout.png": sha(A("cutout.png")), "mesh.json": sha(A("mesh.json")), "families/home/parts/owners.png": sha(A("families", "home", "parts", parts["owners"]))}}
    text = json.dumps(meta, separators=(",", ":")) + "\n"; png = A("cutout-swoop.png"); js = A("swoop.json")
    if a.check:
        same_json = os.path.exists(js) and open(js).read() == text
        same_png = all(os.path.exists(q) and np.array_equal(np.asarray(Image.open(q).convert("RGBA")), cleared) for q in (png, MIRROR))
        print(f"{'pass' if same_json and same_png else 'FAIL'}: swoop assets {'match' if same_json and same_png else 'differ from'} their inputs (swoop.json {same_json}, cutout-swoop.png {same_png})"); sys.exit(0 if same_json and same_png else 1)
    Image.fromarray(cleared, "RGBA").save(png, optimize=True); shutil.copyfile(png, MIRROR); open(js, "w").write(text)
    print(f"wrote {os.path.relpath(png, ROOT)} ({int((rgba[..., 3] > 0).sum() - (cleared[..., 3] > 0).sum())} pixels cleared) and {os.path.relpath(js, ROOT)} ({dropped} of {len(triangles)} triangles dropped)")


if __name__ == "__main__": main()
