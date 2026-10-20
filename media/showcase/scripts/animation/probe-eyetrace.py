#!/usr/bin/env python3
"""Eye trace (rubric C29, D100): the brightest place on screen is where THIS story point's light pushes the eye.

usage: probe-eyetrace.py <frames-dir> --timeline v3/timeline.json --xsheet v3/xsheet.json [--shot <id>] [--tolerance 0.03] [--roles v3/roles.json] [--screenplay v3/screenplay.json] [--beats v3/beats-v2.json] [--blocking v3/blocking] [--json out]
Method: per frame, drop every fixed fill (v3/roles.json, `npm run roles`: the identity pigments, the human's, kit's and gadget's roles, the human's cutout palette and each world's texture
colours, each with its 28-RGB neighbourhood), box-blur what is left by luminance over --blur stage pixels (default 8: a REGION, not a pixel: the anti-aliased edge where a fill meets its
neighbour is a bright speck one or two pixels across, which a light is not), take the brightest 0.5 % of the blurred map (ties kept), and measure the distance from its centroid to the frame's
TARGET as a share of the frame width (0 inside a region target).
THE TARGET (D100: what the beat's light pushes, the emitter only where the beat names it). The target of a frame is the `eye` line of the story point whose span holds it (v3/screenplay.json: what the eye
should find when that is not the emitter), else its `emitter` line (a point's span runs from its `frame` to the next point of the same beat, or the beat's end), else, before a beat's first point, the beat's own named emitter (`effects.emitter` of v3/beats-v2.json:
the structured line beside `light_pushes`, whose prose names a feeling and so names nothing a frame can be measured against). The line is matched by its longest prefix against this table, and what
it resolves to must exist on the frame; a line outside the table, or whose source is missing, is REFUSED naming it (`targets resolve`), never passed:
  line starts with               resolves to                                                       measured as
  box seam | gadget dial |       the xsheet emitter (the lamp: at the seam, then the gadget's dial,   a point (3 % of the width)
    gadget                         on the floor where the join is lost, rimming the structure)
  frame interior                 blocking `frame` of the frame's beat (v3/blocking/<beat>.json)     a region: 0 inside it, else the distance to its edge
                                   AS IT STANDS ON THE FRAME (a frame carried in by Clawd travels: `at` keys and `carriedBy`, `probe_common.resolve_blocking_at`)
  the empty join | the lit join  blocking `join` of the frame's beat                                 a point
  the human                      the human's crop: blocking `figureCrop` (a real shot: the occluder     a region: 0 inside it, else the distance to its edge
                                   mask's `figure` group)
  the trio                       the union of the human's, Codex's and Clawd's crops (blocking             a region, as above
                                   `figureCrop`, `codex`, `clawd` at their native size; a real shot: the
                                   mask's `figure`, `codex` and `clawd` groups)
  none                           nothing: the story point says the light pushes nowhere readable     skipped and counted, by name
                                 (also the art world's own named emitter, 'the drawn piece as it fills', which holds before the crayon comes in: nothing is drawn yet)
  (any target)                   a point or a rectangle that lies wholly outside the picture on a frame (the frame Clawd carries in is still off the right edge on 690 and 691, so there is no interior to find
                                 the light in): skipped and counted as `off the picture`, never failed
  the crayon's own colour        the crayon prop (`blocking.actors.crayon`, `PROP_NATIVE`) as it stands on the frame       a region: 0 inside its rectangle, else the distance to its edge
  the drawn line                 the stroke props on stage on the frame (stroke-1, stroke-2, stroke-3): their union         a region, as above
  the leaf                       the stalk's leaf: a box at the stalk's top (`LEAF_NATIVE`, mirrored when it faces left)     a region, as above
  the piece's lines              the stalk prop on stage (the lines of the piece the human carries)                         a region, as above
  the running bead               the bead prop on stage                                                                     a region, as above
                                 (each of these five needs its prop on stage on the frame, in the beat's blocking as it stands on THAT frame: a prop not yet on, or gone, is a refusal, never a pass)
  anything else (the shimmer, ...): no role, prop or layer of the animatic draws it, so it cannot be measured: refused.
The lamp is therefore the target only where a story point says "box seam", "gadget ..." (the xsheet emitter); where it says "frame interior" a lamp brighter than the interior FAILS.
Masks (region plus colour, p007): the kit's and gadget's pale roles are also the lamp's own halo colours (kit.light, gadget.light, the box tape lit), so a role colour in `role_split`'s `owned` set counts
as a fixed fill only inside the crop of the prop that draws it (`prop_region_from_blocking`: each actor at its native size and scale, the frame's bar, the blocks, the arch, gates carved out as lights);
every other fixed colour is masked wherever it appears. Without blocking beside the timeline the owned colours are masked everywhere, as before (and the note says so).
The roles are masked because they are fixed per palette and not light (C1, C2, C6): the human's cream garment and the kit's pale contour are bright by their own colour, and the
light is what the eye should find OUTSIDE them. Frames whose xsheet row has no emitter where the target is the emitter are skipped and counted; a run that measures no frame fails.
Emitter space: ONE convention. A target is in stage pixels (1280x720) and is projected through the row's camera onto the frame (`probe_common.project`, the model of
`cameraTransform`), then scaled to the frame's width. There is no screen-space option; it read the same point as frame coordinates and was wrong wherever the camera moved.
Control first: a frame with the bright blob 10 % of the width away from the emitter must fail, the blob on the emitter must pass, and a patch of every kind of fixed role (identity
pigment, human garment, kit contour) brighter than the blob must be ignored (read unmasked, it would put the offset far off); with the target the frame interior a lamp brighter than the interior
FAILS and the interior alone passes; a pale halo in the kit's colour counts outside a prop's crop and not inside it; a line outside the table is refused by name; a frame rectangle wholly past the right edge (and one past the bottom, and a point beyond the corner) is off the picture and one that overlaps it by a pixel is not,
and the same rectangle read as a target puts the offset over the tolerance (it would have failed).
"""
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make


