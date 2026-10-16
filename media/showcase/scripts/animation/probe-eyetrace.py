#!/usr/bin/env python3
"""Eye trace (rubric C29): the brightest place on screen is where the light track says the emitter is.

usage: probe-eyetrace.py <frames-dir> --timeline v3/timeline.json --xsheet v3/xsheet.json [--tolerance 0.03] [--emitter-space world|screen] [--json out]
Method: per frame, drop the identity pigments (#4f7df2, #e8694a and their 28-RGB neighbourhoods), take the brightest 0.5 % of what is left by
luminance (ties kept), and measure the distance from its centroid to the xsheet emitter {x, y} (stage pixels, 1280x720) as a share of the frame
width. Frames whose xsheet row has no emitter are skipped and counted. The xsheet emitter is in stage pixels, so it is projected through the row's camera
first (`--emitter-space world`, the default; before 2026-10-14 the default was `screen`, which reads the point as already in frame coordinates and is wrong
where the camera moves).
Control first: a frame with the bright blob 10 % of the width away from the emitter must fail, the blob on the emitter must pass, and an
identity-pigment patch brighter than the blob must be ignored.
"""
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def centroid(img, share=0.005, use_identity=True):
    a = img.astype(np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    keep = ~identity_mask(img) if use_identity else np.ones(lum.shape, bool)
    vals = lum[keep]
    if vals.size == 0: return None
    thr = np.sort(vals)[-max(1, int(np.ceil(vals.size * share)))]
    sel = keep & (lum >= thr)
    ys, xs = np.nonzero(sel)
    return float(xs.mean()), float(ys.mean())


def offset(img, em, space_cam, share=0.005, use_identity=True):
    c = centroid(img, share, use_identity)
    H, W = img.shape[:2]; s = W / STAGE[0]
    ex, ey = project(space_cam, em["x"], em["y"]) if space_cam else (em["x"], em["y"])
    return None if c is None else float(np.hypot(c[0] - ex * s, c[1] - ey * s) / W)


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--tolerance", type=float, default=0.03, help="share of the frame width")
    ap.add_argument("--share", type=float, default=0.005, help="brightest share of non-identity pixels")
    ap.add_argument("--emitter-space", choices=("screen", "world"), default="world")
    a = ap.parse_args()
    pr = Probe("eye-trace", a.json)
    on = offset(make.eye_frame(10), make.emitter_at(10), None, a.share)
    off = offset(make.eye_frame(10, 10.0), make.emitter_at(10), None, a.share)
    raw = offset(make.eye_frame(10), make.emitter_at(10), None, a.share, use_identity=False)
    pr.control(on is not None and on <= a.tolerance and off is not None and off > a.tolerance and raw > a.tolerance,
               f"bright blob 10 % of the width off the emitter -> FAIL (offset {100 * off:.1f} % > {100 * a.tolerance:.0f} %); blob on the emitter -> pass ({100 * on:.1f} %); "
               f"identity patch brighter than the blob is ignored (read as bright it would put the offset at {100 * raw:.0f} %)")
    xs = default_xsheet(a) or die("no xsheet: pass --xsheet (the emitter position per frame lives there)")
    tl = load_timeline(a.timeline); frames = list_frames(a.frames)
    bad, skipped, worst, n = [], 0, (-1.0, None), 0
    for f, p in frames.items():
        em = (xs.get(f) or {}).get("emitter")
        if not isinstance(em, dict) or em.get("x") is None: skipped += 1; continue
        d = offset(load_rgb(p), em, camera_of(xs, f) if a.emitter_space == "world" else None, a.share)
        if d is None: skipped += 1; continue
        n += 1
        if d > worst[0]: worst = (d, f)
        if d > a.tolerance: bad.append((f, round(100 * d, 1)))
    pr.note(f"frames {len(frames)}; measured {n}; skipped (no emitter in the xsheet row) {skipped}; worst offset {100 * worst[0]:.1f} % at frame {worst[1]}")
    pr.check("measured something", n > 0, f"{n} frames carry an emitter" + ("" if n else " - every frame was skipped, so the probe observed nothing"))
    pr.check("emitter within tolerance", not bad, f"{len(bad)} frame(s) over {100 * a.tolerance:.0f} % of the width{': ' + str(bad[:12]) if bad else ''}")
    pr.extra.update({"measured": n, "skipped": skipped, "worst": {"frame": worst[1], "share": worst[0]}, "over": bad})
    pr.finish(f"the brightest non-identity region sits within {100 * a.tolerance:.0f} % of the emitter on all {n} measured frames ({skipped} skipped, no emitter)")


if __name__ == "__main__": main()
