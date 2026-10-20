#!/usr/bin/env python3
"""Colour continuity (rubric C30, with C24 and C15): one hue pair per beat, one emitter at a time, and no hue detour across a crossing.

Two modes, one probe:
  contract mode (before any render):  probe-colour.py --contract v3/light.json --timeline v3/timeline.json [--shots v3/shots.json]
  frames mode (after the animatic):   probe-colour.py <frames-dir> --timeline v3/timeline.json [--contract v3/light.json | --shots v3/shots.json]

Contract mode reads light.json (shape in scripts/animation/README.md): every beat carries exactly one {radiance, accent} pair (equal to its shot's
D74 pair in shots.json where one covers it); emitters never overlap, and two emitters with no emitter-less beat between them hand off 2-4 frames
apart (C18); every timeline crossing has a contract crossing on the same window whose hue `path` runs on the shortest arc from the from-beat's pair
to the to-beat's, in one direction, never grey. Control first: two emitters live on one frame, a 1-frame handoff and a hue path via green must each
fail, the clean contract must pass.

Both modes also hold a crossing's VALUE and CHROMA (C15, "palette travel never dips to grey"). On the contract: no interior sample of a path may sit more than VALUE_MARGIN (0.05 of the range) under
the lower of the two endpoints' value (largest channel), nor under the lower endpoint's chroma (largest channel minus smallest, one 8-bit level of rounding). On frames: the dominant colour of each frame
of a crossing window (the most common 16-level colour of the picture) is read, and the same two floors are taken from the window's first and last readable frames, the chroma floor with CHROMA_SLACK
8-bit levels of rasteriser noise. The control is a path (and a frame sequence) through a tan and through a grey, which must be refused, beside a hue walk between the same endpoints that holds both floors, which must pass.
A straight blend of two colours never leaves the range between them in VALUE, so the value floor cannot refuse a plain fade from a light colour to a dark one however muddy it reads in between: it refuses
a path pulled below both ends. Between two saturated ends of different hue a straight blend does lose CHROMA (orange to blue goes through a grey at its middle, the C15 case), which the chroma floor refuses;
between a light colour and a near-black one the lower endpoint has almost no chroma, so that floor is met by a plain fade too (v3/studies/animatic-02.md C15: value 0.84, 0.35, 0.12 at 1135, 1150, 1160).

Frames mode has two measures. The light's own hue (`radiance_hue`: the chroma-weighted mean hue of the brightest region outside the fixed fills, the region the eye trace finds, when it sits on the emitter; a pale tint keeps its hue, which the saturated-pixel check below cannot see once an emitter is lifted to a luma floor)
must sit inside the beat's pair on every frame the emitter is drawn, and across a crossing walk from the from-beat's pair to the to-beat's without a detour (2 readable frames in the first third of the window and 2 in the last, else the crossing is not measurable on frames and says so). And per frame: the saturated pixels (chroma >= 60, max >= 64) minus the fixed colours (v3/roles.json, `npm run roles`: the identity pigments, the human's, kit's and gadget's role fills and each world's own texture colours; a neighbourhood of 28 RGB) must sit inside the beat's hue pair +-15
degrees (at most --max-outside of them outside, and at least --min-outside-px). Across a crossing window the dominant hue (2 degree bins) starts in
the from-beat's pair, ends in the to-beat's and moves monotonically between (5 degree jitter allowed). Frames with no pair for their beat or fewer than
30 saturated pixels are skipped and counted. Control first: a frame with an off-pair saturated patch and a crossing whose hue detours through
green must fail, the clean sequence must pass.
"""
import argparse, os, sys, tempfile
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

