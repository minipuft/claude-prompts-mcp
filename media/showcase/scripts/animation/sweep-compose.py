#!/usr/bin/env python3
"""Compare every composed frame of a shot with the browser's own render of the same code (row 6.12b).

usage: sweep-compose.py <composed-dir> <whole-dir> [--frames A-B] [--out sweep.json] [--workers 8]
       composed-dir  out/<shot>-seq (element-NNN.png, written by `npm run render`)
       whole-dir     a full browser render of the same code:
                     npx remotion render src/index.ts ShotS01 <whole-dir> --sequence --image-format=png --concurrency=4
Writes [[frame, pixels beyond 2 levels, MAD, largest difference], ...] and prints the frames over the determinism tolerance (2 levels on at most 0.01 % of the pixels,
the same bar `render-cached.mjs` holds its confirm frames to). Exit 0 every frame inside it, 1 a frame beyond it, 2 input error.
"""
import json, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image

LEVELS, SHARE = 2, 0.0001


def one(args):
    composed, whole, frame = args
    a = np.asarray(Image.open(composed).convert("RGB")).astype(np.int16)
    b = np.asarray(Image.open(whole).convert("RGB")).astype(np.int16)
    if a.shape != b.shape: return [frame, -1, -1.0, -1]
    d = np.abs(a - b).max(axis=2)
    return [frame, int((d > LEVELS).sum()), round(float(np.abs(a - b).mean()), 5), int(d.max())]


def main(argv):
    if len(argv) < 3: print(__doc__); return 2
    composed_dir, whole_dir = argv[1], argv[2]
    opt = lambda n, default: argv[argv.index(n) + 1] if n in argv else default
    names = sorted(f for f in os.listdir(composed_dir) if f.startswith("element-") and f.endswith(".png"))
    lo, hi = (int(v) for v in opt("--frames", "0-9999").split("-"))
    jobs = []
    for f in names:
        frame = int(f[8:-4])
        if not lo <= frame <= hi: continue
        w = os.path.join(whole_dir, f)
        if not os.path.exists(w): print(f"no whole frame for {f} in {whole_dir}", file=sys.stderr); return 2
        jobs.append((os.path.join(composed_dir, f), w, frame))
    if not jobs: print("no frames to compare", file=sys.stderr); return 2
    with ProcessPoolExecutor(max_workers=int(opt("--workers", "8"))) as ex: rows = list(ex.map(one, jobs, chunksize=4))
    allowance = int(SHARE * 1280 * 720)
    over = [r for r in rows if r[1] < 0 or r[1] > allowance]
    if "--out" in argv:
        with open(opt("--out", ""), "w") as f: json.dump(rows, f)
    print(f"{len(rows)} frames compared against {whole_dir}; allowance {allowance} pixels beyond {LEVELS} levels; {len(over)} frame(s) beyond it")
    for r in over: print(f"  frame {r[0]}: {r[1]} pixels beyond, MAD {r[2]}, largest {r[3]}")
    if rows: print(f"worst: frame {max(rows, key=lambda r: r[1])[0]} with {max(r[1] for r in rows)} pixels beyond; mean MAD {np.mean([r[2] for r in rows]):.4f}")
    return 1 if over else 0


if __name__ == "__main__": sys.exit(main(sys.argv))
