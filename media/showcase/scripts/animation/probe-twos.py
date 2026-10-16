#!/usr/bin/env python3
"""Twos/ones split (rubric C27): the drawn layer (the figure) changes only on even frames; the camera may change on every frame.

usage: probe-twos.py <frames-dir> --timeline v3/timeline.json [--xsheet v3/xsheet.json] [--figure-frames <dir>] [--shot <id>] [--crop x,y,w,h] [--tolerance 0] [--json out]
Method: per frame, cut the figure region out of the rendered frame with the xsheet camera inverted (--crop overrides the region, in frame pixels
at rest; STAGE.figureCrop otherwise), count the pixels that differ from the previous frame, and list every ODD frame index on which the figure
changed. On full frames crossing windows from the timeline are exempt, because the world's fills change there on every frame. With `--figure-frames` (the figure-only render, Animatic65Figure:
the human flat and filled under the camera, nothing else) the figure is read from that layer and NO window is exempt: only the world's fills morph in a crossing and they are not in
that layer, so a pose change inside a crossing is measured like any other. `--shot <id>` measures one shot's slice of the timeline. On an odd frame where the xsheet camera moved, a change under MOVING_ODD_FLOOR (64 px) is the sub-pixel outline of a re-rasterised figure, not a drawing (see the constant). Control first: a sequence with a change on frame 7 must fail; the same with changes on
even frames only and the camera moving every frame must pass; an odd-frame change inside a crossing window must fail on the figure layer and pass on full frames (exempt).
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def analyse(series, exempt, min_px, moving=frozenset()):
    odd, even, camera_odd = [], 0, 0
    for f, (fig, rest) in series.items():
        if exempt(f) or exempt(f - 1): continue
        if f % 2:
            camera_odd += rest > min_px
            if fig > (max(min_px, MOVING_ODD_FLOOR) if f in moving else min_px): odd.append(f)
        elif fig > min_px: even += 1
    return odd, even, camera_odd


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--figure-frames", default=None, help="the figure-only render (Animatic65Figure): measure the figure there, with no crossing window exempt")
    ap.add_argument("--crop", default=None); ap.add_argument("--tolerance", type=int, default=0, help="odd-frame figure changes allowed outside crossings")
    ap.add_argument("--pixel-threshold", type=int, default=24, help="summed RGB difference that counts as a changed pixel")
    ap.add_argument("--min-pixels", type=int, default=4, help="changed pixels that count as a changed crop (absorbs resampling noise)")
    ap.add_argument("--allow-static", action="store_true", help="do not fail when the figure never changes")
    a = ap.parse_args()
    pr = Probe("twos-ones", a.json)
    bfr, brows = make.twos_sequence(True)
    bad = analyse(change_series(dict(enumerate(bfr)), {r["frame"]: r for r in brows}, None, a.pixel_threshold), lambda f: False, a.min_pixels)
    frs, rows = make.twos_sequence(False)
    good = analyse(change_series(dict(enumerate(frs)), {r["frame"]: r for r in rows}, None, a.pixel_threshold), lambda f: False, a.min_pixels)
    win = lambda f: 20 <= f < 36                                                       # a crossing window of the fixture
    jfr, jrows = make.twos_sequence(False, jump_frame=27)
    jump_fig = analyse(change_series(dict(enumerate(jfr)), {r["frame"]: r for r in jrows}, None, a.pixel_threshold), lambda f: False, a.min_pixels)
    jump_full = analyse(change_series(dict(enumerate(jfr)), {r["frame"]: r for r in jrows}, None, a.pixel_threshold), win, a.min_pixels)
    pr.control(bad[0] == [7] and good[0] == [] and good[1] >= 5 and good[2] >= 20 and 27 in jump_fig[0] and 27 not in jump_full[0],
               f"change on frame 7 -> FAIL (odd-frame figure changes at {bad[0]}); changes on even frames only with the camera moving every frame -> pass "
               f"({len(good[0])} odd-frame changes, {good[1]} even-frame changes, camera moved on {good[2]} odd frames); a figure change on frame 27 inside a crossing window 20-35 -> "
               f"FAIL on the figure layer (odd-frame changes at {[f for f in jump_fig[0] if f == 27]}), exempt (pass) on full frames")
    tl, xs, frames = load_timeline(a.timeline), default_xsheet(a), list_frames(a.frames)
    layer = None
    if a.figure_frames: frames, layer = list_frames(a.figure_frames), "figure layer"
    tl, xs, frames, shot_note = apply_shot(a, tl, xs, frames)
    series = change_series(frames, xs, a.crop, a.pixel_threshold)
    moving = {f for f in series if xs and not same_camera(camera_of(xs, f), camera_of(xs, f - 1))}
    odd, even, cam = analyse(series, (lambda f: False) if layer else (lambda f: in_window(tl, f)), a.min_pixels, moving)
    pr.note(f"frames {len(frames)} ({min(frames)}..{max(frames)}) from the {layer or 'full frames'}{'; ' + shot_note if shot_note else ''}; camera inverted from {'xsheet' if xs else 'nothing (no xsheet)'}; "
            + ("no crossing window exempt (the figure layer has no world fills)" if layer else f"crossing windows exempt: {[(w['a'], w['b']) for w in tl['windows']]}"))
    pr.check("odd-frame changes", len(odd) <= a.tolerance, f"{len(odd)} odd frame(s) where the figure changed (tolerance {a.tolerance}){': ' + str(odd[:20]) if odd else ''}")
    pr.check("figure moves", even > 0 or a.allow_static, f"{even} even-frame figure changes" + ("" if even else " - the figure never changes, so this probe measured nothing (--allow-static to accept)"))
    pr.extra.update({"oddFrames": odd, "evenChanges": even, "cameraMovedOnOddFrames": cam})
    pr.finish(f"the drawing changed on {even} even frames and 0 odd frames; the camera moved on {cam} odd frames")


if __name__ == "__main__": main()
