#!/usr/bin/env python3
"""Props drawn (gate animation-props-drawn): the props a beat's blocking names are on that beat's frame, where the blocking puts them.

usage: probe-props.py <stills-dir> <blocking-dir> [--timeline v3/timeline.json] [--json out]
<stills-dir> holds what `node scripts/animation/render-props.mjs <stills-dir>` writes: per beat that names actors, `<beat>.png` (the animatic's frame in the middle of the beat) and, for each
actor the blocking names, `<beat>--no-<actor>.png` (the same frame rendered with `omit: [<actor>]`); an actor with `on` or `off` that keeps it off the stage on the middle frame has its own pair on the middle of its time on stage (`<beat>--at-<actor>.png` and its `--no-` still), and `stills.json` (render-props.mjs) names the frame of every still: a with and a without still of two frames are refused. For every actor of every beat the picture with it and the picture without it must differ by at least
MIN_PX pixels (more than 8 levels in a channel; at 640x360 and 1280x720 alike, scaled by the frame's area against 1280x720), and the centre of what differs within REACH stage pixels of the
actor's anchor in the blocking (anchors and sizes: src/library/worlds/actors.tsx). An actor the blocking names that has no stills pair is a failure, not a skip. A beat whose blocking names no
actor draws none, and its picture is not read.
Control first, on synthetic 320x180 frames: a frame pair that differs by a blob on the anchor passes; a pair that does not differ at all (the actor was omitted from both: the prop is not drawn) is
refused; a pair whose difference lies in the far corner (drawn, but not where the blocking says) is refused.
"""
import argparse, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *

MIN_PX = 600          # of 1280x720 (0.065 % of the frame): the smallest placeholder, the scale 0.5 bubble's highlight sweeps alone, is several times it
LEVEL = 8
REACH = 420           # stage pixels from the anchor to the centre of the difference: the stalk is 333 tall, the structure 300, the gadget 260 x 0.8; the anchor is a foot or a dial, never the centre


def difference(with_, without, anchor=None):
    """(pixels differing by more than LEVEL, centre of those pixels in stage pixels or None). With an `anchor` (stage pixels) only the pixels within REACH of it count: leaving a prop out of the tree also shifts
    the grain and glow of the scene around it (cant-build, frame 525: 68 631 pixels of the floor glow differ when the 3 544 pixels of the stalk are omitted; the two stills of one tree are identical), and a
    centre taken over all of it lands on the glow, not on the prop."""
    if with_.shape != without.shape: return -1, None
    m = np.abs(with_.astype(np.int16) - without.astype(np.int16)).max(axis=2) > LEVEL
    sc = STAGE[0] / with_.shape[1]
    if anchor is not None:
        yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
        m &= np.hypot(xx * sc - anchor[0], yy * sc - anchor[1]) <= REACH
    n = int(m.sum())
    if not n: return 0, None
    ys, xs = np.nonzero(m)
    return n, (float(xs.mean()) * sc, float(ys.mean()) * sc)


def judge(with_, without, anchor):
    n, c = difference(with_, without, anchor); need = MIN_PX * with_.shape[0] * with_.shape[1] / (STAGE[0] * STAGE[1])
    if n < 0: return False, "the two pictures differ in size"
    if n < need: return False, f"drawing it changes {n} pixels within {REACH} stage px of its anchor (needs {need:.0f}): it is not drawn there"
    d = float(np.hypot(c[0] - anchor[0], c[1] - anchor[1]))
    if d > REACH: return False, f"drawn, but its centre is {d:.0f} stage px from the anchor {tuple(round(v) for v in anchor)} (reach {REACH})"
    return True, f"{n} pixels differ, centred {d:.0f} stage px from the anchor"