HANDOFF = (2, 4)
MIN_SAT_PX = 30
# A hue read from a region's mean carries a spread of its own: the shaded world's bloom reads 192-199 degrees on consecutive frames of one beat (7.7 degrees between two readings), against the 5 degrees of
# `check_path_monotone`'s default, which was set on the dominant hue of thousands of saturated pixels. A detour through a third hue is 16 degrees behind the start on its first sample (the control) and 130-180 over the path.
PATH_SLACK = 10.0
GLOW_CHROMA, GLOW_MIN_PX = 8, 40      # the light's own hue needs this much chroma summed over this many pixels of its region
# C15, a crossing holds value and chroma: the same constants as src/library/animation/light.ts (PATH_VALUE_MARGIN) so the contract and the frames are read by one rule
VALUE_MARGIN = 0.05
CHROMA_SLACK = 4        # 8-bit levels: the dominant colour of a frame is a mean of one 16-level bin, whose max and min channels each carry the rasteriser's 2 levels
DOM_BIN = 16


def _value(rgb): return max(rgb) / 255.0
def _chroma(rgb): return (max(rgb) - min(rgb)) / 255.0


def path_dips(colours, chroma_slack=1.0, interior_only=True):
    """Samples of a colour sequence (RGB triples) that leave the floors its endpoints set: value more than VALUE_MARGIN under the lower endpoint's, or chroma more than `chroma_slack` 8-bit levels under the
    lower endpoint's. [(index, text)]; the endpoints themselves are the floors and never dip."""
    if len(colours) < 3: return []
    first, last = colours[0], colours[-1]
    vf = min(_value(first), _value(last)) - VALUE_MARGIN; cf = min(_chroma(first), _chroma(last)) - chroma_slack / 255.0
    out = []
    for i, c in enumerate(colours):
        if interior_only and i in (0, len(colours) - 1): continue
        if _value(c) < vf: out.append((i, f"value {_value(c):.2f} under the floor {vf:.2f}"))
        elif _chroma(c) < cf: out.append((i, f"chroma {_chroma(c):.2f} under the lower endpoint's {cf:.2f}"))
    return out


def dominant_colour(img):
    """The mean colour of the most common DOM_BIN-level bin of the picture (RGB triple, 0-255)."""
    px = img.reshape(-1, 3).astype(np.int32); q = px // DOM_BIN
    key = (q[:, 0] * 256 + q[:, 1]) * 256 + q[:, 2]
    vals, counts = np.unique(key, return_counts=True); k = vals[counts.argmax()]
    return tuple(float(v) for v in px[key == k].mean(axis=0))


def control_paths():
    """(clean, tan, grey) paths between the same two saturated ends (orange, Turrell blue): a hue walk that keeps both floors, a walk pulled through a tan darker than both ends, a walk pulled through a grey as light as the ends but chromaless."""
    a, b = hex_rgb("#e1750c"), hex_rgb("#0a51fb")
    clean = [a, hex_rgb("#ff2a1a"), hex_rgb("#ff20c0"), hex_rgb("#a020ff"), b]
    tan = [a, hex_rgb("#8c7a5c"), hex_rgb("#6f6248"), hex_rgb("#a020ff"), b]
    grey = [a, hex_rgb("#e6e6e6"), hex_rgb("#e0e0e0"), hex_rgb("#dadada"), b]
    return clean, tan, grey


def check_crossing_frames(frames, tl):
    """([(window, problem text)], [window not measurable], {window: (frames read, min value, min chroma, floors)}). Per crossing window, the dominant colour of every frame given, the floors from the first and last of them."""
    probs, unmeasured, seen = [], [], {}
    for w in tl["windows"]:
        fs = sorted(f for f in frames if w["a"] <= f < w["b"])
        if len(fs) < 3: unmeasured.append((w["a"], w["b"], len(fs))); continue
        cols = [dominant_colour(load_rgb(frames[f])) for f in fs]
        dips = path_dips(cols, CHROMA_SLACK)
        seen[(w["a"], w["b"])] = (len(fs), min(_value(c) for c in cols), min(_chroma(c) for c in cols), (min(_value(cols[0]), _value(cols[-1])) - VALUE_MARGIN, min(_chroma(cols[0]), _chroma(cols[-1])) - CHROMA_SLACK / 255.0))
        if dips: probs.append(((w["a"], w["b"]), f"crossing {w['a']}-{w['b']}: the dominant colour dips at frame {fs[dips[0][0]]} ({dips[0][1]}); {len(dips)} of {len(fs)} frames read dip"))
    return probs, unmeasured, seen


