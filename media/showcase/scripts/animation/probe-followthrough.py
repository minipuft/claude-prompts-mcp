#!/usr/bin/env python3
"""Follow-through (D97, row 8.5): every secondary of a pose sheet trails its primary by what its material declares, and never settles before it.

usage: probe-followthrough.py <joints dump> --materials v3/materials.json [--poses v3/poses/<shot>.json] [--json out]
<joints dump> is `npm run played-joints -- <shot>` (out/<shot>-joints.json): every frame the chart plays, and on every row `rigid`, where each joint of a secondary made of a material would be
riding its primary rigidly (the path the material's chain was driven by). Without --poses the sheet's secondaries, keys and breakdowns are read from the dump; with it, from the file (and a dump
written from another version of that file is refused, by the sha256 the dump carries). A secondary with no `material` is a hand-written delay (`lagDrawings`) and is refused here: nothing derives its lag.

Per secondary made of a material (declared: v3/materials.json `lagFrames`, `settleFrames`, `overshoot`; H = the pose sheet's heightPx; rest speed = 0.5 % of H per frame, the bench's threshold):
  move      for every move (the end of a key's hold to the next key) the secondary follows (not the move its `side` leads, not after `dropsAt`) whose primary joint travels at least 0.02 H:
            lag      the delay at the peak of the cross-correlation of the primary's and the secondary's velocity along the move (0-16 frames) is at least `lagFrames`, and at least the 2 x `lagDrawings`
                     frames the sheet still declares as a floor;
            after    the secondary is still displaced from where riding the primary would put it, by at least 0.5 px, when the primary lands, and keeps moving (more than 0.25 px per frame, apart from the
                     body's own drift) for at least 2 frames after it: it never settles before, or with, its primary. Its last moving frame, the frames it settles after the landing at the bench's
                     threshold scaled to the residual, and its first return past rest as a fraction of that residual are printed with the move (reported, not held: a move that is not a step settles and
                     overshoots by less than the step the declaration is stated for).
  response  the secondary's step response, identified from the played frames (least squares, ridge regularised, over every frame it follows: S - S' = g * (P - P'), the step response the running sum
            of g on the 2-frame grid the drawn layer draws on), read as the bench reads a step: the delay of its velocity peak at least `lagFrames`, its last frame above the rest speed (a step of
            120/720 H) within 2 frames of `settleFrames`, and its first return past rest within 0.08 of `overshoot`. This is the declared contract measured on the chart's own frames, whatever shape
            its moves have. A secondary that follows fewer than 6 jumps of its primary has none to identify and says so (held, not passed).
  contact   a breakdown that is a `contact` of a material (the body's heel on the floor) is followed by the move's settle drawing `contact` frames later, within 2.
Control first (planted dumps, literal chains): a secondary advanced 4 frames ahead of its primary is refused on lag and after; a chain that trails 1 frame is refused on lag; a chain that rings 30
frames is refused on response settle; a chain with no overshoot is refused on response overshoot; a secondary with no material is refused; a contact with no settle after it is refused; and the chain
that meets its material (two stages, lag 4, settle 10, overshoot 0.25) is accepted on every check.
Exit 0 pass, 1 fail, 2 input error or a control that did not trip.
"""
import argparse, hashlib, json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *

REST_FRAC = 0.005            # the bench's rest speed: 0.5 % of the field height per frame (REST_SPEED in secondaries.ts)
STEP_FRAC = 120 / 720        # the bench's step: 120 px in a 720 px field
TRAVEL_MIN_H = 0.02          # a primary that travels less than this over a move is not measured
LAG_MAX = 16
RESIDUAL_MIN_PX = 0.5
MOVING_PX = 0.25
AFTER_MIN = 2
ID_LEN = 16                  # taps of the identified response, on the 2-frame grid: 32 frames, the longest settle a material may declare (30) and one tap more; a longer tail has nothing to be measured against and only fits noise
ID_RIDGE = 1e-3
ID_MIN_JUMPS = 6
TOL_SETTLE, TOL_OVERSHOOT, TOL_CONTACT = 2, 0.08, 2
SHEET_KEYS = ("secondaries", "keys", "breakdowns")


def material_of(materials, c):
    """(declared {lagFrames, settleFrames, overshoot} | None, why-not text) for a secondary."""
    if not c.get("material"): return None, f'secondary "{c["name"]}" names no material: its lag is a hand-written delay (lagDrawings {c.get("lagDrawings")}) and nothing derives it'
    mo = material_motion(materials, c["material"])
    if not mo: return None, f'secondary "{c["name"]}" is made of {c["material"]!r}, which declares no lag and settle in the materials file'
    return mo, None


