#!/usr/bin/env python3
"""Poses (contract only, no frames): every key says what it draws, and the key sheet's joints draw it.

usage: probe-poses.py v3/poses v3/keys v3/charts [--shot <id>] [--joints keys|solved] [--json out]
--joints keys (default) measures the key sheet's joints. --joints solved measures line of action, twinning and weight on each pose key's `solved` joints (what `solvePose` draws for
the declared spec; `npm run solve-poses -- <shot>` writes them into the pose sheet); a pose sheet with a key that has no `solved` is refused (exit 2). The other categories
(keys, breakdowns, secondaries, holds, timing shape, lead arm) read the same files in both modes.
Directory mode: for every v3/charts/<shot>.json with a rig actor, v3/poses/<shot>.json and v3/keys/<shot>.json must exist (--shot limits it to one).
Per shot, each failing item is its own line naming the key or breakdown; a category with nothing wrong prints one ok line. H = the pose sheet's heightPx.
  keys           every chart key has a pose entry with the same name and frame (and the key sheet has it on that frame); every pose key has a `moment`.
  line of action the key sheet's joints, measured by the spine fit (probe_common.spine_curve, the formula of spineCurve in src/library/animation/pose.ts),
                 read as the declared class. Measured bow at least 0.06 unless the key declares class I and its moment says why (words: because, so that,
                 deliberate, stiff, rigid, frozen, locked).
  twinning       twinning score at most 0.7 unless the key carries twinned.why.
  weight         a weight foot is declared, and the root's x sits between the ankles, within 25 percent of the stance width of where `over` puts it
                 (the other ankle + over x the stance toward the weight foot; the midpoint for `both`). Feet closer than 0.05 H are not measured.
  breakdowns     every pair of consecutive keys has a breakdown with arc.offsetPx not 0 or an authored `joints` pose, unless no joint travels 0.08 H between the
                 keys: that short straight move is allowed, and said so.
  secondaries    each declared secondary has lagDrawings 1-3 and joints the key sheet has.
  holds          every key whose hold is over 11 frames has a movingHold or declares `face` (a face change is a moving hold).
  lead arm       one line per move with a lead arm: the shoulder, elbow and wrist of the to-key's lead arm belong to no secondary that lags on that move. A secondary names the `side` it is
                 (`L` or `R`) and then moves with the body on the moves that side leads; one that holds those joints without that side is refused (`parsePoseSheet` refuses it too).
  timing shape   one line per move, from the key's hold end to the next key (the breakdowns the chart plays there: authored, else the two automatic thirds, as `marksIn`): 3-6
                 drawings (C28); at most one `anticipation` (a drawing before the from-key along the chord, -0.15 to -0.05; the sheet stores its favour positive and the drawing sits
                 at -0.25 x favour, so favour 0.2-0.6), at most one `overshoot` (1.05-1.15, favour 0.2-0.6 the same way) and at most one `settle` (0.9 or more); `passing` drawings
                 at 0.25-0.75 and rising; by frame anticipation < passing < overshoot < settle; no breakdown inside the hold; no two drawings on one frame. `parsePoseSheet` refuses the same.
Control first (synthetic sheets, fixtures/make.py pose_fixture): a straight spine declared S is refused on line of action; mirrored limbs with no twinned.why are
refused on twinning; a long move whose only breakdown is a favour is refused on breakdowns; a 10-drawing move and a passing drawing at 0.10 are refused on timing shape;
a clean sheet (a move of anticipation, passing, overshoot, settle) is accepted on every check.
Exit 0 pass, 1 fail, 2 input error or a control that did not trip.
"""
import argparse, copy, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

WHY = re.compile(r"because|so that|deliberate|stiff|rigid|frozen|locked", re.I)
LONG_HOLD = 11
WEIGHT_SLACK = 0.25
SHORT_MOVE_H = 0.08
FEET_APART_H = 0.05
SOLVER_SLACK_PX = 0.05     # a key registered from the solver carries the solved joints to the hundredth of a pixel


def unsolved(poses):
    """Names of the pose keys that carry no `solved` joints."""
    return [k["name"] for k in poses["keys"] if not k.get("solved")]


def with_solved(poses, joints_by_key):
    """A copy of a pose sheet whose keys carry `solved` = the joints given for their name."""
    out = {**poses, "keys": [{**k, "solved": joints_by_key[k["name"]]} for k in poses["keys"]]}
    return out


