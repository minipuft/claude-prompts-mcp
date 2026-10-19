#!/usr/bin/env python3
"""Story-point probe (p014): the film changes its world where the screenplay says it does, not only its figure.

usage: probe-story.py [v3/screenplay.json] [--frames out/animatic-seq] [--figure-frames out/animatic-fig-seq] [--xsheet v3/xsheet.json] [--light v3/light.json] [--blocking v3/blocking]
                      [--keys v3/keys] [--poses v3/poses] [--ledger v3/beats-v2.json] [--timeline v3/timeline.json] [--story sp-4.3,...] [--json out.json]
Animatic 04 played arms over a world that did not change, and every contract probe passed. This probe reads the screenplay (`v3/screenplay.json`, schema showcase.screenplay.1) and judges each
story point on three things, then prints one line per story point (pass or FAIL, and why) and exits 1 when any fails:
  bound   a key of a key sheet (v3/keys) or a pose sheet (v3/poses) carries `storyPoint: <id>` and lies within BIND_FRAMES (4) of the story point's frame. A story point nothing binds is refused.
          Other `storyPoint` fields (beats-v2.json actions, a v3/blocking emitter) are listed, and every `storyPoint` anywhere must name a story point whose beat holds the bound key's frame
  after   each `after` key is observable as its `state_keys[key].observe` recipe in screenplay.json says, between the frame before the story point (f0 - 1) and its last frame (the next story point's
          frame - 1). Recipes read the layer that is the truth for that thing: a PROP exists where the beat's blocking names it (`actors`, an actor may carry `on` and `off` frames, which the
          animatic does not read yet) and is DRAWN where the composed frames (`out/animatic-seq`, what the animatic renders) change near its anchor outside the figure; a count reads the blocking's actors;
          an ACTOR (human, codex, clawd, frame) reads the blocking's positions; XSHEET reads v3/xsheet.json (world, with the phase inside a crossing; emitter); LIGHT reads v3/light.json (beat pair, grain,
          emitter anchor); FIGURE reads the figure layer (`out/animatic-fig-seq`: the human alone on the field colour), the bounding box of what is not field; GATES reads the blocking's three gate anchors
          and wants their composed pixels to change one after another. The blocking is static per beat, so a prop that must change mid-beat needs `on`/`off` there: without it the probe says the blocking
          holds it for the whole beat
  world   when the story point has `after` keys, something outside the figure differs between f0 - 1 and the story point's window, in either layer: the PROPS layer (the composed frame changes by at
          least MIN_PX pixels, 600 of 1280x720 area-scaled, a channel moving more than WORLD_LEVEL 32, within REACH of a prop the blocking names, outside the figure's silhouette grown by 40 stage px and outside the
          cast: Codex's and Clawd's pigments grown by 24, the frame's and the blocks' rectangles, which re-draw themselves on their boil steps and change thousands of pixels with no story point) or the
          BLOCKING layer (a prop comes or goes, Codex, Clawd or the frame moves 20 px, the xsheet's world or crossing phase, the beat's colour pair). A story point whose before and after differ only in the
          figure layer fails here however well the figure acts. A story point with no `after` key holds, and needs only its binding
Control first, on synthetic 320x180 frames and fixtures: a story point whose prop appears where its blocking says passes; a figure that moves over a world that does not (the figure shrinks, nothing
else changes) is refused by `world`; a story point no key binds is refused by `bound`; an `after` key whose prop is in the blocking on both sides and never changes is refused by `after`.
Exit 0 every story point passes, 1 some fail (each named, with its reason), 2 a control that did not trip or an unreadable input.
"""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from probe_common import Probe, die, read_json, load_timeline, list_frames, STAGE, IDENTITY_PIGMENTS, IDENTITY_RADIUS, hex_rgb

