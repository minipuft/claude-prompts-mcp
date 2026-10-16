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

Frames mode, per frame: the saturated pixels (chroma >= 60, max >= 64) minus the identity pigments must sit inside the beat's hue pair +-15
degrees (at most --max-outside of them outside, and at least --min-outside-px). Across a crossing window the dominant hue (2 degree bins) starts in
the from-beat's pair, ends in the to-beat's and moves monotonically between (5 degree jitter allowed). Frames with no pair for their beat or fewer than
30 saturated pixels are skipped and counted. Control first: a frame with an off-pair saturated patch and a crossing whose hue detours through
green must fail, the clean sequence must pass.
"""
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import *
from fixtures import make

HANDOFF = (2, 4)
MIN_SAT_PX = 30


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
    return out


# ---------- frames mode ----------
def sat_hues(img):
    m = ((img.max(axis=2) - img.min(axis=2)) >= 60) & (img.max(axis=2) >= 64) & ~identity_mask(img)
    return hue_array(img[m])


def dominant(h):
    hist, _ = np.histogram(h, bins=180, range=(0, 360))
    sm = hist + np.roll(hist, 1) + np.roll(hist, -1)
    return float(np.argmax(sm) * 2 + 1)


def analyse_frames(frames, tl, pairs, max_outside, min_outside_px):
    off, skipped, wins, probs = [], 0, [], []
    for f, p in frames.items():
        w = next((w for w in tl["windows"] if w["a"] <= f < w["b"]), None)
        h = sat_hues(load_rgb(p))
        if h.size < MIN_SAT_PX: skipped += 1; continue
        if w:
            wins.append((w["a"], f, dominant(h))); continue
        b = beat_at(tl, f); pr_ = pairs.get(b["id"]) if b else None
        hs = pair_hues(pr_) if pr_ else []
        if not hs: skipped += 1; continue
        d = np.min([np.minimum(np.abs(h - x) % 360, 360 - np.abs(h - x) % 360) for x in hs], axis=0)
        outside = int((d > HUE_TOLERANCE).sum())
        if outside > max(min_outside_px, max_outside * h.size): off.append((f, outside, int(h.size)))
    for w in tl["windows"]:
        seq = sorted((f, d) for a_, f, d in wins if a_ == w["a"])
        if len(seq) < 2: continue
        hues = [d for _, d in seq]
        fp, tp = pair_hues(pairs.get(w["from"]) or {}), pair_hues(pairs.get(w["to"]) or {})
        if fp and min(hue_dist(hues[0], x) for x in fp) > HUE_TOLERANCE: probs.append(f"crossing {w['a']}-{w['b']} starts at {hues[0]:.0f} deg, outside the from-beat's pair")
        if tp and min(hue_dist(hues[-1], x) for x in tp) > HUE_TOLERANCE: probs.append(f"crossing {w['a']}-{w['b']} ends at {hues[-1]:.0f} deg, outside the to-beat's pair")
        ok, why = check_path_monotone(hues)
        if not ok: probs.append(f"crossing {w['a']}-{w['b']} detours: {why}")
    return off, probs, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames", nargs="?", default=None); ap.add_argument("--timeline", default="v3/timeline.json")
    ap.add_argument("--contract", default=None, help="light.json"); ap.add_argument("--shots", default=None, help="shots.json (default: beside the timeline)")
    ap.add_argument("--json", default=None); ap.add_argument("--max-outside", type=float, default=0.02); ap.add_argument("--min-outside-px", type=int, default=8)
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
        pr.control(not clean and ov and ti and de and "two emitters" in ov[0][2] and de[0][0] == "crossing hue paths",
                   f"two emitters live on one frame -> FAIL ({ov[0][2]}); handoff 1 frame apart -> FAIL; hue path via green -> FAIL; clean contract -> pass ({len(clean)} failures)")
        tl = load_timeline(a.timeline); light = read_json(a.contract, "light contract")
        shots_path = a.shots or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "shots.json")
        shots = read_json(shots_path, "shots") if os.path.exists(shots_path) else None
        for name, ok, text in check_contract(light, tl, shots, a.min_chroma): pr.check(name, ok, text)
        pr.finish(f"{len(tl['beats'])} beats carry one pair each, emitters hand off one at a time, {len(tl['windows'])} crossings run without a hue detour")
        return
    # frames mode
    ctl_pairs = {"a": dict(zip(("radiance", "accent"), make.PAIR_A)), "b": dict(zip(("radiance", "accent"), make.PAIR_B))}
    def run(**kw):
        fr, t, _ = make.colour_sequence(**kw); return analyse_frames(dict(enumerate(fr)), normalise_timeline(t), ctl_pairs, a.max_outside, a.min_outside_px)
    clean, patch, detour = run(), run(patch_frames={5}), run(path="detour")
    pr.control(not clean[0] and not clean[1] and patch[0] and detour[1],
               f"magenta patch off both pairs -> FAIL (frame {patch[0][0][0]}: {patch[0][0][1]} of {patch[0][0][2]} saturated pixels outside); hue detour through green across a crossing -> FAIL "
               f"({detour[1][0]}); clean sequence with an identity-pigment patch -> pass")
    tl = load_timeline(a.timeline); frames = list_frames(a.frames)
    if a.contract: lb = light_beats(read_json(a.contract, "light contract")); pairs = {k: v.get("pair") for k, v in lb.items()}
    else:
        sp = a.shots or os.path.join(os.path.dirname(os.path.abspath(a.timeline)), "shots.json")
        pairs = {k: {"radiance": v[0], "accent": v[1]} for k, v in shots_pairs(read_json(sp, "shots")).items()}
    if not any(pairs.get(b["id"]) for b in tl["beats"]): die("no beat of the timeline has a hue pair (check --contract / --shots)")
    off, probs, skipped = analyse_frames(frames, tl, pairs, a.max_outside, a.min_outside_px)
    pr.note(f"frames {len(frames)}; skipped (no pair for the beat, or under {MIN_SAT_PX} saturated pixels) {skipped}; crossing windows {[(w['a'], w['b']) for w in tl['windows']]}")
    pr.check("hue pair per frame", not off, f"{len(off)} frame(s) with saturated pixels outside the pair +-{HUE_TOLERANCE:.0f} deg" + (f": {off[:8]} (frame, outside, saturated)" if off else ""))
    pr.check("crossing hue path", not probs, "; ".join(probs) if probs else f"{len(tl['windows'])} crossings move monotonically between pairs")
    pr.extra.update({"offPair": off, "crossingProblems": probs, "skipped": skipped})
    pr.finish(f"all measured frames sit inside their beat's hue pair and the crossings run without a detour ({skipped} skipped)")


if __name__ == "__main__": main()
