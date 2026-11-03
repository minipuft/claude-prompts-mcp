#!/usr/bin/env python3
"""Writes v3/charts/s01-arrival-overwhelm.json, the timing chart of shot s01 (D72 pose-to-pose), from the numbers below.

usage: python3 scripts/s01_chart.py [--write]    (without --write it prints the human's drawing runs and checks them against the hold band)

The human's keys are authored as (name, arrival frame, hold before the move starts, breakdown count). A move of n breakdowns runs on drawings of
4 frames each (twos: a drawing lasts at most 4 frames, so a hold is anything longer) and ends exactly on the next key's frame, so the hold of the
key before it is whatever remains: that is the number that has to land in the CalArts band 11-27 (probe-holds.py, C28). Breakdown favours follow a
slow-in slow-out curve at n equal steps and never one half. Everything is on twos; the light actors are on ones.
"""
import json, math, os, random, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "v3/charts/s01-arrival-overwhelm.json")
SHOT = "s01-arrival-overwhelm"

# name, arrival frame, hold, pose in words, line of action, what changes
KEYS = [
    ("rest-on-lid", 0, "upright behind the box, weight even, forearms resting on the lid's near edge, chin down, eyes on the lid",
     "a gentle forward arc from the hips over the box: head, shoulders and forearms on one soft C", "the poster pose"),
    ("grip", 42, "shoulders drop and round, elbows bend, fingertips curl under the lid's near edge: the gather before the lift",
     "the C deepens: spine curves toward the box, elbows out", "anticipation: shoulders down 8 %, elbows bent, hands under the edge"),
    ("lift", 66, "arms rise to chest height pulling the lid, torso straightens and leans a little back, chin lifts",
     "a rising diagonal from the planted feet up through the lifted forearms", "the lid is in the hands: arms up, spine from a C to a straight lean"),
    ("awe", 104, "one step back, arms drop open and low at the sides, palms out, head tipped back to follow the rising bubble",
     "an open S: heels, hips back, ribs forward, chin up", "release: arms fall open, weight shifts back"),
    ("brace", 154, "hands drawn in to the chest, shoulders up, weight leaning back on the heels, eyes fixed up on the swelling bubble",
     "a backward lean from heels to crown, hands as the fulcrum", "wonder tightens into held breath as the bubble swells"),
    ("joy-a", 190, "arms flung up and out, back arched, hips pushed to the left, face up: the burst after the pop",
     "one big diagonal from the right foot up through the left hand", "the pop lands: everything in the body opens"),
    ("joy-b", 228, "the same joy turned the other way: hips to the right, arms swapped, the hair swoop swinging across (the turn)",
     "the diagonal reverses, an S-curve through the torso", "the turn: weight crosses over, arms trade sides"),
    ("shrink", 272, "knees bent, back rounded, chin to chest, forearms crossed over the head: small and covering",
     "a closing C from the crown down to the bent knees", "joy is overrun: the figure folds in on itself and holds (the field floods)"),
]
# (hold before the move starts, breakdowns n); the last key holds to the end of the shot (a declared long hold)
MOVES = [(4, 4), (4, 2), (3, 4), (6, 4), (6, 2), (4, 4), (6, 4)]  # (breakdowns, frames per drawing): fast actions on twos, slow anticipations and eases on fours

def favours(n):
    s = lambda t: t * t * (3 - 2 * t)
    vals = [round(s((k + 1) / (n + 1)), 3) for k in range(n)]
    return [0.58 if v == 0.5 else v for v in vals]

def human():
    keys, bds = [], []
    for i, (name, frame, pose, loa, chg) in enumerate(KEYS):
        k = {"name": name, "frame": frame, "pose": pose, "lineOfAction": loa, "changes": chg}
        if i < len(MOVES):
            nxt = KEYS[i + 1][1]
            n, draw = MOVES[i]
            move_start = nxt - n * draw
            k["hold"] = move_start - frame
            for j, fv in enumerate(favours(n)):
                bds.append({"frame": move_start + j * draw, "favour": fv})
        else:
            k["hold"] = 420 - frame
        keys.append(k)
    return keys, bds

