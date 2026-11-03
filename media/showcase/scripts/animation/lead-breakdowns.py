#!/usr/bin/env python3
"""Leads a chain of joints ahead of the body inside the authored breakdowns of a move: the head turns first, then the body (sp-4.2, D99).

usage: lead-breakdowns.py <poses.json> "<from>><to>:<pivot>><joint>[><joint>...]:<arrive>" ...
For each drawing of the move whose position along the ROOT's chord between the two keys is t (0 to 1; an anticipation, t < 0, is left as authored), the chain is redrawn: the pivot stays where the drawing has it, and every
joint after it is placed from the joint before it by the key-to-key vector of that bone, its length blended and its angle turned the shortest way, by u = min(1, t / arrive) instead of t. The bone lengths are the keys' own
(a chain turned about its pivot does not stretch, which a world-space blend of the head and neck ahead of the torso would); with arrive 0.6 the head's turn is complete when the body is 0.6 of the way and is held while the body
finishes. Writes the sheet (python's own formatting, which the file is written in) and appends ` + chain lead` once to a drawing's `authored` text. Idempotent: the chain is placed from the pivot and the keys, not from where it was.
`measure` mode: lead-breakdowns.py --measure <poses.json> "<from>><to>:<pivot>><joint>[><joint>...]" prints, per move, the frame the chain's turn (the angle of pivot to its last joint) and the frame the body's (root to pivot) reach 90 % of their key-to-key change in the
drawings the chart plays (the keys' own frames count), and how many frames the chain is ahead: that is the number sp-4.2's measure line asks for (head before torso by 4 or more).
"""
import json, math, sys


def angle(v): return math.atan2(v[1], v[0])
def sub(a, b): return [a[0] - b[0], a[1] - b[1]]
def add(a, b): return [a[0] + b[0], a[1] + b[1]]
def shortest(d): return (d + math.pi) % (2 * math.pi) - math.pi


def polar(va, vb, u):
    la, lb = math.hypot(*va), math.hypot(*vb)
    ang = angle(va) + shortest(angle(vb) - angle(va)) * u
    ln = la + (lb - la) * u
    return [ln * math.cos(ang), ln * math.sin(ang)]


def chord_t(a, b, p):
    c = sub(b["root"], a["root"]); n = c[0] ** 2 + c[1] ** 2
    return ((p["root"][0] - a["root"][0]) * c[0] + (p["root"][1] - a["root"][1]) * c[1]) / n if n > 1e-9 else 0.0


def chain_of(spec): return [j for j in spec.split(">")]


def lead(sheet, keys, move, chain, arrive):
    a_name, b_name = move.split(">"); ka = {k["name"]: k["joints"] for k in keys["keys"]}
    a, b = ka[a_name], ka[b_name]; n = 0
    for x in sheet["breakdowns"]:
        if x["between"] != [a_name, b_name] or not x.get("joints"): continue
        t = chord_t(a, b, x["joints"])
        if t <= 0: continue
        u = min(1.0, t / arrive); pose = x["joints"]
        for prev, cur in zip(chain, chain[1:]):
            v = polar(sub(a[cur], a[prev]), sub(b[cur], b[prev]), u)
            pose[cur] = [round(c, 2) for c in add(pose[prev], v)]
        if " + chain lead" not in x.get("authored", ""): x["authored"] = x.get("authored", "") + " + chain lead"
        n += 1
    if not n: raise SystemExit(f"{move}: no authored breakdowns to lead")
    return n


def turn_share(a, b, p, chain, root_chain):
    """How far the chain's turn (angle pivot -> last joint) and the body's (root -> pivot) are along their key-to-key change in the pose `p`: (chain, body), each 0 to 1 and past."""
    def frac(j0, j1):
        va, vb, vp = sub(a[j1], a[j0]), sub(b[j1], b[j0]), sub(p[j1], p[j0]); tot = shortest(angle(vb) - angle(va))
        return shortest(angle(vp) - angle(va)) / tot if abs(tot) > 1e-6 else 1.0
    return frac(chain[0], chain[-1]), frac(root_chain[0], root_chain[1])


def measure(sheet, keys, move, chain):
    a_name, b_name = move.split(">"); ka = {k["name"]: k["joints"] for k in keys["keys"]}; a, b = ka[a_name], ka[b_name]
    fa = next(k["frame"] for k in keys["keys"] if k["name"] == a_name); fb = next(k["frame"] for k in keys["keys"] if k["name"] == b_name)
    hold_a = next(k["hold"] for k in keys["keys"] if k["name"] == a_name)
    drawings = [(fa, a)] + sorted([(x["frame"], x["joints"]) for x in sheet["breakdowns"] if x["between"] == [a_name, b_name] and x.get("joints") and x["frame"] >= fa + hold_a], key=lambda d: d[0]) + [(fb, b)]
    rows = [(f, *turn_share(a, b, p, chain, ("root", chain[0]))) for f, p in drawings]
    first = lambda i: next((r[0] for r in rows if r[i] >= 0.9), None)
    fc, fbody = first(1), first(2)
    return rows, fc, fbody


def main():
    args = sys.argv[1:]
    if args and args[0] == "--measure":
        path, specs = args[1], args[2:]
        sheet = json.load(open(path)); keys = json.load(open(sheet["source"]["keys"]))
        for spec in specs:
            move, chain = spec.split(":")[0], chain_of(spec.split(":")[1])
            rows, fc, fbody = measure(sheet, keys, move, chain)
            print(f"{move}: chain {'>'.join(chain)} turned (share per drawing): " + ", ".join(f"f{f} {c:.2f}/{bd:.2f}" for f, c, bd in rows))
            print(f"  the chain's turn reaches 90 % on frame {fc}, the body's on frame {fbody}: the chain is {None if fc is None or fbody is None else fbody - fc} frames ahead")
        return
    path, specs = args[0], args[1:]
    if not specs: raise SystemExit(__doc__)
    sheet = json.load(open(path)); keys = json.load(open(sheet["source"]["keys"]))
    for spec in specs:
        move, chain, arrive = spec.split(":")
        n = lead(sheet, keys, move, chain_of(chain), float(arrive)); print(f"{move}: {n} drawings, {chain} arrives at {arrive} of the move")
    open(path, "w").write(json.dumps(sheet, indent=2) + "\n")


if __name__ == "__main__": main()
