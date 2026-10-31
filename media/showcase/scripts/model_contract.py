#!/usr/bin/env python3
"""Write assets/<character>/model.json (the D72 identity contract) from a model_measure.py report.

    model_contract.py --character human --sheet out/human-model-01.png --measure /tmp/m.json \
        --views "1:front,2:three-quarter,3:side" --receipt evidence/call-XB3Fat --plate v3/studies/human-gen-16-swoop.png \
        [--expressions neutral,blink,open-mouth,look] [--hands open,point,grip,hold] [--limb "arm=0.42,leg=0.55"]

The views argument maps row-1 cell numbers (left to right) to view names. Copies the sheet into
assets/<c>/model-<NN>.png and public/assets/<c>/ so the ModelSheet composition can show it.
Exit 2 on a missing input; never invents a measurement.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--character", required=True)
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--measure", required=True)
    ap.add_argument("--views", required=True)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--plate", required=True)
    ap.add_argument("--row", type=int, default=0, help="which measured row is the turnaround")
    ap.add_argument("--expressions", default="neutral,blink,open-mouth,look")
    ap.add_argument("--hands", default="open,point,grip,hold")
    ap.add_argument("--limb", default="", help="limb ratios as name=ratio, applied to every view (measured by hand on the plate)")
    ap.add_argument("--tapered", action="store_true")
    ap.add_argument("--closed", action="store_true")
    a = ap.parse_args()
    for p in (a.sheet, a.measure, a.plate):
        if not Path(p).exists():
            print(f"missing: {p}", file=sys.stderr)
            return 2
    m = json.loads(Path(a.measure).read_text())
    if a.row >= len(m["rows"]):
        print(f"row {a.row} not in measurement ({len(m['rows'])} rows)", file=sys.stderr)
        return 2
    row = m["rows"][a.row]
    names = dict(kv.split(":") for kv in a.views.split(","))
    limb = {k: float(v) for k, v in (kv.split("=") for kv in a.limb.split(",") if kv)}
    views = []
    for n, cell in enumerate(row["cells"], 1):
        x, y, w, h, head, heads = cell
        views.append({"cell": n, "view": names.get(str(n), f"cell {n}"), "heightPx": h, "headPx": head, "limbRatios": limb})
    heights = [v["heightPx"] for v in views]
    ruler = next((r.get("ruler") for r in m["rows"] if r.get("ruler")), None)
    heads = [ruler["heads"]] if ruler and ruler.get("heads") else [v["heightPx"] / v["headPx"] for v in views if v["headPx"]]
    asset_dir = Path("assets") / a.character
    asset_dir.mkdir(parents=True, exist_ok=True)
    nn = 1 + len(list(asset_dir.glob("model-*.png")))
    dst = asset_dir / f"model-{nn:02d}.png"
    shutil.copyfile(a.sheet, dst)
    pub = Path("public") / dst
    pub.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(a.sheet, pub)
    target = m["contour_target_px"]
    contract = {
        "character": a.character,
        "sheet": str(dst),
        "sheetSha256": hashlib.sha256(Path(a.sheet).read_bytes()).hexdigest(),
        "plate": a.plate,
        "plateSha256": hashlib.sha256(Path(a.plate).read_bytes()).hexdigest(),
        "figureHeightPx": int(max(heights)) if heights else 0,
        "heads": round(sum(heads) / len(heads), 2) if heads else 0,
        "views": views,
        "scaleAgreementPct": row["scale_drift_pct"],
        "contour": {"measuredPx": m["contour_px"], "targetPx": target, "tolerancePct": 20, "tapered": a.tapered, "closed": a.closed},
        "expressions": a.expressions.split(","),
        "hands": a.hands.split(","),
        "receipt": a.receipt,
        "measuredWith": "scripts/model_measure.py: heads from the sheet's own proportion ruler when present (circle crossings on its centre column), else height / top-12%-width proxy; contour = 2 x median half-width of thin pale pixels (proxy)",
        "provisional": True,
    }
    out = asset_dir / "model.json"
    out.write_text(json.dumps(contract, indent=2) + "\n")
    print(f"wrote {out} and {dst}; views {[v['view'] for v in views]}, drift {row['scale_drift_pct']} %, contour {m['contour_px']} vs {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
