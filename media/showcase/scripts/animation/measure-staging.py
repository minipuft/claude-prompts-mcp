#!/usr/bin/env python3
"""What is in the picture on each frame of a span (D101: a beat staged wide; feet never cut, the cast and the props in picture).

usage: measure-staging.py <composed-frames> <figure-frames> <from> <to> [--blocking v3/blocking/the-frame.json] [--xsheet v3/xsheet.json] [--timeline v3/timeline.json] [--edge 2]
For every frame in [from, to): the figure layer's ink (every pixel not the field colour) and whether it comes within `--edge` pixels (scaled to the frame) of an edge; Codex's and Clawd's pigment pixels in the composed frame (the identity pigments
of probe_common, grown by IDENTITY_RADIUS) and whether they lie wholly inside the picture; and, from the blocking resolved on that frame and the xsheet's camera, whether the frame, the heap and every other prop rectangle (PROP_EXTENT of
probe-blocking.py) lies inside the picture. Prints one line per 30 frames and the worst case over the span, and exits 1 when the figure touches an edge on any frame, or Codex (once on stage) or a prop leaves the picture.
Codex and Clawd are counted from the first frame their pixels appear: Clawd enters at the right edge by design (sp-4.2), so a frame on which he is not yet in picture is listed, not failed; one that cuts his body at an edge after he has stood in picture is failed.
"""
import argparse, importlib.util, json, math, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from probe_common import IDENTITY_PIGMENTS, IDENTITY_RADIUS, hex_rgb, list_frames
spec = importlib.util.spec_from_file_location("pb", os.path.join(HERE, "probe-blocking.py")); pb = importlib.util.module_from_spec(spec); spec.loader.exec_module(pb)


def ink(im, level=30):
    return np.abs(im.astype(int) - im[2, 2].astype(int)).sum(axis=2) > level


def box(mask):
    ys, xs = np.nonzero(mask)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None


def pigment_box(im, hexv):
    d = np.sqrt(((im.astype(int) - np.array(hex_rgb(hexv))) ** 2).sum(axis=2))
    m = d <= IDENTITY_RADIUS
    return box(m) if m.sum() >= 12 else None


def view_rect(r, cam, sc):
    """A stage rectangle (x, y, w, h) in picture pixels under the xsheet camera (centre x, y; zoom) at frame scale `sc`."""
    z = cam.get("zoom", 1); cx, cy = cam["x"], cam["y"]
    f = lambda x, y: (((x - cx) * z + 640) * sc, ((y - cy) * z + 360) * sc)
    (x0, y0), (x1, y1) = f(r[0], r[1]), f(r[0] + r[2], r[1] + r[3])
    return x0, y0, x1, y1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("composed"); ap.add_argument("figure"); ap.add_argument("start", type=int); ap.add_argument("end", type=int)
    ap.add_argument("--blocking", default=os.path.join(ROOT, "v3", "blocking", "the-frame.json")); ap.add_argument("--xsheet", default=os.path.join(ROOT, "v3", "xsheet.json")); ap.add_argument("--edge", type=float, default=2.0)
    a = ap.parse_args()
    comp, fig = list_frames(a.composed), list_frames(a.figure)
    xs = {r["frame"]: r for r in json.load(open(a.xsheet))["rows"]}
    bl = json.load(open(a.blocking))
    W = H = None; worst = {"figure": None, "codex": None, "clawd": None, "props": None}; bad, seen = [], {"codex": False, "clawd": False}; lines = []
    for f in range(a.start, a.end):
        c = np.asarray(Image.open(comp[f]).convert("RGB")); g = np.asarray(Image.open(fig[f]).convert("RGB")); H, W = c.shape[:2]; sc = W / 1280; e = a.edge * sc
        fb = box(ink(g))
        touch = fb is not None and (fb[0] < e or fb[1] < e or fb[2] > W - e or fb[3] > H - e)
        if touch: bad.append(f"frame {f}: the figure's ink {fb} is within {a.edge} px of an edge of the {W}x{H} picture")
        row = {"f": f, "fig": fb}
        crossing = ">" in str(xs[f].get("world"))   # inside a crossing the world's fills reduce to lines: the cast's pigments are not drawn, which is not a cast that left the picture
        for who in ("codex", "clawd"):
            if crossing: row[who] = "crossing"; continue
            b = pigment_box(c, IDENTITY_PIGMENTS[who]); row[who] = b
            if b:
                cut = b[0] <= e or b[1] <= e or b[2] >= W - e or b[3] >= H - e
                if cut and seen[who]: bad.append(f"frame {f}: {who} (pigment {b}) touches an edge after standing in picture")
                if not cut: seen[who] = True
            elif who == "codex" and seen[who]: bad.append(f"frame {f}: codex is not in picture")
        cur = pb.resolve_at(bl, f); rects = pb.rects_of(cur); cam = xs[f]["camera"]; out = []
        for n, r in rects.items():
            if n not in ("frame", "heap") and n not in pb.PROP_EXTENT: continue
            x0, y0, x1, y1 = view_rect(r, cam, sc); inside = x0 >= -1 and y0 >= -1 and x1 <= W + 1 and y1 <= H + 1
            if not inside: out.append((n, [round(v) for v in (x0, y0, x1, y1)]))
        row["props_out"] = out
        if out: lines.append((f, out))
        if (f - a.start) % 30 == 0 or f == a.end - 1:
            print(f"{f:4d} fig {fb} codex {row['codex']} clawd {row['clawd']} props out of picture: {[o[0] for o in out] or 'none'}", flush=True)
    onstage_out = [(f, o) for f, o in lines]
    # a prop (not the frame carried in) outside the picture after it has come on is a fault; the frame is listed while Clawd carries it in
    for f, o in onstage_out:
        late = [n for n, _ in o if not (n == "frame" and f < 740)]
        if late: bad.append(f"frame {f}: {late} outside the picture")
    print(f"span {a.start}-{a.end - 1}: figure ink within {a.edge} px of an edge on {sum(1 for b in bad if 'figure' in b)} frame(s); codex seen on stage from frame {next((r for r in range(a.start, a.end) if pigment_box(np.asarray(Image.open(comp[r]).convert('RGB')), IDENTITY_PIGMENTS['codex'])), None)}")
    for b in bad[:20]: print("  FAIL", b)
    print(("FAIL" if bad else "pass") + f": staging - {len(bad)} fault(s) over {a.end - a.start} frames")
    sys.exit(1 if bad else 0)


if __name__ == "__main__": main()