BIND_FRAMES = 4       # a bound key lies this close to its story point's frame
MIN_PX = 600          # of 1280x720: the same floor probe-props.py holds a prop to
LEVEL = 16            # a channel moving more than this counts as changed in the figure layer's silhouette
WORLD_LEVEL = 32      # ... and in the world: measured on animatic 04 a drifting emitter's glow moves at most 43 pixels past 32 in a prop's reach (8.2, 8.3, 2.2), a prop appearing moves 5 290 or more
FIG_PAD = 40          # stage pixels the figure's silhouette is grown by before it is taken out of a difference: the figure layer carries the body alone, and the cloak and hair the full frame draws trail it
CAST_PAD = 24         # stage pixels Codex's and Clawd's pigment pixels are grown by (their body, outline and boil), and the frame's and blocks' rectangles by 10: the cast re-draws itself on its own boil steps
REACH = 150           # stage pixels from a prop's anchor a change may lie in and count as that prop's (the cast around it is not counted)
SAMPLE_EVERY = 6      # frames between the window's samples
STAGE_W = STAGE[0]


# ---------- pixels ----------
def scale_of(img): return img.shape[1] / STAGE_W


def changed(a, b, level=LEVEL): return np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > level


def grow(mask, r):
    """The mask dilated by a (2r+1) box, by integral image (no scipy)."""
    if r <= 0 or not mask.any(): return mask
    p = np.pad(mask.astype(np.int32), ((r + 1, r), (r + 1, r))); c = p.cumsum(0).cumsum(1)
    h, w = mask.shape
    return (c[2 * r + 1:2 * r + 1 + h, 2 * r + 1:2 * r + 1 + w] - c[0:h, 2 * r + 1:2 * r + 1 + w] - c[2 * r + 1:2 * r + 1 + h, 0:w] + c[0:h, 0:w]) > 0


def silhouette(fig):
    """What the figure layer draws: every pixel not the field colour (its corner)."""
    return changed(fig, np.broadcast_to(fig[0, 0], fig.shape))


def disc(shape, anchor, radius_stage):
    sc = shape[1] / STAGE_W; yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return np.hypot(xx / sc - anchor[0], yy / sc - anchor[1]) <= radius_stage


def need_px(img): return MIN_PX * img.shape[0] * img.shape[1] / (STAGE[0] * STAGE[1])