def check_shot(poses, keys, chart, joints="keys"):
    """{category: [(item, ok, text)]} for one shot's pose sheet against its key sheet and chart. `joints` = "solved" measures line of action, twinning and weight on the pose keys' `solved` joints."""
    H = poses["heightPx"]; res = {c: [] for c in ("keys", "line of action", "twinning", "weight", "breakdowns", "secondaries", "holds", "timing shape", "lead arm")}
    kj = {k["name"]: k for k in keys["keys"]}
    rig = next((a for a in chart.get("actors", {}).values() if a.get("kind") == "rig"), {"keys": []})
    pk = {k["name"]: k for k in poses["keys"]}
    for ck in rig["keys"]:
        p = pk.get(ck["name"])
        if not p: res["keys"].append((ck["name"], False, f'chart key "{ck["name"]}" (frame {ck["frame"]}) has no pose entry'))
        elif p["frame"] != ck["frame"]: res["keys"].append((ck["name"], False, f'pose key "{ck["name"]}" is on frame {p["frame"]}, the chart has it on {ck["frame"]}'))
        elif ck["name"] in kj and kj[ck["name"]]["frame"] != ck["frame"]: res["keys"].append((ck["name"], False, f'key sheet has "{ck["name"]}" on frame {kj[ck["name"]]["frame"]}, the chart on {ck["frame"]}'))
        else: res["keys"].append((ck["name"], True, f'key "{ck["name"]}" is on the chart, the pose sheet and the key sheet at frame {ck["frame"]}'))
    for p in poses["keys"]:
        if not any(ck["name"] == p["name"] for ck in rig["keys"]): res["keys"].append((p["name"], False, f'pose key "{p["name"]}" is not a chart key'))
        if not str(p.get("moment", "")).strip(): res["keys"].append((p["name"], False, f'pose key "{p["name"]}" has no moment (the script moment it carries)'))
        if p["name"] not in kj: res["keys"].append((p["name"], False, f'pose key "{p["name"]}" is not on the key sheet'))
    for p in poses["keys"]:
        k = kj.get(p["name"])
        if k and k.get("status") == "needs-family":
            nf = k.get("needsFamily") or {}
            res["keys"].append((p["name"], False, f'key "{p["name"]}" needs plate family "{nf.get("family", p.get("plateFamily"))}" (silhouette {nf.get("silhouette", p.get("silhouette"))}): no family mesh holds its pose, so the key sheet has joints and no plate'))
        if k and k.get("source") == "solver" and p.get("solved"):
            off = max(float(np.hypot(*(np.array(k["joints"][n]) - np.array(p["solved"][n])))) for n in p["solved"])
            if off > SOLVER_SLACK_PX: res["keys"].append((p["name"], False, f'key "{p["name"]}" is registered from the solver but its joints are {off:.2f} px from the pose sheet\'s solved joints: run `npm run plates` again'))
    for p in poses["keys"]:
        k = kj.get(p["name"])
        if not k: continue
        j, name, loa = (p["solved"] if joints == "solved" else k["joints"]), p["name"], p["lineOfAction"]
        got = spine_curve(j, H)
        res["line of action"].append((name, bool(got["class"] == loa["class"]),
                                      f'key "{name}": declared line of action {loa["class"]}, the key sheet draws {got["class"]} (bow {got["bow"]:.3f} of the figure, sign {got["sign"]:+d}'
                                      f'{", crosses at %.2f" % got["inflection"] if "inflection" in got else ""})'))
        stiff = loa["class"] == "I" and bool(WHY.search(p.get("moment", "")))
        res["line of action"].append((name + "/bow", got["bow"] >= BOW_MIN or stiff,
                                      f'key "{name}": the spine bows {got["bow"]:.3f} of the figure, under {BOW_MIN}' + (" (declared straight, and the moment says why)" if stiff else " and the key does not declare a stiff line with a reason") if got["bow"] < BOW_MIN else f'key "{name}": bow {got["bow"]:.3f}'))
        sc = twinning_score(j); why = (p.get("twinned") or {}).get("why")
        res["twinning"].append((name, sc <= TWIN_MAX or bool(why), f'key "{name}": the limbs are twinned (score {sc:.2f}, over {TWIN_MAX}) and the key does not say why' if sc > TWIN_MAX and not why else f'key "{name}": twinning {sc:.2f}' + (" (twinned, says why)" if why else "")))
        w = p.get("weight") or {}; foot = w.get("foot")
        if foot not in ("L", "R", "both"): res["weight"].append((name, False, f'key "{name}": no weight foot declared')); continue
        xl, xr, rx = j["ankleL"][0], j["ankleR"][0], j["root"][0]; stance = abs(xr - xl)
        if stance < FEET_APART_H * H: res["weight"].append((name, True, f'key "{name}": feet {stance:.0f} px apart: weight bias not measured')); continue
        over = 0.5 if foot == "both" else w.get("over", 0.5)
        other, wt = (xl, xr) if foot == "R" else (xr, xl) if foot == "L" else (xl, xr)
        want = other + over * (wt - other); between = min(xl, xr) <= rx <= max(xl, xr); off = abs(rx - want) / stance
        res["weight"].append((name, between and off <= WEIGHT_SLACK, f'key "{name}": weight on {foot} at {over:.2f}: the root is at x {rx:.0f}, expected {want:.0f} between the ankles ({xl:.0f}, {xr:.0f}); '
                                                                      f'{"outside the ankles" if not between else f"{off * 100:.0f}% of the stance away, over 25%"}' if not (between and off <= WEIGHT_SLACK) else f'key "{name}": root over the {foot} foot'))
    order = sorted(poses["keys"], key=lambda k: k["frame"])
    for a, b in zip(order, order[1:]):
        ja, jb = kj[a["name"]]["joints"], kj[b["name"]]["joints"]
        travel = max(float(np.hypot(*(np.array(jb[n]) - np.array(ja[n])))) for n in ja)
        mine = [x for x in poses.get("breakdowns", []) if list(x["between"]) == [a["name"], b["name"]]]
        shaped = [x for x in mine if x.get("joints") or abs(x["arc"]["offsetPx"]) > 0]
        item = f'{a["name"]} -> {b["name"]}'
        if shaped: res["breakdowns"].append((item, True, f"{item}: {len(shaped)} breakdown(s) leave the chord"))
        elif travel < SHORT_MOVE_H * H: res["breakdowns"].append((item, True, f"{item}: no joint travels more than {travel:.0f} px (under {SHORT_MOVE_H * H:.0f}): a short straight move is allowed"))
        else:
            res["breakdowns"].append((item, False, f"{item}: the move travels {travel:.0f} px and its breakdowns "
                                                   + (f"({', '.join('frame %d' % x['frame'] for x in mine)}) have only a favour: no arc offset and no authored joints" if mine else "do not exist")))
    stale = {}
    for x in poses.get("breakdowns", []):
        if not (x.get("authored") or x.get("joints")): continue
        a, b = x["between"]; want = keys_hash(kj[a]["joints"], kj[b]["joints"]) if a in kj and b in kj else None
        if want and x.get("keysHash") != want: stale.setdefault((a, b), []).append((x["frame"], x.get("keysHash"), want))
    for (a, b), rows in stale.items():
        frames = ", ".join(str(r[0]) for r in rows); got = rows[0][1]
        res["breakdowns"].append((f"{a} -> {b}", False, f"{a} -> {b}: the authored breakdowns on frames {frames} were built on key joints that have moved ("
                                  + (f"their keysHash {got[:12]} is not the keys' {rows[0][2][:12]}" if got else f"they carry no keysHash, the keys' is {rows[0][2][:12]}") + "): author them again with author-breakdowns.mjs"))
    for c in poses.get("secondaries", []):
        bad = [x for x in c["joints"] if x not in next(iter(kj.values()))["joints"]]
        ok = 1 <= c.get("lagDrawings", 0) <= 3 and not bad
        res["secondaries"].append((c["name"], ok, f'secondary "{c["name"]}": lagDrawings {c.get("lagDrawings")}' + ("" if ok else f" (must be 1-3){'; unknown joints ' + str(bad) if bad else ''}")))
    held = {h["key"] for h in poses.get("movingHolds", [])}
    for p in poses["keys"]:
        hold = (kj.get(p["name"]) or {}).get("hold", p.get("hold")) or 0
        if hold > LONG_HOLD:
            ok = p["name"] in held or bool(p.get("face"))
            res["holds"].append((p["name"], ok, f'key "{p["name"]}" holds {hold} frames: ' + ("moves (a moving hold or a face)" if ok else "dead, the same drawing the whole time: no movingHold and no face change")))
    for a, b, start, marks in timing_moves(poses, {k["name"]: k.get("hold") for k in keys["keys"] if k.get("hold") is not None}):
        ok, line, _ = timing_shape(a, b, start, marks)
        res["timing shape"].append((f'{a["name"]} -> {b["name"]}', ok, line))
    bad_lead = lead_arm_faults(poses); lead_moves = [f'{a["name"]} -> {b["name"]}' for a, b, _, _ in timing_moves(poses) if (b.get("lead") or {}).get("arm") in ("L", "R")]
    for mv in lead_moves:
        t = [x[1] for x in bad_lead if x[0] == mv]
        res["lead arm"].append((mv, not t, t[0] if t else f"{mv}: the lead arm is no lagging secondary on this move"))
    return res