def runs(keys, bds, end=420):
    """The drawings the pose-to-pose rule produces: (first frame, last frame, label) in order."""
    marks = []
    for i, k in enumerate(keys):
        marks.append((k["frame"], k["name"]))
        for b in [b for b in bds if k["frame"] < b["frame"] < (keys[i + 1]["frame"] if i + 1 < len(keys) else 10**9)]:
            marks.append((b["frame"], f'{k["name"]}>{keys[i + 1]["name"]}@{b["favour"]}'))
    out = []
    for i, (f, lab) in enumerate(marks):
        nxt = marks[i + 1][0] if i + 1 < len(marks) else end
        out.append((f, nxt - 1, lab))
    return out

def scalar(param, keys, note, quantise="twos", path=None):
    a = {"kind": "scalar", "param": param, "quantise": quantise, "note": note, "keys": [{"frame": f, "value": v, **({"hold": h} if h else {}), **({"ease": e} if e else {}), **({"why": w} if w else {})} for (f, v, h, e, w) in keys]}
    if path: a["path"] = path
    return a

def pieces():
    rnd = random.Random(7)
    gx, gy = 699.0, -124.0  # the dial at the end of the widen; angles are measured from it
    kinds = ["stalk", "arch", "ring", "block", "frame", "stalk", "ring", "block", "string", "arch", "stalk", "block"]
    # landing slots around the trio, outside its zone (x 330-1000, y 250-700), over the end view x -854..2122, y -981..693
    slots = []
    for _ in range(400):
        x = rnd.uniform(-800, 2080); y = rnd.uniform(-940, 650)
        if 300 < x < 1030 and y > 230: continue
        if abs(x - 699) < 330 and abs(y + 124) < 480: continue   # the gadget's own body
        if all(math.hypot(x - sx, y - sy) > 215 for sx, sy, *_ in slots): slots.append((x, y))
    slots = slots[:56]
    slots.sort(key=lambda s: math.atan2(s[1] - gy, s[0] - gx))  # a sweep around the gadget: related elements in one order
    out, start, gaps = [], 186, [4, 3, 5, 4, 4, 3, 5, 4]
    for i, (x, y) in enumerate(slots):
        kind = kinds[i % len(kinds)]
        d = math.hypot(x - gx, y - gy)
        side = 1 if x > gx else -1
        mid = ((gx + x) / 2 + side * 60, min(gy, y) - 180 - rnd.uniform(0, 140))
        via = [[round(gx + (x - gx) * 0.25 + side * 40, 1), round(gy - 220 - rnd.uniform(0, 160), 1)], [round(mid[0], 1), round(mid[1], 1)]]
        size = {"stalk": rnd.uniform(0.7, 1.5), "arch": rnd.uniform(0.7, 1.35), "ring": rnd.uniform(0.7, 1.4), "block": rnd.uniform(0.8, 1.5), "frame": rnd.uniform(0.7, 1.2), "string": rnd.uniform(0.8, 1.3)}[kind]
        out.append({"id": f"p{i:02d}-{kind}", "kind": kind, "start": start, "flight": int(26 + min(d / 50, 14)) // 2 * 2, "from": "funnel", "via": via, "to": [round(x, 1), round(y, 1)], "size": round(size, 2),
                    "rot": round(rnd.uniform(-14, 14), 1), "layer": "back" if y < 40 else "front"})
        start += gaps[i % len(gaps)]
    return out

