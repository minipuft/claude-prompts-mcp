#!/usr/bin/env python3
"""Synthetic control fixtures for scripts/animation/probe-*.py: deterministic (seeded), 320x180, at most 48 frames, drawn with PIL.

The probes import this module and build their controls in memory; `python3 scripts/animation/fixtures/make.py write [outdir]` writes the same
fixtures to disk (default fixtures/generated/) as element-NNN.png sequences plus timeline.json / xsheet.json / shots.json / light.json, so
`probe-twos.py fixtures/generated/twos-bad --timeline fixtures/generated/twos-bad/timeline.json --xsheet ...` can be run by hand.
"""
import json, os, sys, copy
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # probe_common lives one level up
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

SEED = 20261014
W, H = 320, 180
S = W / 1280                    # frame pixels per stage pixel
PAD = 80                        # extra world columns either side, for camera pans
N = 48
FIELD = (2, 5, 11)
INK = (238, 226, 204)
CODEX, CLAWD = (0x4f, 0x7d, 0xf2), (0xe8, 0x69, 0x4a)


def hsv(h, s=1.0, v=1.0):
    import colorsys
    return tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb((h % 360) / 360, s, v))


def hexof(rgb): return "#%02x%02x%02x" % tuple(rgb)


# ---------- contracts ----------
def xsheet_rows(n, beat="b1", world="home", camera=None, emitter=None, phase=None, keys=None):
    """Rows in the shape the probes read: frame, beat, world, key, breakdown, camera, emitter, phase. Callables take the frame number."""
    rows = []
    for f in range(n):
        rows.append({"frame": f, "beat": beat(f) if callable(beat) else beat, "world": world(f) if callable(world) else world,
                     "key": (keys or {}).get(f), "breakdown": None,
                     "camera": camera(f) if camera else {"x": 640, "y": 360, "zoom": 1, "rot": 0},
                     "emitter": emitter(f) if emitter else None, "phase": phase(f) if phase else "home"})
    return rows


def timeline_fixture():
    """Four beats, three crossings; the compiled shape (durationInFrames, top-level crossings)."""
    beats = [("a", 0, 30, "home"), ("b", 30, 66, "crayon"), ("c", 66, 96, "line"), ("d", 96, 120, "home")]
    wins = [("a", "b", 24, 36), ("b", "c", 60, 72)]
    return {"fps": 30, "durationInFrames": 120,
            "beats": [{"id": i, "index": k, "start": s, "end": e, "frames": e - s, "world": w, "worldRaw": w} for k, (i, s, e, w) in enumerate(beats)],
            "crossings": [{"from": f, "to": t, "start": a, "end": b, "length": b - a} for f, t, a, b in wins]}


def xsheet_for_timeline(tl):
    def beat(f): return next(b["id"] for b in tl["beats"] if b["start"] <= f < b["end"])
    def world(f): return next(b["world"] for b in tl["beats"] if b["start"] <= f < b["end"])
    return xsheet_rows(tl["durationInFrames"], beat=beat, world=world, phase=lambda f: world(f))


def shifted_timeline(tl, beat_id, frames):
    """The control for screen time: beat `beat_id` starts `frames` later (the beat before it ends later)."""
    t = copy.deepcopy(tl)
    i = next(k for k, b in enumerate(t["beats"]) if b["id"] == beat_id)
    t["beats"][i]["start"] += frames; t["beats"][i - 1]["end"] += frames
    for b in (t["beats"][i], t["beats"][i - 1]): b["frames"] = b["end"] - b["start"]
    return t


