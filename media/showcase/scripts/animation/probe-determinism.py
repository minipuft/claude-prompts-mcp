#!/usr/bin/env python3
"""Determinism (rubric C12): two renders of the same frame list match, frame for frame, within the rasteriser's own noise.

usage: probe-determinism.py <frames-dir-a> <frames-dir-b> [--subset] [--shot <id>] [--levels 2] [--share 0.0001] [--bytes] [--json out]
Method: each element-NNN.png of a is compared with b's decoded RGB. A frame matches when no more than SHARE of its pixels (0.01 %, rounded down: 23 at 640x360, 92 at
1280x720) differ by more than LEVELS (2) in any channel. Pixels within LEVELS of each other are the rasteriser's anti-aliasing noise and are not counted: the same
anti-aliased line is quantised to a coverage step by Chromium's SVG rasteriser and lands one step either way from run to run (measured on the animatic: 631-1400 pixels
one level apart on frames of the line and shaded worlds, and at most 30 pixels one coverage step (53 levels) apart). A different picture is far over the bar: the crayon noise
bitmap that was drawn from the live SVG on a tab's first frame differed on 45 000 pixels by up to 43 levels. `--bytes` is the strict form (sha256 of each file; `--levels` and
`--share` are not used). The two frame lists must be the same (--subset: every frame of b must exist in a, for a sampled re-render).
Control first, on a 320x180 fixture frame (allowance 5 pixels): two writes of one frame match; one pixel one level off (rasteriser noise) matches; 40 pixels one level off (still
noise) matches; a patch of 60 pixels 40 levels off is refused; the whole frame shifted by 3 levels is refused. A SINGLE pixel changed by 40 levels is inside the allowance by
arithmetic (1 pixel is 0.0017 % of the fixture), so it is reported as tolerated and is not a control; `--share 0` refuses it.
"""
import argparse, hashlib, os, sys, tempfile
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


LEVELS, SHARE = 2, 0.0001


def digest(path):
    with open(path, "rb") as f: return hashlib.sha256(f.read()).hexdigest()


def pixels_of(p): return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)


def beyond(x, y, levels):
    """Pixels where some channel differs by more than `levels`."""
    return int((np.abs(x - y).max(axis=2) > levels).sum())


def frame_ok(x, y, levels, share):
    """(ok, pixels beyond levels, allowance, pixels differing at all, largest difference)."""
    n = beyond(x, y, levels); allow = int(share * x.shape[0] * x.shape[1]); d = np.abs(x - y).max(axis=2)
    return n <= allow, n, allow, int((d > 0).sum()), int(d.max())


def compare(a, b, subset, strict=False, levels=LEVELS, share=SHARE):
    """(frames that differ, frames in only one list, common count, {frame: (beyond, allowance, differing, largest)} for the frames with any difference)."""
    only_a = sorted(set(a) - set(b)); only_b = sorted(set(b) - set(a))
    diff, noise = [], {}
    for f in sorted(set(a) & set(b)):
        if strict:
            if digest(a[f]) != digest(b[f]): diff.append(f)
            continue
        x, y = pixels_of(a[f]), pixels_of(b[f])
        if x.shape != y.shape: diff.append(f); noise[f] = (-1, 0, -1, -1); continue
        ok, n, allow, any_, top = frame_ok(x, y, levels, share)
        if any_: noise[f] = (n, allow, any_, top)
        if not ok: diff.append(f)
    listing = only_b if subset else only_a + only_b
    return diff, listing, len(set(a) & set(b)), noise


