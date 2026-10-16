#!/usr/bin/env python3
"""Eye trace (rubric C29): the brightest place on screen is where the light track says the emitter is.

usage: probe-eyetrace.py <frames-dir> --timeline v3/timeline.json --xsheet v3/xsheet.json [--shot <id>] [--tolerance 0.03] [--roles v3/roles.json] [--json out]
Method: per frame, drop every fixed fill (v3/roles.json, `npm run roles`: the identity pigments, the human's, kit's and gadget's roles, the human's cutout palette and each world's texture
colours, each with its 28-RGB neighbourhood), box-blur what is left by luminance over --blur stage pixels (default 8: a REGION, not a pixel: the anti-aliased edge where a fill meets its
neighbour is a bright speck one or two pixels across, which a light is not), take the brightest 0.5 % of the blurred map (ties kept), and measure the distance from its centroid to the
xsheet emitter as a share of the frame width.
The roles are masked because they are fixed per palette and not light (C1, C2, C6): the human's cream garment and the kit's pale contour are bright by their own colour, and the
light is what the eye should find OUTSIDE them. Frames whose xsheet row has no emitter are skipped and counted; a run that skips every frame fails.
Emitter space: ONE convention. The xsheet emitter is in stage pixels (1280x720) and is projected through the row's camera onto the frame (`probe_common.project`, the model of
`cameraTransform`), then scaled to the frame's width. There is no screen-space option; it read the same point as frame coordinates and was wrong wherever the camera moved.
Control first: a frame with the bright blob 10 % of the width away from the emitter must fail, the blob on the emitter must pass, and a patch of every kind of fixed role (identity
pigment, human garment, kit contour) brighter than the blob must be ignored (read unmasked, it would put the offset far off).
"""
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def centroid(img, share=0.005, hexes=None, blur=BLUR_STAGE_PX, masked=None):
    """Centroid of the brightest region (`brightest_region`: the brightest `share` of the pixels outside the fixed fills, ranked by blurred luminance), or None. `masked` is the fixed-fill mask
    (`cast_mask`), else `hexes` masks by colour."""
    sel = brightest_region(img, hexes, share, blur, masked)
    if sel is None: return None
    ys, xs = np.nonzero(sel)
    return float(xs.mean()), float(ys.mean())


def offset(img, em, cam, share=0.005, hexes=None, blur=BLUR_STAGE_PX, plate=None):
    """Distance from the brightest unmasked region to the emitter (stage pixels, projected through `cam`), as a share of the frame width. `hexes` are the fixed colours, `plate` the human cutout's
    colours (masked only where the human is, see `cast_mask`)."""
    c = centroid(img, share, None, blur, cast_mask(img, cam, hexes, plate) if (hexes or plate) else None)
    H, W = img.shape[:2]; s = W / STAGE[0]
    ex, ey = project(cam, em["x"], em["y"])
    return None if c is None else float(np.hypot(c[0] - ex * s, c[1] - ey * s) / W)


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--tolerance", type=float, default=0.03, help="share of the frame width")
    ap.add_argument("--share", type=float, default=0.005, help="brightest share of unmasked pixels")
    ap.add_argument("--min-strength", type=float, default=1.0, help="measure only frames where the xsheet's emitter strength is at least this (default 1: fully drawn)")
    ap.add_argument("--blur", type=float, default=BLUR_STAGE_PX, help="stage pixels of box blur before ranking (0: none)")
    ap.add_argument("--roles", default=None, help="v3/roles.json (default: beside the project's v3)")
    a = ap.parse_args()
    pr = Probe("eye-trace", a.json)
    hexes = fixed_role_hexes(a.roles, plates=False); plate = plate_hexes(a.roles)
    ctl = ["#4f7df2", "#e8694a", "#e7e4da", "#d9e5e3"]                          # identity (Codex, Clawd), the human's cream, the kit's pale: each is in the real roles file too
    on = offset(make.eye_frame(10), make.emitter_at(10), None, a.share, ctl, a.blur)
    off = offset(make.eye_frame(10, 10.0), make.emitter_at(10), None, a.share, ctl, a.blur)
    raw = offset(make.eye_frame(10), make.emitter_at(10), None, a.share, None, a.blur)
    cam = {"x": 500, "y": 360, "zoom": 1, "rot": 0}                             # the emitter's stage x is 140 further right than a locked camera would put it
    moved = offset(make.eye_frame(10), make.emitter_at(10), cam, a.share, ctl, a.blur)
    specks = make.eye_frame(10); rng = np.random.default_rng(7)
    ys, xs_ = rng.integers(0, specks.shape[0], 120), rng.integers(0, 120, 120); specks[ys, xs_] = (255, 255, 255)      # 120 lone anti-aliasing specks on the left, brighter than the blob, 0.2 % of the pixels
    sp = offset(specks, make.emitter_at(10), None, a.share, ctl, a.blur); sp_raw = offset(specks, make.emitter_at(10), None, a.share, ctl, 0)
    pr.control(on is not None and on <= a.tolerance and off is not None and off > a.tolerance and raw > a.tolerance and moved > a.tolerance and sp <= a.tolerance and (a.blur == 0 or sp_raw > sp),
               f"bright blob 10 % of the width off the emitter -> FAIL (offset {100 * off:.1f} % > {100 * a.tolerance:.0f} %); blob on the emitter -> pass ({100 * on:.1f} %); "
               f"identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at {100 * raw:.0f} %); "
               f"the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL ({100 * moved:.1f} %), so the camera is read; "
               f"120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset {100 * sp:.1f} % blurred, {100 * sp_raw:.1f} % unblurred")
    xs = default_xsheet(a) or die("no xsheet: pass --xsheet (the emitter position per frame lives there)")
    tl = load_timeline(a.timeline); frames = list_frames(a.frames)
    tl, xs, frames, shot_note = apply_shot(a, tl, xs, frames)
    bad, skipped, fading, worst, n = [], 0, 0, (-1.0, None), 0
    for f, p in frames.items():
        em = (xs.get(f) or {}).get("emitter")
        if not isinstance(em, dict) or em.get("x") is None: skipped += 1; continue
        if em.get("strength", 1.0) < a.min_strength: fading += 1; continue
        d = offset(load_rgb(p), em, camera_of(xs, f), a.share, hexes, a.blur, plate)
        if d is None: skipped += 1; continue
        n += 1
        if d > worst[0]: worst = (d, f)
        if d > a.tolerance: bad.append((f, round(100 * d, 1)))
    pr.note(f"frames {len(frames)}{'; ' + shot_note if shot_note else ''}; masked {len(hexes)} fixed colours everywhere and the human cutout's {len(plate)} inside its crop, from {roles_source(a.roles)}; measured {n}; skipped (no emitter in the xsheet row) {skipped}; skipped (emitter drawn below strength {a.min_strength:g}, a crossing) {fading}; worst offset {100 * worst[0]:.1f} % at frame {worst[1]}")
    pr.check("measured something", n > 0, f"{n} frames carry an emitter" + ("" if n else " - every frame was skipped, so the probe observed nothing"))
    pr.check("emitter within tolerance", not bad, f"{len(bad)} frame(s) over {100 * a.tolerance:.0f} % of the width{': ' + str(bad[:12]) if bad else ''}")
    pr.extra.update({"measured": n, "skipped": skipped, "fading": fading, "worst": {"frame": worst[1], "share": worst[0]}, "over": bad})
    pr.finish(f"the brightest region outside the fixed roles sits within {100 * a.tolerance:.0f} % of the emitter on all {n} measured frames ({skipped} skipped with no emitter, {fading} in a crossing)")


if __name__ == "__main__": main()