# ---------- the film as the probe reads it (files in a run, fixtures in the control) ----------
class Film:
    def __init__(self, sps, d, ledger, timeline, composed, figure, xs, light, blocking, bindings, duration):
        self.sps, self.d, self.ledger, self.tl, self.composed, self.figure, self.xs, self.light, self.blocking, self.bindings, self.duration = sps, d, ledger, timeline, composed, figure, xs, light, blocking, bindings, duration
        self.registry = d.get("state_keys", {}).get("keys", {}); self.colours = d.get("colour_keys", {})
        self._fm = {}

    def beat_id(self, f):
        b = next((b for b in self.tl["beats"] if b["start"] <= f < b["end"]), None)
        return b["id"] if b else None

    def rec(self, f): return self.blocking.get(self.beat_id(f), {})
    def light_at(self, f): return (self.light.get("beats", {}) if isinstance(self.light.get("beats"), dict) else {}).get(self.beat_id(f), {})

    def fig_mask(self, f, pad):
        if f not in self._fm: self._fm[f] = grow(silhouette(self.figure(f)), max(1, round(pad * scale_of(self.figure(f)))))
        return self._fm[f]

    def cast_mask(self, f):
        """Codex and Clawd (their pigment pixels grown), the frame and the kit blocks (their rectangles from the blocking): what the animatic re-draws on its own boil steps, which no story point makes happen."""
        im = self.composed(f); sc = scale_of(im); m = np.zeros(im.shape[:2], bool)
        for hx in IDENTITY_PIGMENTS.values(): m |= (np.abs(im.astype(np.int16) - np.array(hex_rgb(hx), np.int16)).sum(axis=2) <= IDENTITY_RADIUS * 1.8)
        m = grow(m, max(1, round(CAST_PAD * sc)))
        rec = self.rec(f)
        for r in [rec.get("frame")] + list(rec.get("blocks") or []):
            if r: m[max(int((r["y"] - 10) * sc), 0):int((r["y"] + r["height"] + 10) * sc), max(int((r["x"] - 10) * sc), 0):int((r["x"] + r["width"] + 10) * sc)] = True
        return m

    def world_diff(self, fa, fb, region=None):
        """Pixels that differ between two composed frames outside the figure's silhouette and the cast at either of them (and inside `region`)."""
        a, b = self.composed(fa), self.composed(fb)
        m = changed(a, b, WORLD_LEVEL) & ~self.fig_mask(fa, FIG_PAD) & ~self.fig_mask(fb, FIG_PAD) & ~self.cast_mask(fa) & ~self.cast_mask(fb)
        if region is not None: m &= region
        return int(m.sum()), need_px(a)

    def props_region(self, fa, fb):
        """The discs of REACH around the anchor of every prop the blocking names at either frame."""
        shape = self.composed(fa).shape; reg = np.zeros(shape[:2], bool)
        for f in (fa, fb):
            for name in (self.rec(f).get("actors") or {}): reg |= disc(shape, anchor_of(self.rec(f), name), REACH)
        return reg

    def blocking_changes(self, fa, fb):
        """What the records (blocking, xsheet, light) say differs between two frames outside the figure: a prop that comes or goes, the cast or the frame moved 20 px, the world or its crossing phase, the beat's pair."""
        ra, rb, out = self.rec(fa), self.rec(fb), []
        for name in sorted(set(ra.get("actors") or {}) | set(rb.get("actors") or {})):
            if present(ra, name, fa) != present(rb, name, fb): out.append(f"{name} {'appears' if present(rb, name, fb) else 'goes'}")
        for who in ("codex", "clawd", "frame"):
            pa, pb = position(ra, who, fa), position(rb, who, fb)
            if pa and pb and np.hypot(pa[0] - pb[0], pa[1] - pb[1]) >= 20: out.append(f"{who} moves {np.hypot(pa[0] - pb[0], pa[1] - pb[1]):.0f} px")
        xa, xb = self.xs(fa), self.xs(fb)
        if xa and xb and xs_world(xa) != xs_world(xb): out.append(f"world {xs_world(xa)} -> {xs_world(xb)}")
        la, lb = self.light_at(fa).get("pair"), self.light_at(fb).get("pair")
        if la and lb and la != lb: out.append("the beat's colour pair changes")
        return out

    def window(self, i):
        sp = self.sps[i]; f0 = sp["frame"]; f1 = self.sps[i + 1]["frame"] if i + 1 < len(self.sps) else self.duration
        return max(f0 - 1, 0), f0, f1, f1 - 1


def present(rec, actor, f):
    a = (rec.get("actors") or {}).get(actor)
    if a is None: return False
    return a.get("on", -10**9) <= f and (a.get("off") is None or f < a["off"])


def anchor_of(rec, actor):
    a = (rec.get("actors") or {}).get(actor)
    return (a["x"], a["y"]) if a else None


def position(rec, actor, f):
    p = rec.get(actor) if actor in ("human", "figure", "codex", "clawd", "frame") else None
    if actor == "human": p = rec.get("figure")
    if not isinstance(p, dict) or "x" not in p: return None
    for e in sorted(p.get("at", []), key=lambda e: e["frame"]):
        if e["frame"] <= f: p = {**p, **{k: e[k] for k in ("x", "y") if k in e}}
    return (p["x"], p.get("y", 0))


def xs_world(r):
    if not r: return None
    w = r.get("world")
    return f"{w}/{r.get('phase')}" if w and ">" in w else w