def planted(fr, kind):
    """The fixture frame with a defect planted: noise (1 level, 1 pixel), noise40 (1 level, 40 pixels), patch (60 pixels, 40 levels), shift (every pixel 3 levels), single (1 pixel, 40 levels)."""
    alt = fr.astype(np.int16).copy()
    if kind == "noise": alt[90, 100] += 1
    elif kind == "noise40": alt[90, 100:140] += 1
    elif kind == "patch": alt[90:96, 100:110] += 40
    elif kind == "shift": alt += 3
    elif kind == "single": alt[90, 100] += 40
    return np.clip(alt, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_a", nargs="?"); ap.add_argument("frames_b", nargs="?")
    ap.add_argument("--timeline", default=None); ap.add_argument("--json", default=None)
    ap.add_argument("--subset", action="store_true")
    ap.add_argument("--shot", default=None, help="compare the frames inside one shot's slice of the timeline (--timeline, default v3/timeline.json)")
    ap.add_argument("--levels", type=int, default=LEVELS, help="a pixel counts only when a channel differs by more than this (default 2)")
    ap.add_argument("--share", type=float, default=SHARE, help="share of a frame's pixels allowed beyond --levels (default 0.0001 = 0.01 %%)")
    ap.add_argument("--bytes", action="store_true", help="strict: sha256 of each file, no tolerance")
    ap.add_argument("--pixels", action="store_true", help="compare decoded pixels (the default; accepted so the gate commands that spell it keep working)")
    ap.add_argument("--control-only", action="store_true", help="run the control and stop (probe-all uses this when there is no second render)")
    a = ap.parse_args()
    pr = Probe("determinism", a.json)
    with tempfile.TemporaryDirectory() as t:
        fr = make.twos_sequence(False)[0][20]
        kinds = ("same", "noise", "noise40", "patch", "shift", "single")
        for k in kinds:
            os.makedirs(os.path.join(t, k)); Image.fromarray(fr if k == "same" else planted(fr, k)).save(os.path.join(t, k, "element-000.png"))
        os.makedirs(os.path.join(t, "base")); Image.fromarray(fr).save(os.path.join(t, "base", "element-000.png"))
        got = {k: compare(list_frames(os.path.join(t, "base")), list_frames(os.path.join(t, k)), False, a.bytes, a.levels, a.share) for k in kinds}
    allow = int(a.share * fr.shape[0] * fr.shape[1])
    tol = {k: not got[k][0] for k in kinds}
    if a.bytes: want = {"same": True, "noise": False, "noise40": False, "patch": False, "shift": False, "single": False}
    else: want = {"same": True, "noise": True, "noise40": True, "patch": False, "shift": False, "single": allow >= 1}
    ctl = (f"two writes of the same frame -> pass; " if a.bytes else
           f"two writes of the same frame -> pass; 1 pixel 1 level off (rasteriser noise) -> pass; 40 pixels 1 level off (noise) -> pass; 60 pixels 40 levels off -> FAIL "
           f"({got['patch'][3].get(0, ('?',))[0]} beyond {a.levels} levels, allowance {allow}); every pixel 3 levels off -> FAIL ({got['shift'][3].get(0, ('?',))[0]} beyond {a.levels} levels); "
           f"1 pixel 40 levels off -> {'tolerated (inside the allowance of ' + str(allow) + ')' if tol['single'] else 'FAIL'}")
    if a.bytes: ctl += "one altered pixel -> FAIL (frame [0] differs)"
    pr.control(all(tol[k] == want[k] for k in kinds), ctl)
    if a.control_only:
        print("control-only: no second render supplied"); pr._write("control-only"); sys.exit(0)
    if not (a.frames_a and a.frames_b): die("two frame directories are required (or --control-only)")
    fa, fb = list_frames(a.frames_a), list_frames(a.frames_b)
    if a.shot:
        a.timeline = a.timeline or "v3/timeline.json"
        _, _, fa, shot_note = apply_shot(a, load_timeline(a.timeline), None, fa); _, _, fb, _ = apply_shot(a, load_timeline(a.timeline), None, fb); pr.note(shot_note)
    diff, listing, common, noise = compare(fa, fb, a.subset, a.bytes, a.levels, a.share)
    pr.check("same frame list", not listing, f"{len(fa)} frames in a, {len(fb)} in b" + (f"; not matched: {listing[:12]}" if listing else ""))
    if a.bytes:
        pr.check("byte-identical", not diff, f"{common - len(diff)} of {common} common frames identical" + (f"; differ at {diff[:20]}" if diff else ""))
    else:
        quiet = [f for f in noise if f not in diff]
        top = max((v[0] for v in noise.values()), default=0)
        pr.note(f"{len(noise)} of {common} common frames differ at all; {len(quiet)} of those inside the tolerance (at most {top} pixels beyond {a.levels} levels, {max((v[3] for v in noise.values()), default=0)} levels the largest difference)")
        pr.check("identical within tolerance", not diff, f"{common - len(diff)} of {common} common frames match within {a.levels} levels on all but {100 * a.share:g} % of the pixels"
                 + (f"; over the bar at " + ", ".join(f"{f} ({noise[f][0]} pixels beyond {a.levels} levels, allowance {noise[f][1]}, largest {noise[f][3]})" for f in diff[:12]) if diff else ""))
    pr.extra.update({"differ": diff, "unmatched": listing, "noise": {str(f): v for f, v in noise.items()}})
    pr.finish(f"{common} frames, " + ("sha256 identical" if a.bytes else f"within {a.levels} levels on all but {100 * a.share:g} % of the pixels") + " across both renders")


if __name__ == "__main__": main()
