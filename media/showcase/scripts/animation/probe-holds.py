#!/usr/bin/env python3
"""Hold band (rubric C28): every hold of the drawn layer lasts 11-27 frames unless the xsheet declares a longer one, and a move between two holds
uses 3-6 drawings.

usage: probe-holds.py <frames-dir> --timeline v3/timeline.json [--xsheet v3/xsheet.json] [--figure-frames <dir>] [--shot <id>] [--crop x,y,w,h] [--no-pops] [--json out]
Method: the figure crop (camera inverted, as probe-twos.py) is compared frame to frame; a run of identical crops is one drawing. A drawing held
for more than --move-run frames (default 4: twos, threes, fours belong to a move) is a hold and must sit in 11-27. A key row of the xsheet whose
hold is >= 28 (explicit `hold`, else the span to the next key or breakdown row) is an intentional long hold: allowed and listed. The drawings between
two consecutive holds are the move: 3-6 of them. A hold meeting a crossing window or the end of the sequence is cut short by it, so only its upper
bound is checked. Two holds with no drawing between them are a pop (a holds-only animatic is made of them): counted and listed, a failure only
under --no-pops. Boil (line and texture redraws the world makes on its own, 6 per second in the crayon world, which the board's timing law allows inside a hold) changes
the figure's pixels as much as a small pose change does, so pixels alone cannot tell the two apart. When the xsheet carries any key or breakdown row, a
change counts as a new drawing only on a frame within 1 of such a row; any other change is boil, counted and listed, and does not end a hold. Without
key rows every change counts, as before. Control first: a 40-frame hold must fail, a 16-frame hold must pass, a declared 40-frame key hold must pass and be listed, a
one-drawing move must fail; on a frame where the xsheet camera moved a change of 64 pixels or fewer is the figure re-rasterised under the move, not a drawing (MOVING_ODD_FLOOR, as in probe-twos.py); a pose change planted inside a crossing window with no key row must fail on the figure layer and be exempt on full frames.

Crossings. On full frames a crossing window is exempt: the world's fills change on every frame there, so a pixel change is not a drawing. With `--figure-frames` (the figure-only render,
Animatic65Figure: the human flat and filled under the camera, nothing else) the figure is read from that layer and no window is exempt: nothing in that layer morphs, so every change in it
is a pose change, and one with no key or breakdown row within 1 frame is a failure of its own ("not on the exposure sheet"), not boil. `--shot <id>` measures one shot's slice.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

BAND = (11, 27)


def runs_of(series, frames_sorted, exempt, min_px):
    """Drawings as runs [start, end] (inclusive) per segment between crossing windows; each carries whether a window or the sequence edge cut it."""
    segs, cur = [], []
    for f in frames_sorted:
        if exempt(f):
            if cur: segs.append((cur, True)); cur = []
        else:
            if cur and f != cur[-1] + 1: segs.append((cur, True)); cur = []
            cur.append(f)
    if cur: segs.append((cur, False))
    out = []
    for seg, ended_by_window in segs:
        runs, start = [], seg[0]
        for f in seg[1:]:
            if series.get(f, (0, 0))[0] > min_px: runs.append([start, f - 1]); start = f
        runs.append([start, seg[-1]])
        for i, r in enumerate(runs):
            r.append(i == 0)                       # clipped on the left: the segment's first run begins at a window or the sequence start
            r.append(i == len(runs) - 1)           # clipped on the right
        out.append(runs)
    return out


def analyse(series, frames_sorted, exempt, min_px, long_holds, move_run, starts):
    holds, fails, moves, pops, listed = [], [], [], 0, []
    for runs in runs_of(series, frames_sorted, exempt, min_px):
        marks = []
        for r in runs:
            n = r[1] - r[0] + 1
            if n <= move_run: continue
            marks.append(r)
            declared = next((h for h in long_holds if r[0] >= h["start"] - 1 and r[1] <= h["start"] + h["hold"] + 1), None)
            clipped = r[2] or r[3]
            if n > BAND[1] and declared: listed.append({"start": r[0], "frames": n, "key": declared["key"], "declared": declared["hold"]})
            elif n > BAND[1]: fails.append(f"hold of {n} frames at {r[0]}-{r[1]} is over {BAND[1]} and no key declares it")
            elif n < BAND[0] and not clipped: fails.append(f"hold of {n} frames at {r[0]}-{r[1]} is under {BAND[0]}")
            holds.append((r[0], r[1], n))
        for h0, h1 in zip(marks, marks[1:]):
            between = [r for r in runs if r[0] > h0[1] and r[1] < h1[0]]
            if len(between) == 0:
                if h1[0] in starts: continue                          # a cut at a beat start is not a move
                pops += 1
            elif not 3 <= len(between) <= 6: fails.append(f"move from the hold ending {h0[1]} to the hold starting {h1[0]} uses {len(between)} drawing(s), not 3-6")
            if between: moves.append(len(between))
    return holds, fails, moves, pops, listed


def authorise(series, xs, min_px, exempt=lambda f: False):
    """Zero the figure change on frames no key or breakdown row of the xsheet accounts for (boil). Returns (series, the frames of those changes outside `exempt`: boil on full frames,
    strays on the figure layer). A frame `exempt` (a crossing window on full frames) is never listed."""
    marks = sorted(f for f, r in (xs or {}).items() if r.get("key") or r.get("breakdown"))
    if not marks: return series, []
    out, boil = {}, []
    for f, (fig, rest) in series.items():
        if fig > min_px and not any(abs(f - m) <= 1 for m in marks):
            if not exempt(f): boil.append(f)
            out[f] = (0, rest)
        else: out[f] = (fig, rest)
    return out, boil


def run_fixture(kind, a, min_px):
    frs, rows = make.holds_sequence(kind); xs = {r["frame"]: r for r in rows}
    series = authorise(change_series(dict(enumerate(frs)), xs, None, a.pixel_threshold), xs, min_px)[0]
    return analyse(series, [0] + sorted(series), lambda f: False, min_px, declared_long_holds(xs), a.move_run, set())


def crossing_fixture(kind, a, min_px, figure_layer):
    """Strays (changes with no key row) of a hold sequence with a pose change planted on frame 28 inside the crossing window 24-39: kind 'crossing-jump' carries no key row there, 'crossing-keyed' does."""
    frs, rows = make.holds_sequence(kind); xs = {r["frame"]: r for r in rows}
    return authorise(change_series(dict(enumerate(frs)), xs, None, a.pixel_threshold), xs, min_px, (lambda f: False) if figure_layer else (lambda f: 24 <= f < 40))[1]


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--figure-frames", default=None, help="the figure-only render (Animatic65Figure): measure the figure there, with no crossing window exempt")
    ap.add_argument("--crop", default=None); ap.add_argument("--move-run", type=int, default=4, help="longest drawing still counted as part of a move")
    ap.add_argument("--pixel-threshold", type=int, default=24); ap.add_argument("--min-pixels", type=int, default=4)
    ap.add_argument("--no-pops", action="store_true", help="fail a key-to-key change with no drawing between the holds")
    a = ap.parse_args()
    pr = Probe("hold-band", a.json)
    c = {k: run_fixture(k, a, a.min_pixels) for k in ("hold40", "good", "hold40-declared", "onedraw")}
    ok = (c["hold40"][1] and not c["good"][1] and not c["hold40-declared"][1] and c["hold40-declared"][4] and c["onedraw"][1] and c["good"][2] == [4])
    jump_fig, jump_full, keyed = (crossing_fixture("crossing-jump", a, a.min_pixels, True), crossing_fixture("crossing-jump", a, a.min_pixels, False), crossing_fixture("crossing-keyed", a, a.min_pixels, True))
    ok = ok and jump_fig == [28] and jump_full == [] and keyed == []
    pr.control(ok, f"40-frame hold -> FAIL ({c['hold40'][1][0]}); 16-frame hold, 4-drawing move -> pass ({len(c['good'][0])} holds, move of {c['good'][2][0]}); "
                   f"40-frame hold declared by key {c['hold40-declared'][4][0]['key']!r} -> pass and listed; 1-drawing move -> FAIL; a pose change on frame 28 inside a crossing window with no key row -> "
                   f"FAIL on the figure layer (stray change at {jump_fig}), exempt on full frames; the same change with a key row -> pass")
    tl, xs, frames = load_timeline(a.timeline), default_xsheet(a), list_frames(a.frames)
    layer = None
    if a.figure_frames: frames, layer = list_frames(a.figure_frames), "figure layer"
    tl, xs, frames, shot_note = apply_shot(a, tl, xs, frames)
    exempt = (lambda f: False) if layer else (lambda f: in_window(tl, f))
    series, boil = authorise(damp_camera_noise(change_series(frames, xs, a.crop, a.pixel_threshold), xs), xs, a.min_pixels, exempt)
    fs = sorted(frames)
    holds, fails, moves, pops, listed = analyse(series, fs, exempt, a.min_pixels, declared_long_holds(xs), a.move_run, {b["start"] for b in tl["beats"]})
    pr.note(f"frames {len(fs)} from the {layer or 'full frames'}{'; ' + shot_note if shot_note else ''}; holds found {len(holds)} (lengths {sorted({h[2] for h in holds})[:12]}); moves {len(moves)} (drawings per move {moves[:12]}); pops {pops}; "
            + (f"changes with no key row within 1 frame {len(boil)}" if layer else f"boil changes (no key row within 1 frame, not counted as drawings) {len(boil)}"))
    if layer: pr.check("pose changes on the sheet", not boil, f"{len(boil)} figure change(s) on the figure layer with no key or breakdown row within 1 frame" + (f": {boil[:20]}" if boil else ""))
    pr.check("hold band", not [f for f in fails if f.startswith("hold")], "; ".join(f for f in fails if f.startswith("hold")) or f"all {len(holds)} holds inside {BAND[0]}-{BAND[1]} or declared")
    pr.check("move drawings", not [f for f in fails if f.startswith("move")], "; ".join(f for f in fails if f.startswith("move")) or f"all {len(moves)} moves use 3-6 drawings")
    pr.check("pops", not (a.no_pops and pops), f"{pops} key-to-key change(s) with no drawing between{' (allowed: --no-pops not set)' if pops and not a.no_pops else ''}")
    for h in listed: pr.note(f"intentional long hold: key {h['key']!r} frames {h['start']}.. ({h['frames']} frames, declared {h['declared']})")
    pr.extra.update({"holds": holds, "moves": moves, "pops": pops, "longHolds": listed, "boilChanges": len(boil)})
    pr.finish(f"{len(holds)} holds in the band or declared, {len(moves)} moves of 3-6 drawings, {pops} pops, {len(listed)} intentional long holds listed")


if __name__ == "__main__": main()