# ---------- the recipes ----------
def read_prop(film, sp, o, fb, fa, i):
    rb, ra, actor = film.rec(fb), film.rec(fa), o["actor"]
    pb, pa, want = present(rb, actor, fb), present(ra, actor, fa), o["expect"]
    names = sorted((ra.get("actors") or {}))
    where = f"beat {film.beat_id(fa)!r} names {names or 'no actors'}"
    if want in ("appears", "present") and not pa: return False, f"{actor!r} is not in the blocking at f{fa} ({where}); there is nothing to draw"
    if want == "appears" and pb: return False, f"{actor!r} is in the blocking before f{fb} and after it: it never appears inside the story point (the blocking holds it for the whole beat, `on` unset)"
    if want == "disappears" and not pb: return False, f"{actor!r} is already gone before the story point (not in the blocking at f{fb}): nothing leaves inside it"
    if want == "disappears" and pa: return False, f"{actor!r} is still in the blocking at f{fa}: it never goes"
    anc = anchor_of(ra if pa else rb, actor)
    f0 = film.sps[i]["frame"]; best = 0
    reg = disc(film.composed(fb).shape, anc, REACH)
    for t in list(range(f0, film.window(i)[2], SAMPLE_EVERY)) + [fa]:
        best = max(best, film.world_diff(fb, t, reg)[0])
    floor = need_px(film.composed(fb))
    if best < floor: return False, f"{actor!r} is in the blocking at ({anc[0]:.0f}, {anc[1]:.0f}) and nothing outside the figure changes within {REACH} px of it ({best} px against {floor:.0f}): it does not {'appear' if want == 'appears' else 'go' if want == 'disappears' else 'change'} on the frames"
    return True, f"{actor!r} {want}, {best} px change within {REACH} px of ({anc[0]:.0f}, {anc[1]:.0f})"


def read_count(film, sp, o, fb, fa, i):
    n = lambda f: sum(1 for a in o["actors"] if present(film.rec(f), a, f))
    nb, na = n(fb), n(fa)
    if o["expect"] == "rises" and not na > nb: return False, f"{'/'.join(o['actors'])} count is {nb} at f{fb} and {na} at f{fa}: the blocking names {sorted(film.rec(fa).get('actors') or {}) or 'no actors'} and none of them arrives inside the story point"
    return True, f"count {nb} -> {na}"


def read_actor(film, sp, o, fb, fa, i):
    a, e = o["actor"], o["expect"]
    pb, pa = position(film.rec(fb), a, fb), position(film.rec(fa), a, fa)
    fmt = lambda p: "absent" if p is None else f"({p[0]:.0f}, {p[1]:.0f})"
    on = lambda p: p is not None and 0 <= p[0] <= STAGE[0]
    if e == "offstage":
        if on(pa): return False, f"{a} is at {fmt(pa)} on stage at f{fa}: the blocking holds it there for the whole beat, it never leaves"
    elif e == "onstage":
        if on(pb) or not on(pa): return False, f"{a} is {fmt(pb)} at f{fb} and {fmt(pa)} at f{fa}: it does not enter inside the story point"
    elif e == "toward-frame":
        fr = film.rec(fa).get("frame");
        if pb is None or pa is None or not fr: return False, f"{a} or the frame has no position in the blocking"
        gain = abs(pb[0] - fr["x"]) - abs(pa[0] - fr["x"])
        if gain < o.get("min", 0): return False, f"{a} moves {gain:.0f} px toward the frame ({fmt(pb)} to {fmt(pa)}, frame at x {fr['x']}); needs {o.get('min', 0)}"
    elif e == "passes":
        ob, oa = position(film.rec(fb), o["other"], fb), position(film.rec(fa), o["other"], fa)
        if pa is None or oa is None or not (pa[0] > oa[0] and not (pb is not None and ob is not None and pb[0] > ob[0])): return False, f"{a} is at x {fmt(pa)} and {o['other']} at {fmt(oa)} at f{fa} (before: {fmt(pb)} and {fmt(ob)}): {a} does not pass {o['other']} inside the story point"
    return True, f"{a} {e}: {fmt(pb)} -> {fmt(pa)}"


