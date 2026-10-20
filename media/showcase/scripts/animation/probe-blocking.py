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
  - time (the beat's own frames): a prop's `on` and `off` and every position key `at` (props, Codex, Clawd, the frame, all in film frames) lie inside the beat, a prop comes on before it goes off, position keys run
    in ascending frames, a `contacts` entry's `frame` lies inside the beat. The props apart check above reads the blocking on sampled frames of the beat (every SAMPLE_EVERY, every key frame of the figure's sheet,
    every `on`, `off` and `at` frame and the frame before it): a prop is tested only while it is on stage, Codex, Clawd and the frame where their keys put them, and the human's body as the key it holds on that frame.
    A contact with a `frame` must touch on that frame and, with `moves: {actor, by: [lo, hi]}`, the named prop's anchor must have moved by lo to hi pixels thirty frames after it.
  - actor tables: every actor name src/library/worlds/actors.tsx draws (`ACTOR_NAMES` and the `ActorName` union) has a native size in probe_common.PROP_NATIVE (the eye trace and colour probes read it) and an extent in PROP_EXTENT
    (props apart): a prop the renderer can draw and a table lacks stops those probes with an input error on the first beat that names it (the heap did, on the restaged beat 4).
Control first: an actor with no position, an emitter outside the frame, a missing card, overlapping identity boxes, a beat with no file, two props that overlap undeclared, a declaration for a
pair that does not touch, a stalk in the air, a prop off the stage, a prop that comes on after its beat has ended, a position key outside its beat and a prop that goes off before it comes on must each fail; the clean fixture must pass, and so must the same two props with their contact declared.
"""
import argparse, copy, math, os, re, sys
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


# ---------- time: the blocking on one frame (`probe_common.resolve_blocking_at`, the mirror of resolveBlocking in src/library/animation/blocking.ts) ----------
SAMPLE_EVERY = 10    # frames between the sampled frames of a beat
AFTER_CONTACT = 30   # frames after a contact a shifted prop is measured at


def timed_frames(bl, beat, extra=()):
    """The frames of a beat the blocking is read on: every SAMPLE_EVERY, the frame each prop comes on and goes off (and the one before), every position key (and the one before), and `extra` (key frames of the sheet)."""
    marks = {beat["start"], beat["end"] - 1, *extra}
    pieces = [bl.get(k) for k in ("codex", "clawd", "frame", "figure")] + [a for a in (bl.get("actors") or {}).values() if isinstance(a, dict)]
    for o in pieces:
        if not isinstance(o, dict): continue
        marks.update(v for v in (o.get("on"), o.get("off")) if num(v))
        marks.update(k["frame"] for k in o.get("at") or [] if isinstance(k, dict) and num(k.get("frame")))
    for c in bl.get("contacts") or []:
        if isinstance(c, dict) and num(c.get("frame")): marks.update((c["frame"], c["frame"] + AFTER_CONTACT))
    marks.update(m - 1 for m in list(marks))
    marks.update(range(beat["start"], beat["end"], SAMPLE_EVERY))
    return sorted(m for m in marks if beat["start"] <= m < beat["end"])


def time_faults(bl, beat, drops=()):
    """Faults of the time fields of one beat: [text]. `drops` are the frames the beat's pose sheet says a garment comes off (`dropsAt` of a secondary): the beat's heap lies on the floor from exactly that frame."""
    out, lo, hi = [], beat["start"], beat["end"]
    heap = (bl.get("actors") or {}).get("heap") if isinstance(bl.get("actors"), dict) else None
    for d in drops:
        if lo <= d < hi and not (isinstance(heap, dict) and heap.get("on") == d): out.append(f"the pose sheet drops the cloak at frame {d} and the beat's heap does not come on at frame {d} ({'it comes on at ' + str(heap.get('on')) if isinstance(heap, dict) and heap.get('on') is not None else 'it is not timed' if isinstance(heap, dict) else 'there is no heap'})")
    for name, a in (bl.get("actors") or {}).items():
        if not isinstance(a, dict): continue
        on, off = a.get("on"), a.get("off")
        if num(on) and on >= hi: out.append(f"the {name} comes on at frame {on}, after the beat ends at {hi}")
        if num(off) and off <= lo: out.append(f"the {name} goes off at frame {off}, before the beat starts at {lo}")
        if num(on) and num(off) and off <= on: out.append(f"the {name} goes off at frame {off}, not after it comes on at {on}")
    for who, o in [(w, bl.get(w)) for w in ("codex", "clawd", "frame", "figure")] + [(n, a) for n, a in (bl.get("actors") or {}).items()]:
        if not isinstance(o, dict) or o.get("at") is None: continue
        ks = o["at"]
        if not (isinstance(ks, list) and ks and all(isinstance(k, dict) and num(k.get("frame")) and num(k.get("x")) for k in ks)): out.append(f"the {who}'s position keys must be a list of {{frame, x, y?}}"); continue
        for k in ks:
            if not lo <= k["frame"] < hi: out.append(f"the {who} has a position key at frame {k['frame']}, outside the beat {lo}-{hi - 1}")
        if any(b["frame"] <= a["frame"] for a, b in zip(ks, ks[1:])): out.append(f"the {who}'s position keys do not run in ascending frames")
    for c in bl.get("contacts") or []:
        if isinstance(c, dict) and num(c.get("frame")) and not lo <= c["frame"] < hi: out.append(f"the contact of the {c.get('a')} and the {c.get('b')} is at frame {c['frame']}, outside the beat {lo}-{hi - 1}")
    return out


# ---------- props apart ----------
# Extents of each placeholder prop relative to its anchor, per unit scale, as (left, top, right, bottom) in stage pixels: the bounding box of the pixels that differ between the animatic's still
# with the prop and without it (render-props.mjs, 1280x720, camera locked), divided by the scale it stood at. The stalk is measured facing left and mirrors when it faces right.
PROP_EXTENT = {"crayon": (-11, -92, 11, 2), "stroke-1": (-11, -194, 43, 11), "stroke-2": (-58, -396, 47, -172), "stroke-3": (-24, -394, 81, -287), "grid": (-122, -242, 122, 3), "pointer": (-304, -296, 10, 10), "title": (-200, -46, 222, 10), "box": (-67, -156, 106, 1), "bubble": (-128, -132, 126, 128), "gadget": (-56, -169, 108, 69), "stalk": (-51, -333, 43, 10), "structure": (-112, -302, 112, 2), "heap": (-88, -64, 88, 4), "lid": (-78, -23, 108, 68), "arch": (-62, -172, 62, 3), "arch-2": (-62, -172, 62, 3), "ring": (-53, -53, 53, 53), "ring-2": (-53, -53, 53, 53), "patch": (-58, -90, 58, 2), "patch-2": (-58, -90, 58, 2), "patch-3": (-58, -90, 58, 2), "bead": (-8, -8, 148, 47), "bead-2": (-8, -8, 148, 47)}
STANDS = ("box", "stalk", "structure", "heap")   # anchored at a foot: it stands on the floor
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
    """The human's body in stage pixels, one shape per key drawn in the beat: (key name, points, radius, the key's film frame), the key's joints and points along its bones, mapped by the skeleton's registration and the blocking's
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
        out.append((k["name"], pts, radius, k["frame"] + origin))
    return out