TARGET_TABLE = (("box seam", "emitter"), ("gadget dial", "emitter"), ("gadget", "emitter"), ("frame interior", "frame"), ("the empty join", "join"), ("the lit join", "join"), ("the human", "human"), ("the trio", "trio"), ("none", "none"),
                ("the drawn piece as it fills", "none"), ("the crayon's own colour", "prop"), ("the drawn line", "prop"), ("the leaf", "leaf"), ("the piece's lines", "prop"), ("the running bead", "prop"))
PROP_TARGETS = {"the crayon's own colour": ["crayon"], "the drawn line": ["stroke-1", "stroke-2", "stroke-3"], "the piece's lines": ["stalk"], "the running bead": ["bead"]}
"""The props a `prop` line names (their union is the target region). The stalk's leaf is drawn at the top of the spiral (`OpeningStalk`: its base at (0, -394) in the stalk's own px, open about 75 px wide and 45 high)."""
LEAF_NATIVE = ((-10, -470), (95, -385))
"""The leaf's box from the stalk's anchor, in native px at scale 1: (x0, y0), (x1, y1)."""
"""(prefix of the screenplay's `eye` or `emitter` line, kind): see the docstring for what each kind resolves to. The longest prefix wins, so 'gadget dial, lost' and 'gadget, rimming the structure' are both the lamp."""


def table_entry(line):
    """(prefix, kind) of the longest `TARGET_TABLE` entry a line starts with, or None. A prefix matches whole words: 'none readable' is 'none', 'gadgetry' is not 'gadget'."""
    t = (line or "").strip().lower(); best = None
    for pre, kind in TARGET_TABLE:
        if t.startswith(pre) and (len(t) == len(pre) or not t[len(pre)].isalnum()) and (best is None or len(pre) > len(best[0])): best = (pre, kind)
    return best


def table_kind(line):
    """The kind a story point's `eye` or `emitter` line resolves to (`TARGET_TABLE`), or None when no entry matches."""
    e = table_entry(line); return e[1] if e else None


def prop_rect(line, blocking):
    """The stage rectangle (x, y, w, h) of the props a `prop` or `leaf` line names, as they stand in `blocking`, or None when none of them is on stage there: the union of each prop's native box (`PROP_NATIVE`) at its anchor and scale;
    the leaf is `LEAF_NATIVE` from the stalk's anchor (mirrored for a stalk that faces left)."""
    pre, kind = table_entry(line); names = ["stalk"] if kind == "leaf" else PROP_TARGETS[pre]; acts = (blocking or {}).get("actors") or {}; rects = []
    for n in names:
        a = acts.get(n)
        if not isinstance(a, dict) or n not in PROP_NATIVE or a.get("x") is None: continue
        s = a.get("scale", 1.0)
        if kind == "leaf":
            (x0, y0), (x1, y1) = LEAF_NATIVE
            if a.get("facing") == "left": x0, x1 = -x1, -x0
            rects.append((a["x"] + x0 * s, a["y"] + y0 * s, a["x"] + x1 * s, a["y"] + y1 * s))
        else:
            (ox, oy), (w, h) = PROP_NATIVE[n]; rects.append((a["x"] - ox * s, a["y"] - oy * s, a["x"] - ox * s + w * s, a["y"] - oy * s + h * s))
    if not rects: return None
    x0, y0, x1, y1 = min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects)
    return (x0, y0, x1 - x0, y1 - y0)


