#!/usr/bin/env python3
"""Loop closure in line-world phases (rubric C23/C14 line world): the figure's boundary is one closed loop on every frame of a line phase.

usage: probe-loop.py <frames-dir> --timeline v3/timeline.json [--xsheet v3/xsheet.json] [--figure-line-frames <dir>] [--shot <id>] [--crop x,y,w,h] [--json out]
Method: the `verdict` function of scripts/measure-worlds.py `loop`, copied (it is a subcommand of a script, not importable): ink = pixels more than 24
(summed RGB) from the field colour, the hole-filled ink must be one body whose largest piece spans the whole height of everything drawn and holds
>= 95 % of the filled area; pieces touching the crop's left border are not the figure. Changes against the original: the field colour is the
crop's corner pixel on each frame (the original read frame 0's, which is the same on a constant field), the speck size is 12 px at 1280 wide and
scales with the frame, and the figure crop is cut with the xsheet camera inverted. Frames to check: xsheet rows with phase == 'line' or world ==
'line'; without an xsheet, the frames of timeline beats whose world is 'line'. Control first, as the original: a closed frame must read closed and
the same frame with a 4 px band erased across the shins must read open; repeated on the first line-phase frame of the sequence.

Two reasons to read the figure alone. (1) The line world's floor grid runs through the figure's legs and on into the crop's left border, so in the full frame the outline and the grid
are one body, a body that touches the border is not the figure, and closure reads open on a figure that is closed. (2) Clipping: a figure the frame cuts off cannot be a closed loop
whatever the world draws, so closure alone would call a framing defect a drawing defect. `--figure-line-frames` (the figure-line render, Animatic65FigureLine: the human as the line
world draws it, contour only, on the field colour, nothing else) is read for BOTH: closure by `verdict` on the camera-inverted crop, and `figure inside the frame` for ink on the
frame's own edges (top, bottom, left, right), naming the frames and the edges. Without it closure is measured on the full frames as before (and fails wherever the grid merges with the
figure) and clipping is not measured, which the probe says. Control: a figure that fits reads inside; the same figure shifted down until the boots pass the bottom edge reads clipped at
the bottom. `--shot <id>` measures one shot's slice.
"""
import argparse, os, sys
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


def verdict(a, min_area):
    """Attribution: copied from scripts/measure-worlds.py `loop` (D78 world proof), `verdict`. Returns (closed, height share, area share)."""
    field = a[0, 0]
    ink = np.abs(a - field).sum(axis=2) > 24
    filled = ndi.binary_fill_holes(ink)
    lab, n = ndi.label(filled, structure=np.ones((3, 3)))
    if n == 0: return False, 0.0, 0.0
    sizes = np.array(ndi.sum(filled, lab, range(1, n + 1)))
    edge = set(np.unique(lab[:, 0]).tolist()) - {0}
    keep = [i for i in range(n) if sizes[i] >= min_area and (i + 1) not in edge]
    if not keep: return False, 0.0, 0.0
    boxes = ndi.find_objects(lab)
    top = min(boxes[i][0].start for i in keep); bottom = max(boxes[i][0].stop for i in keep)
    big = max(keep, key=lambda i: sizes[i])
    height = (boxes[big][0].stop - boxes[big][0].start) / (bottom - top)
    share = sizes[big] / sizes[keep].sum()
    return bool(height >= 0.98 and share >= 0.95), float(height), float(share)


def cut(a):
    field = a[0, 0]; fg = np.abs(a - field).sum(axis=2) > 24; ys = np.nonzero(fg.any(axis=1))[0]
    y = int(ys.min() + 0.75 * (ys.max() - ys.min())); b = a.copy(); b[y:y + 4, :] = field
    return b, y


def clipped_edges(a, thresh=24):
    """The edges of the frame `a` the figure's ink touches: any of top, bottom, left, right. The field is the corner pixel, as in `verdict`."""
    field = a[0, 0]; ink = np.abs(a - field).sum(axis=2) > thresh
    return [name for name, hit in (("top", ink[0].any()), ("bottom", ink[-1].any()), ("left", ink[:, 0].any()), ("right", ink[:, -1].any())) if hit]