# ---------- contract mode ----------
def light_beats(light):
    b = light.get("beats", {})
    return {x["id"]: x for x in b} if isinstance(b, list) else b


def shots_pairs(shots):
    out = {}
    for s in (shots or {}).get("shots", []):
        h = s.get("hue") or {}
        for bid in s.get("beat", []): out[bid] = (h.get("radiance"), h.get("accent"))
    return out


def pair_hues(pair):
    return [h for h in (hue_of(hex_rgb(pair[k])) for k in ("radiance", "accent") if valid_hex(pair.get(k))) for h in [h] if h is not None]


def check_contract(light, tl, shots=None, min_chroma=24):
    out = []   # (check, ok, text)
    lb = light_beats(light); beats = {b["id"]: b for b in tl["beats"]}
    # one hue pair per beat
    bad = []
    for b in tl["beats"]:
        p = (lb.get(b["id"]) or {}).get("pair")
        if not isinstance(p, dict) or not (valid_hex(p.get("radiance")) and valid_hex(p.get("accent"))): bad.append(b["id"])
    out.append(("one pair per beat", not bad, f"beats without a single {{radiance, accent}} hex pair: {bad}" if bad else f"all {len(beats)} beats carry one pair"))
    sp = shots_pairs(shots); mism = []
    for bid, (r, a_) in sp.items():
        p = (lb.get(bid) or {}).get("pair") or {}
        if bid in beats and (str(p.get("radiance", "")).lower(), str(p.get("accent", "")).lower()) != (str(r).lower(), str(a_).lower()): mism.append(bid)
    if shots is not None: out.append(("pair equals the shot's D74 pair", not mism, f"beats whose pair differs from shots.json: {mism}" if mism else f"{len(sp)} shot-covered beats agree"))
    # emitters: one at a time, handoffs 2-4 frames apart
    flat = []
    for b in tl["beats"]:
        e = (lb.get(b["id"]) or {}).get("emitter")
        for x in (e if isinstance(e, list) else [e] if e else []):
            flat.append({"beat": b["id"], "on": x.get("on", b["start"]), "off": x.get("off", b["end"]), "colour": x.get("colour")})
    flat.sort(key=lambda x: x["on"]); probs = []
    for x in flat:
        if x["off"] <= x["on"]: probs.append(f"emitter of {x['beat']!r} goes off at {x['off']} before it comes on at {x['on']}")
    for x, y in zip(flat, flat[1:]):
        if y["on"] < x["off"]:
            probs.append(f"two emitters live on frames {y['on']}..{x['off'] - 1} ({x['beat']!r} and {y['beat']!r})"); continue
        gap = y["on"] - x["off"]
        dark = any(x["off"] <= bb["start"] and bb["end"] <= y["on"] and not (lb.get(bb["id"]) or {}).get("emitter") for bb in tl["beats"])
        if not (HANDOFF[0] <= gap <= HANDOFF[1]) and not dark:
            probs.append(f"handoff {x['beat']!r} -> {y['beat']!r} is {gap} frame(s) apart (off {x['off']}, on {y['on']}); C18 wants {HANDOFF[0]}-{HANDOFF[1]}")
    out.append(("one emitter at a time", not probs, "; ".join(probs) if probs else f"{len(flat)} emitters, no overlap, handoffs {HANDOFF[0]}-{HANDOFF[1]} frames apart"))
    off_pair = []
    for b in tl["beats"]:
        e = (lb.get(b["id"]) or {}).get("emitter"); p = (lb.get(b["id"]) or {}).get("pair") or {}
        hs = pair_hues(p) if p else []
        for x in (e if isinstance(e, list) else [e] if e else []):
            c = x.get("colour")
            if valid_hex(c) and hs and hue_of(hex_rgb(c)) is not None and min(hue_dist(hue_of(hex_rgb(c)), h) for h in hs) > HUE_TOLERANCE: off_pair.append(f"{b['id']} {c}")
    out.append(("emitter colour inside the pair", not off_pair, f"emitter colours off their beat's pair by more than {HUE_TOLERANCE:.0f} deg: {off_pair}" if off_pair else "every emitter colour sits in its beat's pair"))
    # crossings: hue path
    cl = {(c.get("from"), c.get("to")): c for c in light.get("crossings", [])}; probs = []
    for w in tl["windows"]:
        c = cl.get((w["from"], w["to"]))
        if not c: probs.append(f"crossing {w['from']!r} -> {w['to']!r} ({w['a']}-{w['b']}) has no entry in the contract"); continue
        if list(c.get("frames", [])) != [w["a"], w["b"]]: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: contract window {c.get('frames')} differs from the timeline's {[w['a'], w['b']]}")
        path = c.get("path") or []
        if len(path) < 2 or not all(valid_hex(h) for h in path): probs.append(f"crossing {w['from']!r} -> {w['to']!r}: path needs >= 2 hex colours"); continue
        grey = [h for h in path if chroma_of(hex_rgb(h)) < min_chroma and max(hex_rgb(h)) >= 16]
        hues = [hue_of(hex_rgb(h)) for h in path]
        if grey or None in hues: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: path dips to grey at {grey}"); continue
        fp, tp = pair_hues((lb.get(w["from"]) or {}).get("pair") or {}), pair_hues((lb.get(w["to"]) or {}).get("pair") or {})
        if fp and min(hue_dist(hues[0], h) for h in fp) > HUE_TOLERANCE: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: path starts at {hues[0]:.0f} deg, outside the from-beat's pair")
        if tp and min(hue_dist(hues[-1], h) for h in tp) > HUE_TOLERANCE: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: path ends at {hues[-1]:.0f} deg, outside the to-beat's pair")
        ok, why = check_path_monotone(hues)
        if not ok: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: hue detour, {why}")
    out.append(("crossing hue paths", not probs, "; ".join(probs) if probs else f"{len(tl['windows'])} crossings, each monotonic from the from-pair to the to-pair"))
    probs = []
    for w in tl["windows"]:
        c = cl.get((w["from"], w["to"]))
        if not c or not all(valid_hex(h) for h in (c.get("path") or [])): continue            # reported by the check above
        dips = path_dips([hex_rgb(h) for h in c["path"]])
        if dips: probs.append(f"crossing {w['from']!r} -> {w['to']!r}: sample {dips[0][0]} ({c['path'][dips[0][0]]}) dips, {dips[0][1]}")
    out.append(("crossing value and chroma held", not probs, "; ".join(probs) if probs else f"{len(tl['windows'])} crossings hold value (within {VALUE_MARGIN} of the lower endpoint's) and chroma (not under the lower endpoint's)"))
    return out


