#!/usr/bin/env python3
"""In-betweens (pose pass): the drawings between two holds are arcs that ease, secondaries arrive late, holds drift, and the picture shows it.

usage: probe-inbetweens.py <figure-frames-dir> --joints out/<shot>-joints.json --poses v3/poses/<shot>.json [--xsheet v3/xsheet.json] [--crop x,y,w,h] [--json out]
       probe-inbetweens.py --all v3/poses --frames-root out --joints-root out [--json out]
Reads the joints dump of the shot (scripts/animation/joints.mjs: one row per frame, the joints the renderer drew, quantised on twos), the pose sheet
(v3/poses/<shot>.json: keys with hold and lead, secondaries, moving holds) and the figure-only frames (`element-NNN.png`, camera inverted from the rows'
`camera`, else the xsheet's). A MOVE is the span from the end of one key's hold to the next key's frame; its drawings are the distinct poses in it, and
the path of a joint is the pose before the move followed by one position per drawing. Measured per move (H = the pose sheet's heightPx):
  arcs     the lead wrist (the wrist of the destination key's lead arm, else the one that travels further), the head and the root each run an ARC on a move whose chord is
           at least 0.08 H: over the pose before the move and one position per drawing, (a) the signed perpendicular deviation from the chord has one sign on every interior
           drawing (under 1 px is zero), (b) the projection onto the chord never goes back by more than max(1 px, 0.005 H) (4.4 px at 880) except into a declared anticipation and out of a declared overshoot, (c) the turn between consecutive
           segments never exceeds 90 degrees except at the vertex of those declared reversals, (d) the largest deviation is at least max(4 px, 0.02 H). A straight path is the Flash tell; a zigzag with the right off-chord distance is its cousin.
  spacing  on a move of at least 4 drawings, the lead wrist's per-drawing distances ease: the first and the last are each smaller than the largest in the
           middle. All distances within 15 percent of each other is "even spacing".
  (a secondary that names the `side` the move leads with does not lag on it: its joints are the body's there, for the arcs, the overlap and the kinds)
  overlap  each secondary's joints come within 10 percent of their end pose (of their travel) at least 2 x `lagDrawings` frames after the joints that belong to
           no secondary do (frames: poseChartFrom delays the part that many, whatever length the move's own drawings have). Drawings are followed up to 8 frames into the next hold, because a part that trails arrives after the key; the end pose is the one at the end of that tail.
  moving holds  over a declared moving hold the ink centroid of the figure crop drifts: a net shift of at least 0.5 stage px, no step of 2 frames larger than driftPx x
           (stage px per key px) + 0.5 px. The hold runs from the key's frame + 2 x the largest lagDrawings of any secondary (until then a secondary is still landing: overlap,
           not a hold) to the first drawing of the move that leaves the key, or to the end of the drift (`over` frames), whichever comes first: once the figure has stopped drifting there is nothing left to measure, and a camera that zooms through the hold only adds inversion noise. Net shift, not change: redrawn contours (boil) change pixels and sum to nothing.
           Stage px per key px: --stage-per-key, else the pose sheet's layout `staging.human.standingHeightPx` over heightPx.
  pixel ease  the figure crop's changed pixels at each drawing of a move follow the same ease: first and last smaller than the largest in the middle
           (applied to the moves the spacing check applies to). This is what the viewer sees.
--all PHASE: for every v3/poses/<shot>.json expects <frames-root>/<shot>-figure-seq/ and <joints-root>/<shot>-joints.json, prints one line per shot,
SKIPS (and says so) a shot whose frames or joints are missing, and fails (exit 1) when no shot had frames to measure.
Control first: a zigzag path with the same off-chord distance as a bow is refused on (a) only, a path that doubles back on (b), a hairpin on (c) only, a smooth one-sided bow passes;
a joints file built by pure linear lerp (straight chord, even spacing) is refused on arcs and spacing; the same with an arc offset and eased favours is accepted on every check;
a secondary snapped to the primary's frame is refused on overlap; a declared moving hold that does not move is refused.
Exit 0 pass, 1 fail naming the move and joint, 2 input error or a control that did not trip.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

ARC_MIN_PX, ARC_MIN_H, CHORD_MIN_H = 4.0, 0.02, 0.08
EVEN_RATIO = 1.15
ARRIVE = 0.10
SECONDARY_MIN_H = 0.04
TAIL_FRAMES = 8
HOLD_NET_STAGE_PX, HOLD_STEP_SLACK = 0.5, 0.5


def row_map(rows):
    return {r["frame"]: r["joints"] for r in rows}


def differs(a, b):
    return any(abs(a[k][0] - b[k][0]) > 1e-6 or abs(a[k][1] - b[k][1]) > 1e-6 for k in a)


def moves_of(sheet):
    keys = sorted(sheet["keys"], key=lambda k: k["frame"]); out = []
    for a, b in zip(keys, keys[1:]):
        start = a["frame"] + (a.get("hold") or 0)
        if start < b["frame"]:
            out.append({"from": a["name"], "to": b["name"], "start": start, "end": b["frame"], "tailEnd": min(b["frame"] + TAIL_FRAMES, b["frame"] + (b.get("hold") or TAIL_FRAMES)),
                        "lead": (b.get("lead") or {}).get("arm", "none")})
    return out


def first_drawing_after(sheet, key):
    """Frame of the first drawing of the move that leaves `key`: its first breakdown, else the next key's frame, else the key's own frame (firstDrawingAfter in pose.ts)."""
    own = [b["frame"] for b in sheet.get("breakdowns", []) if b["between"][0] == key["name"]]
    later = [k["frame"] for k in sheet["keys"] if k["frame"] > key["frame"]]
    return min(own + ([min(later)] if later else [key["frame"]]))


def drawings_in(rows, move):
    """(pose before the move, [(frame, pose)] for each distinct drawing from the move's start to its tail end, index of the landing drawing)."""
    pose0 = rows.get(move["start"] - 1) or rows.get(move["start"]); last, out, landing = pose0, [], 0
    for f in range(move["start"], move["tailEnd"] + 1):
        j = rows.get(f)
        if j is not None and differs(j, last):
            out.append((f, j)); last = j
            if f <= move["end"]: landing = len(out)
    return pose0, out, landing


def active_secondaries(sheet, move):
    """The secondaries that lag on `move`: all but those whose `side` is the side the move leads with (they move with the body there; activeSecondaries in pose.ts)."""
    return [c for c in sheet.get("secondaries", []) if not (c.get("side") and c["side"] == move["lead"])]


def kinds_of(sheet, move, frames_of, joint=None):
    """The declared kind of the drawing each path point shows: the kind of the last breakdown of this move on or before the frame the point's joint is showing, None for the pose before the move and
    for the key itself and what follows it. A part that trails (a joint of a secondary) shows the pose of 2 x `lagDrawings` frames earlier, so at the key's frame it may still show the overshoot."""
    marks = sorted((b["frame"], b["kind"]) for b in sheet.get("breakdowns", []) if b["between"] == [move["from"], move["to"]])
    lag = max([2 * c["lagDrawings"] for c in active_secondaries(sheet, move) if joint in c["joints"]], default=0)
    return [None if f is None or f - lag >= move["end"] else next((k for fr, k in reversed(marks) if fr <= f - lag), None) for f in frames_of]


def arrival_count(ds, joint, landing, settled, near):
    """How many drawings the path of `joint` runs over: the drawings up to the key's frame, and on to the first one within `near` px of where the joint settles (`settled`: the pose at the
    end of the tail) when the key's frame still shows it short of that. A part that trails reaches the key pose after the key's frame, so the chord of its path ends there, not on the
    lagged drawing the key's frame shows; a joint already within `near` at the key's frame (the body, whose moving hold has drifted a little by the end of the tail) keeps its landing."""
    if landing and float(np.hypot(*(np.array(ds[landing - 1][1][joint]) - np.array(settled[joint])))) <= near: return landing
    return next((i for i in range(landing + 1, len(ds) + 1) if float(np.hypot(*(np.array(ds[i - 1][1][joint]) - np.array(settled[joint])))) <= near), landing)


def path_of(pose0, ds, joint, count=None):
    return [pose0[joint]] + [d[1][joint] for d in (ds if count is None else ds[:count])]


def lead_wrist(move, pose0, ds, landing):
    if move["lead"] in ("L", "R"): return "wrist" + move["lead"]
    reach = {s: float(np.hypot(*(np.array(ds[landing - 1][1]["wrist" + s]) - np.array(pose0["wrist" + s])))) for s in "LR"} if landing else {"L": 0, "R": 0}
    return "wristL" if reach["L"] >= reach["R"] else "wristR"


def arrival(paths, ends, start, ds_count, threshold):
    """First drawing (1-based) by which every joint in `paths` is within ARRIVE of its travel from its end pose; None when it never is."""
    for i in range(1, ds_count + 1):
        if all(float(np.hypot(*(np.array(p[i]) - np.array(e)))) <= ARRIVE * c for p, e, c in zip(paths, ends, threshold)): return i
    return None


def ink_centroid(crop):
    c = crop.astype(np.float32); bg = np.median(c.reshape(-1, 3), axis=0)
    w = np.abs(c - bg).sum(axis=2); tot = float(w.sum())
    if tot <= 0: return None
    yy, xx = np.mgrid[0:w.shape[0], 0:w.shape[1]]
    return float((w * xx).sum() / tot), float((w * yy).sum() / tot)


def analyse(sheet, rows, frames, xs, stage_per_key, crop_arg=None, thresh=24, min_px=4, only_moves=None):
    """{category: [(item, ok, text)]} for one shot. `rows`: frame -> joints; `frames`: frame -> path or array (None: the frame checks are not run)."""
    H = sheet["heightPx"]; moves = moves_of(sheet); res = {"arcs": [], "spacing": [], "overlap": [], "moving holds": [], "pixel ease": []}
    onsets, needed = {}, set()
    for mv in moves:
        pose0, ds, landing = drawings_in(rows, mv)
        name = f'{mv["from"]} -> {mv["to"]} (frames {mv["start"]}-{mv["end"]})'
        if not landing: res["arcs"].append((name, True, "no drawing between the holds (a cut)")); continue
        lw = lead_wrist(mv, pose0, ds, landing); applicable = False
        act = active_secondaries(sheet, mv); in_secondary = {j for c in act for j in c["joints"]}
        settled = rows.get(mv["tailEnd"]) or ds[-1][1]; near = max(ARC_ZERO_PX, ARC_BACK_FRAC * H)
        for joint in (lw, "head", "root"):
            n = arrival_count(ds, joint, landing, settled, near)
            p = path_of(pose0, ds, joint, n); chord = float(np.hypot(*(np.array(p[-1]) - np.array(p[0])))); need = max(ARC_MIN_PX, ARC_MIN_H * H)
            if chord < CHORD_MIN_H * H: res["arcs"].append((f"{name} {joint}", True, f"short move ({chord:.0f} px < {CHORD_MIN_H * H:.0f}): a straight path is allowed")); continue
            frames_of = [None] + [d[0] for d in ds[:n]]
            faults = arc_faults(p, frames_of, need, kinds_of(sheet, mv, frames_of, joint), H)
            letters = "".join(sorted({f[0] for f in faults}))
            where = f"{joint} in the move {mv['from']} -> {mv['to']} (frames {mv['start']}-{mv['end']}, {n} drawings)"
            res["arcs"].append((f"{name} {joint}", not faults, f"{where} runs an arc: it bows one way off its {chord:.0f} px chord by {arc_deviation(p):.1f} px, needs {need:.1f}, and goes forward without a hairpin"
                                if not faults else f"{where} is not an arc, failing {letters}: " + "; ".join(f"[{k}] {t}" for k, t in faults)))
            if joint == lw and n >= 4: applicable = True
        p = path_of(pose0, ds, lw, arrival_count(ds, lw, landing, settled, near)); chord = float(np.hypot(*(np.array(p[-1]) - np.array(p[0]))))
        if applicable and chord >= CHORD_MIN_H * H:
            g = spacing_profile(p); mid = g[1:-1]; even = min(g) > 0 and max(g) / min(g) <= EVEN_RATIO
            eased = g[0] < max(mid) and g[-1] < max(mid)
            why = "even spacing" if even else ("it does not ease in and out" if not eased else "eases in and out")
            res["spacing"].append((f"{name} {lw}", eased and not even, f"{lw} in the move {mv['from']} -> {mv['to']} (frames {mv['start']}-{mv['end']}): gaps {[round(x, 1) for x in g]} px: {why}"))
            onsets[name] = [d[0] for d in ds[:landing]]; needed.update(onsets[name]); needed.update(f - 1 for f in onsets[name])
        elif landing >= 4: res["spacing"].append((f"{name} {lw}", True, f"{lw} travels {chord:.0f} px, under {CHORD_MIN_H * H:.0f}: spacing not measured"))
        # overlap
        total = len(ds)
        for c in act:
            settled = rows.get(mv["tailEnd"]) or ds[-1][1]          # the key's pose once its trailing parts have arrived
            sj = [j for j in c["joints"] if j in pose0]; ends = [settled[j] for j in sj]
            trav = [float(np.hypot(*(np.array(e) - np.array(pose0[j])))) for j, e in zip(sj, ends)]
            keep = [i for i, t in enumerate(trav) if t >= SECONDARY_MIN_H * H]
            pj = [j for j in pose0 if j not in in_secondary and float(np.hypot(*(np.array(settled[j]) - np.array(pose0[j])))) >= SECONDARY_MIN_H * H]
            if not keep or not pj: continue
            sa = arrival([path_of(pose0, ds, sj[i]) for i in keep], [ends[i] for i in keep], mv["start"], total, [trav[i] for i in keep])
            pends = [settled[j] for j in pj]
            pa = arrival([path_of(pose0, ds, j) for j in pj], pends, mv["start"], total, [float(np.hypot(*(np.array(e) - np.array(pose0[j]))))for j, e in zip(pj, pends)])
            lag = 2 * c["lagDrawings"]                  # frames: lagDrawings is a count of drawings on twos (poseChartFrom delays the part lagDrawings x 2 frames), whatever the move's own drawings last
            fa, fs = (ds[pa - 1][0] if pa else None), (ds[sa - 1][0] if sa else None)
            ok = pa is not None and (sa is None or fs - fa >= lag)
            text = (f"secondary {c['name']} in the move {mv['from']} -> {mv['to']}: the body is within {int(ARRIVE * 100)}% of its end pose on frame {fa}, "
                    f"{c['name']} on frame {fs if fs is not None else 'never (within the tail)'}; it should trail by {lag} frames")
            res["overlap"].append((f"{name} {c['name']}", ok, text + ("" if ok else " (snapped to the body)" if sa == pa else " (too early)")))
    # frame checks
    if frames is not None:
        sub = {f: frames[f] for f in sorted(needed) if f in frames}
        series = change_series(sub, xs, crop_arg, thresh) if sub else {}
        for name, fs in onsets.items():
            mags = [series[f][0] if f in series else None for f in fs]
            if None in mags or len(mags) < 4: res["pixel ease"].append((name, True, "frames missing for this move: not measured")); continue
            mid = mags[1:-1]; ok = mags[0] < max(mid) and mags[-1] < max(mid)
            res["pixel ease"].append((name, ok, f"move {name}: changed pixels per drawing {mags}: {'small, large, small' if ok else 'no ease in the picture'}"))
        first = next(iter(frames))
        img0 = load_rgb(frames[first]); box, s = crop_box_px(img0.shape, crop_arg)
        for h in sheet.get("movingHolds", []):
            key = next(k for k in sheet["keys"] if k["name"] == h["key"]); end = min(key["frame"] + h["over"], max(key["frame"] + (key.get("hold") or h["over"]), first_drawing_after(sheet, key)))
            begin = key["frame"] + 2 * max([c["lagDrawings"] for c in sheet.get("secondaries", [])], default=0)   # the last secondary has landed: until then the figure moves as overlap
            fs = [f for f in range(begin, end, 2) if f in frames]          # the hold's own drawings: the frame the next move starts on is not one
            if len(fs) < 3: res["moving holds"].append((h["key"], False, f'moving hold on "{h["key"]}": frames {begin}-{end - 1} are not in the sequence')); continue
            cs = []
            for f in fs:
                crop = world_crop(load_rgb(frames[f]), camera_of(xs, f), s, box); cs.append(ink_centroid(crop))
            if None in cs: res["moving holds"].append((h["key"], False, f'moving hold on "{h["key"]}": the figure crop is empty')); continue
            steps = [float(np.hypot(*(np.array(b) - np.array(a)))) / s for a, b in zip(cs, cs[1:])]; net = float(np.hypot(*(np.array(cs[-1]) - np.array(cs[0])))) / s
            cap = h["driftPx"] * stage_per_key + HOLD_STEP_SLACK
            ok = net >= HOLD_NET_STAGE_PX and max(steps) <= cap
            res["moving holds"].append((h["key"], ok, f'moving hold on "{h["key"]}" (frames {begin}-{end - 1}, after the secondaries land): net drift {net:.2f} stage px (needs {HOLD_NET_STAGE_PX}), largest step {max(steps):.2f} (cap {cap:.2f})'
                                        + ("" if net >= HOLD_NET_STAGE_PX else ": the hold does not move")))
    return res


def report(pr, res, shot=""):
    pre = f"{shot}: " if shot else ""
    for cat, items in res.items():
        if not items: pr.check(pre + cat, True, "nothing to measure"); continue
        bad = [i for i in items if not i[1]]
        if bad:
            for item, _, text in bad: pr.check(f"{pre}{cat} {item}", False, text)
        else: pr.check(pre + cat, True, f"{len(items)} item(s) measured, all ok")
    return sum(1 for items in res.values() for i in items if not i[1])


def failed_cats(res): return {c for c, items in res.items() if any(not i[1] for i in items)}


def stage_per_key_of(sheet, override):
    if override: return override
    try:
        lay = json.load(open(sheet["source"]["layout"]))
        return lay["staging"]["human"]["standingHeightPx"] / sheet["heightPx"]
    except (OSError, KeyError, ValueError, TypeError):
        return 0.4


def xs_from_rows(rows_full, xsheet_path):
    if xsheet_path: return load_xsheet(xsheet_path)
    return {r["frame"]: {"camera": r["camera"]} for r in rows_full if r.get("camera")} or None


# Paths of one joint over a move (key-sheet px, y down; the chord runs along +x, so a positive y is one side of it), each built to trip ONE letter of arc_faults.
ARC_CONTROLS = {
    "zigzag": [[0, 0], [30, 8], [60, -8], [90, 8], [120, 0]],           # max off-chord 8 px like the bow below, but alternating sides; it only goes forward and never turns past 56 degrees
    "double-back": [[0, 0], [40, 10], [70, 14], [50, 12], [100, 0]],    # one side, but it goes 20 px back along the chord
    "hairpin": [[0, 0], [50, 30], [52, 5], [100, 0]],                   # one side, forward, but it turns 116 degrees at the second drawing
    "bow": [[0, 0], [30, 6], [60, 8], [90, 6], [120, 0]],               # one side, forward, 8 px off the chord, turns 8 degrees at most
    "anticipation": [[0, 0], [-12, 5], [30, 9], [70, 10], [100, 6], [120, 0]],    # a drawing 12 px BEFORE the from-pose, then forward: a reversal the move declares
    "anticipation-undeclared": [[0, 0], [-12, 5], [30, 9], [70, 10], [100, 6], [120, 0]],    # the same path with the drawing declared a passing one
    "overshoot": [[0, 0], [35, 8], [80, 10], [135, 7], [114, 3], [120, 0]],       # 15 px past the key, then back to a settle: a reversal the move declares
    "overshoot-undeclared": [[0, 0], [35, 8], [80, 10], [135, 7], [114, 3], [120, 0]],       # the same path with no kinds
    "noise": [[0, 0], [30, 6], [60, 8], [57, 8], [90, 6], [120, 0]],    # a bow that steps back 3 px once: under the bar (0.5 percent of 880), so no reversal
}
ARC_KINDS = {"anticipation": [None, "anticipation", "passing", "passing", "settle", None], "anticipation-undeclared": [None, "passing", "passing", "passing", "settle", None],
             "overshoot": [None, "passing", "passing", "overshoot", "settle", None]}
ARC_CONTROL_H = 880.0


def arc_controls():
    """{name: letters it is refused on}, and whether that is what the contract says: the zigzag on a only, the double back on b, the hairpin on c only, the bow on nothing."""
    got = {k: "".join(sorted({f[0] for f in arc_faults(v, None, 4.0, ARC_KINDS.get(k), ARC_CONTROL_H)})) for k, v in ARC_CONTROLS.items()}
    ok = (got["zigzag"] == "a" and "b" in got["double-back"] and got["hairpin"] == "c" and got["bow"] == ""
          and got["anticipation-undeclared"] == "bc" and got["anticipation"] == "" and got["overshoot-undeclared"] == "bc" and got["overshoot"] == "" and got["noise"] == "")
    return got, ok


def control(pr, a):
    out = {}
    for kind in ("linear", "eased", "snapped", "static"):
        sheet, rows, frames, spk = make.inbetween_case(kind)
        out[kind] = analyse(sheet, row_map(rows), dict(enumerate(frames)), None, spk, None, a.pixel_threshold, a.min_pixels)
    shape, shape_ok = arc_controls()
    ok = (shape_ok and {"arcs", "spacing"} <= failed_cats(out["linear"]) and not failed_cats(out["eased"]) and failed_cats(out["snapped"]) == {"overlap"} and failed_cats(out["static"]) == {"moving holds"})
    pr.control(ok, f"zigzag path with the same 8 px off-chord distance as the bow -> refused on [{shape['zigzag']}] (one sign); path that doubles back -> refused on [{shape['double-back']}] (monotone); "
                   f"hairpin -> refused on [{shape['hairpin']}] (turn at most {ARC_MAX_TURN_DEG:.0f} degrees); one-sided bow -> refused on [{shape['bow'] or 'none'}]; "
                   f"a reversal into an undeclared anticipation -> refused on [{shape['anticipation-undeclared']}], the same declared -> refused on [{shape['anticipation'] or 'none'}]; "
                   f"a return from an undeclared overshoot -> refused on [{shape['overshoot-undeclared']}], declared -> [{shape['overshoot'] or 'none'}]; a 3 px step back at {ARC_CONTROL_H:.0f} px -> [{shape['noise'] or 'none'}] (bar {max(ARC_ZERO_PX, ARC_BACK_FRAC * ARC_CONTROL_H):.1f} px); "
                   f"linear lerp -> FAIL on {sorted(failed_cats(out['linear']))}; arc offset with eased favours -> pass on all {len(out['eased'])} checks "
                   f"({sum(len(v) for v in out['eased'].values())} items); secondary snapped to the primary -> FAIL on {sorted(failed_cats(out['snapped']))}; "
                   f"declared moving hold that does not move -> FAIL on {sorted(failed_cats(out['static']))}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames", nargs="?", help="directory of element-NNN.png of the figure-only render")
    ap.add_argument("--joints"); ap.add_argument("--poses"); ap.add_argument("--xsheet", default=None); ap.add_argument("--crop", default=None)
    ap.add_argument("--all", default=None, metavar="POSES_DIR"); ap.add_argument("--frames-root", default="out"); ap.add_argument("--joints-root", default="out")
    ap.add_argument("--stage-per-key", type=float, default=None); ap.add_argument("--json", default=None)
    ap.add_argument("--pixel-threshold", type=int, default=24); ap.add_argument("--min-pixels", type=int, default=4)
    a = ap.parse_args()
    pr = Probe("inbetweens", a.json)
    control(pr, a)
    shots = []
    if a.all:
        if not os.path.isdir(a.all): die(f"poses directory {a.all} does not exist")
        for fn in sorted(os.listdir(a.all)):
            if not fn.endswith(".json"): continue
            shot = fn[:-5]; fd, jf = os.path.join(a.frames_root, f"{shot}-figure-seq"), os.path.join(a.joints_root, f"{shot}-joints.json")
            missing = [p for p in (fd, jf) if not os.path.exists(p)]
            if missing: print(f"SKIP {shot}: {', '.join(missing)} missing", flush=True); pr.extra.setdefault("skipped", []).append(shot); continue
            shots.append((shot, os.path.join(a.all, fn), fd, jf))
        if not shots:
            pr.checks.append({"check": "shots", "ok": False, "text": "no shot had frames to measure"})
            print("  FAIL shots: no shot had frames to measure", flush=True); pr.finish("")
    else:
        if not (a.frames and a.joints and a.poses): die("give <frames-dir> --joints <file> --poses <file>, or --all <poses-dir>")
        shots.append((os.path.basename(a.poses)[:-5], a.poses, a.frames, a.joints))
    for shot, pp, fd, jf in shots:
        sheet, jd, frames = read_json(pp, "pose sheet"), read_json(jf, "joints file"), list_frames(fd)
        if "heightPx" not in sheet or "rows" not in jd: die(f"{pp} or {jf} is not a pose sheet / joints file")
        xs = xs_from_rows(jd["rows"], a.xsheet)
        res = analyse(sheet, row_map(jd["rows"]), frames, xs, stage_per_key_of(sheet, a.stage_per_key), a.crop, a.pixel_threshold, a.min_pixels)
        n = report(pr, res, shot if len(shots) > 1 else "")
        print(f"{shot} · {'FAIL' if n else 'pass'} · {len(moves_of(sheet))} moves, {sum(len(v) for v in res.values())} items measured, {n} failed", flush=True)
        pr.extra.setdefault("shots", {})[shot] = {c: [{"item": i, "ok": bool(ok), "text": t} for i, ok, t in v] for c, v in res.items()}
    pr.finish(f"{len(shots)} shot(s): arcs, spacing, overlap, moving holds and pixel ease measured")


if __name__ == "__main__": main()
