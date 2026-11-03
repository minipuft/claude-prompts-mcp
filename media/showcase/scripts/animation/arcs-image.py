#!/usr/bin/env python3
"""The paths of the lead wrist, the head and the root over each move of a shot, before and after a pose-chart change, as one image and one table.

usage: arcs-image.py <before-joints.json> <after-joints.json> --poses v3/poses/<shot>.json --out out/<shot>-arcs.png [--moves rest-on-lid>grip,lift>awe] [--json out/<shot>-arcs.json]
Joints files come from `npm run joints -- <shot>` (scripts/animation/joints.mjs). A path is what probe-inbetweens.py measures: the pose before the move, then one position per
drawing up to the landing; the lead wrist, the head and the root are the joints its arcs check reads, and a joint on a move shorter than 0.08 of the height is left out.
Image: one panel per move, key-sheet pixels with y down; pale dashed = before, solid = after, dots are drawings, the first drawing of the after path is ringed. Each panel's footer
reads the after path with probe_common.arc_faults (a one sign, b monotone, c turn at most 90 degrees, d reach). The table on stdout is the same numbers per move for the lead joint:
drawings, largest deviation, sign changes of the interior deviations (an arc has none), the back-steps over the bar split into declared (into an anticipation, out of an overshoot) and undeclared, the kinds of the drawings in order, and the faults.
Exit 0 written, 2 input error.
"""
import argparse, importlib.util, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from PIL import Image, ImageDraw, ImageFont

_spec = importlib.util.spec_from_file_location("probe_inbetweens", os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe-inbetweens.py"))
pib = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(pib)

COLOURS = {"lead": (200, 38, 44), "head": (31, 119, 180), "root": (44, 130, 50)}
BG, INK, FRAME = (249, 247, 242), (30, 30, 30), (190, 190, 186)


def font(size, bold=False):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else ""), "/usr/share/fonts/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else "")):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def move_paths(sheet, rows):
    """{move name: {role: (joint, [(frame|None, [x, y])])}} for every move of the sheet whose joint chord is at least 0.08 of the height."""
    H, out = sheet["heightPx"], {}
    for mv in pib.moves_of(sheet):
        pose0, ds, landing = pib.drawings_in(rows, mv)
        if not landing: continue
        lw = pib.lead_wrist(mv, pose0, ds, landing); name = f'{mv["from"]}>{mv["to"]}'; out[name] = {"mv": mv}
        settled = rows.get(mv["tailEnd"]) or ds[-1][1]; near = max(pib.ARC_ZERO_PX, pib.ARC_BACK_FRAC * H)
        for role, joint in (("lead", lw), ("head", "head"), ("root", "root")):
            p = pib.path_of(pose0, ds, joint, pib.arrival_count(ds, joint, landing, settled, near))     # as the probe reads it: a part that trails is followed to where it settles
            if float(np.hypot(*(np.array(p[-1]) - np.array(p[0])))) < pib.CHORD_MIN_H * H: continue
            out[name][role] = (joint, [(None if i == 0 else ds[i - 1][0], q) for i, q in enumerate(p)])
    return out