def moves_of(sheet, end):
    """[{from, to, start, end, first, lead}]: the end of a key's hold to the next key; `first` is the frame of the move's first drawing (its first breakdown, else the key), `window` ends where the next move's first drawing begins (or the shot's end)."""
    keys = sorted(sheet["keys"], key=lambda k: k["frame"]); out = []
    for a, b in zip(keys, keys[1:]):
        own = [x["frame"] for x in sheet.get("breakdowns", []) if x["between"] == [a["name"], b["name"]]]
        out.append({"from": a["name"], "to": b["name"], "start": a["frame"] + (a.get("hold") or 0), "end": b["frame"], "first": min(own + [b["frame"]]), "lead": (b.get("lead") or {}).get("arm", "none")})
    for i, m in enumerate(out): m["window"] = out[i + 1]["first"] if i + 1 < len(out) else end
    return out


def follows_on(c, m):
    return secondary_follows(c, m["start"]) and not (c.get("side") and c["side"] == m["lead"])


def lag_peak(vp, vs):
    """The shift k (0..LAG_MAX frames) at which the secondary's velocity correlates best with the primary's; the smaller on a tie."""
    best, lag = -1e30, 0
    for k in range(LAG_MAX + 1):
        s = float(sum(vp[i] * vs[i + k] for i in range(len(vp) - k)))
        if s > best + 1e-9: best, lag = s, k
    return lag


def identify(P, S, use, H):
    """The secondary's step response from the played frames: g with dS = g * dP over the even frames (the drawn layer's grid; P, S hold one row per even frame), least squares with a ridge, over the
    differences `use` marks (the frames the secondary follows; the history of dP behind them is the primary's own). Returns (lag, settle, overshoot, g, fit error), read as the bench reads a step, in frames:
    the delay of g's peak, the last tap above the rest speed of a step of 120/720 H (a tap is 2 frames, so its speed per frame is g / 2), the first return of the running sum past 1."""
    dP = np.diff(P, axis=0); dS = np.diff(S, axis=0)
    rows = [i for i in range(len(dP)) if use[i]]
    A = np.array([[dP[i - k, ax] if i - k >= 0 else 0.0 for k in range(ID_LEN)] for ax in (0, 1) for i in rows]); b = np.concatenate([dS[rows, 0], dS[rows, 1]])
    G = A.T @ A; g = np.linalg.solve(G + ID_RIDGE * np.trace(G) / ID_LEN * np.eye(ID_LEN), A.T @ b)
    err = float(np.linalg.norm(A @ g - b) / max(1e-9, np.linalg.norm(b)))
    thr = REST_FRAC * H / (STEP_FRAC * H) * 2           # g is per 2 frames
    taps = [k for k in range(ID_LEN) if abs(g[k]) > thr]
    return 2 * int(np.argmax(g)), 2 * (max(taps) if taps else 0), max(0.0, float(np.cumsum(g).max()) - 1.0), g, err


def arrays(rows, joint, frames):
    return np.array([rows[f]["rigid"][joint] for f in frames], float), np.array([rows[f]["joints"][joint] for f in frames], float)


