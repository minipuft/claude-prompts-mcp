#!/usr/bin/env python3
"""Cut row 1 of a key sheet (D72) into one crop per key and run scripts/cutout.py --field black on each (role quantization, soft alpha, contour).

usage: s01_keys_cut.py <sheet.png> <first-key-number> <count> <out-dir> [--json out.json]

Row 1 is everything above the long pale baseline; keys are assigned to the numerals under it (K1..) by the column midpoints between numerals, so two
figures whose hands nearly touch still split where the numerals say. Each crop is saved as <out-dir>/K<n>-crop.png (RGB, black field, with its
bounding box in the sheet recorded), cut by cutout.py into <out-dir>/K<n>/ and recomposed from the quantized parts as <out-dir>/K<n>.png (RGBA).
"""
import hashlib, json, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def baseline_row(a):
    """The first long pale line from the top below the first quarter: the shared baseline (the row-2 panel borders come after it)."""
    pale = (a.max(axis=2) > 120) & (a.max(axis=2) - a.min(axis=2) < 70)
    single = "--single" in sys.argv  # one figure per plate: a shorter baseline, nothing below the numeral
    for y in range(a.shape[0] // 4, a.shape[0] * 9 // 10 if single else a.shape[0] * 2 // 3):
        n = int(pale[y].sum())
        if single:
            d = np.diff(np.concatenate(([0], pale[y].astype(np.int8), [0]))); runs = np.where(d == -1)[0] - np.where(d == 1)[0]
            if runs.size and runs.max() > 0.25 * a.shape[1]: return y, int(runs.max())
        elif n > 0.6 * a.shape[1]: return y, n
    sys.exit("no baseline found")


def numerals(a, y0):
    """Cream numerals under the baseline: x centres of connected pale blobs in the band below it."""
    band = a[y0 + 8:y0 + 60]
    pale = band.max(axis=2) > 150
    lab, n = ndi.label(ndi.binary_dilation(pale, structure=np.ones((3, 25))))
    xs = []
    for i in range(1, n + 1):
        ys_, xs_ = np.where(lab == i)
        if len(xs_) > 120 and (xs_.max() - xs_.min()) < 140 and (ys_.max() - ys_.min()) > 10: xs.append(float((xs_.min() + xs_.max()) / 2))
    return sorted(xs)


def main():
    sheet, first, count, out_dir = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    os.makedirs(out_dir, exist_ok=True)
    img = Image.open(sheet).convert("RGB"); a = np.asarray(img)
    yb, w = baseline_row(a)
    xs = numerals(a, yb)
    if len(xs) != count: sys.exit(f"found {len(xs)} numerals under the baseline (row {yb}), expected {count}: {xs}")
    cuts = [0] + [(xs[i] + xs[i + 1]) / 2 for i in range(count - 1)] + [a.shape[1]]
    ink = a[:yb - 3].max(axis=2) > 40
    report = {"sheet": sheet, "sheetSha256": sha(sheet), "baselineRow": int(yb), "numeralX": xs, "keys": []}
    for i in range(count):
        n = first + i
        x0, x1 = int(cuts[i]), int(cuts[i + 1])
        sub = ink[:, x0:x1]
        ys, xs_ = np.where(sub)
        box = [x0 + int(xs_.min()) - 6, max(0, int(ys.min()) - 6), x0 + int(xs_.max()) + 7, int(yb) + 4]
        crop = img.crop(box)
        # black out anything from a neighbouring figure inside the crop
        arr = np.array(crop)
        arr[:, : max(0, x0 - box[0])] = 0
        arr[:, min(arr.shape[1], x1 - box[0]):] = 0
        crop = Image.fromarray(arr)
        cp = os.path.join(out_dir, f"K{n}-crop.png"); crop.save(cp)
        adir = os.path.join(out_dir, f"K{n}")
        subprocess.run([sys.executable, os.path.join(HERE, "cutout.py"), cp, adir, "--field", "black", "--min-area", "300",
                        "--roles", "main1=#2f45a8,main2=#b983c0,shadow=#1d1d36,light=#e7e4da,accent=#d28a21", "--pin", "skin=#67b479,skinShadow=#c885c2"],
                       check=True, capture_output=True)
        man = json.load(open(os.path.join(adir, "parts.json")))
        plate = Image.new("RGBA", crop.size, (0, 0, 0, 0))
        for p in man["parts"]:
            part = Image.open(os.path.join(adir, p["png"])).convert("RGBA")
            plate.alpha_composite(part, (p["bbox"][0], p["bbox"][1]))
        pp = os.path.join(out_dir, f"K{n}.png"); plate.save(pp)
        report["keys"].append({"key": f"K{n}", "cropBoxInSheet": box, "cropPx": list(crop.size), "crop": cp, "cropSha256": sha(cp), "plate": pp, "plateSha256": sha(pp), "parts": len(man["parts"]),
                               "figureHeightPx": int(yb) + 4 - box[1], "baselineInCrop": int(yb) - box[1]})
        print(f"K{n}: crop {crop.size} box {box} parts {len(man['parts'])}", flush=True)
    if "--json" in sys.argv:
        json.dump(report, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