def shape_depth(shape, rect):
    """How far the disc union `shape` reaches into `rect` (the deepest disc), in stage pixels; 0 or less is clear."""
    _, pts, r = shape[:3]
    return max(r - math.hypot(max(rect[0] - x, 0, x - (rect[0] + rect[2])), max(rect[1] - y, 0, y - (rect[1] + rect[3]))) for x, y in pts)


def held_shapes(figure, f):
    """The shapes of the key the human holds on film frame `f` (the latest key at or before it); every shape when the frame is None or the shapes carry no frame (the control's fixtures)."""
    framed = [sh for sh in figure if len(sh) > 3]
    if f is None or len(framed) != len(figure) or not framed: return list(figure)
    before = [sh for sh in framed if sh[3] <= f]
    return [max(before, key=lambda sh: sh[3])] if before else [min(framed, key=lambda sh: sh[3])]


def rects_of(bl):
    rects = {}
    if isinstance(bl.get("frame"), dict) and all(num(bl["frame"].get(k)) for k in ("x", "y", "width", "height")): f = bl["frame"]; rects["frame"] = (f["x"], f["y"], f["width"], f["height"])
    bs = [b for b in bl.get("blocks") or [] if isinstance(b, dict) and all(num(b.get(k)) for k in ("x", "y", "width", "height"))]
    if bs: x0, y0 = min(b["x"] for b in bs), min(b["y"] for b in bs); rects["blocks"] = (x0, y0, max(b["x"] + b["width"] for b in bs) - x0, max(b["y"] + b["height"] for b in bs) - y0)
    for n, r in identity_boxes(bl).items():
        if n != "human": rects[n] = r
    for n, a in (bl.get("actors") if isinstance(bl.get("actors"), dict) else {}).items():
        if n in PROP_EXTENT and xy(a) and num(a.get("scale")): rects[n] = prop_rect(n, a)
    return rects