def check_secondary(dump, sheet, materials, c, pr_check):
    """Run every held check of one secondary; pr_check(category, item, ok, text) records a line."""
    H = dump["heightPx"]; rows = {r["frame"]: r for r in dump["rows"]}; end = min(dump["shotFrames"][1], dump["frames"][1]); rest = REST_FRAC * H
    mo, why = material_of(materials, c)
    if not mo: pr_check("material", c["name"], False, why); return
    j = c["joints"][-1]
    if "rigid" not in next(iter(rows.values())) or j not in next(iter(rows.values()))["rigid"]:
        pr_check("material", c["name"], False, f'the dump has no rigid path for joint {j!r} of secondary "{c["name"]}": write it with `npm run played-joints -- {dump["shot"]}`'); return
    floor = 2 * c["lagDrawings"] if c.get("lagDrawings") is not None else 0
    pr_check("material", c["name"], True, f'secondary "{c["name"]}" is made of {c["material"]}: lag at least {mo["lagFrames"]} frames, settles {mo["settleFrames"]} after, overshoots {mo["overshoot"]}'
             + (f'; the sheet\'s lagDrawings {c["lagDrawings"]} is its floor of {floor} frames' if floor else ""))
    for m in moves_of(sheet, end):
        item = f'{c["name"]} {m["from"]} -> {m["to"]}'
        if not follows_on(c, m): continue
        F = [f for f in range(m["start"] - 2, min(m["window"], end)) if f in rows]
        if len(F) < 4 or m["end"] not in F or m["start"] - 1 not in F: continue
        P, S = arrays(rows, j, F); at = F.index(m["end"])
        trav = P[at] - P[F.index(m["start"] - 1)]; dist = float(np.hypot(*trav))
        if dist < TRAVEL_MIN_H * H: pr_check("move", item, True, f'{item}: the primary travels {dist:.0f} px, under {TRAVEL_MIN_H * H:.0f}: not measured'); continue
        u = trav / dist
        vp = [float(u @ (P[i + 1] - P[i])) for i in range(len(F) - 1)]; vs = [float(u @ (S[i + 1] - S[i])) for i in range(len(F) - 1)]
        lag = lag_peak(vp, vs); need = max(mo["lagFrames"], floor)
        pr_check("lag", item, lag >= need, f'{item} (frames {m["start"]}-{m["end"]}): the {c["material"]} trails the primary by {lag} frames at the peak of the velocity cross-correlation, '
                 + (f'at least the {need} it declares' if lag >= need else f'under the {need} it declares'))
        D = (S - P) @ u; resid = abs(float(D[at])); sgn = 1 if D[at] >= 0 else -1
        moving = [F[i] for i in range(at + 1, len(F)) if abs(D[i] - D[i - 1]) > MOVING_PX]
        last = max(moving) if moving else m["end"]; after = last - m["end"]
        thr = max(0.05, rest * resid / (STEP_FRAC * H))
        settle = max([F[i] for i in range(at + 1, len(F)) if abs(D[i] - D[i - 1]) > thr] + [m["end"]]) - m["end"]
        best, inside = 0.0, False
        for i in range(at, len(F)):
            v = -sgn * float(D[i])
            if v > 0.1: inside = True; best = max(best, v)
            elif inside: break
        ok = resid >= RESIDUAL_MIN_PX and after >= AFTER_MIN
        pr_check("after", item, ok, f'{item}: when the primary lands on frame {m["end"]} the {c["name"]} is {resid:.1f} px from riding it and moves until frame {last} ({after} frames after)'
                 + (f'; settles {settle} frames after at {thr:.2f} px per frame, first return {best / max(resid, 1e-9):.2f} of that residual (a step: {mo["settleFrames"]} frames, {mo["overshoot"]})' if ok
                    else ": it had already stopped when the primary landed, or settled with it, not after it"))
    # the identified response over every frame the secondary follows
    first = dump["frames"][0]; grid = [f for f in range(first + first % 2, end + 1, 2) if f in rows]
    P, S = arrays(rows, j, grid)
    use = [secondary_follows(c, grid[i + 1]) and not any(c.get("side") and c["side"] == m["lead"] and m["start"] <= grid[i + 1] < m["end"] + mo["lagFrames"] for m in moves_of(sheet, end)) for i in range(len(grid) - 1)]
    jumps = int(sum(1 for i in range(len(use)) if use[i] and float(np.hypot(*(P[i + 1] - P[i]))) > 0.5))
    if jumps < ID_MIN_JUMPS:
        pr_check("response", c["name"], False, f'secondary "{c["name"]}" follows {jumps} jumps of its primary, under the {ID_MIN_JUMPS} its step response needs to be identified: not measured, and so not held'); return
    lag, settle, over, g, err = identify(P, S, use, H)
    bad = []
    if lag < mo["lagFrames"] or (floor and lag < floor): bad.append(f"it trails {lag} frames, under {max(mo['lagFrames'], floor)}")
    if abs(settle - mo["settleFrames"]) > TOL_SETTLE: bad.append(f"it settles {settle} frames after a step, declared {mo['settleFrames']} (±{TOL_SETTLE})")
    if abs(over - mo["overshoot"]) > TOL_OVERSHOOT: bad.append(f"it overshoots {over:.2f}, declared {mo['overshoot']} (±{TOL_OVERSHOOT})")
    pr_check("response", c["name"], not bad, f'secondary "{c["name"]}" ({jumps} jumps, fit error {err:.2f}): step response trails {lag} frames, settles {settle} after, overshoots {over:.2f}; declared {mo["lagFrames"]}, {mo["settleFrames"]}, {mo["overshoot"]}'
             + ("" if not bad else ": " + "; ".join(bad)))


