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
  - props apart (D100): the frame, the kit blocks, Codex, Clawd, the human's body (the joints of the keys the beat plays, grown by a hand's reach) and every prop of `actors` (box, bubble, gadget, stalk,
    structure; extents in PROP_EXTENT, measured from the animatic's omit-one stills) occupy their own rectangles. Two that overlap by more than TOUCH pixels each way must be a declared
    `contacts` entry ({a, b, why}); a declaration for a pair that does not overlap is stale and refused; a prop that stands on the floor (box, stalk, structure) has its foot within FLOOR_BAND of
    the floor line (a stalk rooted at y 300 hangs in the air); every prop lies on the stage.
Control first: an actor with no position, an emitter outside the frame, a missing card, overlapping identity boxes, a beat with no file, two props that overlap undeclared, a declaration for a
pair that does not touch, a stalk in the air and a prop off the stage must each fail; the clean fixture must pass, and so must the same two props with their contact declared.
"""
import argparse, copy, math, os, sys
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


# ---------- props apart ----------
# Extents of each placeholder prop relative to its anchor, per unit scale, as (left, top, right, bottom) in stage pixels: the bounding box of the pixels that differ between the animatic's still
# with the prop and without it (render-props.mjs, 1280x720, camera locked), divided by the scale it stood at. The stalk is measured facing left and mirrors when it faces right.
PROP_EXTENT = {"box": (-67, -156, 106, 1), "bubble": (-128, -132, 126, 128), "gadget": (-56, -169, 108, 69), "stalk": (-51, -333, 43, 10), "structure": (-112, -302, 112, 2)}
STANDS = ("box", "stalk", "structure")   # anchored at a foot: it stands on the floor
FLOOR_BAND = (-60, 260)                  # the foot's y relative to the floor line: the stage is 3/4 view, so the floor is a band, not a line
TOUCH = 4                                # pixels two rectangles may share each way before they count as overlapping
HAND = 70                                # mask pixels from a bone to the edge of the drawn limb, a hand or a foot (half a limb's width, and the hand past the wrist)
BONES = (("root", "torso"), ("torso", "neck"), ("neck", "head"), ("torso", "shoulderL"), ("shoulderL", "elbowL"), ("elbowL", "wristL"), ("torso", "shoulderR"), ("shoulderR", "elbowR"), ("elbowR", "wristR"),
         ("root", "hipL"), ("hipL", "kneeL"), ("kneeL", "ankleL"), ("root", "hipR"), ("hipR", "kneeR"), ("kneeR", "ankleR"), ("root", "ponchoPoint"))


def prop_rect(name, a):
    l, t, r, b = PROP_EXTENT[name]
    if name == "stalk" and a.get("facing") == "right": l, r = -r, -l
    s = a["scale"]
    return (a["x"] + l * s, a["y"] + t * s, (r - l) * s, (b - t) * s)


def overlap_amount(a, b):
    return min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]), min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])


def figure_shapes(bl, tl_beat, episode_root, skeleton, shot_start=None):
    """The human's body in stage pixels, one shape per key drawn in the beat: (key name, points, radius), the key's joints and points along its bones, mapped by the skeleton's registration and the blocking's
    figure placement, each with HAND grown to stage pixels. The body is a union of discs, not a bounding box: a box around an arm thrown wide would claim the empty corner under it. [] when the beat names no key sheet
    (`poseShot`, else `shot`; the figure is then the placeholder lift, which has no sheet to read). A key sheet the beat names and that cannot be read is an error."""
    shot = bl.get("poseShot") or bl.get("shot")
    if not shot: return []
    path = os.path.join(episode_root, "keys", f"{shot}.json")
    keys = read_json(path, "key sheet").get("keys") or []
    if not keys: die(f"key sheet {path} has no keys")
    first = min(k["frame"] for k in keys); start0 = tl_beat["start"] if shot_start is None else shot_start
    origin = 0 if first >= start0 else start0   # an s02-the-frame sheet counts film frames; an s01 or s02-cant-build-frame sheet counts from its shot's first beat
    lo, hi = tl_beat["start"] - origin, tl_beat["end"] - origin
    active = [k for k in keys if k["frame"] <= lo]; drawn = [k for k in keys if lo < k["frame"] < hi]
    use = ([max(active, key=lambda k: k["frame"])] if active else []) + drawn
    if not use: die(f"beat {tl_beat['id']!r}: no key of {path} is drawn in frames {lo}-{hi}")
    reg = skeleton["registration"]; fig = bl["figure"]; radius = HAND * reg["scale"] * fig["scale"]; out = []
    to_stage = lambda p: (fig["x"] + fig["scale"] * (reg["scale"] * (p[0] - reg["originMask"][0]) + reg["originCanvas"][0]), fig["y"] + fig["scale"] * (reg["scale"] * (p[1] - reg["originMask"][1]) + reg["originCanvas"][1]))
    for k in use:
        j = {n: to_stage(p) for n, p in k["joints"].items()}; pts = list(j.values())
        for a, b in BONES:
            if a in j and b in j: pts += [(j[a][0] + (j[b][0] - j[a][0]) * t / 6, j[a][1] + (j[b][1] - j[a][1]) * t / 6) for t in range(1, 6)]
        out.append((k["name"], pts, radius))
    return out


def shape_depth(shape, rect):
    """How far the disc union `shape` reaches into `rect` (the deepest disc), in stage pixels; 0 or less is clear."""
    _, pts, r = shape
    return max(r - math.hypot(max(rect[0] - x, 0, x - (rect[0] + rect[2])), max(rect[1] - y, 0, y - (rect[1] + rect[3]))) for x, y in pts)


def prop_faults(bl, figure):
    """Faults of one beat's props: [(kind, text)]. `figure` is `figure_shapes`' list: the human is tested once per key it draws, and "the human" in a declared contact stands for any of them."""
    rects = {}
    if isinstance(bl.get("frame"), dict) and all(num(bl["frame"].get(k)) for k in ("x", "y", "width", "height")): f = bl["frame"]; rects["frame"] = (f["x"], f["y"], f["width"], f["height"])
    bs = [b for b in bl.get("blocks") or [] if isinstance(b, dict) and all(num(b.get(k)) for k in ("x", "y", "width", "height"))]
    if bs: x0, y0 = min(b["x"] for b in bs), min(b["y"] for b in bs); rects["blocks"] = (x0, y0, max(b["x"] + b["width"] for b in bs) - x0, max(b["y"] + b["height"] for b in bs) - y0)
    for n, r in identity_boxes(bl).items():
        if n != "human": rects[n] = r
    out = []; acts = bl.get("actors") if isinstance(bl.get("actors"), dict) else {}
    floor = (bl.get("floor") or {}).get("y")
    for n, a in acts.items():
        if n not in PROP_EXTENT: continue
        if not (xy(a) and num(a.get("scale"))): continue
        rects[n] = prop_rect(n, a)
        if n in STANDS and num(floor) and not (floor + FLOOR_BAND[0] <= a["y"] <= floor + FLOOR_BAND[1]):
            out.append(("air", f"the {n} stands at y {a['y']:g}, {abs(a['y'] - floor):g} px {'above' if a['y'] < floor else 'below'} the floor line {floor:g} (a foot belongs within {FLOOR_BAND[0]} to +{FLOOR_BAND[1]})"))
    for n, r in rects.items():
        if n in PROP_EXTENT and (r[0] < -TOUCH or r[1] < -TOUCH or r[0] + r[2] > STAGE[0] + TOUCH or r[1] + r[3] > STAGE[1] + TOUCH):
            out.append(("stage", f"the {n} reaches ({r[0]:.0f}, {r[1]:.0f}) to ({r[0] + r[2]:.0f}, {r[1] + r[3]:.0f}), off the {STAGE[0]}x{STAGE[1]} stage"))
    declared = {}
    for c in bl.get("contacts") or []:
        if not (isinstance(c, dict) and c.get("a") in {**rects, "human": 1} and c.get("b") in {**rects, "human": 1} and c["a"] != c["b"] and isinstance(c.get("why"), str) and c["why"].strip()):
            out.append(("contact", f"contact {c!r} must name two things on the stage and say why"))
        else: declared[frozenset((c["a"], c["b"]))] = c
    seen = set(); names = sorted(rects) + (["human"] if figure else [])
    def hits(m, n):
        if m == "human" or n == "human":
            other = n if m == "human" else m
            return [(f"human ({sh[0]})", other, (d, d)) for sh in figure for d in [shape_depth(sh, rects[other])] if d > TOUCH]
        w, h = overlap_amount(rects[m], rects[n])
        return [(m, n, (w, h))] if min(w, h) > TOUCH else []
    for i, m in enumerate(names):
        for n in names[i + 1:]:
            if {m, n} <= {"human", "codex", "clawd"}: continue   # the identity boxes against the human are `identity boxes apart`, read on the figure crop
            hit = hits(m, n)
            key = frozenset((m, n)); d = declared.get(key); seen.add(key)
            if hit and not d: x, y, (w, h) = max(hit, key=lambda t: t[2][0] * t[2][1]); out.append(("overlap", f"the {x} and the {y} overlap by {w:.0f}{'' if x.startswith('human') else f' x {h:.0f}'} px and no contact is declared"))
            if d and not hit: out.append(("contact", f"the contact of the {m} and the {n} ({d['why']!r}) is declared but they do not overlap"))
    return out


def check_blocking(tl, ledger, blocks, exempt, episode_root=None, skeleton=None):
    acts = {b["id"]: sorted({a["actor"] for a in b.get("actions", [])}) for b in ledger.get("beats", [])}
    pr = {"files": [], "actors": [], "emitter": [], "card": [], "boxes": [], "props": []}
    starts = {}
    for b in tl["beats"]:
        shot = (blocks.get(b["id"]) or {}).get("poseShot") or (blocks.get(b["id"]) or {}).get("shot")
        if shot: starts[shot] = min(starts.get(shot, b["start"]), b["start"])
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
        fig = figure_shapes(bl, b, episode_root, skeleton, starts.get(bl.get("poseShot") or bl.get("shot"))) if episode_root and skeleton else []
        for _, text in prop_faults(bl, fig): pr["props"].append(f"beat {b['id']!r}: {text}")
    known = {b["id"] for b in tl["beats"]} | {"test-scene"}
    extra = sorted(set(blocks) - known)
    msg = {"files": ("one file per beat", f"{len(tl['beats'])} beats, {len(blocks)} blocking files"), "actors": ("actors positioned and scaled", "every actor the ledger names is placed"),
           "emitter": ("emitter inside the frame", "emitter start and end inside the frame on every beat"), "card": ("composition card cited", "every beat cites a card"),
           "boxes": ("identity boxes apart", "Codex, Clawd and the human's crop never overlap"),
           "props": ("props apart", "the frame, the blocks, Codex, Clawd, the human's body and every prop keep their own rectangles; each contact is declared with its reason; every foot stands on the floor")}
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
    stage = {"floor": {"y": 480}, "actors": {"box": {"x": 500, "y": 440, "scale": 1.0}, "bubble": {"x": 520, "y": 380, "scale": 0.5}}}
    c = copy.deepcopy(block); c["a"].update(stage); cases["two props that overlap, undeclared"] = c
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"box": {"x": 300, "y": 440, "scale": 1.0}, "stalk": {"x": 900, "y": 440, "scale": 1.0}}, "contacts": [{"a": "box", "b": "stalk", "why": "the stalk leans on the box"}]})
    cases["a contact declared for two props that do not touch"] = c
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"stalk": {"x": 900, "y": 300, "scale": 1.0, "facing": "left"}}}); cases["a stalk in the air"] = c
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"gadget": {"x": 1270, "y": 330, "scale": 1.0}}}); cases["a prop off the stage"] = c
    declared = copy.deepcopy(block); declared["a"].update({**stage, "contacts": [{"a": "box", "b": "bubble", "why": "the bubble rises out of the open box"}]})
    return normalise_timeline(tl), ledger, block, cases, declared


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("timeline"); ap.add_argument("blocking_dir"); ap.add_argument("--ledger", default=None)
    ap.add_argument("--exempt", default="world", help="comma-separated pseudo-actors that need no position"); ap.add_argument("--json", default=None)
    ap.add_argument("--shot", default=None, help="check one shot's beats only")
    a = ap.parse_args(); exempt = set(filter(None, a.exempt.split(",")))
    pr = Probe("blocking-contract", a.json)
    tl0, ledger0, block0, cases, declared0 = planted()
    clean = [c for c in check_blocking(tl0, ledger0, block0, exempt)[0] + check_blocking(tl0, ledger0, declared0, exempt)[0] if not c[1]]
    tripped = {n: [c for c in check_blocking(tl0, ledger0, b, exempt)[0] if not c[1]] for n, b in cases.items()}
    body = copy.deepcopy(block0["a"]); body.update({"floor": {"y": 480}, "actors": {"box": {"x": 600, "y": 450, "scale": 1.0}}})
    near, far = [("lean", [(560, 330)], 40)], [("lean", [(300, 100)], 40)]
    tripped["a prop inside the human's body"] = [("props apart", False, t) for k, t in prop_faults(body, near) if k == "overlap"]
    clear_of_body = [t for _, t in prop_faults(body, far)]
    pr.control(not clean and not clear_of_body and all(tripped.values()), "; ".join(f"{n} -> {'FAIL (' + v[0][0] + ')' if v else 'NOT REFUSED'}" for n, v in tripped.items()) + f"; clean fixture, and the same two overlapping props with their contact declared -> pass ({len(clean)} failures)")
    tl, _, _, shot_note = apply_shot(a, load_timeline(a.timeline)); raw = tl["source"]
    if shot_note: pr.note(shot_note)
    lp = a.ledger or raw.get("ledger") or next((b.get("ledgerPath") for b in tl["beats"] if b.get("ledgerPath")), None) or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "beats-v2.json")
    ledger = read_json(lp, "ledger")
    blocks = load_blocks(a.blocking_dir)
    episode_root = os.path.dirname(os.path.abspath(a.blocking_dir)); skeleton_path = os.path.join(os.path.dirname(episode_root), "assets", "human", "skeleton.json")
    checks, extra = check_blocking(tl, ledger, blocks, exempt, episode_root, read_json(skeleton_path, "skeleton registration"))
    for name, ok, text in checks: pr.check(name, ok, text)
    if extra: pr.note(f"blocking files naming no beat (ignored): {extra}")
    pr.finish(f"{len(tl['beats'])} beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart, props apart")


if __name__ == "__main__": main()