# ---------- twos / holds scene ----------
def _base():
    rng = np.random.default_rng(SEED)
    base = np.empty((H, W + 2 * PAD, 3), np.uint8); base[:] = FIELD
    blocks = rng.integers(0, 7, size=(H // 6, (W + 2 * PAD) // 6, 1), dtype=np.uint8)
    base += np.kron(blocks, np.ones((6, 6, 3), np.uint8))               # static seeded 6 px blocks: a camera move is visible everywhere, and the PNGs stay small
    base[:, ::24] = (40, 48, 70)
    return base
_BASE = _base()


def scene(pose, cam_x=640, extra=None):
    """The world canvas with the figure at pose id `pose`, read out through a camera at stage x `cam_x` (1 stage-quarter pixel per frame pixel)."""
    img = Image.fromarray(_BASE.copy()); d = ImageDraw.Draw(img)
    ox = PAD
    d.ellipse([ox + 140, 36, ox + 160, 56], fill=INK)                      # head
    d.rectangle([ox + 142, 58, ox + 158, 110], fill=INK)                   # torso
    d.rectangle([ox + 142, 110, ox + 149, 150], fill=INK); d.rectangle([ox + 151, 110, ox + 158, 150], fill=INK)
    a = np.deg2rad(-90 + 25 * (pose % 12))
    d.line([ox + 150, 66, ox + 150 + 44 * np.cos(a), 66 + 44 * np.sin(a)], fill=INK, width=5)   # the arm is the part that moves
    if extra: extra(d, ox)
    arr = np.array(img)
    shift = int(round((cam_x - 640) * S))
    return arr[:, PAD + shift: PAD + shift + W].copy()


def pose_ids(change_frames, n=N):
    return [sum(1 for c in change_frames if c <= f) for f in range(n)]


def twos_sequence(bad=False, jump_frame=None):
    """Pose changes on even frames only (bad: plus one on frame 7; jump_frame: plus one on that frame, e.g. an odd frame inside a crossing window); the camera pans every frame."""
    ids = pose_ids({4, 10, 16, 22, 28, 34, 40} | ({7} if bad else set()) | ({jump_frame} if jump_frame is not None else set()))
    cam = lambda f: {"x": 640 + 4 * f, "y": 360, "zoom": 1, "rot": 0}
    frames = [scene(ids[f], 640 + 4 * f) for f in range(N)]
    return frames, xsheet_rows(N, camera=cam)


def holds_ids(kind):
    if kind == "good":      return [0] * 16 + [1, 1, 2, 2, 3, 3, 4, 4] + [5] * 16 + [6, 6, 7, 7, 8, 8, 9, 9]
    if kind == "hold40":    return [0] * 40 + [1, 1, 2, 2, 3, 3, 4, 4]
    if kind == "onedraw":   return [0] * 16 + [1] * 2 + [2] * 16 + [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]
    raise KeyError(kind)


def holds_sequence(kind):
    declared = kind == "hold40-declared"
    jump = kind in ("crossing-jump", "crossing-keyed")
    ids = holds_ids("hold40" if declared else "good" if jump else kind)
    if jump: ids = ids[:28] + [i + 20 for i in ids[28:]]                  # a pose jump on frame 28, inside the crossing window 24-39
    keys = {f: f"P{ids[f]}" for f in range(1, len(ids)) if ids[f] != ids[f - 1]}     # every change is a key row: the probe reads boil as any change without one
    if kind == "crossing-jump": keys.pop(28)                              # ...except the planted jump: nothing on the sheet accounts for it
    if declared: keys[0] = {"id": "K1", "hold": 40}
    return [scene(i) for i in ids], xsheet_rows(N, keys=keys)


# ---------- eye trace ----------
def emitter_at(f): return {"x": 300 + 20 * f, "y": 300, "hex": "#fad204"}


def eye_frame(f, offset_pct=0.0, with_identity=True):
    """Dark frame, a soft grey blob at the emitter (offset_pct of frame width to the right), and an identity-pigment patch brighter than the blob."""
    a = np.empty((H, W, 3), np.float32); a[:] = FIELD
    e = emitter_at(f); cx, cy = e["x"] * S + offset_pct / 100 * W, e["y"] * S
    yy, xx = np.mgrid[0:H, 0:W]
    g = 150 * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * 6 ** 2))
    a += g[..., None]
    a = np.clip(a, 0, 255).astype(np.uint8)
    if with_identity:
        a[10:34, 10:34] = CODEX; a[150:174, 280:304] = CLAWD
        a[10:34, 250:274] = (0xe7, 0xe4, 0xda); a[60:84, 10:34] = (0xd9, 0xe5, 0xe3)       # the human's cream (settled.human.light) and the kit's pale (settled.kit.light)
    return a


def eye_sequence(offset_pct=0.0, n=N):
    return [eye_frame(f, offset_pct) for f in range(n)], xsheet_rows(n, emitter=emitter_at)