def frames_apart(manifest, with_name, without_name):
    """Why the two stills are not one frame with and without the actor (a sentence), or None when they are. A pair of two different frames differs by a whole picture's worth of pixels whether or not the prop is drawn."""
    w, o = manifest.get(with_name), manifest.get(without_name)
    if w is None or o is None: return f"has stills the manifest does not name ({with_name if w is None else without_name}): render them again with render-props.mjs"
    if w["frame"] != o["frame"]: return f"is compared across two frames ({with_name} is frame {w['frame']}, {without_name} is frame {o['frame']}): the difference would be the film's, not the prop's"
    return None


def planted():
    """320x180 pairs: (blob on the anchor, no difference, blob in the far corner), and the anchor in stage pixels."""
    base = np.full((180, 320, 3), 20, np.uint8); anchor = (640.0, 360.0)
    on = base.copy(); on[60:120, 110:210] = 200           # 100 x 60 at 320 wide = 4x scale: centred (160, 90) -> stage (640, 360)
    corner = base.copy(); corner[0:60, 0:60] = 200        # centred (30, 30) -> stage (120, 120), 700+ px from the anchor
    return base, on, corner, anchor


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stills"); ap.add_argument("blocking_dir"); ap.add_argument("--timeline", default="v3/timeline.json"); ap.add_argument("--json", default=None)
    a = ap.parse_args(); pr = Probe("props-drawn", a.json)
    base, on, corner, anchor = planted()
    ok_on, _ = judge(on, base, anchor); ok_none, why_none = judge(base, base.copy(), anchor); ok_far, why_far = judge(corner, base, anchor)
    two = frames_apart({"a.png": {"frame": 300}, "b.png": {"frame": 375}}, "a.png", "b.png"); one = frames_apart({"a.png": {"frame": 300}, "b.png": {"frame": 300}}, "a.png", "b.png")
    pr.control(ok_on and not ok_none and not ok_far and bool(two) and one is None, f"a pair that differs by a blob on the anchor -> pass; a pair with no difference (the actor omitted from both) -> FAIL ({why_none}); a difference in the far corner -> FAIL ({why_far}); two stills of different frames -> FAIL ({two[:70]}...); two stills of one frame -> pass")
    tl = load_timeline(a.timeline)
    if not os.path.isdir(a.stills): die(f"stills directory {a.stills} does not exist (node scripts/animation/render-props.mjs {a.stills})")
    mp = os.path.join(a.stills, "stills.json")
    if not os.path.exists(mp): die(f"{mp} does not exist: the stills were not rendered by render-props.mjs, which writes the frame of every still beside them")
    manifest = read_json(mp, "stills manifest")
    named, bad = 0, []
    for b in tl["beats"]:
        p = os.path.join(a.blocking_dir, f"{b['id']}.json")
        if not os.path.exists(p): continue
        actors = (read_json(p, "blocking file").get("actors") or {})
        for name, place in actors.items():
            named += 1
            own = os.path.join(a.stills, f"{b['id']}--at-{name}.png")       # a prop that is not on stage on the beat's middle frame has its own with-still on the middle of its time on stage
            full, omitted = own if os.path.exists(own) else os.path.join(a.stills, f"{b['id']}.png"), os.path.join(a.stills, f"{b['id']}--no-{name}.png")
            if not (os.path.exists(full) and os.path.exists(omitted)): bad.append(f"beat {b['id']!r}: actor {name!r} has no stills pair ({os.path.basename(full)}, {os.path.basename(omitted)})"); continue
            apart = frames_apart(manifest, os.path.basename(full), os.path.basename(omitted))
            if apart: bad.append(f"beat {b['id']!r}: actor {name!r} {apart}"); continue
            ok, why = judge(np.asarray(Image.open(full).convert("RGB")), np.asarray(Image.open(omitted).convert("RGB")), (place["x"], place["y"]))
            if not ok: bad.append(f"beat {b['id']!r}: actor {name!r} {why}")
    pr.check("every named prop is drawn where the blocking puts it", not bad and named > 0, "; ".join(bad) if bad else f"{named} actors named by the blocking, each drawn within {REACH} stage px of its anchor" if named else "no beat's blocking names an actor")
    pr.finish(f"{named} props named by the blocking are all on their beats' frames")


if __name__ == "__main__": main()