def read_xsheet(film, sp, o, fb, fa, i):
    rb, ra = film.xs(fb), film.xs(fa)
    if not rb or not ra: return False, f"v3/xsheet.json has no row at f{fb} or f{fa}"
    if o["field"] == "world":
        vb, va, e = xs_world(rb), xs_world(ra), o["expect"]
        if e == "changes": return (vb != va), f"world {vb!r} at f{fb} and {va!r} at f{fa}" + ("" if vb != va else ": it does not change inside the story point")
        kit = film.colours.get(re.split(r"→|->", sp["colour"])[-1].strip(), {}).get("kit")
        return (ra.get("world") == kit), f"world is {ra.get('world')!r} at f{fa}, the colour key's kit is {kit!r}"
    eb, ea = rb.get("emitter"), ra.get("emitter")
    if o["expect"] == "inside-frame":
        fr = film.rec(fa).get("frame")
        ok = bool(ea and ea.get("strength", 0) > 0 and fr and fr["x"] <= ea["x"] <= fr["x"] + fr["width"] and fr["y"] <= ea["y"] <= fr["y"] + fr["height"])
        return ok, f"emitter {('(%.0f, %.0f)' % (ea['x'], ea['y'])) if ea else 'none'} at f{fa}, frame {fr and (fr['x'], fr['y'], fr['width'], fr['height'])}"
    ch = (eb is None) != (ea is None) or (eb and ea and (eb["hex"] != ea["hex"] or abs(eb.get("strength", 1) - ea.get("strength", 1)) >= 0.2))
    return bool(ch), f"emitter {eb and eb['hex']}/{eb and eb.get('strength')} at f{fb}, {ea and ea['hex']}/{ea and ea.get('strength')} at f{fa}" + ("" if ch else ": the light neither changes colour nor strength (it only drifts), so no join lights")


def anchors_of(lt):
    e = lt.get("emitter")
    return " ".join(str(x.get("anchor", "")) for x in (e if isinstance(e, list) else [e] if e else [])).lower()


def read_light(film, sp, o, fb, fa, i):
    lt = film.light_at(fa)
    if not lt: return False, f"v3/light.json has no entry for beat {film.beat_id(fa)!r}"
    f, e = o["field"], o["expect"]
    if f == "anchor":
        a = anchors_of(lt)
        need = o["text"].lower() if e == "contains" else sp.get("emitter", "").lower()
        ok = bool(a) and (need in a if e == "contains" else all(w in a for w in re.findall(r"[a-z]{3,}", need)))
        return ok, f"the beat's emitter sits on {a or 'nothing'!r}; the story point wants {need!r}"
    if f == "grain":
        to = next((s["to"] for b in film.ledger["beats"] if b["id"] == film.beat_id(fa) for s in b.get("state", []) if s["key"] == "grain"), None)
        return (to is not None and lt.get("grain") == to), f"light.json grain is {lt.get('grain')!r}, beats-v2.json says {to!r} for this beat"
    hue = film.colours.get(re.split(r"→|->", sp["colour"])[-1].strip(), {}).get("hue")
    return (hue is not None and (lt.get("pair") or {}).get("radiance", "").lower() == hue.lower()), f"light.json pair radiance {(lt.get('pair') or {}).get('radiance')} against the colour key's hue {hue}"


def box_of(fig):
    m = silhouette(fig)
    if not m.any(): return None
    ys, xs = np.nonzero(m); return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, int(m.sum()))


def read_figure(film, sp, o, fb, fa, i):
    bb, ba = box_of(film.figure(fb)), box_of(film.figure(fa))
    if not bb or not ba: return False, "the figure layer is empty at one of the frames"
    pick = {"height": lambda b: b[3] - b[1], "width": lambda b: b[2] - b[0], "area": lambda b: b[4]}[o["measure"]]
    rel = (pick(ba) - pick(bb)) / max(pick(bb), 1)
    e, mn = o["expect"], o.get("min", 0)
    ok = rel <= -mn if e == "falls" else rel >= mn if e == "rises" else abs(rel) >= mn
    return ok, f"figure {o['measure']} {rel * 100:+.1f} % between f{fb} and f{fa} ({e} by {mn * 100:.0f} % needed)"