def prop_faults(bl, figure, frames=(None,)):
    """Faults of one beat's props: [(kind, text)]. `figure` is `figure_shapes`' list: the human is tested once per key it draws, and "the human" in a declared contact stands for any of them.
    `frames` are the film frames the beat is read on (`resolve_at`): a thing is tested where and while it stands, the human as the key it holds; None reads the file as it is. A fault is reported once, at the first
    frame it shows; a declared contact is stale only if the pair touches on none of the frames."""
    out, seen_text, touching = [], set(), set()
    floor = (bl.get("floor") or {}).get("y")
    declared = {}
    first = resolve_blocking_at(bl, frames[0])
    names_all = set(rects_of(first)) | {"human"}
    for c in bl.get("contacts") or []:
        if not (isinstance(c, dict) and c.get("a") in names_all | set(bl.get("actors") or {}) and c.get("b") in names_all | set(bl.get("actors") or {}) and c["a"] != c["b"] and isinstance(c.get("why"), str) and c["why"].strip()):
            out.append(("contact", f"contact {c!r} must name two things on the stage and say why"))
        else: declared[frozenset((c["a"], c["b"]))] = c
    def add(kind, text, f):
        if text not in seen_text: seen_text.add(text); out.append((kind, text if f is None else f"{text} (from frame {f})"))
    for f in frames:
        cur = resolve_blocking_at(bl, f); rects = rects_of(cur); shapes = held_shapes(figure, f)
        if isinstance(bl.get("figure"), dict) and isinstance(cur.get("figure"), dict):      # the human travels (`figure.at`): the key's body is drawn where the placement stands on this frame
            dx, dy = cur["figure"]["x"] - bl["figure"]["x"], cur["figure"]["y"] - bl["figure"]["y"]
            if dx or dy: shapes = [(sh[0], [(x + dx, y + dy) for x, y in sh[1]], *sh[2:]) for sh in shapes]
        acts = cur.get("actors") if isinstance(cur.get("actors"), dict) else {}
        for n, a in acts.items():
            if n in PROP_EXTENT and xy(a) and num(a.get("scale")) and n in STANDS and not a.get("carriedBy") and not a.get("standsOn") and num(floor) and not (floor + FLOOR_BAND[0] <= a["y"] <= floor + FLOOR_BAND[1]):
                add("air", f"the {n} stands at y {a['y']:g}, {abs(a['y'] - floor):g} px {'above' if a['y'] < floor else 'below'} the floor line {floor:g} (a foot belongs within {FLOOR_BAND[0]} to +{FLOOR_BAND[1]})", f)
        for n, r in rects.items():
            if n in PROP_EXTENT and (r[0] < -TOUCH or r[1] < -TOUCH or r[0] + r[2] > STAGE[0] + TOUCH or r[1] + r[3] > STAGE[1] + TOUCH):
                add("stage", f"the {n} reaches ({r[0]:.0f}, {r[1]:.0f}) to ({r[0] + r[2]:.0f}, {r[1] + r[3]:.0f}), off the {STAGE[0]}x{STAGE[1]} stage", f)
        def hits(m, n):
            if m == "human" or n == "human":
                other = n if m == "human" else m
                return [(f"human ({sh[0]})", other, (d, d)) for sh in shapes for d in [shape_depth(sh, rects[other])] if d > TOUCH]
            w, h = overlap_amount(rects[m], rects[n])
            return [(m, n, (w, h))] if min(w, h) > TOUCH else []
        names = sorted(rects) + (["human"] if shapes else [])
        for i, m in enumerate(names):
            for n in names[i + 1:]:
                if {m, n} <= {"human", "codex", "clawd"}: continue   # the identity boxes against the human are `identity boxes apart`, read on the figure crop
                hit = hits(m, n); key = frozenset((m, n))
                if hit: touching.add(key)
                if hit and key not in declared: x, y, (w, h) = max(hit, key=lambda t: t[2][0] * t[2][1]); add("overlap", f"the {x} and the {y} overlap by {w:.0f}{'' if x.startswith('human') else f' x {h:.0f}'} px and no contact is declared", f)
    for key, d in declared.items():
        a, b = sorted(key)
        if key not in touching: out.append(("contact", f"the contact of the {a} and the {b} ({d['why']!r}) is declared but they do not overlap" + ("" if frames == (None,) else " on any frame of the beat")))
        if num(d.get("frame")) and frames != (None,):
            cur = resolve_blocking_at(bl, d["frame"]); rects = rects_of(cur)
            if a in rects and b in rects:
                w, h = overlap_amount(rects[a], rects[b])
                if min(w, h) < -TOUCH: out.append(("contact", f"the {a} and the {b} are declared to touch on frame {d['frame']} ({d['why']!r}) and are {-min(w, h):.0f} px apart"))
        mv = d.get("moves")
        if mv is not None and frames != (None,):
            who = (bl.get("actors") or {}).get(mv.get("actor")) if isinstance(mv, dict) else None
            lo_hi = mv.get("by") if isinstance(mv, dict) else None
            if not (who and num(d.get("frame")) and isinstance(lo_hi, list) and len(lo_hi) == 2): out.append(("contact", f"contact {d!r}: `moves` needs a prop of `actors`, a contact `frame` and `by: [lo, hi]`")); continue
            a0, a1 = resolve_blocking_at(bl, d["frame"] - 1)["actors"][mv["actor"]], resolve_blocking_at(bl, d["frame"] + AFTER_CONTACT)["actors"][mv["actor"]]
            shift = math.hypot(a1["x"] - a0["x"], a1["y"] - a0["y"])
            if not lo_hi[0] <= shift <= lo_hi[1]: out.append(("contact", f"the {mv['actor']} moves {shift:.1f} px between frame {d['frame'] - 1} and {d['frame'] + AFTER_CONTACT}; the contact declares {lo_hi[0]} to {lo_hi[1]}"))
    return out


