#!/usr/bin/env python3
"""Blocking contract (gate animation-blocking-contract): every beat is staged before anything renders.

usage: probe-blocking.py <timeline.json> <blocking-dir> [--ledger beats-v2.json] [--exempt world] [--json out]
One <beat-id>.json per timeline beat (test-scene.json is the schema's example and is not a beat). For each beat, from the ledger's `actions`:
  - every actor an action names has a position (x, y) and a scale (`scale`, or width and height for a box); an actor is read from `actors.<name>` (map or
    list) or from a top-level key of that name, the human also as `figure`; --exempt names pseudo-actors that stand nowhere (default: world);
  - `emitter.start` and `emitter.end` lie inside the frame (values up to 2 read as fractions of the frame, larger ones as stage pixels, 1280x720);
  - `card` names a composition card;
  - the identity boxes (Codex, Clawd, the human's crop) do not overlap each other. Codex and Clawd boxes are the sprite's position grown to the
    measured boxes of scripts/measure-worlds.py (Codex 166.7 x 166.7 px per unit scale from 20 px up-left of the sprite, Clawd 180 x 153.3 from 10 px up-left);
    the human's crop is the file's `figureCrop`, else the stage crop scaled with the figure.
The ledger is --ledger, else the timeline's recorded ledger path, else beats-v2.json beside the timeline.
Control first: an actor with no position, an emitter outside the frame, a missing card, overlapping identity boxes and a beat with no file must each fail;
the clean fixture must pass.
"""
import argparse, copy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

ALIAS = {"human": ("human", "figure")}
SPRITE = {"codex": (-20, -20, 300 / 1.8, 300 / 1.8), "clawd": (-10, -10, 270 / 1.5, 230 / 1.5)}


def num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)


def find_actor(bl, name):
    acts = bl.get("actors")
    if isinstance(acts, dict) and isinstance(acts.get(name), dict): return acts[name]
    if isinstance(acts, list):
        for x in acts:
            if isinstance(x, dict) and name in (x.get("actor"), x.get("id"), x.get("name")): return x
    for k in ALIAS.get(name, (name,)):
        if isinstance(bl.get(k), dict): return bl[k]
    return None


def xy(o):
    if num(o.get("x")) and num(o.get("y")): return o["x"], o["y"]
    pos = o.get("position")
    if isinstance(pos, (list, tuple)) and len(pos) == 2 and all(num(v) for v in pos): return tuple(pos)
    if isinstance(pos, dict) and num(pos.get("x")) and num(pos.get("y")): return pos["x"], pos["y"]
    return None


def point(p):
    if isinstance(p, (list, tuple)) and len(p) == 2: return p[0], p[1]
    if isinstance(p, dict) and num(p.get("x")) and num(p.get("y")): return p["x"], p["y"]
    return None


def inside_frame(pt):
    x, y = pt
    if not (num(x) and num(y)): return False
    return (0 <= x <= 1 and 0 <= y <= 1) if max(abs(x), abs(y)) <= 2.0 else (0 <= x <= STAGE[0] and 0 <= y <= STAGE[1])


def identity_boxes(bl):
    out = {}
    for n, (dx, dy, w, h) in SPRITE.items():
        o = find_actor(bl, n)
        if o and xy(o) and num(o.get("scale")):
            x, y = xy(o); sc = o["scale"]
            out[n] = (x + dx, y + dy, w * sc, h * sc)
    fc = bl.get("figureCrop"); fo = find_actor(bl, "human")
    if isinstance(fc, dict) and all(num(fc.get(k)) for k in ("x", "y", "width", "height")): out["human"] = (fc["x"], fc["y"], fc["width"], fc["height"])
    elif fo and xy(fo) and num(fo.get("scale")):
        k = fo["scale"] / 0.68; x, y = xy(fo)
        out["human"] = (x - 40 * k, 0, 500 * k, 720)
    return out


def overlap(a, b):
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]); h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return w > 0 and h > 0