def read_gates(film, sp, o, fb, fa, i):
    gates = film.rec(fa).get("gates") or []
    if len(gates) < 3: return False, f"the blocking of beat {film.beat_id(fa)!r} holds {len(gates)} gate anchors, a chain of three needs 3"
    firsts, f1 = [], film.window(i)[2]
    for g in gates:
        reg = disc(film.composed(fb).shape, (g["x"], g["y"]), g.get("r", 30) * 1.6)
        first = next((t for t in range(film.sps[i]["frame"], f1, 2) if film.world_diff(fb, t, reg)[0] >= need_px(film.composed(fb)) / 4), None)
        firsts.append(first)
    if None in firsts: return False, f"gate(s) {[k + 1 for k, t in enumerate(firsts) if t is None]} never change on the frames (first change per gate: {firsts})"
    gaps = [b - a for a, b in zip(firsts, firsts[1:])]
    if not all(g >= o.get("min_stagger", 1) for g in gaps): return False, f"the gates first change at {firsts}: not in order, staggered {o.get('min_stagger', 1)}"
    return True, f"the gates first change at {firsts}"


READERS = {"prop": read_prop, "count": read_count, "actor": read_actor, "xsheet": read_xsheet, "light": read_light, "figure": read_figure, "gates": read_gates}


# ---------- one story point ----------
def judge(film, i):
    sp = film.sps[i]; fb, f0, f1, fa = film.window(i); checks = []
    near = [b for b in film.bindings.get(sp["id"], []) if b[0] in ("key", "pose")]
    close = [b for b in near if abs(b[2] - sp["frame"]) <= BIND_FRAMES]
    if close: checks.append(("bound", True, f"{close[0][0]} {close[0][1]!r} at f{close[0][2]} ({close[0][3]})"))
    elif near: checks.append(("bound", False, f"{near[0][0]} {near[0][1]!r} is bound but at f{near[0][2]}, {abs(near[0][2] - sp['frame'])} frames from the story point (limit {BIND_FRAMES})"))
    else:
        other = [b for b in film.bindings.get(sp["id"], [])]
        checks.append(("bound", False, "no key or pose carries storyPoint " + sp["id"] + (f" (bound otherwise: {', '.join(b[0] + ' ' + str(b[1]) for b in other)})" if other else "")))
    for key in sp.get("after", []):
        o = (film.registry.get(key) or {}).get("observe")
        if not o: checks.append((f"after {key}", False, "state_keys carries no recipe for it")); continue
        ok, why = READERS[o["kind"]](film, sp, o, fb, fa, i)
        checks.append((f"after {key}", bool(ok), why))
    if sp.get("after"):
        best, floor = 0, 1; reg = film.props_region(fb, fa)
        for t in list(range(f0, f1, SAMPLE_EVERY)) + [fa]:
            n, floor = film.world_diff(fb, t, reg); best = max(best, n)
        recs = film.blocking_changes(fb, fa)
        fig = int(changed(film.figure(fb), film.figure(fa)).sum())
        ok = best >= floor or bool(recs)
        checks.append(("world", ok, f"props layer {best} px outside the figure and the cast (needs {floor:.0f}); records: {', '.join(recs) or 'nothing differs'}; figure layer {fig} px" + ("" if ok else ": the figure acts over a world that does not change")))
    return {"id": sp["id"], "shot": sp.get("shot"), "slug": sp["slug"], "frames": [f0, f1], "ok": all(c[1] for c in checks), "checks": [{"check": c, "ok": ok, "text": t} for c, ok, t in checks]}


# ---------- bindings ----------
def read_bindings(a, ids, d, ledger, blocking):
    out, dangling = {}, []
    def add(sp, kind, name, frame, src):
        if sp not in ids: dangling.append(f"{src} {name!r} names story point {sp!r}, which the screenplay does not have")
        out.setdefault(sp, []).append((kind, name, frame, src))
    for kind, dirn in (("key", a.keys), ("pose", a.poses)):
        for p in sorted(glob.glob(os.path.join(dirn, "*.json"))):
            if os.path.basename(p).count(".") > 1: continue
            for k in (json.load(open(p, encoding="utf8")).get("keys") or []):
                if k.get("storyPoint"): add(k["storyPoint"], kind, k["name"], k["frame"], os.path.relpath(p, ROOT))
    for b in ledger["beats"]:
        for act in b.get("actions", []):
            if act.get("storyPoint"): add(act["storyPoint"], "action", f"{b['id']}:{act['actor']}", b["frames"][0], "beats-v2.json")
    for beat, rec in blocking.items():
        e = rec.get("emitter") or {}
        if e.get("storyPoint"): add(e["storyPoint"], "emitter", f"{beat}:{e.get('anchor')}", None, f"blocking/{beat}.json")
    return out, dangling