def check_contacts(sheet, materials, pr_check):
    keys = sorted(sheet["keys"], key=lambda k: k["frame"])
    for a, b in zip(keys, keys[1:]):
        mine = [x for x in sheet.get("breakdowns", []) if x["between"] == [a["name"], b["name"]]]
        settle = next((x for x in mine if x["kind"] == "settle"), None)
        for x in [x for x in mine if x.get("contact")]:
            want = ((materials.get(x["contact"]) or {}).get("contact") or {}).get("value")
            item = f'{a["name"]} -> {b["name"]} contact {x["frame"]}'
            if want is None: pr_check("contact", item, False, f'{item}: {x["contact"]!r} declares no contact frames'); continue
            gap = None if settle is None or settle["frame"] <= x["frame"] else settle["frame"] - x["frame"]
            ok = gap is not None and abs(gap - want) <= TOL_CONTACT
            pr_check("contact", item, ok, f'{item}: the {x["contact"]} lands on frame {x["frame"]} and settles on frame {settle["frame"] if settle else None}'
                     + (f', {gap} frames later, {x["contact"]} declares {want}' if gap is not None else ": there is no settle drawing after it"))


def measure(dump, sheet, materials):
    """{category: [(item, ok, text)]} for one dump."""
    out = {c: [] for c in ("material", "lag", "after", "response", "contact")}
    rec = lambda cat, item, ok, text: out.setdefault(cat, []).append((item, ok, text))
    for c in sheet.get("secondaries", []): check_secondary(dump, sheet, materials, c, rec)
    check_contacts(sheet, materials, rec)
    return out


# ---------- the control: planted dumps, literal chains ----------
PLANT = {"lagFrames": {"value": 4}, "settleFrames": {"value": 10}, "overshoot": {"value": 0.25}, "contact": {"value": 8}}
CHAINS = {                                           # (points, natural frequency rad/frame, damping per frame): the same linear stepper as secondaries.ts, no constraint, no gravity
    "meets": (2, 0.651, 0.619),                      # trails 4, settles 10, overshoots 0.27: the hair the bench designs
    "short": (1, 1.9, 2.4),                          # trails 1
    "rings": (1, 0.20, 0.06),                        # rings past 30 frames
    "dead": (1, 0.45, 0.9),                          # critically damped: no overshoot
}
def chain_response(anchor, points, freq, damping):
    """The tip of a linear chain of `points` springs hung from an anchor that is given on every frame, stepped on ones (4 substeps) and read on twos: its displacement from the anchor's start."""
    p, q, prev, tips = [0.0] * points, [0.0] * points, anchor[0], []
    for a in anchor:
        for s in range(1, 5):
            parent, dt = prev + (a - prev) * s / 4, 0.25
            for i in range(points):
                before = p[i]; acc = freq * freq * (parent - p[i]) - damping * (p[i] - q[i]) / dt
                p[i] = p[i] + (p[i] - q[i]) + acc * dt * dt; q[i] = before; parent = p[i]
        prev = a; tips.append(p[-1])
    return [tips[f - f % 2] for f in range(len(tips))]