def story_target(f, beat_id, points, beats):
    """(line, source) the frame's target is named by: the story point of `beat_id` whose span holds `f` (the last with `frame` <= f), else the beat's own named emitter. (None, why) when nothing names one."""
    mine = sorted((p for p in points if p.get("beat") == beat_id), key=lambda p: p["frame"]); hit = None
    for p in mine:
        if p["frame"] <= f: hit = p
    if hit is not None: return hit.get("eye") or hit.get("emitter"), f"story point {hit['id']}"
    b = next((b for b in beats if b.get("id") == beat_id), None)
    if b is None: return None, f"beat {beat_id!r} is not in the beats file"
    line = (b.get("effects") or {}).get("emitter")
    return (line, f"beat {beat_id} (light_pushes: {b.get('light_pushes', '')[:40]!r})") if line else (None, f"beat {beat_id} names no emitter")


def resolve_target(line, source, em, blocking):
    """The target a frame is measured against, or a refusal: ({"kind", "x", "y"} | {"kind", "rect": (x, y, w, h)} | {"kind": "none"}, None) or (None, why). `em` the xsheet emitter, `blocking` the beat's."""
    kind = table_kind(line)
    if kind is None: return None, f"{line!r} ({source}) is not in the target table: no role, prop or layer of the frame draws it"
    if kind == "none": return {"kind": "none"}, None
    if kind in ("human", "trio"): return {"kind": kind}, None                                    # a region: the caller builds its mask from the blocking or the shot's occluder mask (`cast_mask_for`)
    if kind == "emitter":
        if not isinstance(em, dict) or em.get("x") is None: return {"kind": "emitter", "missing": True}, None
        return {"kind": "emitter", "x": em["x"], "y": em["y"]}, None
    if kind in ("prop", "leaf"):
        r = prop_rect(line, blocking)
        if r is None: return None, f"{line!r} ({source}) needs {'the stalk' if kind == 'leaf' else ' or '.join(PROP_TARGETS[table_entry(line)[0]])} on stage in the beat's blocking, and none is"
        return {"kind": kind, "rect": r}, None
    if kind == "frame":
        fr = (blocking or {}).get("frame")
        if not fr: return None, f"{line!r} ({source}) needs the beat's blocking `frame`, which is absent"
        return {"kind": "frame", "rect": (fr["x"], fr["y"], fr["width"], fr["height"])}, None
    jn = (blocking or {}).get("join")
    if not jn: return None, f"{line!r} ({source}) needs the beat's blocking `join`, which is absent"
    return {"kind": "join", "x": jn["x"], "y": jn["y"]}, None


def cast_mask_for(tgt, shape, cam, blocking, occluder_path=None):
    """The mask of a `the human` / `the trio` target, or (None, why): from the occluder mask the shot's light was drawn from when `occluder_path` is given, else from the blocking's crops."""
    if occluder_path: return cast_region_from_occluders(occluder_path, shape, tgt["kind"]), None
    m = cast_region_from_blocking(shape, cam, blocking, tgt["kind"]) if blocking else None
    return (m, None) if m is not None else (None, "the beat's blocking lacks `figureCrop`" + (", `codex` or `clawd`" if tgt["kind"] == "trio" else "") + ", and no occluder mask names the cast")


def centroid(img, share=0.005, hexes=None, blur=BLUR_STAGE_PX, masked=None):
    """Centroid of the brightest region (`brightest_region`: the brightest `share` of the pixels outside the fixed fills, ranked by blurred luminance), or None. `masked` is the fixed-fill mask
    (`cast_mask`), else `hexes` masks by colour."""
    sel = brightest_region(img, hexes, share, blur, masked)
    if sel is None: return None
    ys, xs = np.nonzero(sel)
    return float(xs.mean()), float(ys.mean())


def offset(img, em, cam, share=0.005, hexes=None, blur=BLUR_STAGE_PX, plate=None, owned=None, region=None):
    """Distance from the brightest unmasked region to the target (stage pixels, projected through `cam`), as a share of the frame width. `em` is a point ({"x", "y"}: the emitter or a join) or a
    region ({"rect": (x, y, w, h)} or {"mask": frame-sized bool}: 0 inside it, else the distance to its nearest edge). `hexes` are the fixed colours, `plate` the human cutout's colours (masked only where the human is, see
    `cast_mask`), `owned` the kit's and gadget's pale roles masked only inside `region`."""
    c = centroid(img, share, None, blur, cast_mask(img, cam, hexes, plate, owned=owned, region=region) if (hexes or plate or owned) else None)
    H, W = img.shape[:2]; s = W / STAGE[0]
    if c is None: return None
    if "mask" in em:
        from scipy import ndimage as ndi
        cx, cy = min(max(int(round(c[0])), 0), W - 1), min(max(int(round(c[1])), 0), H - 1)
        return 0.0 if em["mask"][cy, cx] else float(ndi.distance_transform_edt(~em["mask"])[cy, cx] / W)
    if "rect" in em:
        x, y, w, h = em["rect"]; pts = [project(cam, px, py) for px, py in ((x, y), (x + w, y), (x, y + h), (x + w, y + h))]
        x0, x1, y0, y1 = (min(p[0] for p in pts) * s, max(p[0] for p in pts) * s, min(p[1] for p in pts) * s, max(p[1] for p in pts) * s)
        return float(np.hypot(max(x0 - c[0], 0, c[0] - x1), max(y0 - c[1], 0, c[1] - y1)) / W)
    ex, ey = project(cam, em["x"], em["y"])
    return float(np.hypot(c[0] - ex * s, c[1] - ey * s) / W)