ACTORS_SOURCE = ("src", "library", "worlds", "actors.tsx")


def actor_table_faults(source):
    """Faults of the two actor tables against the actors.tsx text `source`: [text]. The names are read from `ACTOR_NAMES` and from the `ActorName` union; each must be in `probe_common.PROP_NATIVE` and in `PROP_EXTENT`."""
    m_list = re.search(r"ACTOR_NAMES[^=]*=\s*\[([^\]]*)\]", source); m_union = re.search(r"type\s+ActorName\s*=\s*([^;]+);", source)
    if not m_list or not m_union: return ["actors.tsx no longer declares `ACTOR_NAMES` and `type ActorName` where this probe reads them"]
    names = set(re.findall(r"'([A-Za-z_]+)'", m_list.group(1))) | set(re.findall(r"'([A-Za-z_]+)'", m_union.group(1)))
    return [f"actors.tsx draws {n!r} and {where} has no entry for it" for n in sorted(names) for where, table in (("probe_common.PROP_NATIVE", PROP_NATIVE), ("probe-blocking.PROP_EXTENT", PROP_EXTENT)) if n not in table]


def check_blocking(tl, ledger, blocks, exempt, episode_root=None, skeleton=None):
    acts = {b["id"]: sorted({a["actor"] for a in b.get("actions", [])}) for b in ledger.get("beats", [])}
    pr = {"files": [], "actors": [], "emitter": [], "card": [], "boxes": [], "time": [], "props": []}
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
        sheet = os.path.join(episode_root, "poses", f"{bl.get('poseShot')}.json") if episode_root and bl.get("poseShot") else None
        drops = [c["dropsAt"] for c in (read_json(sheet, "pose sheet").get("secondaries") or []) if isinstance(c, dict) and num(c.get("dropsAt"))] if sheet and os.path.exists(sheet) else []
        tf = time_faults(bl, b, drops); pr["time"] += [f"beat {b['id']!r}: {t}" for t in tf]
        fig = figure_shapes(bl, b, episode_root, skeleton, starts.get(bl.get("poseShot") or bl.get("shot"))) if episode_root and skeleton else []
        frames = tuple(timed_frames(bl, b, [sh[3] for sh in fig if len(sh) > 3 and b["start"] <= sh[3] < b["end"]])) if not tf else (None,)
        said = set()
        for f in frames:
            bx = identity_boxes(resolve_blocking_at(bl, f)); names = sorted(bx)
            for i, m in enumerate(names):
                for n in names[i + 1:]:
                    if overlap(bx[m], bx[n]) and (m, n) not in said: said.add((m, n)); pr["boxes"].append(f"beat {b['id']!r}: the {m} box and the {n} box overlap" + ("" if f is None else f" (from frame {f})"))
        for _, text in prop_faults(bl, fig, frames): pr["props"].append(f"beat {b['id']!r}: {text}")
    known = {b["id"] for b in tl["beats"]} | {"test-scene"}
    extra = sorted(set(blocks) - known)
    msg = {"files": ("one file per beat", f"{len(tl['beats'])} beats, {len(blocks)} blocking files"), "actors": ("actors positioned and scaled", "every actor the ledger names is placed"),
           "emitter": ("emitter inside the frame", "emitter start and end inside the frame on every beat"), "card": ("composition card cited", "every beat cites a card"),
           "boxes": ("identity boxes apart", "Codex, Clawd and the human's crop never overlap"),
           "time": ("props and positions timed inside their beat", "every `on`, `off`, position key and contact frame lies inside its beat, a prop comes on before it goes off, and a shifted prop moves as its contact declares"),
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
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"heap": {"x": 400, "y": 470, "scale": 1.0, "on": 30}}}); cases["a prop on after its beat has ended"] = c   # beat a is frames 0-29
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"heap": {"x": 400, "y": 470, "scale": 1.0, "on": 20, "off": 10}}}); cases["a prop that goes off before it comes on"] = c
    c = copy.deepcopy(block); c["a"]["clawd"]["at"] = [{"frame": 10, "x": 1400}, {"frame": 45, "x": 940}]; cases["a position key outside its beat"] = c
    c = copy.deepcopy(block); c["a"].update({"floor": {"y": 480}, "actors": {"heap": {"x": 600, "y": 470, "scale": 1.0}, "stalk": {"x": 600, "y": 470, "scale": 0.5, "on": 20}}}); cases["a prop that comes on over another"] = c   # not overlapping before frame 20
    nudge = lambda dx: {"floor": {"y": 480}, "actors": {"heap": {"x": 240, "y": 470, "scale": 1.0, "at": [{"frame": 6, "x": 240}, {"frame": 10, "x": 240 + dx}]}}, "contacts": [{"a": "codex", "b": "heap", "frame": 5, "why": "Codex's foot meets the heap", "moves": {"actor": "heap", "by": [4, 12]}}]}
    c = copy.deepcopy(block); c["a"].update(nudge(20)); cases["a heap that a contact says moves 4 to 12 px and moves 20"] = c
    declared = copy.deepcopy(block); declared["a"].update({**stage, "contacts": [{"a": "box", "b": "bubble", "why": "the bubble rises out of the open box"}]})
    timed = copy.deepcopy(block); timed["a"].update({"floor": {"y": 480}, "actors": {"stalk": {"x": 600, "y": 470, "scale": 0.5, "off": 10}, "heap": {"x": 600, "y": 470, "scale": 1.0, "on": 12}}})   # at one place, never on stage together
    nudged = copy.deepcopy(block); nudged["a"].update(nudge(8))   # moves 8 px: inside the 4 to 12 the contact declares
    return normalise_timeline(tl), ledger, block, cases, ((declared, timed, nudged))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("timeline"); ap.add_argument("blocking_dir"); ap.add_argument("--ledger", default=None)
    ap.add_argument("--exempt", default="world", help="comma-separated pseudo-actors that need no position"); ap.add_argument("--json", default=None)
    ap.add_argument("--shot", default=None, help="check one shot's beats only")
    a = ap.parse_args(); exempt = set(filter(None, a.exempt.split(",")))
    pr = Probe("blocking-contract", a.json)
    tl0, ledger0, block0, cases, (declared0, timed0, nudged0) = planted()
    clean = [c for c in check_blocking(tl0, ledger0, block0, exempt)[0] + check_blocking(tl0, ledger0, declared0, exempt)[0] + check_blocking(tl0, ledger0, timed0, exempt)[0] + check_blocking(tl0, ledger0, nudged0, exempt)[0] if not c[1]]
    tripped = {n: [c for c in check_blocking(tl0, ledger0, b, exempt)[0] if not c[1]] for n, b in cases.items()}
    # the scaffold beats: a stalk in the air is fine when the human carries it or it is set on something (`standsOn`), and still refused when it is neither (the case "a stalk in the air" above is the same stalk with neither)
    air = {"floor": {"y": 480}, "actors": {"stalk": {"x": 900, "y": 300, "scale": 0.5, "facing": "left"}}}
    held0 = copy.deepcopy(block0); held0["a"].update({"floor": {"y": 480}, "actors": {"stalk": {**air["actors"]["stalk"], "carriedBy": "human"}}})
    set0 = copy.deepcopy(block0); set0["a"].update({"floor": {"y": 480}, "actors": {"stalk": {**air["actors"]["stalk"], "standsOn": "blocks"}}})
    clean_air = [c for c in check_blocking(tl0, ledger0, held0, exempt)[0] + check_blocking(tl0, ledger0, set0, exempt)[0] if not c[1]]
    neither0 = copy.deepcopy(block0); neither0["a"].update(air); tripped["a half-size stalk in the air that nobody carries and nothing holds"] = [c for c in check_blocking(tl0, ledger0, neither0, exempt)[0] if not c[1]]
    body = copy.deepcopy(block0["a"]); body.update({"floor": {"y": 480}, "actors": {"box": {"x": 600, "y": 450, "scale": 1.0}}})
    near, far = [("lean", [(560, 330)], 40)], [("lean", [(300, 100)], 40)]
    heap_beat = {**copy.deepcopy(block0["a"]), "actors": {"heap": {"x": 600, "y": 470, "scale": 1.0, "on": 20}}}
    tripped["a heap that lands on another frame than the cloak drops"] = [("props and positions timed inside their beat", False, t) for t in time_faults(heap_beat, tl0["beats"][0], [10])]
    clear_heap = time_faults(heap_beat, tl0["beats"][0], [20])
    drawn = "export type ActorName = 'box' | 'heap' | 'lantern';\nexport const ACTOR_NAMES: readonly ActorName[] = ['box', 'heap', 'lantern'];\n"
    walker = {**copy.deepcopy(body), "figure": {"scale": 1.0, "x": 0, "y": 0, "at": [{"frame": 0, "x": 0}, {"frame": 10, "x": 300}]}}; stands = [("lean", [(300, 300)], 40, 0)]
    tripped["a human who travels into a prop nothing declares"] = [("props apart", False, t) for k, t in prop_faults(walker, stands, (0, 10)) if k == "overlap"]
    still = [t for _, t in prop_faults({**walker, "figure": {k: v for k, v in walker["figure"].items() if k != "at"}}, stands, (0, 10))]
    tripped["an actor the renderer draws that PROP_NATIVE and PROP_EXTENT lack"] = [("actor tables", False, t) for t in actor_table_faults(drawn)]
    clear_tables = [t for t in actor_table_faults(drawn.replace("'lantern'", "'bubble'"))]
    tripped["a prop inside the human's body"] = [("props apart", False, t) for k, t in prop_faults(body, near) if k == "overlap"]
    clear_of_body = [t for _, t in prop_faults(body, far)]
    pr.control(not clean and not clean_air and not clear_of_body and not clear_heap and not clear_tables and not still and all(tripped.values()), "; ".join(f"{n} -> {'FAIL (' + v[0][0] + ')' if v else 'NOT REFUSED'}" for n, v in tripped.items()) + f"; clean fixture, a stalk in the air that the human carries and one set on the blocks, the same two overlapping props with their contact declared, two props at one place that are never on stage together, a heap that moves 8 px against a declared 4 to 12, a heap that comes on the frame the cloak drops, a human who stays where she is beside the same prop, and actor names every table carries -> pass ({len(clean)} failures)")
    tl, _, _, shot_note = apply_shot(a, load_timeline(a.timeline)); raw = tl["source"]
    if shot_note: pr.note(shot_note)
    lp = a.ledger or raw.get("ledger") or next((b.get("ledgerPath") for b in tl["beats"] if b.get("ledgerPath")), None) or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "beats-v2.json")
    ledger = read_json(lp, "ledger")
    blocks = load_blocks(a.blocking_dir)
    episode_root = os.path.dirname(os.path.abspath(a.blocking_dir)); skeleton_path = os.path.join(os.path.dirname(episode_root), "assets", "human", "skeleton.json")
    checks, extra = check_blocking(tl, ledger, blocks, exempt, episode_root, read_json(skeleton_path, "skeleton registration"))
    for name, ok, text in checks: pr.check(name, ok, text)
    actors_path = os.path.join(os.path.dirname(episode_root), *ACTORS_SOURCE)
    if os.path.exists(actors_path):
        faults = actor_table_faults(open(actors_path, encoding="utf8").read())
        pr.check("actor tables", not faults, "; ".join(faults) if faults else f"every actor src/library/worlds/actors.tsx draws has a native size and an extent ({', '.join(sorted(PROP_NATIVE))})")
    else: pr.note(f"actor tables not read: {actors_path} does not exist")
    if extra: pr.note(f"blocking files naming no beat (ignored): {extra}")
    pr.finish(f"{len(tl['beats'])} beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart, props apart")


if __name__ == "__main__": main()