def stats(path, need, kinds=None, height_px=None):
    pts = np.array([q for _, q in path], float); c = pts[-1] - pts[0]; n = float(np.hypot(*c)); rel = pts - pts[0]
    dev = (c[0] * rel[:, 1] - c[1] * rel[:, 0]) / n; proj = rel @ (c / n)
    signs = [1 if d > 0 else -1 for d in dev[1:-1] if abs(d) >= ARC_ZERO_PX]
    bar = max(ARC_ZERO_PX, ARC_BACK_FRAC * (height_px or 0.0))
    backs = [i for i in range(1, len(pts)) if proj[i] - proj[i - 1] < -bar]
    declared = [i for i in backs if kinds and (kinds[i] == "anticipation" or kinds[i - 1] == "overshoot")]
    return {"drawings": len(pts) - 1, "maxDeviationPx": round(arc_deviation(pts), 1), "signChanges": sum(1 for a, b in zip(signs, signs[1:]) if a != b),
            "backSteps": {"declared": len(declared), "undeclared": len(backs) - len(declared)}, "barPx": round(bar, 1),
            "kinds": [k or "-" for k in (kinds or [])[1:]],
            "chordMonotone": len(backs) == 0, "faults": "".join(sorted({f[0] for f in arc_faults(pts, [f for f, _ in path], need, kinds, height_px)}))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("before"); ap.add_argument("after"); ap.add_argument("--poses", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--moves", default=None, help="comma list of 'from>to'; default every move"); ap.add_argument("--json", default=None)
    a = ap.parse_args()
    sheet = read_json(a.poses, "pose sheet"); H = sheet["heightPx"]; need = max(pib.ARC_MIN_PX, pib.ARC_MIN_H * H)
    before = move_paths(sheet, pib.row_map(read_json(a.before, "joints file")["rows"])); after = move_paths(sheet, pib.row_map(read_json(a.after, "joints file")["rows"]))
    names = [n for n in (a.moves.split(",") if a.moves else list(after)) if n in after]
    if not names: die("no move to draw: " + (a.moves or "the sheet has none"))
    cols = min(4, len(names)); rowsn = (len(names) + cols - 1) // cols; PW, PH, M, HEAD = 420, 470, 12, 40
    img = Image.new("RGB", (cols * PW + M, rowsn * PH + HEAD + M), BG); d = ImageDraw.Draw(img)
    d.text((M, 10), "Joint paths per move, key-sheet pixels. Pale dashed = before, solid = after; dots are drawings, the first drawing is ringed.", fill=INK, font=font(13))
    table = {}
    for k, name in enumerate(names):
        ox, oy = M + (k % cols) * PW, HEAD + (k // cols) * PH; mv = after[name]["mv"]
        d.rectangle([ox, oy, ox + PW - M, oy + PH - M], outline=FRAME); d.text((ox + 8, oy + 6), f'{name} (frames {mv["start"]}-{mv["end"]})', fill=INK, font=font(13, True))
        roles = [r for r in ("lead", "head", "root") if r in after[name]]
        allp = [q for r in roles for _, q in after[name][r][1]] + [q for r in roles if r in before.get(name, {}) for _, q in before[name][r][1]]
        xs, ys = [q[0] for q in allp], [q[1] for q in allp]; x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        top, bottom, w, h = oy + 30, oy + PH - M - 70, PW - M - 28, PH - M - 100
        s = min(w / max(x1 - x0, 1), h / max(y1 - y0, 1)); px = lambda q: (ox + 14 + (q[0] - x0) * s, top + (q[1] - y0) * s)
        for role in roles:
            col = COLOURS[role]; pale = tuple(int(c * 0.35 + 255 * 0.65) for c in col)
            if role in before.get(name, {}):
                pts = [px(q) for _, q in before[name][role][1]]
                for p0, p1 in zip(pts, pts[1:]): dashed(d, p0, p1, pale)
                for p in pts: d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=pale)
            joint, path = after[name][role]; pts = [px(q) for _, q in path]
            d.line(pts, fill=col, width=2)
            for p in pts: d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=col)
            d.ellipse([pts[1][0] - 6, pts[1][1] - 6, pts[1][0] + 6, pts[1][1] + 6], outline=col)
            d.text((pts[-1][0] + 6, pts[-1][1] - 6), "lead wrist" if role == "lead" else role, fill=col, font=font(11, True))
            st = stats(path, need, pib.kinds_of(sheet, mv, [f for f, _ in path], joint), H); table.setdefault(name, {})[role] = {"joint": joint, **st}
            foot = f'{"lead wrist " + joint[-1] if role == "lead" else role}: {st["drawings"]} drawings, {st["maxDeviationPx"]:.0f} px off chord, ' + ("an arc" if not st["faults"] else f'fails {st["faults"]}') + (f', {st["backSteps"]["declared"]} declared back-step(s)' if st["backSteps"]["declared"] else "")
            d.text((ox + 8, oy + PH - M - 62 + 16 * roles.index(role)), foot, fill=col, font=font(11))
    img.save(a.out)
    for name in names:
        t = table[name]; lead = t.get("lead")
        if lead: print(f'{name}: lead {lead["joint"]}: {lead["drawings"]} drawings, max deviation {lead["maxDeviationPx"]} px, sign changes {lead["signChanges"]}, back-steps over {lead["barPx"]} px declared {lead["backSteps"]["declared"]} / undeclared {lead["backSteps"]["undeclared"]}, kinds {",".join(lead["kinds"])}' + (f', faults {lead["faults"]}' if lead["faults"] else ""))
        else: print(f"{name}: no lead joint over 0.08 H")
    if a.json: json.dump(table, open(a.json, "w"), indent=1)
    print(f"wrote {a.out}")


def dashed(d, p0, p1, col, on=7, off=5):
    L = float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
    if L < 1e-6: return
    u = ((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L); t = 0.0
    while t < L:
        e = min(t + on, L); d.line([(p0[0] + u[0] * t, p0[1] + u[1] * t), (p0[0] + u[0] * e, p0[1] + u[1] * e)], fill=col, width=2); t += on + off


if __name__ == "__main__": main()