def off_picture(em, cam, shape):
    """True when a point or rectangle target (stage px, projected through `cam`) lies wholly outside the picture: there is nothing on the frame for the light to be found in."""
    H, W = shape[:2]; s = W / STAGE[0]
    if "rect" in em:
        x, y, w, h = em["rect"]; pts = [project(cam, px, py) for px, py in ((x, y), (x + w, y), (x, y + h), (x + w, y + h))]
        return max(p[0] for p in pts) * s <= 0 or min(p[0] for p in pts) * s >= W or max(p[1] for p in pts) * s <= 0 or min(p[1] for p in pts) * s >= H
    if "x" in em:
        ex, ey = project(cam, em["x"], em["y"]); return not (0 <= ex * s < W and 0 <= ey * s < H)
    return False


def controls(a, ctl):
    """The control: (ok, text), planted in memory (320x180 frames, `make`)."""
    on = offset(make.eye_frame(10), make.emitter_at(10), None, a.share, ctl, a.blur)
    off = offset(make.eye_frame(10, 10.0), make.emitter_at(10), None, a.share, ctl, a.blur)
    raw = offset(make.eye_frame(10), make.emitter_at(10), None, a.share, None, a.blur)
    cam = {"x": 500, "y": 360, "zoom": 1, "rot": 0}                             # the emitter's stage x is 140 further right than a locked camera would put it
    moved = offset(make.eye_frame(10), make.emitter_at(10), cam, a.share, ctl, a.blur)
    specks = make.eye_frame(10); rng = np.random.default_rng(7)
    ys, xs_ = rng.integers(0, specks.shape[0], 120), rng.integers(0, 120, 120); specks[ys, xs_] = (255, 255, 255)      # 120 lone anti-aliasing specks on the left, brighter than the blob, 0.2 % of the pixels
    sp = offset(specks, make.emitter_at(10), None, a.share, ctl, a.blur); sp_raw = offset(specks, make.emitter_at(10), None, a.share, ctl, 0)
    # D100: the target is the frame interior and the lamp is brighter than the interior's light -> FAIL; the interior's light alone -> pass; and the lamp the line names is still found
    S = make.S; rect = (700, 100, 360, 260); lamp = make.emitter_at(10); inner = lambda amp: _blob(_field(), (880 * S, 230 * S), amp)
    both = _blob(inner(120), (lamp["x"] * S, lamp["y"] * S), 250, sigma=10.0)   # the interior glows at 120, the lamp (outside it, x 500) at 250 over a wider core
    d_lamp_brighter = offset(both, {"rect": rect}, None, a.share, ctl, a.blur)
    d_interior = offset(inner(120), {"rect": rect}, None, a.share, ctl, a.blur)
    d_lamp_named = offset(both, {"x": lamp["x"], "y": lamp["y"]}, None, a.share, ctl, a.blur)
    # a frame that travels: carried in by Clawd it stands 250 px right of where it ends on frame 30 (the blocking's `at` keys and `carriedBy`); the target is where it is on THAT frame, so the light in it passes and the same frame read against
    # the box it ends in fails (resolve_blocking_at, the mirror of the animatic's resolveBlocking)
    bl_walk = {"frame": {"x": 700, "y": 100, "width": 360, "height": 260, "carriedBy": "clawd"}, "clawd": {"x": 1500, "y": 300, "at": [{"frame": 10, "x": 1500}, {"frame": 50, "x": 1000}]}}
    travelling = _blob(_field(), ((resolve_blocking_at(bl_walk, 30)["frame"]["x"] + 180) * S, 230 * S), 120)
    t_moving, _ = resolve_target("frame interior", "story point sp-w", None, resolve_blocking_at(bl_walk, 30)); t_final, _ = resolve_target("frame interior", "story point sp-w", None, bl_walk)
    d_travel = offset(travelling, t_moving, None, a.share, ctl, a.blur); d_final = offset(travelling, t_final, None, a.share, ctl, a.blur)
    walk_x = (resolve_blocking_at(bl_walk, 30)["frame"]["x"], resolve_blocking_at(bl_walk, 9)["frame"]["x"], resolve_blocking_at(bl_walk, 50)["frame"]["x"])
    # D100 `eye`: a story point with eye "the human" is read before its emitter; the lamp brightest outside the human's crop FAILS, the human's own light passes, no `eye` is the lamp again
    bl = {"figureCrop": {"x": 380, "y": 0, "width": 500, "height": 720}}; pts = [{"id": "sp-c", "beat": "b", "frame": 0, "emitter": "gadget dial", "eye": "the human"}, {"id": "sp-d", "beat": "d", "frame": 0, "emitter": "gadget dial"}]
    lamp_o = {"x": 1000, "y": 300}; both_h = _blob(_blob(_field(), (lamp_o["x"] * S, lamp_o["y"] * S), 250, sigma=10.0), (640 * S, 400 * S), 120)
    def eye_read(beat, frame_img):
        line, src = story_target(0, beat, pts, []); tg, why = resolve_target(line, src, lamp_o, bl); m, _ = cast_mask_for(tg, frame_img.shape, None, bl)
        return line, offset(frame_img, {"mask": m} if tg["kind"] in ("human", "trio") else tg, None, a.share, ctl, a.blur)
    l_h, d_h_lamp = eye_read("b", both_h); l_d, d_d_lamp = eye_read("d", both_h); _, d_h_own = eye_read("b", _blob(_field(), (640 * S, 400 * S), 120))
    trio_none = cast_region_from_blocking((make.H, make.W, 3), None, bl, "trio")
    # p007: a pale halo in the kit's colour is the lamp where no prop is, a fixed fill where the prop is
    halo, region = _halo_frame(); kit_pale = ["#d9e5e3"]; bare = [h for h in ctl if h not in kit_pale]
    d_all = offset(halo, make.emitter_at(10), None, a.share, bare + kit_pale, a.blur)                                   # masked everywhere: the halo is eaten
    d_reg = offset(halo, make.emitter_at(10), None, a.share, bare, a.blur, owned=kit_pale, region=region)               # region plus colour: the halo is found, the prop's own pale is masked
    refused = resolve_target("the shimmer", "story point sp-5.3", None, {})[1]; kind_ok = (table_kind("box seam, tiny"), table_kind("gadget, rimming the structure"), table_kind("none readable"), table_kind("gadgetry"), table_kind("the lit join, then each gate in sequence"))
    # the props the scaffold beats name: each resolves to the rectangle its prop stands in on the frame; the light on it passes, the light a prop's height away fails; a prop that is not on stage on the frame is refused by name
    bl_p = {"actors": {"crayon": {"x": 640, "y": 400, "scale": 1.0}, "stroke-1": {"x": 300, "y": 500, "scale": 0.5}, "stroke-3": {"x": 700, "y": 500, "scale": 0.5}, "stalk": {"x": 900, "y": 560, "scale": 0.55, "facing": "right"}, "bead": {"x": 200, "y": 600, "scale": 0.5}}}
    t_cray = resolve_target("the crayon's own colour", "story point sp-5.1", None, bl_p)[0]; t_draw = resolve_target("the drawn line", "story point sp-5.2", None, bl_p)[0]
    t_leaf = resolve_target("the leaf", "story point sp-5.3", None, bl_p)[0]; t_piece = resolve_target("the piece's lines, carried", "story point sp-6.1", None, bl_p)[0]; t_bead = resolve_target("the running bead", "story point sp-7.3", None, bl_p)[0]
    c_in = lambda t: ((t["rect"][0] + t["rect"][2] / 2) * make.S, (t["rect"][1] + t["rect"][3] / 2) * make.S)
    p_on = offset(_blob(_field(), c_in(t_cray), 120), t_cray, None, a.share, ctl, a.blur); p_off = offset(_blob(_field(), (c_in(t_cray)[0] + 0.1 * make.W, c_in(t_cray)[1]), 120), t_cray, None, a.share, ctl, a.blur)
    leaf_on = offset(_blob(_field(), c_in(t_leaf), 120), t_leaf, None, a.share, ctl, a.blur); leaf_root = offset(_blob(_field(), (900 * make.S, 540 * make.S), 120), t_leaf, None, a.share, ctl, a.blur)
    absent = resolve_target("the drawn line", "story point sp-5.2", None, {"actors": {"crayon": bl_p["actors"]["crayon"]}})[1]
    props_ok = (t_cray is not None and t_cray["rect"] == (640 - 9, 400 - 90, 18, 90) and t_draw["rect"][0] < 300 and t_draw["rect"][0] + t_draw["rect"][2] > 700 and t_leaf["rect"][1] < t_piece["rect"][1] and t_piece["kind"] == "prop" and t_leaf["kind"] == "leaf"
                and t_bead["rect"][0] == 200 - 8 * 0.5 and p_on <= a.tolerance and p_off > a.tolerance and leaf_on <= a.tolerance and leaf_root > a.tolerance and absent is not None and "on stage" in absent and "stroke-1" in absent)
    # a target wholly off the picture (the frame at x 1288 of 1280 on frame 690) is skipped, not measured; it would have failed (the light is somewhere on the picture, the rect is not)
    S_ = make.S; shape = (make.H, make.W, 3); inside_rect = {"rect": (700, 100, 360, 260)}; edge_rect = {"rect": (1288, 190, 400, 410)}; just_in = {"rect": (1279, 190, 400, 410)}
    below_rect = {"rect": (400, 725, 300, 200)}; far_point = {"x": 1404.0, "y": 392.0}; near_point = {"x": 1270.0, "y": 392.0}
    off_flags = (off_picture(edge_rect, None, shape), off_picture(just_in, None, shape), off_picture(below_rect, None, shape), off_picture(far_point, None, shape), off_picture(near_point, None, shape), off_picture(inside_rect, None, shape))
    d_off = offset(inner(120), edge_rect, None, a.share, ctl, a.blur)
    ok = (on is not None and on <= a.tolerance and off is not None and off > a.tolerance and raw > a.tolerance and moved > a.tolerance and sp <= a.tolerance and (a.blur == 0 or sp_raw > sp)
          and d_lamp_brighter > a.tolerance and d_interior <= a.tolerance and d_lamp_named <= a.tolerance
          and d_travel <= a.tolerance and d_final > a.tolerance and walk_x == (950.0, 1200.0, 700.0)
          and l_h == "the human" and d_h_lamp > a.tolerance and d_h_own <= a.tolerance and l_d == "gadget dial" and d_d_lamp <= a.tolerance and trio_none is None
          and d_all > a.tolerance and d_reg <= a.tolerance and refused and "the shimmer" in refused and kind_ok == ("emitter", "emitter", "none", None, "join") and props_ok
          and off_flags == (True, False, True, True, False, False) and d_off > a.tolerance)
    return ok, (f"bright blob 10 % of the width off the emitter -> FAIL (offset {100 * off:.1f} % > {100 * a.tolerance:.0f} %); blob on the emitter -> pass ({100 * on:.1f} %); "
                f"identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at {100 * raw:.0f} %); "
                f"the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL ({100 * moved:.1f} %), so the camera is read; "
                f"120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset {100 * sp:.1f} % blurred, {100 * sp_raw:.1f} % unblurred; "
                f"target the frame interior: a lamp brighter than the interior's light, outside it -> FAIL ({100 * d_lamp_brighter:.1f} %), the interior's light alone -> pass ({100 * d_interior:.1f} %), "
                f"and the same frame against the lamp as the target -> pass ({100 * d_lamp_named:.1f} %), so the target is what is read; "
                f"a frame carried in by Clawd (frame x {walk_x[1]:.0f} before his first key, {walk_x[0]:.0f} on frame 30, {walk_x[2]:.0f} where it ends) with its light inside it on frame 30: judged against the box it ends in -> FAIL ({100 * d_final:.1f} %), against the box it stands in on that frame -> pass ({100 * d_travel:.1f} %); "
                f"a story point with eye 'the human' (read before its emitter 'gadget dial'): the lamp brightest outside the human's crop -> FAIL ({100 * d_h_lamp:.1f} %), the human's own light -> pass ({100 * d_h_own:.1f} %), "
                f"the same frame under a point with no eye (the lamp) -> pass ({100 * d_d_lamp:.1f} %), and a blocking without the cast's crops resolves no trio; "
                f"a pale halo in the kit's colour: masked everywhere it is eaten -> FAIL ({100 * d_all:.1f} %), masked only inside the prop's crop it is found -> pass ({100 * d_reg:.1f} %); "
                f"a line outside the table is refused by name ({refused[:48]}...); "
                f"the props the scaffold beats name resolve to where their props stand (the crayon's rectangle 18 x 90 at its anchor, the strokes' union, the stalk's leaf above the stalk's lines, the bead): the light in the crayon -> pass ({100 * p_on:.1f} %), the light a tenth of the width away -> FAIL ({100 * p_off:.1f} %), the light at the stalk's root against the leaf -> FAIL ({100 * leaf_root:.1f} %), the light on the leaf -> pass ({100 * leaf_on:.1f} %), and a line whose props are not on stage is refused naming them ({absent[:60]}...); "
                f"a frame wholly past the right edge (x 1288 of 1280) -> off the picture and skipped (read as a target it would FAIL, {100 * d_off:.1f} %), one overlapping the edge by a pixel -> measured, one wholly below -> off the picture, "
                f"a point at x 1404 -> off, a point at x 1270 -> measured")