# ---------- control ----------
def synthetic():
    """A 320x180 film of 90 frames. Story points: A (f20, prop appears at f30, blob at the lamp's anchor), B (f60, the figure shrinks and nothing else moves), C (f80, nothing binds it), D (f40, the lamp is
    named for both sides and nothing changes). Returns the films (one per case) and the expectations."""
    bg = np.full((180, 320, 3), 12, np.uint8)
    def figure_at(f, shrink=False):
        im = np.full((180, 320, 3), 12, np.uint8); h = 80 if not (shrink and f >= 60) else 40
        im[170 - h:170, 140:170] = (200, 90, 90); return im
    def comp(f, lamp, shrink=False):
        im = bg.copy(); fg = figure_at(f, shrink); m = changed(fg, np.broadcast_to(fg[0, 0], fg.shape)); im[m] = fg[m]
        if lamp and f >= 30: im[40:80, 40:90] = (230, 230, 90)
        return im
    tl = {"beats": [{"id": "b", "start": 0, "end": 90}]}
    ledger = {"beats": [{"id": "b", "state": []}]}
    sps = [{"id": "sp-1.1", "frame": 20, "slug": "A", "after": ["lamp.lit"], "colour": "k"}, {"id": "sp-1.2", "frame": 60, "slug": "B", "after": ["human.small"], "colour": "k"},
           {"id": "sp-1.3", "frame": 80, "slug": "C", "after": [], "colour": "k"}]
    d = {"colour_keys": {"k": {"hue": "#000000", "accent": "#ffffff"}}, "state_keys": {"keys": {
        "lamp.lit": {"observe": {"kind": "prop", "actor": "lamp", "expect": "appears"}}, "human.small": {"observe": {"kind": "figure", "measure": "height", "expect": "falls", "min": 0.15}},
        "lamp.still": {"observe": {"kind": "prop", "actor": "lamp", "expect": "appears"}}}}}
    mk = lambda sp_list, blocking, binds, lamp, shrink: Film(sp_list, d, ledger, tl, lambda f: comp(f, lamp, shrink), lambda f: figure_at(f, shrink), lambda f: None, {}, {"b": blocking}, binds, 90)
    appear = {"actors": {"lamp": {"x": 260, "y": 240, "on": 30}}}      # anchor (260, 240) stage px = (65, 60) in the 320 px frame, inside the blob
    always = {"actors": {"lamp": {"x": 260, "y": 240}}}
    bound = lambda *ids: {i: [("key", "k", s["frame"], "fixture")] for s in sps for i in ids if s["id"] == i}
    cases = {
        "a prop that appears where the blocking says": (mk(sps, appear, bound("sp-1.1"), True, False), 0, True, None),
        "a figure that shrinks over a world that does not change": (mk(sps, appear, bound("sp-1.2"), False, True), 1, False, "world"),
        "a story point no key binds": (mk(sps, appear, {}, True, False), 0, False, "bound"),
        "an after key whose prop is in the blocking on both sides and never changes": (mk(sps, always, bound("sp-1.1"), False, False), 0, False, "after lamp.lit"),
    }
    return cases