def planted(kind):
    """(dump, sheet, materials) of one planted secondary: a primary that steps along x in three moves, five drawings each (a jump every 4 frames, on twos), and the secondary `kind` makes of it:
    `meets` the chain of CHAINS['meets']; `early` the primary 4 frames ahead; `short`, `rings`, `dead` the other chains; `no-material` the same chain with a hand-written lag; `no-settle` a contact with no settle after it."""
    keys = [("A", 0, 20), ("B", 60, 40), ("C", 140, 40), ("D", 220, 60)]
    sizes = {"B": [30, 70, 80, 50, 30], "C": [40, 90, 110, 70, 40], "D": [20, 60, 70, 50, 20]}
    jumps = {}
    for (a, fa, ha), (b, fb, hb) in zip(keys, keys[1:]):
        for i, size in enumerate(sizes[b]): jumps[fb - 4 * (len(sizes[b]) - i)] = size
    P, x = [], 0.0
    for f in range(300):
        x += jumps.get(f, 0.0); P.append(x)
    S = chain_response(P, *CHAINS["meets" if kind in ("no-material", "early", "no-settle") else kind])
    if kind == "early": S = [P[min(len(P) - 1, f + 4)] for f in range(len(P))]
    rows = [{"frame": f, "joints": {"tailTip": [S[f], 400.0]}, "rigid": {"tailTip": [P[f], 400.0]}} for f in range(len(P))]
    sheet = {"keys": [{"name": n, "frame": f, "hold": h, "lead": {"arm": "none", "leg": "none"}} for n, f, h in keys], "breakdowns": [], "secondaries": [{"name": "tail", "joints": ["tailTip"]}]}
    if kind == "no-material": sheet["secondaries"][0]["lagDrawings"] = 2
    else: sheet["secondaries"][0]["material"] = "plant"
    for (a, fa, ha), (b, fb, hb) in zip(keys, keys[1:]):
        n = len(sizes[b])
        for i in range(n): sheet["breakdowns"].append({"between": [a, b], "frame": fb - 4 * (n - i), "kind": "settle" if i == n - 1 else "passing", "favour": 0.96 if i == n - 1 else round(0.26 + 0.12 * i, 2)})
    if kind == "no-settle":
        sheet["breakdowns"] = [x for x in sheet["breakdowns"] if x["kind"] != "settle"]
        sheet["breakdowns"][0]["contact"] = "plant"
    return {"shot": "control", "heightPx": 922, "frames": [0, 300], "shotFrames": [0, 300], "rows": rows}, sheet, {"plant": PLANT}


def control(pr):
    got = {}
    for kind in ("meets", "early", "short", "rings", "dead", "no-material", "no-settle"):
        dump, sheet, mats = planted(kind)
        res = measure(dump, sheet, mats)
        got[kind] = {c for c, items in res.items() if any(not i[1] for i in items)}
        got[kind + "/n"] = sum(len(v) for v in res.values())
    ok = (not got["meets"] and {"lag", "after"} <= got["early"] and "lag" in got["short"] and "response" in got["rings"] and "response" in got["dead"] and got["no-material"] == {"material"} and got["no-settle"] == {"contact"})
    pr.control(ok, f'a secondary 4 frames ahead of its primary -> FAIL on {sorted(got["early"])}; a chain that trails 1 frame -> FAIL on {sorted(got["short"])}; a chain that rings 30 frames -> FAIL on {sorted(got["rings"])}; '
                   f'a chain with no overshoot -> FAIL on {sorted(got["dead"])}; a secondary with no material -> FAIL on {sorted(got["no-material"])}; a contact with no settle after it -> FAIL on {sorted(got["no-settle"])}; '
                   f'the chain that meets its material (lag 4, settle 10, overshoot 0.25) -> pass on all {got["meets/n"]} checks')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("joints"); ap.add_argument("--materials", default=MATERIALS_FILE); ap.add_argument("--poses", default=None); ap.add_argument("--json", default=None)
    a = ap.parse_args()
    pr = Probe("followthrough", a.json)
    control(pr)
    dump = read_json(a.joints, "joints dump"); materials = read_json(a.materials, "materials file")
    if "rows" not in dump or "heightPx" not in dump or "rigid" not in (dump["rows"][0] if dump["rows"] else {}):
        die(f"{a.joints} carries no rigid paths: write it with `npm run played-joints -- <shot>` (joints.mjs' dump does not have them)")
    if a.poses:
        sheet = read_json(a.poses, "pose sheet")
        with open(a.poses, "rb") as f: now = hashlib.sha256(f.read()).hexdigest()
        if dump.get("sheets", {}).get("poses") not in (None, now): die(f"{a.joints} was written from another version of {a.poses}: run `npm run played-joints -- {dump['shot']}` again")
    else:
        if not all(k in dump.get("chart", {}) for k in SHEET_KEYS): die(f"{a.joints} carries no sheet; give --poses")
        sheet = dump["chart"]
    dump.setdefault("shotFrames", dump["frames"])
    res = measure(dump, sheet, materials)
    bad = 0
    for cat, items in res.items():
        for item, ok, text in items:
            pr.check(f"{cat} {item}", ok, text); bad += not ok
    n = sum(len(v) for v in res.values())
    if not n: pr.check("secondaries", False, "no secondary of the sheet is made of a material: nothing to measure")
    pr.finish(f'{dump["shot"]}: {len(sheet.get("secondaries", []))} secondar{"y" if len(sheet.get("secondaries", [])) == 1 else "ies"}, {n} checks: each trails its primary by its material\'s lag, settles after it and answers a step as declared')


if __name__ == "__main__": main()