def _blob(a, centre, amp, sigma=6.0, colour=(1.0, 1.0, 1.0)):
    """`a` (uint8 H x W x 3) plus a soft Gaussian blob of peak `amp` at `centre` (frame pixels)."""
    H, W = a.shape[:2]; yy, xx = np.mgrid[0:H, 0:W]
    g = amp * np.exp(-((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2) / (2 * sigma ** 2))
    return np.clip(a.astype(np.float32) + g[..., None] * np.array(colour, np.float32), 0, 255).astype(np.uint8)


def _field():
    a = np.empty((make.H, make.W, 3), np.uint8); a[:] = make.FIELD
    return a


def _halo_frame():
    """The p007 fixture: a dark field with a flat pale disc in the kit's colour at the emitter (the lamp's halo core, 12 px in radius: more than the 0.5 % the eye trace ranks) and a prop's pale patch
    (kit.light itself, brighter and larger) elsewhere, inside `region`, the prop's crop."""
    a = _field(); e = make.emitter_at(10); cx, cy = e["x"] * make.S, e["y"] * make.S
    yy, xx = np.mgrid[0:make.H, 0:make.W]; a[(xx - cx) ** 2 + (yy - cy) ** 2 <= 12 ** 2] = (0xc8, 0xdc, 0xe8)      # a cool pale of the lamp's halo, inside kit.light's 28-RGB sphere and outside the human cream's
    a[140:170, 200:240] = (0xd9, 0xe5, 0xe3)
    region = np.zeros(a.shape[:2], bool); region[130:178, 190:250] = True
    return a, region


def load_targets(a):
    """(story points, beats, blocking by beat id) from the files beside the timeline, or what --screenplay / --beats / --blocking name; a missing screenplay or beats file is an input error:
    without them nothing says where the light pushes."""
    base = os.path.dirname(os.path.abspath(a.timeline))
    sp_path = a.screenplay or os.path.join(base, "screenplay.json"); bt_path = a.beats or os.path.join(base, "beats-v2.json")
    for pth, what in ((sp_path, "screenplay"), (bt_path, "beats")):
        if not os.path.exists(pth): die(f"no {what} file {pth}: the eye's target per story point lives in v3/screenplay.json and v3/beats-v2.json (--screenplay, --beats)")
    points = read_json(sp_path, "screenplay").get("story_points", []); beats = read_json(bt_path, "beats").get("beats", [])
    if not points: die(f"{sp_path} has no story_points")
    blocking = {}
    bdir = a.blocking or os.path.join(base, "blocking")
    if os.path.isdir(bdir):
        for fn in sorted(os.listdir(bdir)):
            if fn.endswith(".json"): b = read_json(os.path.join(bdir, fn), "blocking"); blocking[b.get("id", fn[:-5])] = b
    return points, beats, blocking


def span_of(spans, key, f):
    """Records a run of frames as (first, last) per key (contiguous or not: the first and the last frame the key was seen on, and the count)."""
    lo, hi, n = spans.get(key, (f, f, 0)); spans[key] = (min(lo, f), max(hi, f), n + 1)


def main():
    ap = add_common(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--tolerance", type=float, default=0.03, help="share of the frame width")
    ap.add_argument("--share", type=float, default=0.005, help="brightest share of unmasked pixels")
    ap.add_argument("--min-strength", type=float, default=1.0, help="measure only frames where the xsheet's emitter strength is at least this (default 1: fully drawn)")
    ap.add_argument("--blur", type=float, default=BLUR_STAGE_PX, help="stage pixels of box blur before ranking (0: none)")
    ap.add_argument("--roles", default=None, help="v3/roles.json (default: beside the project's v3)")
    ap.add_argument("--screenplay", default=None, help="v3/screenplay.json (default: beside the timeline): the story points name the eye's target")
    ap.add_argument("--beats", default=None, help="v3/beats-v2.json (default: beside the timeline): a beat's own named emitter, before its first story point")
    ap.add_argument("--blocking", default=None, help="v3/blocking (default: beside the timeline): the frame and the join the targets resolve to, and the props' crops")
    a = ap.parse_args()
    pr = Probe("eye-trace", a.json)
    hexes_all = fixed_role_hexes(a.roles, plates=False); plate = plate_hexes(a.roles)
    ctl = ["#4f7df2", "#e8694a", "#e7e4da", "#d9e5e3"]                          # identity (Codex, Clawd), the human's cream, the kit's pale: each is in the real roles file too
    ok, text = controls(a, ctl)
    pr.control(ok, text)
    xs = default_xsheet(a) or die("no xsheet: pass --xsheet (the emitter position per frame lives there)")
    tl = load_timeline(a.timeline); frames = list_frames(a.frames)
    tl, xs, frames, shot_note = apply_shot(a, tl, xs, frames)
    points, beats, blocking = load_targets(a)
    everywhere, owned = role_split(a.roles)
    drawn_from = blocking_describes(tl, xs, blocking) if owned else set()        # the beats whose frames the blocking stages (the animatic); a real shot's props are elsewhere
    bad, skipped, fading, worst, n = [], 0, 0, (-1.0, None), 0
    refused, unreadable, off, kinds = {}, {}, {}, {}
    for f, p in frames.items():
        b = beat_at(tl, f); bid = b["id"] if b else None
        line, source = story_target(f, bid, points, beats) if bid else (None, "the frame is on no beat of the timeline")
        row = xs.get(f) or {}; em = row.get("emitter"); bl_f = resolve_blocking_at(blocking.get(bid), f)      # the blocking as it stands on THIS frame: a frame carried in, the human on her way, a prop not yet on
        tgt, why = resolve_target(line, source, em, bl_f) if line is not None else (None, f"{source}: no target named")
        if tgt is None: span_of(refused, why, f); continue
        if tgt["kind"] == "none": span_of(unreadable, f"{line!r} ({source})", f); continue
        if tgt.get("missing"): skipped += 1; continue
        if isinstance(em, dict) and em.get("strength", 1.0) < a.min_strength: fading += 1; continue
        cam = camera_of(xs, f); img = load_rgb(p)
        if off_picture(tgt, cam, img.shape): span_of(off, f"{line!r} ({source})", f); continue
        if tgt["kind"] in ("human", "trio"):
            m, why = cast_mask_for(tgt, img.shape, cam, bl_f if bid in drawn_from else None)
            if m is None: span_of(refused, f"{line!r} ({source}): {why}", f); continue
            tgt = {**tgt, "mask": m}
        region = prop_region_from_blocking(img.shape, cam, bl_f) if bid in drawn_from else None
        d = offset(img, tgt, cam, a.share, everywhere if region is not None else hexes_all, a.blur, plate, owned if region is not None else None, region)
        if d is None: skipped += 1; continue
        n += 1; kinds[tgt["kind"]] = kinds.get(tgt["kind"], 0) + 1
        if d > worst[0]: worst = (d, f)
        if d > a.tolerance: bad.append((f, round(100 * d, 1), tgt["kind"]))
    nref = sum(v[2] for v in refused.values()); nun = sum(v[2] for v in unreadable.values()); noff = sum(v[2] for v in off.values())
    pr.note(f"frames {len(frames)}{'; ' + shot_note if shot_note else ''}; masked {len(everywhere) if drawn_from else len(hexes_all)} fixed colours everywhere and the human cutout's {len(plate)} inside its crop"
            + (f", and {len(owned)} kit and gadget colours only inside their props' crops (blocking, beats {sorted(drawn_from)})" if drawn_from else ", the kit and gadget colours everywhere (no blocking describes these frames)") + f", from {roles_source(a.roles)}; "
            f"measured {n} {dict(sorted(kinds.items()))}; skipped (target is the emitter and the xsheet row has none) {skipped}; skipped (emitter drawn below strength {a.min_strength:g}, a crossing) {fading}; "
            f"skipped (the story point says the light pushes nowhere readable) {nun}; skipped (the target is wholly off the picture) {noff}{' (' + '; '.join(f'{k}: frames {lo}-{hi}' for k, (lo, hi, _) in sorted(off.items(), key=lambda kv: kv[1][0])) + ')' if off else ''}; worst offset {100 * worst[0]:.1f} % at frame {worst[1]}")
    pr.check("measured something", n > 0, f"{n} frames carry a target" + ("" if n else " - every frame was skipped or refused, so the probe observed nothing"))
    pr.check("targets resolve", not refused, (f"{nref} frame(s) have a target the frame cannot resolve: " + "; ".join(f"{why}: frames {lo}-{hi} ({c})" for why, (lo, hi, c) in sorted(refused.items(), key=lambda kv: kv[1][0]))) if refused
             else "every story point's target is in the table and its source exists" + (f"; {nun} frame(s) name no readable target: " + "; ".join(f"{k}: frames {lo}-{hi}" for k, (lo, hi, _) in sorted(unreadable.items(), key=lambda kv: kv[1][0])) if unreadable else ""))
    pr.check("target within tolerance", not bad, f"{len(bad)} frame(s) over {100 * a.tolerance:.0f} % of the width{': ' + str(bad[:12]) if bad else ''}")
    pr.extra.update({"offPicture": {k: list(v) for k, v in off.items()}, "measured": n, "kinds": kinds, "skipped": skipped, "fading": fading, "unreadable": {k: list(v) for k, v in unreadable.items()}, "refused": {k: list(v) for k, v in refused.items()},
                     "worst": {"frame": worst[1], "share": worst[0]}, "over": bad})
    pr.finish(f"the brightest region outside the fixed roles sits within {100 * a.tolerance:.0f} % of its story point's target on all {n} measured frames ({skipped + fading + nun + noff} skipped)")


if __name__ == "__main__": main()