# ---------- frames mode ----------
def sat_hues(img, masks):
    """Hues of the saturated pixels outside the fixed fills and their blends. `masks` = (hexes, blend): `hexes` the fixed colours (identity pigments, the human's, kit's and gadget's roles, the
    human cutout's palette, each world's texture colours) with a 28-RGB neighbourhood, `blend` the colours those are drawn in, whose blends with black, white and each other (the
    anti-aliased edge of a fill, its stipple, its bloom) are fixed too. What is left is the radiance layer and anything off the palette, the only things that grade per beat (C24, C30)."""
    hexes, blend = masks[1], masks[1]
    m = ((img.max(axis=2) - img.min(axis=2)) >= 60) & (img.max(axis=2) >= 64) & ~fixed_fill_mask(img, masks[2] if len(masks) > 2 else masks[0], blend=masks[1])
    return hue_array(img[m])


def dominant(h):
    hist, _ = np.histogram(h, bins=180, range=(0, 360))
    sm = hist + np.roll(hist, 1) + np.roll(hist, -1)
    return float(np.argmax(sm) * 2 + 1)


def radiance_hue(img, em, cam, hexes, tol=0.03, plate=None, owned=None, region=None):
    """The hue of the light itself: the chroma-weighted circular mean hue of the brightest region outside the fixed fills (`brightest_region`, the region the eye trace measures), when that region
    centres within `tol` of the frame width of the projected emitter; None when it does not (the light is not the brightest thing there, which C29 reports) or when it has no hue. A pale tint
    keeps its hue (an emitter lifted to a luma floor is no longer saturated enough for the saturated-pixel check to see it). (hue, pixels) or None."""
    sel = brightest_region(img, None, masked=cast_mask(img, cam, hexes, plate, owned=owned, region=region))        # `owned` (the kit's and gadget's pale roles, role_split) only inside `region`: where their props are drawn
    if sel is None: return None
    H, W = img.shape[:2]; sc = W / STAGE[0]
    if sel.sum() > 2 * 0.005 * H * W: return None                    # a flat frame ties everywhere: nothing is the brightest
    ex, ey = (v * sc for v in project(cam, em["x"], em["y"]))
    ys, xs = np.nonzero(sel)
    if np.hypot(xs.mean() - ex, ys.mean() - ey) / W > tol: return None
    px = img[sel]; ch = (px.max(axis=1) - px.min(axis=1)).astype(np.float32)
    ang = np.deg2rad(hue_array(px[None])[0]); w = ch
    if w.sum() < GLOW_MIN_PX * GLOW_CHROMA: return None
    return float(np.rad2deg(np.arctan2((w * np.sin(ang)).sum(), (w * np.cos(ang)).sum())) % 360), int(sel.sum())