def failed(res): return {c for c, items in res.items() if any(not i[1] for i in items)}


def report(pr, shot, res):
    n = 0
    for cat, items in res.items():
        bad = [i for i in items if not i[1]]
        if cat in ("timing shape", "lead arm"):                                  # one line per move, ok or not
            for item, ok, text in items: pr.check(f"{shot}: {cat}", ok, text); n += not ok
            continue
        for item, _, text in bad: pr.check(f"{cat} {item}", False, text); n += 1
        if not bad: pr.check(f"{shot}: {cat}", True, f"{len(items)} item(s) ok" if items else "nothing to measure")
    return n


def solved_control():
    """(ok, text): the solved mode reads the `solved` joints and nothing else. Clean sheet with its own key joints as `solved` -> accepted; the straight-s sheet (declared S, straight) solved
    from its straight key joints -> refused on line of action only; the clean sheet (declared C, curved key sheet) with the straight joints as `solved` -> refused under `solved` and accepted under
    `keys`; a sheet with no `solved` -> listed as unsolved."""
    (clean, ckeys, cchart), (straight, skeys, schart) = make.pose_fixture("clean"), make.pose_fixture("straight-s")
    own = lambda kk: {k["name"]: k["joints"] for k in kk["keys"]}
    ok_sheet = with_solved(clean, own(ckeys)); bad_sheet = with_solved(straight, own(skeys))
    mixed = with_solved(clean, {"A": own(skeys)["A"], "B": own(ckeys)["B"]})
    a = check_shot(ok_sheet, ckeys, cchart, "solved"); b = check_shot(bad_sheet, skeys, schart, "solved")
    c_solved = check_shot(mixed, ckeys, cchart, "solved"); c_keys = check_shot(mixed, ckeys, cchart, "keys")
    ok = (not failed(a) and failed(b) == {"line of action"} and failed(c_solved) == {"line of action"} and not failed(c_keys)
          and unsolved(clean) == ["A", "B"] and not unsolved(ok_sheet))
    return ok, (f"[--joints solved] solved joints of a straight spine declared S -> FAIL ({sorted(failed(b))}); the same clean sheet with straight solved joints -> FAIL under solved ({sorted(failed(c_solved))}), "
                f"pass under keys; a sheet with no solved joints -> refused (unsolved {unsolved(clean)}); solved joints equal to the key sheet's -> pass on {len(a)} checks")