# ---------- loop ----------
def _silhouette(f, pose=None):
    m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
    d.ellipse([140, 30, 164, 54], fill=255)
    d.rectangle([140, 52, 164, 112], fill=255)
    a = np.deg2rad(-90 + 10 * ((f // 2) % 6 if pose is None else pose % 6))
    d.line([152, 64, 152 + 44 * np.cos(a), 64 + 44 * np.sin(a)], fill=255, width=7)
    d.rectangle([140, 110, 150, 160], fill=255); d.rectangle([154, 110, 164, 160], fill=255)
    return np.array(m) > 0


def loop_frame(f, cut=False):
    """A closed outline (2 px) of the figure's silhouette in pale ink on the field; `cut` erases a 4 px band across the shins (measure-worlds.py loop's control)."""
    m = _silhouette(f); edge = m & ~ndi.binary_erosion(m, iterations=2)
    a = np.empty((H, W, 3), np.uint8); a[:] = FIELD; a[edge] = INK
    if cut:
        ys = np.nonzero(edge.any(axis=1))[0]; y = int(ys.min() + 0.75 * (ys.max() - ys.min())); a[y:y + 4, :] = FIELD
    return a


def loop_sequence(cut_frames=()):
    frames = [loop_frame(f, f in cut_frames) for f in range(N)]
    return frames, xsheet_rows(N, phase=lambda f: "line" if 8 <= f < 40 else "home", world=lambda f: "line" if 8 <= f < 40 else "home")


# ---------- all probes at once (probe-all's pass path) ----------
def combined_sequence():
    """One line-world beat that every frame probe can pass: a dim closed outline held 16 frames, a 4-drawing move on twos, a held 16 and a
    trailing move (holds_ids('good')); a blue radiance block, a dim accent patch and Clawd's pigment patch; a white blob on the emitter path."""
    ids = holds_ids("good"); frames = []
    ink = (40, 52, 80)
    for f in range(N):
        m = _silhouette(f, ids[f]); edge = m & ~ndi.binary_erosion(m, iterations=2)
        a = np.empty((H, W, 3), np.float32); a[:] = FIELD
        a[edge] = ink
        a[100:160, 10:80] = hex_rgb_(PAIR_A[0]); a[20:26, 250:256] = (125, 105, 2); a[150:174, 280:304] = CLAWD
        e = combined_emitter(f); yy, xx = np.mgrid[0:H, 0:W]
        a += (255 * np.exp(-((xx - e["x"] * S) ** 2 + (yy - e["y"] * S) ** 2) / (2 * 8 ** 2)))[..., None]
        frames.append(np.clip(a, 0, 255).astype(np.uint8))
    tl = {"fps": 30, "durationInFrames": N, "beats": [{"id": "a", "index": 0, "start": 0, "end": N, "frames": N, "world": "line"}], "crossings": []}
    xs = xsheet_rows(N, beat="a", world="line", phase=lambda f: "line", emitter=combined_emitter)
    return frames, tl, xs, {"shots": [{"id": "s", "beat": ["a"], "hue": {"radiance": PAIR_A[0], "accent": PAIR_A[1]}}]}


def combined_emitter(f): return {"x": 1000 + 5 * f, "y": 300, "hex": "#ffffff"}


def hex_rgb_(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


# ---------- colour ----------
PAIR_A = ("#0a51fb", "#fad204")    # D74 s01
PAIR_B = ("#e1750c", "#fad204")    # D74 s03


def colour_timeline():
    return {"fps": 30, "durationInFrames": N,
            "beats": [{"id": "a", "index": 0, "start": 0, "end": 24, "frames": 24, "world": "home"},
                      {"id": "b", "index": 1, "start": 24, "end": 48, "frames": 24, "world": "crayon"}],
            "crossings": [{"from": "a", "to": "b", "start": 14, "end": 34, "length": 20}]}


def colour_shots():
    return {"shots": [{"id": "sa", "beat": ["a"], "hue": {"radiance": PAIR_A[0], "accent": PAIR_A[1]}},
                      {"id": "sb", "beat": ["b"], "hue": {"radiance": PAIR_B[0], "accent": PAIR_B[1]}}]}


def _hue_of_hex(h):
    from probe_common import hex_rgb, hue_of
    return hue_of(hex_rgb(h))


def colour_frame(f, patch=False, path="direct"):
    """Radiance blob + accent patch + Clawd's pigment patch. Inside the crossing (14..33) the blob's hue walks from the from-beat's radiance to the
    to-beat's: path 'direct' on the shortest arc, 'detour' through green first. `patch`: a magenta 24x24 patch off both pairs."""
    a = np.empty((H, W, 3), np.uint8); a[:] = FIELD
    hA, hB = _hue_of_hex(PAIR_A[0]), _hue_of_hex(PAIR_B[0])
    arc = ((hB - hA + 180) % 360) - 180
    if f < 14: col, acc = PAIR_A[0], PAIR_A[1]
    elif f >= 34: col, acc = PAIR_B[0], PAIR_B[1]
    else:
        t = (f - 14) / 19
        if path == "detour": h = hA + (-140 * np.sin(np.pi * t) + arc * t)  # swings down toward green mid-crossing, then on to the end
        else: h = hA + arc * t
        col, acc = hexof(hsv(h, 0.95, 0.95)), None
    a[40:140, 60:200] = [int(col[i:i + 2], 16) for i in (1, 3, 5)]
    if acc: a[40:60, 210:250] = [int(acc[i:i + 2], 16) for i in (1, 3, 5)]
    a[150:174, 280:304] = CLAWD
    a[60:84, 260:284] = (0xc8, 0x32, 0x3a); a[100:124, 10:34] = (0x2f, 0x45, 0xa8)          # the kit's accent and the human's main1: saturated, off both pairs, fixed per palette
    if patch: a[100:124, 260:284] = hsv(300, 1, 1)
    return a


def colour_sequence(patch_frames=(), path="direct"):
    return [colour_frame(f, f in patch_frames, path) for f in range(N)], colour_timeline(), colour_shots()


def glow_frame(hexc, with_blob=True):
    """The field with a soft glow of colour `hexc` centred on the emitter (stage 640, 360 = frame 160, 90; peak 0.9 of the colour, sigma 14 px), the way an additive light lays on a dark ground:
    a pale tint keeps its hue at low chroma, which the saturated-pixel check cannot see and `radiance_hue` reads."""
    a = np.empty((H, W, 3), np.float32); a[:] = FIELD
    if with_blob:
        yy, xx = np.mgrid[0:H, 0:W]; g = 0.9 * np.exp(-((xx - 160) ** 2 + (yy - 90) ** 2) / (2 * 14 ** 2))
        a += g[..., None] * np.array(hex_rgb_(hexc), np.float32)
    return np.clip(a, 0, 255).astype(np.uint8)


# ---------- light contract (probe-colour --contract) ----------
def light_contract(overlap=False, detour=False, tight=False):
    tl = timeline_fixture()
    pairs = {"a": ("#0a51fb", "#fad204"), "b": ("#e1750c", "#fad204"), "c": ("#e1750c", "#fad204"), "d": ("#a63a2e", "#f8c496")}
    emit = {"a": (0, 28), "b": (31, 64), "c": (None, None), "d": (97, 120)}
    if overlap: emit["b"] = (26, 64)            # b is on while a is still on: two emitters live on frames 26..27
    if tight: emit["b"] = (29, 64)              # a hands off one frame apart: light does not lag drawing
    beats = {}
    for b in tl["beats"]:
        on, off = emit[b["id"]]
        e = {"anchor": "dial", "start": [0.4, 0.8], "end": [0.6, 0.5], "intensity": 0.8, "colour": pairs[b["id"]][0], "on": on, "off": off} if on is not None else None
        beats[b["id"]] = {"pair": {"radiance": pairs[b["id"]][0], "accent": pairs[b["id"]][1]}, "emitter": e, "radiance": "settled", "grain": "low"}
    cr = [{"from": "a", "to": "b", "frames": [24, 36], "path": ["#0a51fb", "#8a20ff", "#ff2090", "#e1750c"]},
          {"from": "b", "to": "c", "frames": [60, 72], "path": ["#e1750c", "#e1750c"]}]
    if detour: cr[0]["path"] = ["#0a51fb", "#10b0a0", "#a030e0", "#e1750c"]   # swings to green, then back round to the end
    return {"beats": beats, "crossings": cr}, tl


# ---------- blocking ----------
def blocking_fixture():
    """A ledger, a timeline and one blocking per beat. Beat 'a' is in the shape of v3/blocking/*.json (figure/codex/clawd at the top level),
    the others in the shape the animation_blocking prompt describes (an `actors` map); both carry an `emitter` and a `card`."""
    tl = timeline_fixture()
    ledger = {"beats": [{"id": "a", "actions": [{"actor": "human", "does": "reaches"}, {"actor": "codex", "does": "leans in"}, {"actor": "clawd", "does": "leans in"}, {"actor": "world", "does": "n/a"}]},
                        {"id": "b", "actions": [{"actor": "human", "does": "draws"}]},
                        {"id": "c", "actions": [{"actor": "human", "does": "steps"}]},
                        {"id": "d", "actions": [{"actor": "codex", "does": "waves"}, {"actor": "clawd", "does": "waves"}]}]}
    common = {"emitter": {"start": {"x": 0.35, "y": 0.88}, "end": {"x": 0.6, "y": 0.48}}, "card": "eagle-abc", "derivedFrom": "test-scene", "provisional": True}
    def payload(actors):
        return {**common, "actors": {n: {"x": x, "y": y, "scale": sc, "facing": "right"} for n, (x, y, sc) in actors.items()}}
    block = {"a": {**common, "id": "a", "beat": "a", "figure": {"scale": 0.68, "x": 420, "y": 40}, "codex": {"x": 60, "y": 440, "scale": 1.8},
                   "clawd": {"x": 940, "y": 470, "scale": 1.5}, "figureCrop": {"x": 380, "y": 0, "width": 500, "height": 720}},
             "b": payload({"human": (420, 40, 0.68)}), "c": payload({"human": (420, 40, 0.68)}),
             "d": payload({"codex": (60, 440, 1.8), "clawd": (940, 470, 1.5)})}
    return tl, ledger, block


# ---------- writer ----------
# ---------- poses (probe-poses.py, probe-inbetweens.py) ----------
POSE_H = 880.0                  # figure height in the synthetic key sheets' space
BONES = (("root", "torso"), ("torso", "neck"), ("neck", "head"), ("torso", "shoulderL"), ("shoulderL", "elbowL"), ("elbowL", "wristL"), ("torso", "shoulderR"),
         ("shoulderR", "elbowR"), ("elbowR", "wristR"), ("root", "hipL"), ("hipL", "kneeL"), ("kneeL", "ankleL"), ("root", "hipR"), ("hipR", "kneeR"), ("kneeR", "ankleR"))


def pose_joints(x0=300.0, offs=(0.0, 0.0, 0.0), lean=0.0, arms="asym", foot="both", over=0.5, stance=210.0, ground=900.0, dy=0.0, arm_shift=(0.0, 0.0)):
    """A 17-joint figure (the rig's names) with the spine's shoulder midpoint, torso and neck offset from the root-to-head chord by `offs` (fractions of
    POSE_H), arms mirrored (`twin`) or not (`asym`), and the root over the declared foot (`over` of the way from the other ankle to that one)."""
    root = np.array([x0, 640.0 + dy]); head = root + np.array([lean, -299.0]); c = head - root; n = np.array([-c[1], c[0]]) / np.hypot(*c)
    mid, torso, neck = (root + t * c + n * o * POSE_H for t, o in zip((0.75, 0.88, 0.94), offs))
    sh = {"L": mid - np.array([60.0, 0]), "R": mid + np.array([60.0, 0])}
    el = {"L": sh["L"] + np.array([-40.0, 110]), "R": sh["R"] + (np.array([40.0, 110]) if arms == "twin" else np.array([70.0, 60]))}
    wr = {"L": el["L"] + np.array([-70.0, 90]), "R": el["R"] + (np.array([70.0, 90]) if arms == "twin" else np.array([110.0, -30]))}
    wr["R"] = wr["R"] + np.array(arm_shift)
    if foot == "both": xl, xr = x0 - stance / 2, x0 + stance / 2
    elif foot == "R": xl = x0 - over * stance; xr = xl + stance
    else: xr = x0 + over * stance; xl = xr - stance
    j = {"root": root, "torso": torso, "neck": neck, "head": head, "shoulderL": sh["L"], "shoulderR": sh["R"], "elbowL": el["L"], "elbowR": el["R"], "wristL": wr["L"], "wristR": wr["R"],
         "hipL": root - np.array([28.0, 0]), "hipR": root + np.array([28.0, 0]), "ponchoPoint": root + np.array([6.0, -5.0])}
    for side, x in (("L", xl), ("R", xr)):
        hip = j["hip" + side]; ank = np.array([x, ground]); j["ankle" + side] = ank
        j["knee" + side] = (hip + ank) / 2 + np.array([-18.0 if side == "L" else 18.0, 0])
    return {k: [round(float(v[0]), 2), round(float(v[1]), 2)] for k, v in j.items()}


def _pkey(name, frame, hold, cls, bow, sign, foot, over, moment, lead=("R", "L"), twinned=None, inflection=None):
    loa = {"class": cls, "bow": bow, "sign": sign}
    if inflection is not None: loa["inflection"] = inflection
    k = {"name": name, "frame": frame, "hold": hold, "moment": moment, "lineOfAction": loa, "weight": {"foot": foot, "over": over},
         "lead": {"arm": lead[0], "leg": lead[1]}, "silhouette": "open"}
    if twinned: k["twinned"] = {"why": twinned}
    return k


def _fixture_marks(kind):
    """(frame, favour, kind) of the breakdowns of the 20-frame move A -> B (A's hold ends on frame 20). `clean`: an anticipation at -0.10 along the chord, a passing drawing at 0.30, an
    overshoot at 1.10 and a settle at 0.95, four drawings. `ten-drawings`: ten passing drawings, one per twos. `early-passing`: the clean move with its passing drawing at 0.10."""
    if kind == "ten-drawings": return [(20 + 2 * i, v, "passing") for i, v in enumerate((0.26, 0.30, 0.34, 0.38, 0.42, 0.46, 0.54, 0.58, 0.62, 0.66))]
    return [(22, 0.4, "anticipation"), (28, 0.1 if kind == "early-passing" else 0.3, "passing"), (32, 0.4, "overshoot"), (36, 0.95, "settle")]


def pose_fixture(kind):
    """(pose sheet, key sheet, chart) of two keys 40 frames apart for probe-poses.py. `clean`: a C then an S, arms not mirrored, weight where it is declared,
    a move of four drawings (anticipation, passing, overshoot, settle) that leave the chord, a secondary and moving holds. The others plant one fault each: `straight-s`
    (key A declared S on a straight spine), `twin` (mirrored limbs, no twinned.why), `favour-only` (a long move whose breakdowns have only a favour), `ten-drawings` (a move of ten
    drawings), `early-passing` (a passing drawing at 0.10 of the way), `lead-lag` (the lead wrist declared as a secondary with no side), `wrong-sign` (key A's spine mirrored to the other side
    of its chord while the sheet still declares sign -1), `mirrored-declared` (the same mirrored spine declared sign +1: accepted). The clean sheet's right hand names side R: B leads with the right arm, so it does not lag there."""
    c_offs, s_offs = (-0.075, -0.05, -0.03), (-0.02, -0.05, -0.04)
    a_offs = (0.0, 0.0, 0.0) if kind == "straight-s" else tuple(-v for v in c_offs) if kind in ("wrong-sign", "mirrored-declared") else c_offs
    ja = pose_joints(300, a_offs, arms="twin" if kind == "twin" else "asym", foot="R", over=0.7)
    jb = pose_joints(380, s_offs, lean=20, foot="L", over=0.6, arm_shift=(120, -330))
    cls_a = "S" if kind == "straight-s" else "C"
    pa = _pkey("A", 0, 20, cls_a, 0.08, 1 if kind == "mirrored-declared" else -1, "R", 0.7, "Weight on the right foot, hands low, the gather before the lift.", inflection=0.5 if cls_a == "S" else None)
    pb = _pkey("B", 40, 20, "S", 0.15, 1, "L", 0.6, "The reach: weight crosses to the left foot and the right hand goes up.", lead=("R", "R"), inflection=0.5)
    arc = {"joint": "wristR", "offsetPx": 0 if kind == "favour-only" else 40}
    sheet = {"shot": f"fixture-{kind}", "actor": "human", "heightPx": POSE_H, "source": {"chart": "c", "keys": "k", "layout": "l"}, "keys": [pa, pb],
             "breakdowns": [{"between": ["A", "B"], "frame": f, "favour": v, "kind": k, "arc": arc} for f, v, k in _fixture_marks(kind)],
             "secondaries": [{"name": "poncho", "joints": ["ponchoPoint"], "lagDrawings": 2}] + ([{"name": "hand", "joints": ["wristR"], "lagDrawings": 1}] if kind == "lead-lag" else [{"name": "handR", "joints": ["elbowR", "wristR"], "lagDrawings": 1, "side": "R"}]),
             "movingHolds": [{"key": "A", "driftPx": 3, "over": 16}, {"key": "B", "driftPx": 3, "over": 16}]}
    keys = {"shot": sheet["shot"], "actor": "human", "keys": [{"name": "A", "frame": 0, "hold": 20, "joints": ja}, {"name": "B", "frame": 40, "hold": 20, "joints": jb}]}
    chart = {"shot": sheet["shot"], "actors": {"human": {"kind": "rig", "keySheet": "k", "keys": [{"name": "A", "frame": 0, "hold": 20}, {"name": "B", "frame": 40, "hold": 20}], "breakdowns": []}}}
    return sheet, keys, chart


IB_EASE = [0.08, 0.28, 0.55, 0.85, 0.97, 1.0]       # six drawings from the end of A's hold to B: small, large, small
IB_FRAMES, IB_START, IB_LAND = 48, 12, 22
IB_ARCS = {"wristR": 30.0, "head": 25.0, "root": 30.0}      # px off the chord at the middle of the move
IB_SCALE, IB_STAGE_PER_KEY = 0.2, 0.8                       # frame px per key px; stage px per key px (frame is 320 wide = 1/4 stage)


def _ib_poses():
    a = pose_joints(300, (-0.075, -0.05, -0.03), foot="R", over=0.7)
    b = {k: list(v) for k, v in a.items()}
    shift = {"root": (80, -20), "torso": (60, -30), "neck": (60, -35), "head": (80, -50), "ponchoPoint": (85, -22), "shoulderL": (60, -30), "shoulderR": (60, -30),
             "elbowL": (20, -60), "wristL": (-120, -160), "elbowR": (140, -120), "wristR": (250, -350), "hipL": (80, -20), "hipR": (80, -20)}
    for k, (dx, dy) in shift.items(): b[k] = [a[k][0] + dx, a[k][1] + dy]
    return a, b


def _lerp(p, q, t): return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]


def _bow(p, q, t, off):
    """The point `t` of the way from p to q pushed `off` px to the right of the direction p -> q, by 4t(1-t) (an arc that peaks mid-move)."""
    c = np.array(q) - np.array(p); n = np.array([-c[1], c[0]]) / max(1e-9, np.hypot(*c)); return list(np.array(_lerp(p, q, t)) + n * off * 4 * t * (1 - t))


def _drift(f): return 4.0 * (lambda u: u * u * (3 - 2 * u))(min(1.0, max(0.0, (f - IB_LAND) / 12)))


def draw_joints(j, scale=IB_SCALE, size=(W, H)):
    """The figure as bones and a head on the field, 4x supersampled so a sub-pixel move changes the picture a little (as the real render does)."""
    k = 4; img = Image.new("RGB", (size[0] * k, size[1] * k), FIELD); d = ImageDraw.Draw(img)
    m = lambda p: ((95 + (p[0] - 100) * scale) * k, ((p[1] - 150) * scale) * k)
    for a, b in BONES: d.line([m(j[a]), m(j[b])], fill=INK, width=3 * k)
    x, y = m(j["head"]); d.ellipse([x - 5 * k, y - 8 * k, x + 5 * k, y + 2 * k], fill=INK)
    return np.array(img.resize(size, Image.BOX))


def inbetween_case(kind):
    """(pose sheet, joints rows, figure frames, stage px per key px) of one move from key A (hold to frame 12) to key B (frame 22) in 48 frames, drawn on twos.
    `linear`: pure lerp in six equal steps, no arc, secondaries on the body's frame. `eased`: the same move with eased favours, an arc on the lead wrist, head and root,
    the poncho two drawings behind and the left hand one behind, and B drifting. `snapped`: eased, but the secondaries arrive with the body. `static`: eased, B not drifting."""
    a, b = _ib_poses(); sec = {"ponchoPoint": 2, "wristL": 1}
    sheet = {"shot": f"fixture-{kind}", "actor": "human", "heightPx": POSE_H, "source": {"chart": "c", "keys": "k", "layout": "l"},
             "keys": [_pkey("A", 0, IB_START, "C", 0.08, -1, "R", 0.7, "m"), _pkey("B", IB_LAND, 26, "S", 0.08, 1, "L", 0.6, "m", lead=("R", "R"), inflection=0.5)],
             "breakdowns": [], "secondaries": [{"name": "poncho", "joints": ["ponchoPoint"], "lagDrawings": 2}, {"name": "handL", "joints": ["wristL"], "lagDrawings": 1}],
             "movingHolds": [{"key": "B", "driftPx": 4, "over": 12}]}
    ease = [(i + 1) / 6 for i in range(6)] if kind == "linear" else IB_EASE
    rows, frames = [], []
    for f in range(IB_FRAMES):
        i = 0 if f < IB_START else (f - IB_START) // 2 + 1          # drawing number (twos); 6 is the landing
        j = {}
        for name in a:
            lag = 0 if kind in ("linear", "snapped") else sec.get(name, 0)
            t = 0.0 if i - lag < 1 else ease[min(6, i - lag) - 1]
            off = 0.0 if kind == "linear" else IB_ARCS.get(name, 0.0)
            j[name] = _bow(a[name], b[name], t, off) if off else _lerp(a[name], b[name], t)
        if kind in ("eased", "snapped") and f >= IB_LAND:
            dy = _drift(f - (f % 2))
            j = {k: [v[0], v[1] + dy] for k, v in j.items()}
        j = {k: [round(v[0], 3), round(v[1], 3)] for k, v in j.items()}
        rows.append({"frame": f, "joints": j}); frames.append(draw_joints(j))
    return sheet, rows, frames, IB_STAGE_PER_KEY


def save_seq(d, frames, tl=None, xs=None, extra=None):
    os.makedirs(d, exist_ok=True)
    for f, a in enumerate(frames): Image.fromarray(np.asarray(a, np.uint8)).save(os.path.join(d, f"element-{f:03d}.png"))
    for name, obj in (("timeline.json", tl), ("xsheet.json", {"rows": xs} if xs else None), *(extra or {}).items()):
        if obj is not None: json.dump(obj, open(os.path.join(d, name), "w"), indent=1)


def write_all(out):
    ftl = timeline_fixture()
    tl_simple = {"fps": 30, "durationInFrames": N, "beats": [{"id": "b1", "index": 0, "start": 0, "end": N, "frames": N, "world": "home"}], "crossings": []}
    for name, kw in (("twos-good", False), ("twos-bad", True)):
        fr, xs = twos_sequence(kw); save_seq(os.path.join(out, name), fr, tl_simple, xs)
    for kind in ("good", "hold40", "onedraw", "hold40-declared"):
        fr, xs = holds_sequence(kind); save_seq(os.path.join(out, "holds-" + kind), fr, tl_simple, xs)
    for name, off in (("eye-good", 0.0), ("eye-bad", 10.0)):
        fr, xs = eye_sequence(off); save_seq(os.path.join(out, name), fr, tl_simple, xs)
    for name, cuts in (("loop-good", {3}), ("loop-bad", {20, 21, 22})):
        fr, xs = loop_sequence(cuts); save_seq(os.path.join(out, name), fr, tl_simple, xs)
    for name, kw in (("colour-good", {}), ("colour-patch", {"patch_frames": {5}}), ("colour-detour", {"path": "detour"})):
        fr, tl, shots = colour_sequence(**kw); save_seq(os.path.join(out, name), fr, tl, None, {"shots.json": shots})
    save_seq(os.path.join(out, "screentime-good"), [], ftl, xsheet_for_timeline(ftl))
    save_seq(os.path.join(out, "screentime-bad"), [], shifted_timeline(ftl, "b", 3), xsheet_for_timeline(ftl))
    fr, tl, xs, shots = combined_sequence(); save_seq(os.path.join(out, "all-good"), fr, tl, xs, {"shots.json": shots})
    save_seq(os.path.join(out, "all-good-rerun"), combined_sequence()[0])
    fr, _ = twos_sequence(False)
    save_seq(os.path.join(out, "det-a"), fr); save_seq(os.path.join(out, "det-b"), fr)
    alt = [x.copy() for x in fr]; alt[20][90, 100] ^= 1; save_seq(os.path.join(out, "det-altered"), alt)
    for name, kw in (("light-good", {}), ("light-overlap", {"overlap": True}), ("light-tight", {"tight": True}), ("light-detour", {"detour": True})):
        lc, tl = light_contract(**kw); save_seq(os.path.join(out, name), [], tl, None, {"light.json": lc})
    for name, mut in (("timeline-good", lambda t: t),):
        save_seq(os.path.join(out, name), [], mut(copy.deepcopy(ftl)))
    btl, ledger, block = blocking_fixture()
    d = os.path.join(out, "blocking-good"); save_seq(d, [], btl, None, {"ledger.json": ledger})
    os.makedirs(os.path.join(d, "blocking"), exist_ok=True)
    for k, v in block.items(): json.dump(v, open(os.path.join(d, "blocking", k + ".json"), "w"), indent=1)
    print(f"wrote fixtures to {out}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "write":
        write_all(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated"))
    else:
        print(__doc__)