def analyse_frames(frames, tl, pairs, max_outside, min_outside_px, masks, xs=None, directions=None):
    """(saturated pixels off the pair [(frame, outside, saturated)], crossing problems, frames skipped, crossings unmeasured, glow frames off the pair, glow frames measured, glow frames unreadable).
    Two measures. (1) Saturated pixels outside the fixed fills and their blends sit inside the beat's pair, outside crossings. (2) With an xsheet, the light's own hue (`radiance_hue`: a pale tint
    keeps its hue) sits inside the beat's pair on every frame the emitter is drawn, and across a crossing it walks from the from-beat's pair to the to-beat's without a detour; where the xsheet gives no
    emitter the dominant saturated hue stands in (the fixtures)."""
    off, skipped, wins, probs, glow_off, glow_n, glow_skipped = [], 0, [], [], [], 0, 0
    for f, p in frames.items():
        w = next((w for w in tl["windows"] if w["a"] <= f < w["b"]), None)
        img = load_rgb(p)
        em = ((xs or {}).get(f) or {}).get("emitter")
        cam_f = camera_of(xs, f); bk = masks[4] if len(masks) > 4 and masks[4] else None; bb = (resolve_blocking_at(bk[2].get((beat_at(tl, f) or {}).get("id")), f) if bk else None)       # bk: (everywhere, owned, blocking of the beats these frames are drawn from)
        glow = radiance_hue(img, em, cam_f, bk[0] if bb else masks[0], plate=masks[3] if len(masks) > 3 else None, owned=bk[1] if bb else None, region=prop_region_from_blocking(img.shape, cam_f, bb) if bb else None) if isinstance(em, dict) and em.get("x") is not None and em.get("strength", 1.0) > 0 else None
        if isinstance(em, dict) and glow is None: glow_skipped += 1
        b = beat_at(tl, f); pr_ = pairs.get(b["id"]) if b else None
        hs = pair_hues(pr_) if pr_ else []
        if glow is not None:
            glow_n += 1
            if w: wins.append((w["a"], f, glow[0]))
            elif hs and min(hue_dist(glow[0], x) for x in hs) > HUE_TOLERANCE: glow_off.append((f, round(glow[0]), [round(x) for x in hs]))
        h = sat_hues(img, masks)
        if h.size < MIN_SAT_PX: skipped += 1; continue
        if w:
            if glow is None: wins.append((w["a"], f, dominant(h)))
            continue
        if not hs: skipped += 1; continue
        d = np.min([np.minimum(np.abs(h - x) % 360, 360 - np.abs(h - x) % 360) for x in hs], axis=0)
        outside = int((d > HUE_TOLERANCE).sum())
        if outside > max(min_outside_px, max_outside * h.size): off.append((f, outside, int(h.size)))
    unmeasured = []
    for w in tl["windows"]:
        seq = sorted((f, d) for a_, f, d in wins if a_ == w["a"])
        third = (w["b"] - w["a"]) / 3
        first, last = [x for x in seq if x[0] < w["a"] + third], [x for x in seq if x[0] >= w["b"] - third]
        if len(first) < 2 or len(last) < 2: unmeasured.append((w["a"], w["b"], len(first), len(last))); continue      # a path read from its middle says nothing about where it starts or ends
        hues = [d for _, d in seq]
        fp, tp = pair_hues(pairs.get(w["from"]) or {}), pair_hues(pairs.get(w["to"]) or {})
        if fp and min(hue_dist(hues[0], x) for x in fp) > HUE_TOLERANCE: probs.append(f"crossing {w['a']}-{w['b']} starts at {hues[0]:.0f} deg, outside the from-beat's pair")
        if tp and min(hue_dist(hues[-1], x) for x in tp) > HUE_TOLERANCE: probs.append(f"crossing {w['a']}-{w['b']} ends at {hues[-1]:.0f} deg, outside the to-beat's pair")
        ok, why = check_path_monotone(hues, slack=PATH_SLACK, direction=(directions or {}).get((w['from'], w['to'])))
        if not ok: probs.append(f"crossing {w['a']}-{w['b']} detours: {why}")
    return off, probs, skipped, unmeasured, glow_off, glow_n, glow_skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames", nargs="?", default=None); ap.add_argument("--timeline", default="v3/timeline.json")
    ap.add_argument("--contract", default=None, help="light.json"); ap.add_argument("--shots", default=None, help="shots.json (default: beside the timeline)")
    ap.add_argument("--xsheet", default=None, help="v3/xsheet.json (default: beside the timeline): the emitter per frame, for the light's own hue")
    ap.add_argument("--json", default=None); ap.add_argument("--max-outside", type=float, default=0.02); ap.add_argument("--min-outside-px", type=int, default=8)
    ap.add_argument("--roles", default=None, help="v3/roles.json (default: beside the project's v3)")
    ap.add_argument("--shot", default=None, help="frames mode: one shot's slice of the timeline")
    ap.add_argument("--min-chroma", type=int, default=24, help="contract paths: colours below this chroma count as grey")
    a = ap.parse_args()
    contract_mode = a.frames is None
    if contract_mode and not a.contract: die("give a frames directory, or --contract light.json")
    pr = Probe("colour-continuity", a.json)
    if contract_mode:
        def failing(**kw):
            lc, t = make.light_contract(**kw); return [c for c in check_contract(lc, normalise_timeline(t), None, a.min_chroma) if not c[1]]
        lc, t = make.light_contract(); clean = [c for c in check_contract(lc, normalise_timeline(t), None, a.min_chroma) if not c[1]]
        ov, ti, de = failing(overlap=True), failing(tight=True), failing(detour=True)
        cp_clean, cp_tan, cp_grey = control_paths(); d_clean, d_tan, d_grey = path_dips(cp_clean), path_dips(cp_tan), path_dips(cp_grey)
        pr.control(not clean and ov and ti and de and "two emitters" in ov[0][2] and de[0][0] == "crossing hue paths" and not d_clean and d_tan and d_grey,
                   f"two emitters live on one frame -> FAIL ({ov[0][2]}); handoff 1 frame apart -> FAIL; hue path via green -> FAIL; clean contract -> pass ({len(clean)} failures); "
                   f"a path through a tan -> FAIL (sample {d_tan[0][0]}: {d_tan[0][1]}); through a grey -> FAIL (sample {d_grey[0][0]}: {d_grey[0][1]}); a hue walk between the same ends that holds both floors -> pass")
        tl = load_timeline(a.timeline); light = read_json(a.contract, "light contract")
        shots_path = a.shots or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "shots.json")
        shots = read_json(shots_path, "shots") if os.path.exists(shots_path) else None
        for name, ok, text in check_contract(light, tl, shots, a.min_chroma): pr.check(name, ok, text)
        pr.finish(f"{len(tl['beats'])} beats carry one pair each, emitters hand off one at a time, {len(tl['windows'])} crossings run without a hue detour")
        return
    # frames mode
    ctl_pairs = {"a": dict(zip(("radiance", "accent"), make.PAIR_A)), "b": dict(zip(("radiance", "accent"), make.PAIR_B))}
    ctl = ["#4f7df2", "#e8694a", "#2f45a8", "#c8323a"]          # identity (Codex, Clawd), the human's main1, the kit's accent: each is in the real roles file too
    def run(**kw):
        fr, t, _ = make.colour_sequence(**kw); return analyse_frames(dict(enumerate(fr)), normalise_timeline(t), ctl_pairs, a.max_outside, a.min_outside_px, (ctl, ctl, ctl))
    clean, patch, detour = run(), run(patch_frames={5}), run(path="detour")
    em0 = {"x": 640, "y": 360, "hex": "#ffffff", "strength": 1}
    g_ok, g_bad, g_none = (radiance_hue(make.glow_frame(c).astype(np.int16), em0, None, ctl) for c in ("#d1dffe", "#d1fed9", None)) if False else (
        radiance_hue(make.glow_frame("#d1dffe").astype(np.int16), em0, None, ctl), radiance_hue(make.glow_frame("#d1fed9").astype(np.int16), em0, None, ctl), radiance_hue(make.glow_frame("#ffffff", False).astype(np.int16), em0, None, ctl))
    pair_h = pair_hues(ctl_pairs["a"])
    glow_ok = g_ok is not None and min(hue_dist(g_ok[0], x) for x in pair_h) <= HUE_TOLERANCE and g_bad is not None and min(hue_dist(g_bad[0], x) for x in pair_h) > HUE_TOLERANCE and g_none is None
    pr.control(not clean[0] and not clean[1] and patch[0] and detour[1] and glow_ok,
               f"magenta patch off both pairs -> FAIL (frame {patch[0][0][0]}: {patch[0][0][1]} of {patch[0][0][2]} saturated pixels outside); hue detour through green across a crossing -> FAIL "
               f"({detour[1][0]}); clean sequence with identity, garment and kit-accent patches (all saturated, all off the pair) -> pass; a pale blue glow on the emitter reads {g_ok[0]:.0f} deg -> inside the blue pair, "
               f"the same glow in pale green reads {g_bad[0]:.0f} deg -> off it, a frame with no glow reads nothing")
    cp_clean, cp_tan, cp_grey = control_paths()
    def fade_frames(path, tmp):
        os.makedirs(tmp); out = {}
        for i, c in enumerate(path):
            fn = os.path.join(tmp, f"element-{100 + i:03d}.png"); Image.fromarray(np.full((36, 64, 3), c, np.uint8)).save(fn); out[100 + i] = fn
        return out
    ctl_tl = {"windows": [{"a": 100, "b": 100 + len(cp_clean), "from": "x", "to": "y"}]}
    with tempfile.TemporaryDirectory() as t:
        cf_clean, cf_tan, cf_grey = (check_crossing_frames(fade_frames(p_, os.path.join(t, n_)), ctl_tl)[0] for p_, n_ in ((cp_clean, "clean"), (cp_tan, "tan"), (cp_grey, "grey")))
    pr.control(not cf_clean and cf_tan and cf_grey,
               f"a crossing whose frames pass through a tan -> FAIL ({cf_tan[0][1] if cf_tan else 'NOT REFUSED'}); through a grey -> FAIL ({cf_grey[0][1] if cf_grey else 'NOT REFUSED'}); a hue walk between the same ends that holds both floors -> pass")
    hexes = fixed_role_hexes(a.roles, plates=False)
    masks = (hexes, fixed_fill_hexes(a.roles), fixed_role_hexes(a.roles, sheets=True), plate_hexes(a.roles), None)
    tl = load_timeline(a.timeline); frames = list_frames(a.frames)
    tl, _, frames, shot_note = apply_shot(a, tl, None, frames)
    if a.contract: lb = light_beats(read_json(a.contract, "light contract")); pairs = {k: v.get("pair") for k, v in lb.items()}
    else:
        sp = a.shots or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "shots.json")
        pairs = {k: {"radiance": v[0], "accent": v[1]} for k, v in shots_pairs(read_json(sp, "shots")).items()}
    if not any(pairs.get(b["id"]) for b in tl["beats"]): die("no beat of the timeline has a hue pair (check --contract / --shots)")
    xs = default_xsheet(a)
    everywhere, owned = role_split(a.roles); bl = load_blocking(a.timeline) if owned else {}; drawn_from = blocking_describes(tl, xs, bl)
    if drawn_from: masks = masks[:4] + ((everywhere, owned, {k: v for k, v in bl.items() if k in drawn_from}),)       # the light's own hue: the kit's and gadget's pale roles only inside their props' crops (D100), on the beats the blocking describes
    directions = {}
    if a.contract:
        for c in read_json(a.contract, "light contract").get("crossings", []):
            hs = [hue_of(hex_rgb(h)) for h in c.get("path", []) if valid_hex(h)]
            if len(hs) >= 2 and None not in hs: directions[(c.get("from"), c.get("to"))] = path_direction(hs)
    off, probs, skipped, unmeasured, glow_off, glow_n, glow_skipped = analyse_frames(frames, tl, pairs, a.max_outside, a.min_outside_px, masks, xs, directions)
    pr.note(f"frames {len(frames)}{'; ' + shot_note if shot_note else ''}; masked {len(hexes)} fixed colours from {roles_source(a.roles)}; skipped (no pair for the beat, or under {MIN_SAT_PX} saturated pixels) {skipped}; crossing windows {[(w['a'], w['b']) for w in tl['windows']]}")
    pr.check("radiance hue per frame", not glow_off, f"the light's own hue sits inside the beat's pair on {glow_n - len(glow_off)} of {glow_n} frames where it is drawn and readable ({glow_skipped} drawn but unreadable: the brightest region outside the fixed fills is not on the emitter, or has no chroma to read a hue from)"
             + (f"; off the pair on {len(glow_off)}: {glow_off[:8]} (frame, hue, pair hues)" if glow_off else ""))
    pr.check("saturated pixels inside the pair", not off, f"{len(off)} of {len(frames) - skipped} measured frame(s) ({skipped} had under {MIN_SAT_PX} saturated pixels left outside the fixed fills and their blends, or no pair) with saturated pixels outside the pair +-{HUE_TOLERANCE:.0f} deg" + (f": {off[:8]} (frame, outside, saturated)" if off else ""))
    measured = len(tl["windows"]) - len(unmeasured)
    pr.check("crossing hue path", not probs, "; ".join(probs) if probs else f"{measured} of {len(tl['windows'])} crossings measured on frames move monotonically between pairs"
             + (f"; {len(unmeasured)} left too few measurable frames at one end (2 are needed in its first third and 2 in its last, and a frame needs {MIN_SAT_PX} saturated pixels outside the fixed fills and their blends; the line world in the middle has none by design): {[(u[0], u[1], f'{u[2]} in the first third, {u[3]} in the last') for u in unmeasured]}; only the light contract's path covers those (probe-colour.py --contract)" if unmeasured else ""))
    cprobs, cunmeasured, cseen = check_crossing_frames(frames, tl)
    pr.check("crossing value and chroma held", not cprobs, "; ".join(t for _, t in cprobs) if cprobs else
             f"{len(cseen)} of {len(tl['windows'])} crossings hold value and chroma on their dominant colour: " + "; ".join(f"{a_}-{b_}: {n} frames read, lowest value {v:.2f} (floor {fl[0]:.2f}), lowest chroma {c:.3f} (floor {fl[1]:.3f})" for (a_, b_), (n, v, c, fl) in cseen.items())
             + (f"; {len(cunmeasured)} with under 3 frames read: {cunmeasured}" if cunmeasured else ""))
    pr.extra.update({"crossingHold": {f"{a_}-{b_}": {"frames": n, "minValue": v, "minChroma": c} for (a_, b_), (n, v, c, _) in cseen.items()}, "offPair": off, "glowOffPair": glow_off, "glowMeasured": glow_n, "crossingProblems": probs, "skipped": skipped})
    pr.finish(f"all measured frames sit inside their beat's hue pair; {measured} of {len(tl['windows'])} crossings measured on frames run without a detour ({skipped} frames skipped)")


if __name__ == "__main__": main()