def family_control():
    """(ok, text): a key that needs a plate family is refused by name on `keys`, a breakdown authored on keys that have since moved (or on none) is refused on `breakdowns`, a solver key whose
    joints drifted from the solved ones is refused on `keys`, and the same sheets set right pass."""
    sheet, keys, chart = make.pose_fixture("clean")
    base = failed(check_shot(sheet, keys, chart))
    needs = copy.deepcopy(keys); needs["keys"][1].update({"status": "needs-family", "needsFamily": {"family": "burst", "silhouette": "star"}})
    r_needs = check_shot(sheet, needs, chart); bad_needs = [t for _, ok, t in r_needs["keys"] if not ok]
    authored = copy.deepcopy(sheet); x = authored["breakdowns"][1]; x["joints"] = {n: list(p) for n, p in keys["keys"][0]["joints"].items()}; x["authored"] = "world blend + arc"
    x["keysHash"] = keys_hash(keys["keys"][0]["joints"], keys["keys"][1]["joints"])
    fresh = failed(check_shot(authored, keys, chart))
    moved = copy.deepcopy(keys); moved["keys"][1]["joints"]["wristR"][0] += 25.0
    r_stale = check_shot(authored, moved, chart); bad_stale = [t for _, ok, t in r_stale["breakdowns"] if not ok]
    nohash = copy.deepcopy(authored); del nohash["breakdowns"][1]["keysHash"]; r_none = failed(check_shot(nohash, keys, chart))
    solver = copy.deepcopy(sheet); solver_keys = copy.deepcopy(keys)
    for p, k in zip(solver["keys"], solver_keys["keys"]): p["solved"] = copy.deepcopy(k["joints"]); k["source"] = "solver"
    solver_ok = failed(check_shot(solver, solver_keys, chart)); solver_keys["keys"][0]["joints"]["head"][1] += 3.0; solver_bad = [t for _, ok, t in check_shot(solver, solver_keys, chart)["keys"] if not ok]
    ok = (not base and failed(r_needs) == {"keys"} and len(bad_needs) == 1 and not fresh and failed(r_stale) == {"breakdowns"} and r_none == {"breakdowns"}
          and not solver_ok and len(solver_bad) == 1)
    return ok, (f"a key that needs a family -> FAIL (['keys']: {bad_needs[0] if bad_needs else None}); a breakdown authored on keys that moved -> FAIL (['breakdowns']: {bad_stale[0] if bad_stale else None}); "
                f"an authored breakdown with no keysHash -> FAIL ({sorted(r_none)}); the same breakdown on the keys it was built on -> pass; a solver key 3 px off its solved joints -> FAIL (['keys']: {solver_bad[0] if solver_bad else None}); "
                f"solver keys on their solved joints -> pass")