def check_blocking(tl, ledger, blocks, exempt):
    acts = {b["id"]: sorted({a["actor"] for a in b.get("actions", [])}) for b in ledger.get("beats", [])}
    pr = {"files": [], "actors": [], "emitter": [], "card": [], "boxes": []}
    for b in tl["beats"]:
        bl = blocks.get(b["id"])
        if bl is None: pr["files"].append(f"beat {b['id']!r} has no blocking file"); continue
        for n in acts.get(b["id"], []):
            if n in exempt: continue
            o = find_actor(bl, n)
            if not o or not xy(o): pr["actors"].append(f"beat {b['id']!r}: actor {n!r} has no position (x, y)")
            elif not (num(o.get("scale")) or (num(o.get("width")) and num(o.get("height")))): pr["actors"].append(f"beat {b['id']!r}: actor {n!r} has no scale")
        em = bl.get("emitter")
        for end in ("start", "end"):
            pt = point(em.get(end)) if isinstance(em, dict) else None
            if pt is None: pr["emitter"].append(f"beat {b['id']!r}: emitter.{end} is missing")
            elif not inside_frame(pt): pr["emitter"].append(f"beat {b['id']!r}: emitter.{end} {pt} is outside the frame")
        if not (isinstance(bl.get("card"), str) and bl["card"].strip()): pr["card"].append(f"beat {b['id']!r}: no composition card cited")
        bx = identity_boxes(bl); names = sorted(bx)
        for i, m in enumerate(names):
            for n in names[i + 1:]:
                if overlap(bx[m], bx[n]): pr["boxes"].append(f"beat {b['id']!r}: the {m} box and the {n} box overlap")
    known = {b["id"] for b in tl["beats"]} | {"test-scene"}
    extra = sorted(set(blocks) - known)
    msg = {"files": ("one file per beat", f"{len(tl['beats'])} beats, {len(blocks)} blocking files"), "actors": ("actors positioned and scaled", "every actor the ledger names is placed"),
           "emitter": ("emitter inside the frame", "emitter start and end inside the frame on every beat"), "card": ("composition card cited", "every beat cites a card"),
           "boxes": ("identity boxes apart", "Codex, Clawd and the human's crop never overlap")}
    return [(msg[k][0], not v, "; ".join(v) if v else msg[k][1]) for k, v in pr.items()], extra


def load_blocks(d):
    out = {}
    if not os.path.isdir(d): die(f"blocking directory {d} does not exist")
    for f in sorted(os.listdir(d)):
        if f.endswith(".json"): out[f[:-5]] = read_json(os.path.join(d, f), "blocking file")
    return out


def planted():
    tl, ledger, block = make.blocking_fixture(); cases = {}
    c = copy.deepcopy(block); del c["a"]["codex"]; cases["actor with no position"] = c
    c = copy.deepcopy(block); c["b"]["emitter"]["end"] = {"x": 1.4, "y": 0.5}; cases["emitter outside the frame"] = c
    c = copy.deepcopy(block); del c["c"]["card"]; cases["missing card"] = c
    c = copy.deepcopy(block); c["a"]["clawd"]["x"] = 300; cases["overlapping identity boxes"] = c
    c = copy.deepcopy(block); del c["d"]; cases["beat with no file"] = c
    return normalise_timeline(tl), ledger, block, cases


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("timeline"); ap.add_argument("blocking_dir"); ap.add_argument("--ledger", default=None)
    ap.add_argument("--exempt", default="world", help="comma-separated pseudo-actors that need no position"); ap.add_argument("--json", default=None)
    ap.add_argument("--shot", default=None, help="check one shot's beats only")
    a = ap.parse_args(); exempt = set(filter(None, a.exempt.split(",")))
    pr = Probe("blocking-contract", a.json)
    tl0, ledger0, block0, cases = planted()
    clean = [c for c in check_blocking(tl0, ledger0, block0, exempt)[0] if not c[1]]
    tripped = {n: [c for c in check_blocking(tl0, ledger0, b, exempt)[0] if not c[1]] for n, b in cases.items()}
    pr.control(not clean and all(tripped.values()), "; ".join(f"{n} -> {'FAIL (' + v[0][0] + ')' if v else 'NOT REFUSED'}" for n, v in tripped.items()) + f"; clean fixture -> pass ({len(clean)} failures)")
    tl, _, _, shot_note = apply_shot(a, load_timeline(a.timeline)); raw = tl["source"]
    if shot_note: pr.note(shot_note)
    lp = a.ledger or raw.get("ledger") or next((b.get("ledgerPath") for b in tl["beats"] if b.get("ledgerPath")), None) or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "beats-v2.json")
    ledger = read_json(lp, "ledger")
    blocks = load_blocks(a.blocking_dir)
    checks, extra = check_blocking(tl, ledger, blocks, exempt)
    for name, ok, text in checks: pr.check(name, ok, text)
    if extra: pr.note(f"blocking files naming no beat (ignored): {extra}")
    pr.finish(f"{len(tl['beats'])} beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart")


if __name__ == "__main__": main()
