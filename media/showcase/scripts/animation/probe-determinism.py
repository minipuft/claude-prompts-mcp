#!/usr/bin/env python3
"""Byte-identical double render (rubric C12): two renders of the same frame list match, frame for frame.

usage: probe-determinism.py <frames-dir-a> <frames-dir-b> [--subset] [--pixels] [--json out]
Method: sha256 of each element-NNN.png in both directories. The two frame lists must be the same (--subset: every frame of b must exist in a, for a
sampled re-render). --pixels compares decoded RGB instead of file bytes, for a renderer that stamps metadata into the PNG.
Control first: two writes of one fixture frame hash the same; the same write with one pixel changed does not.
"""
import argparse, hashlib, os, sys, tempfile
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def digest(path, pixels):
    if pixels: return hashlib.sha256(np.asarray(Image.open(path).convert("RGB")).tobytes()).hexdigest()
    with open(path, "rb") as f: return hashlib.sha256(f.read()).hexdigest()


def compare(a, b, pixels, subset):
    only_a = sorted(set(a) - set(b)); only_b = sorted(set(b) - set(a))
    diff = [f for f in sorted(set(a) & set(b)) if digest(a[f], pixels) != digest(b[f], pixels)]
    listing = only_b if subset else only_a + only_b
    return diff, listing, len(set(a) & set(b))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_a", nargs="?"); ap.add_argument("frames_b", nargs="?")
    ap.add_argument("--timeline", default=None); ap.add_argument("--json", default=None)
    ap.add_argument("--subset", action="store_true"); ap.add_argument("--pixels", action="store_true")
    ap.add_argument("--control-only", action="store_true", help="run the control and stop (probe-all uses this when there is no second render)")
    a = ap.parse_args()
    pr = Probe("determinism", a.json)
    with tempfile.TemporaryDirectory() as t:
        fr = make.twos_sequence(False)[0][20]; alt = fr.copy(); alt[90, 100] ^= 1
        for name, img in (("a", fr), ("b", fr), ("c", alt)):
            os.makedirs(os.path.join(t, name)); Image.fromarray(img).save(os.path.join(t, name, "element-000.png"))
        same = compare(list_frames(os.path.join(t, "a")), list_frames(os.path.join(t, "b")), a.pixels, False)
        one = compare(list_frames(os.path.join(t, "a")), list_frames(os.path.join(t, "c")), a.pixels, False)
    pr.control(not same[0] and one[0] == [0], f"one altered pixel -> FAIL (frame {one[0]} differs); two writes of the same frame -> pass ({same[2]} frame, 0 differ)")
    if a.control_only:
        print("control-only: no second render supplied"); pr._write("control-only"); sys.exit(0)
    if not (a.frames_a and a.frames_b): die("two frame directories are required (or --control-only)")
    fa, fb = list_frames(a.frames_a), list_frames(a.frames_b)
    diff, listing, common = compare(fa, fb, a.pixels, a.subset)
    pr.check("same frame list", not listing, f"{len(fa)} frames in a, {len(fb)} in b" + (f"; not matched: {listing[:12]}" if listing else ""))
    pr.check("byte-identical", not diff, f"{common - len(diff)} of {common} common frames identical" + (f"; differ at {diff[:20]}" if diff else ""))
    pr.extra.update({"differ": diff, "unmatched": listing})
    pr.finish(f"{common} frames, sha256 identical across both renders")


if __name__ == "__main__": main()