def control(pr, joints="keys"):
    out = {k: check_shot(*make.pose_fixture(k)) for k in ("clean", "straight-s", "twin", "favour-only", "ten-drawings", "early-passing", "lead-lag")}
    sok, stext = solved_control() if joints == "solved" else (True, "")
    fok, ftext = family_control()
    only = {"straight-s": "line of action", "twin": "twinning", "favour-only": "breakdowns", "ten-drawings": "timing shape", "early-passing": "timing shape", "lead-lag": "lead arm"}
    ok = fok and sok and not failed(out["clean"]) and all(failed(out[k]) == {c} for k, c in only.items())
    clean = out["clean"]["timing shape"][0][2]
    pr.control(ok, f"a straight spine declared S -> FAIL ({sorted(failed(out['straight-s']))}); mirrored limbs with no twinned.why -> FAIL ({sorted(failed(out['twin']))}); "
                   f"a long move with only a favour -> FAIL ({sorted(failed(out['favour-only']))}); a 10-drawing move -> FAIL ({sorted(failed(out['ten-drawings']))}: {out['ten-drawings']['timing shape'][0][2].split('; ', 1)[-1]}); "
                   f"a passing drawing at 0.10 -> FAIL ({sorted(failed(out['early-passing']))}: {out['early-passing']['timing shape'][0][2].split('; ', 1)[-1]}); "
                   f"a lead-arm joint declared as a lagging secondary -> FAIL ({sorted(failed(out['lead-lag']))}: {out['lead-lag']['lead arm'][0][2]}); "
                   f"a clean sheet -> pass on {len(out['clean'])} checks ({clean})" + (f"; {stext}" if stext else "") + f"; {ftext}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("poses"); ap.add_argument("keys"); ap.add_argument("charts"); ap.add_argument("--shot", default=None); ap.add_argument("--json", default=None)
    ap.add_argument("--joints", choices=("keys", "solved"), default="keys", help="measure the key sheet's joints (default) or each pose key's solved joints")
    a = ap.parse_args()
    pr = Probe("poses", a.json)
    control(pr, a.joints)
    for d in (a.poses, a.keys, a.charts):
        if not os.path.isdir(d): die(f"{d} is not a directory")
    shots = sorted(f[:-5] for f in os.listdir(a.charts) if f.endswith(".json"))
    if a.shot: shots = [s for s in shots if s == a.shot] or die(f"no chart {a.charts}/{a.shot}.json")
    n_shots = bad_total = 0
    for shot in shots:
        chart = read_json(os.path.join(a.charts, shot + ".json"), "chart")
        if not any(x.get("kind") == "rig" for x in chart.get("actors", {}).values()): print(f"  {shot}: no rig actor, nothing to pose", flush=True); continue
        n_shots += 1
        pp, kp = os.path.join(a.poses, shot + ".json"), os.path.join(a.keys, shot + ".json")
        missing = [p for p in (pp, kp) if not os.path.exists(p)]
        if missing:
            pr.check(f"{shot}: files", False, f"{', '.join(missing)} missing: a chart with a rig actor needs a pose sheet and a key sheet"); bad_total += 1; continue
        poses = read_json(pp, "pose sheet")
        if a.joints == "solved" and unsolved(poses):
            die(f"{pp}: no solved joints on key(s) {', '.join(unsolved(poses))}; run `npm run solve-poses -- {shot}` first")
        res = check_shot(poses, read_json(kp, "key sheet"), chart, a.joints)
        bad_total += report(pr, shot, res)
        pr.extra.setdefault("shots", {})[shot] = {c: [{"item": i, "ok": bool(ok), "text": t} for i, ok, t in v] for c, v in res.items()}
    if not n_shots: die("no chart with a rig actor to check")
    pr.finish(f"{n_shots} shot(s) ({a.joints} joints): keys, line of action, twinning, weight, breakdowns, secondaries, holds, timing shape and lead arm all as declared")


if __name__ == "__main__": main()