def crop_of(img, xs, f, crop_arg):
    box, s = crop_box_px(img.shape, crop_arg)
    return world_crop(img, camera_of(xs, f), s, box), s


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--crop", default=None)
    ap.add_argument("--figure-line-frames", default=None, help="the figure-line render (Animatic65FigureLine, the line phase's frames): closure and clipping are read there")
    a = ap.parse_args()
    pr = Probe("loop-closure", a.json)
    fr = make.loop_frame(20).astype(np.int16); fcut, y = cut(fr)
    sm = max(3, round(12 * make.S * make.S))
    v0, v1 = verdict(fr, sm), verdict(fcut, sm)
    pr.control(v0[0] and not v1[0], f"synthetic closed outline closed={v0[0]} (height {v0[1]:.3f}, share {v0[2]:.3f}); 4 px band erased across the shins (row {y}) closed={v1[0]} "
                                    f"(height {v1[1]:.3f}, share {v1[2]:.3f}) {'flips' if v0[0] and not v1[0] else 'DOES NOT FLIP'}")
    fit = make.loop_frame(20).astype(np.int16)
    down = np.vstack([np.broadcast_to(fit[0, 0], (30, fit.shape[1], 3)), fit])[:fit.shape[0]]                 # the same figure 30 rows lower: its boots (row 160) pass the bottom edge
    c_in, c_out = clipped_edges(fit), clipped_edges(down)
    if c_in or "bottom" not in c_out: die(f"the clipping control did not trip: a fitting figure reads clipped at {c_in}, the figure shifted down reads {c_out}")
    print(f"control (clipping): a figure that fits reads inside the frame; the same figure 30 rows lower reads clipped at {c_out}", flush=True)
    tl, xs, frames = load_timeline(a.timeline), default_xsheet(a), list_frames(a.frames)
    tl, xs, frames, shot_note = apply_shot(a, tl, xs, frames)
    if xs: line = [f for f in frames if (xs.get(f) or {}).get("phase") == "line" or (xs.get(f) or {}).get("world") == "line"]
    else: line = [f for f in frames if (beat_at(tl, f) or {}).get("world") == "line"]
    if not line and a.shot:                                                       # a slice without a crossing has nothing to close: said, not passed silently
        pr.note(f"not applicable: {shot_note} has no line-phase frame"); pr.finish("not applicable: the shot has no line phase")
    pr.check("line phases present", bool(line), f"{len(line)} line-phase frames{'; ' + shot_note if shot_note else ''}" + ("" if line else " - none, so closure was never measured"))
    if not line: pr.finish("")
    ff = None
    if a.figure_line_frames:
        ff = list_frames(a.figure_line_frames); missing = [f for f in line if f not in ff]
        if missing: die(f"the figure-line layer {a.figure_line_frames} lacks line-phase frames {missing[:8]}")
    src = ff or frames                                                          # where closure is read: the figure-line layer when given, else the full frames
    img0, _ = crop_of(load_rgb(src[line[0]]), xs, line[0], a.crop)
    scale = load_rgb(src[line[0]]).shape[1] / STAGE[0]; min_area = max(3, round(12 * scale * scale))
    b0, _ = cut(img0)
    r0, r1 = verdict(img0, min_area), verdict(b0, min_area)
    pr.note(f"control on the real frame {line[0]}{' (figure-line layer)' if ff else ''}: intact closed={r0[0]} (height {r0[1]:.3f}, share {r0[2]:.3f}); band erased closed={r1[0]} {'flips' if r0[0] and not r1[0] else 'does not flip (intact frame is not closed)' if not r0[0] else 'DOES NOT FLIP'}")
    if r0[0] and r1[0]: die("positive control failed on the real frames: a cut figure still reads closed, so the probe cannot tell open from closed here")
    clipped = {}
    if ff:
        for f in line:
            e = clipped_edges(load_rgb(ff[f]))
            if e: clipped[f] = e
        pr.check("figure inside the frame", not clipped, f"{len(line) - len(clipped)} of {len(line)} line-phase frames have the whole figure inside the frame" + (
                 f"; clipped on {len(clipped)}: " + ", ".join(f"{k} {sum(1 for v in clipped.values() if k in v)}" for k in ("top", "bottom", "left", "right") if any(k in v for v in clipped.values())) + f" (first at {sorted(clipped)[:6]})" if clipped else ""))
    else: pr.note("clipping not measured: no --figure-line-frames (the figure-line render); closure is read on the full frames, where the floor grid merges with the figure's outline")
    open_f = []
    for f in line:
        c, _ = crop_of(load_rgb(src[f]), xs, f, a.crop)
        if not verdict(np.asarray(c).astype(np.int16), min_area)[0]: open_f.append(f)
    pr.check("loop closed", not open_f, f"closed on {len(line) - len(open_f)} of {len(line)} line-phase frames" + (f"; open on {open_f[:20]}" if open_f else ""))
    pr.extra.update({"lineFrames": len(line), "open": open_f, "clipped": {str(k): v for k, v in clipped.items()}})
    pr.finish(f"the figure's boundary loop is closed on all {len(line)} line-phase frames")


if __name__ == "__main__": main()