def run_control(pr):
    res, bad = [], []
    for label, (film, i, want_ok, want_check) in synthetic().items():
        r = judge(film, i); failed = [c["check"] for c in r["checks"] if not c["ok"]]
        right = r["ok"] if want_ok else (not r["ok"] and want_check in failed)
        res.append(f"{label} -> {'pass' if r['ok'] else 'FAIL (' + ', '.join(failed) + ')'}")
        if not right: bad.append(label)
    pr.control(not bad, "; ".join(res))


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    j = lambda *p: os.path.join(ROOT, *p)
    ap.add_argument("screenplay", nargs="?", default=j("v3", "screenplay.json")); ap.add_argument("--frames", default=j("out", "animatic-seq")); ap.add_argument("--figure-frames", default=j("out", "animatic-fig-seq"))
    ap.add_argument("--xsheet", default=j("v3", "xsheet.json")); ap.add_argument("--light", default=j("v3", "light.json")); ap.add_argument("--blocking", default=j("v3", "blocking"))
    ap.add_argument("--keys", default=j("v3", "keys")); ap.add_argument("--poses", default=j("v3", "poses")); ap.add_argument("--ledger", default=j("v3", "beats-v2.json")); ap.add_argument("--timeline", default=j("v3", "timeline.json"))
    ap.add_argument("--story", default=None, help="comma-separated story point ids to judge (the others are not read)"); ap.add_argument("--json", default=None)
    a = ap.parse_args(); pr = Probe("story", a.json)
    run_control(pr)
    d = read_json(a.screenplay, "the screenplay"); ledger = read_json(a.ledger, "the ledger"); tl = load_timeline(a.timeline)
    if d.get("schema") != "showcase.screenplay.1": die(f"{a.screenplay} has schema {d.get('schema')!r}")
    xs = {r["frame"]: r for r in read_json(a.xsheet, "the xsheet")["rows"]}
    light = read_json(a.light, "the light contract")
    blocking = {}
    for p in sorted(glob.glob(os.path.join(a.blocking, "*.json"))):
        b = read_json(p, "a blocking file"); blocking[b.get("id", os.path.basename(p)[:-5])] = b
    comp, fig = list_frames(a.frames), list_frames(a.figure_frames)
    cache = {}
    def loader(frames, tag):
        def get(f):
            if (tag, f) not in cache:
                if f not in frames: die(f"{a.frames if tag == 'c' else a.figure_frames} has no frame {f}")
                cache[(tag, f)] = np.asarray(Image.open(frames[f]).convert("RGB"))
                if len(cache) > 120: cache.pop(next(iter(cache)))
            return cache[(tag, f)]
        return get
    ids = {s["id"] for s in d["story_points"]}
    bindings, dangling = read_bindings(a, ids, d, ledger, blocking)
    film = Film(d["story_points"], d, ledger, tl, loader(comp, "c"), loader(fig, "f"), xs.get, light, blocking, bindings, tl["duration"])
    only = set(a.story.split(",")) if a.story else None
    pr.check("bindings resolve", not dangling, "; ".join(dangling) if dangling else f"{sum(len(v) for v in bindings.values())} storyPoint fields on {len(bindings)} story points (keys, poses, ledger actions, blocking emitters) each name a story point")
    results = []
    for i, sp in enumerate(film.sps):
        if only and sp["id"] not in only: continue
        r = judge(film, i); results.append(r)
        pid = f"{(r['shot'] or '?').split('-')[0]}/{r['id']}"
        print(f"{'pass' if r['ok'] else 'FAIL'}  {pid:<11} {r['slug']:<10} f{r['frames'][0]}-{r['frames'][1] - 1}", flush=True)
        for c in r["checks"]:
            print(f"        {'ok  ' if c['ok'] else 'FAIL'} {c['check']}: {c['text']}", flush=True)
    for r in results: pr.checks.append({"check": f"{r['shot'] and r['shot'].split('-')[0]}/{r['id']}", "ok": r["ok"], "text": "; ".join(f"{c['check']}: {c['text']}" for c in r["checks"] if not c["ok"]) or "all checks pass"})
    pr.extra["storyPoints"] = results
    n_ok = sum(1 for r in results if r["ok"])
    pr.finish(f"{n_ok} of {len(results)} story points pass")


if __name__ == "__main__": main()
