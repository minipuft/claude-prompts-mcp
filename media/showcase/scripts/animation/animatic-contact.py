#!/usr/bin/env python3
"""Contact strips of an animatic render, for the study the owner reads (not a probe: nothing here passes or fails).

usage: animatic-contact.py <frames-dir> strip <out.png> [--timeline v3/timeline.json] [--cols 4]
         one frame per beat (its middle, nudged out of any crossing window) and every crossing's middle, each labelled with its beat and frame;
       animatic-contact.py <frames-dir> keys <out.png> --joints out/<shot>-animatic-joints.json [--beat the-frame] [--after 8]
         the beat's keys, two tiles each (four tiles to a row): the frame each key lands on and the same key `--after` frames later, each with its derived secondaries drawn over the frame as the dump
         (`node scripts/animation/played-joints.mjs <shot> --animatic`) has them: the trail of each secondary's joint over the 24 frames before (orange for the cloak's cloth, cyan for the hair), a filled
         dot where it is, a ring where it would be if it rode its primary rigidly. The rig draws no hair, so the cyan dot is a marker for the tip the chart derives, not a drawing in the frame.
The camera comes from v3/xsheet.json, the figure's placement from the beat's blocking file, the joint-to-stage mapping from assets/human/skeleton.json.
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def load(path): return json.load(open(os.path.join(ROOT, path) if not os.path.isabs(path) else path))


def frame_image(frames, f):
    names = [n for n in os.listdir(frames) if n.startswith("element-") and n.endswith(".png")]
    width = len(names[0]) - len("element-.png")
    return Image.open(os.path.join(frames, f"element-{f:0{width}d}.png")).convert("RGB")


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def label(im, text, size=18):
    d = ImageDraw.Draw(im); f = font(size); w = d.textlength(text, font=f)
    d.rectangle((0, 0, w + 12, size + 8), fill=(0, 0, 0)); d.text((6, 3), text, fill=(255, 235, 120), font=f)
    return im


def strip(a):
    tl = load(a.timeline); beats, cross = tl["beats"], tl.get("crossings", [])
    def clear(f): return not any(c["start"] <= f < c["end"] for c in cross)
    picks = []
    for b in beats:
        mid = (b["start"] + b["end"]) // 2
        for d in range(0, 80):
            hit = next((m for m in (mid + d, mid - d) if b["start"] <= m < b["end"] and clear(m)), None)
            if hit is not None: mid = hit; break
        picks.append((b["id"], mid))
    for c in cross: picks.append((f"crossing {c['fromWorld']} > {c['toWorld']}", (c["start"] + c["end"]) // 2))
    picks.sort(key=lambda p: p[1])
    tile = (500, 281); cols = a.cols; rows = -(-len(picks) // cols)
    out = Image.new("RGB", (tile[0] * cols, tile[1] * rows))
    for i, (name, f) in enumerate(picks):
        out.paste(label(frame_image(a.frames, f).resize(tile), f"f{f} {name}", 14), ((i % cols) * tile[0], (i // cols) * tile[1]))
    out.save(a.out); print(f"strip: {len(picks)} frames -> {a.out}")


def keys(a):
    dump = load(a.joints); rows = {r["frame"]: r for r in dump["rows"]}; xs = {r["frame"]: r for r in load("v3/xsheet.json")["rows"]}
    bl = load(f"v3/blocking/{a.beat}.json"); fig = bl["figure"]; reg = load("assets/human/skeleton.json")["registration"]
    to_stage = lambda p: (fig["x"] + fig["scale"] * (reg["scale"] * (p[0] - reg["originMask"][0]) + reg["originCanvas"][0]), fig["y"] + fig["scale"] * (reg["scale"] * (p[1] - reg["originMask"][1]) + reg["originCanvas"][1]))
    def to_screen(f, p):
        c = xs[f]["camera"]; s = to_stage(p); z = c["zoom"]
        return ((s[0] - c["x"]) * z + 640, (s[1] - c["y"]) * z + 360)
    derived = [(n, c["name"], c.get("material")) for c in dump["chart"]["secondaries"] if c.get("material") for n in c["joints"]]
    colours = {"cloth": (255, 150, 40), "hair": (60, 220, 255)}
    tile = (480, 270); ks = dump["chart"]["keys"]; cols = 4
    out = Image.new("RGB", (tile[0] * cols, tile[1] * -(-2 * len(ks) // cols)))
    for col, k in enumerate(ks):
        for row, f in enumerate((k["frame"], k["frame"] + a.after)):
            im = frame_image(a.frames, f); d = ImageDraw.Draw(im, "RGBA")
            for joint, name, material in derived:
                colour = colours.get(material, (255, 255, 255))
                trail = [to_screen(g, rows[g]["joints"][joint]) for g in range(max(f - 24, dump["frames"][0]), f + 1, 2) if g in rows]
                if len(trail) > 1: d.line(trail, fill=colour + (200,), width=7)
                x, y = to_screen(f, rows[f]["joints"][joint]); d.ellipse((x - 15, y - 15, x + 15, y + 15), fill=colour + (255,), outline=(0, 0, 0, 255), width=3)
                rx, ry = to_screen(f, rows[f]["rigid"][joint]); d.ellipse((rx - 15, ry - 15, rx + 15, ry + 15), outline=colour + (255,), width=5)
            note = f"{k['name']} f{f}" + ("" if row == 0 else f" (+{a.after})")
            n = 2 * col + row
            out.paste(label(im.resize(tile), note, 14), ((n % cols) * tile[0], (n // cols) * tile[1]))
    out.save(a.out); print(f"keys: {len(ks)} keys x 2 -> {a.out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames"); ap.add_argument("mode", choices=["strip", "keys"]); ap.add_argument("out")
    ap.add_argument("--timeline", default="v3/timeline.json"); ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--joints"); ap.add_argument("--beat", default="the-frame"); ap.add_argument("--after", type=int, default=8)
    a = ap.parse_args(); os.chdir(ROOT)
    if not os.path.isdir(a.frames): sys.exit(f"input error: {a.frames} is not a directory")
    if a.mode == "keys" and not a.joints: sys.exit("input error: keys needs --joints")
    (strip if a.mode == "strip" else keys)(a)


if __name__ == "__main__": main()
