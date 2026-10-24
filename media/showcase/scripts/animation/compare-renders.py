#!/usr/bin/env python3
"""Which frames of one render differ from the same frames of another (what changed in the film, and where).

usage: compare-renders.py <frames-a> <frames-b> [--levels 2] [--share 0.0001]
A frame differs when more than `--share` of its pixels (default 0.01 %, the determinism probe's own bar for the rasteriser's noise) differ by more than `--levels` in some channel. Prints the runs of differing frames, the count of identical
frames and the largest difference, one line each; exits 0 always (it is a measurement, not a gate). Control: a frame compared with itself reads identical and with a copy that has a 30 px square painted over it reads different.
"""
import argparse, sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import list_frames


def differs(a, b, levels, share):
    n = int((np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > levels).sum())
    return n, n > share * a.shape[0] * a.shape[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a"); ap.add_argument("b"); ap.add_argument("--levels", type=int, default=2); ap.add_argument("--share", type=float, default=0.0001)
    o = ap.parse_args()
    probe = np.full((180, 320, 3), 40, np.uint8); painted = probe.copy(); painted[10:40, 10:40] = 250
    c1, c2 = differs(probe, probe, o.levels, o.share), differs(probe, painted, o.levels, o.share)
    print(f"control: a frame against itself -> {'different' if c1[1] else 'identical'}; against a copy with a 30 px square painted over it -> {'different' if c2[1] else 'identical'} ({c2[0]} px)")
    if c1[1] or not c2[1]: print("refused: the comparison did not tell the control frames apart"); sys.exit(2)
    fa, fb = list_frames(o.a), list_frames(o.b); both = sorted(set(fa) & set(fb))
    runs, same, worst = [], 0, (0, None)
    for f in both:
        n, d = differs(np.asarray(Image.open(fa[f]).convert("RGB")), np.asarray(Image.open(fb[f]).convert("RGB")), o.levels, o.share)
        if not d: same += 1; continue
        if runs and f == runs[-1][1] + 1: runs[-1][1] = f; runs[-1][2] = max(runs[-1][2], n)
        else: runs.append([f, f, n])
        worst = max(worst, (n, f))
    print(f"{len(both)} frames in both; {same} identical; differing runs (first-last, most pixels): " + ", ".join(f"{a}-{b} ({n})" if a != b else f"{a} ({n})" for a, b, n in runs))
    print(f"largest difference: {worst[0]} px on frame {worst[1]}")


if __name__ == "__main__": main()