def build():
    keys, bds = human()
    ps = pieces()
    def pin(i, lands_at, to, kind, note, size=1.0, via=None):
        p = ps[i]
        p.update({"kind": kind, "to": to, "size": size, "flight": lands_at - p["start"], "id": f"p{i:02d}-{note.split()[0]}-{kind}", "note": note, "layer": "front"})
        if via: p["via"] = via
        return p
    # the piece Codex catches: lands in its raised hands (Codex stands at stage (330, 686) feet, hands up near its head)
    catch = pin(4, 234, [376, 596], "block", "codex catches this block in its raised hands at 234", 1.0, [[900, -330], [520, 140]])
    # the stalk that pushes Clawd: roots at the ground just left of it (Clawd stands at (980, 686)) and sweeps right as it unrolls
    push = pin(14, 262, [905, 690], "stalk", "clawd is pushed by this stalk at 262", 0.95, [[1100, -300], [1000, 200]])
    actors = {
        "human": {"kind": "rig", "keySheet": "v3/keys/s01-arrival-overwhelm.json", "keys": keys, "breakdowns": bds,
                  "note": "every move is 3-6 drawings of 4 frames on twos; keys held 10-24 frames before the move starts; the last key is a declared long hold to the end of the shot (the field floods, the figure stays folded)"},
        "box.lid": scalar("lid angle, 0 closed .. 1 about 105 degrees; hinge on the back edge", [(0, 0, 42, None, "closed; the seam hairline is the only light"), (44, 0.05, 12, None, "a crack: the lid lifts 5 % as the fingers curl under (seam pulse), 2 frames after the grip key lands"), (74, 0.64, 0, "smooth", "pulled by the hands: the lift key lands at 66, the lid follows 8 frames later"), (90, 1.07, 0, "out", "swings past open under its own weight (overshoot)"), (102, 1.0, 0, None, "settles open")], "cracks 2 frames after the human's grip key lands (frame 42) and follows the lift key (66) by 8 frames: cause then effect"),
        "bubble.size": scalar("bubble radius in units of 140 px; 0 = not there", [(0, 0, 84, None, None), (88, 0.12, 0, "out", "a bead of light at the box's mouth"), (112, 0.5, 0, "smooth", "rises and swells with the gadget inside"), (146, 0.8, 4, "smooth", "the swell begins to lead the camera"), (178, 1.55, 0, "in", "the last two frames are the stretch before the pop"), (180, 0, 0, None, "the pop: gone in one drawing; the burst ring is the light layer's")], "the bubble leads the widen (frames 150-180) and pops on 180"),
        "gadget.rise": scalar("position along its path, 0 inside the box .. 1 above the box at the pop .. 2 hovering high with the dial at its end-of-move position", [(0, 0, 86, None, "hidden behind the box's front"), (90, 0.12, 0, "smooth", "starts to rise on its bubble"), (130, 0.6, 0, "smooth", None), (178, 1.0, 0, None, "rides the bubble to the pop"), (182, 1.0, 0, "smooth", "a hang: gravity takes a frame"), (262, 2.0, 0, "out", "rises and grows to tower over the trio")],
                              "bubble and gadget keep the same centre until the pop", path=[{"x": 745, "y": 610, "scale": 0.45}, {"x": 730, "y": 330, "scale": 1.15}, {"x": 699, "y": -124, "scale": 2.9}]),
        "gadget.glow": scalar("dial opening 0..1 (the accent dot's radius)", [(0, 0, 180, None, None), (184, 0.2, 0, "out", "the dial wakes 4 frames after the pop"), (204, 1.0, 0, None, None)], "light follows the drawn pop by 4 frames (law 4)"),
        "codex.lean": scalar("lean toward the box, 0 upright .. 1 full lean", [(0, 0, 94, None, None), (98, 0.6, 22, "out", "leans in 4 frames after the lid is open: related staggered by 4 from clawd"), (146, 0.85, 30, "smooth", "leans in further as the bubble swells"), (186, 0.15, 0, "out", "recoil at the pop"), (226, 0.4, 0, "smooth", "turns to the incoming piece")], "stagger: codex starts at 94, clawd at 98"),
        "codex.catch": scalar("arms up to catch, 0..1", [(0, 0, 224, None, None), (234, 1.0, 14, "out", "the piece lands in its hands"), (252, 0.0, 0, "smooth", "lets it down")], "piece p04 lands in its hands at frame 234"),
        "clawd.lean": scalar("lean toward the box, 0..1", [(0, 0, 98, None, None), (102, 0.5, 20, "out", "leans in: 4 frames after codex"), (150, 0.7, 30, "smooth", None), (190, 0.1, 0, "out", "recoil at the pop")], None),
        "clawd.push": scalar("pushed by a stalk, 0 none .. 1 pushed right and tipped", [(0, 0, 258, None, None), (262, 0.0, 0, "in", "the stalk's tip reaches it"), (276, 1.12, 0, "out", "pushed past where it stays"), (290, 0.9, 0, "smooth", "settles")], "a stalk (piece p25) passes behind Clawd at 262"),
        "stalk0.grow": scalar("the first stalk's curl, 0 not there .. 1 fully unrolled; rooted at the gadget's funnel", [(0, 0, 176, None, None), (180, 0.04, 0, "out", "starts as the bubble pops (cause)"), (212, 1.0, 0, None, "curl complete as the widen ends")], "leads the camera from 180 to 210"),
        "light.seam": scalar("box seam light, 0..1 (the one emitter before the pop)", [(0, 0.5, 38, None, "hairline"), (44, 0.95, 0, "out", "crack: seam pulse"), (60, 0.7, 40, "smooth", "the lid opening widens it"), (140, 0.8, 30, "smooth", None), (178, 0.0, 0, "smooth", "the bubble covers the mouth; the emitter window ends at 178")], "one emitter at a time: the seam window is frames 0-177, the dial window 182-419 (handoff gap 4)", quantise="ones"),
        "light.dial": scalar("dial emitter, 0..1 (the one emitter after the pop)", [(0, 0, 181, None, None), (182, 0.35, 0, "out", "on 2 frames after the pop; handoff gap 4 frames (seam off 178)"), (200, 1.0, 0, None, None)], None, quantise="ones"),
        "light.flood": scalar("Turrell blue radiance flooding the field, 0..1", [(0, 0, 183, None, None), (190, 0.15, 0, "out", "begins 4 frames after the dial (glass after light, law 4)"), (262, 1.0, 0, "smooth", "full; grain keeps rising to the end")], "cause then light then glass then settle", quantise="ones"),
        "light.grain": scalar("grain amount, 0..1", [(0, 0.1, 190, None, None), (260, 0.5, 0, "smooth", None), (420, 0.8, 0, "smooth", "rising to the cut into beat 3")], "grain is boil, reseeded on twos from 3 variants", quantise="twos"),
    }
    return {
        "shot": SHOT, "fps": 30, "frames": [0, 420], "provisional": True,
        "source": {"timeline": "v3/timeline.json (arrival 0-180, everything-at-once 180-420, no crossing)", "layout": "v3/layouts/s01-arrival-overwhelm.json", "blocking": ["v3/blocking/arrival.json", "v3/blocking/everything-at-once.json"]},
        "actors": actors,
        "pieces": ps,
        "pulses": [{"frame": 44, "what": "seam pulse: the lid cracks (the hairline widens)", "length": 14}, {"frame": 180, "what": "the pop: the burst ring and the accent flash (drawn cause); the dial wakes 182, the flood 190", "length": 12}],
        "lag": {"frames": 3, "recovery": 12, "note": "radiance follows the drawn cause by 2-4 frames (here: pop 180, seam off 178, dial on 182, flood 190, grain 190) and recovers over 12 frames without snapping"},
        "boil": {"variants": 3, "rate": 4, "seed": 11},
        "camera": {"span": [150, 210], "note": "locked 0-150, widen 150-210 on ones from (640,360,x1) to (604,103,x0.6), held to 420; led by the bubble (150-180) then stalk0's curl (180-210); numbers in the layout contract"},
    }

def main():
    chart = build()
    keys, bds = human()
    rs = runs(keys, bds)
    bad = []
    for f, l, lab in rs:
        n = l - f + 1
        if n > 4 and not (11 <= n <= 27):
            tag = "declared long hold" if n > 27 and lab == keys[-1]["name"] else "OUT OF BAND"
            bad.append((lab, f, l, n, tag))
    print(f"human: {len(keys)} keys, {len(bds)} breakdowns, {len(rs)} drawings")
    for f, l, lab in rs:
        n = l - f + 1
        print(f"  {f:3d}-{l:3d} {n:3d}f  {lab}")
    print("bad:", [b for b in bad if b[4] == "OUT OF BAND"] or "none")
    print(f"pieces: {len(chart['pieces'])}, starts {chart['pieces'][0]['start']}..{chart['pieces'][-1]['start']}, gaps {sorted({b['start'] - a['start'] for a, b in zip(chart['pieces'], chart['pieces'][1:])})}")
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as f:
            json.dump(chart, f, indent=1)
            f.write("\n")
        print("wrote", os.path.relpath(OUT, ROOT))

if __name__ == "__main__":
    main()
