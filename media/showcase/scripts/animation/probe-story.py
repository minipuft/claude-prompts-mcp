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
  measure each clause of the story point's `measure` (the `;`-separated lines) is the `says` of one of its `recipes` (screenplay.json; probe-screenplay.py refuses a clause no recipe says), and each recipe is one more check
          here, read over the story point's window clipped at the end of its own beat (a cut ends what a story point can observe: p020). A story point whose measure has no recipe fails `measure`. Kinds (the fields each takes
          are listed in `RECIPE_NEEDS` of probe-screenplay.py):
            stage     a thing the blocking holds, as it stands on a frame (`resolve_blocking_at`): present, persists to a frame, absent, appears, disappears, moves (px, a range), rest, returns to its start within N frames,
                      inside another thing's rectangle, offstage, onstage, carried-by (`from` the holder on the first frame the thing is on stage at or after `since`, `to` the holder on the window's last frame, within `within` px)
            count     named props on stage: rises (from, to), at-most, rises-then-falls;  arrivals: N named props come on one frame;  stagger: the `on` (or `off`) frames of props are N frames apart;  order: one thing
                      starts to move N frames before another;  contact: two things' rectangles (props and the cast at their native size, the frame, the join; the human is her hands, the figure layer's thin skin) are within N px
            emitters  the light.json emitter count, or a steady xsheet emitter;  hold: the xsheet declares a hold of N frames;  glow: the area lit around the emitter (outside the figure and the cast) grows M % at least N frames
                      after a prop starts to move;  picture: the share of the beat's hue, the mean luminance outside the frame, or the share of non-field ink rises or falls M %;  hands: the figure layer draws both hands
                      (finger-sized skin components), or does not;  figure, actor, xsheet, light, gates: the readers the `after` keys use, with `lowest`, `equals` and `at: next` besides
  The human is read where the story point's measure line names her: `human x moves toward frame >= 60 px` (actor `human` reads the root travel `figure.at` of the blocking, which the animatic plays on the frame each drawing
  comes on), `hand within 8 px of frame edge` (figure measure `edge-gap`: the figure layer's rightmost ink against the frame's left edge, on the story point's first frame) and `human crosses frame x` (figure measure
  `centre`: the silhouette's centre is left of the frame's left edge on the frame the recipe starts from, `since: previous` being the previous story point's frame, and at or past it on the last frame of the beat; a cut ends
  the observation). A recipe with `world: false` reads the figure itself and asks nothing of the world, so its story point needs no `world` change.
Control first, on synthetic 320x180 frames and fixtures: a story point whose prop appears where its blocking says passes; a figure that moves over a world that does not (the figure shrinks, nothing
else changes) is refused by `world`; a story point no key binds is refused by `bound`; an `after` key whose prop is in the blocking on both sides and never changes is refused by `after`; a human who walks 70 px toward the frame
passes and one who walks 30 px is refused; a hand 3 px from the frame's edge passes and one 40 px short of it is refused; a body whose centre goes from left of the frame's edge to right of it passes, one that stays left is
refused and one that was already across before the story point is refused; each recipe kind passes where its fixture does what the recipe says and is refused where it does not (a lid that moves 80 px against a range of 200, three arrivals against four on
one frame, a glow that grows two frames after the lid against four needed, hands drawn before the story point, a figure that rose again against `lowest`), and a measure clause no recipe says, or no recipe at all, is refused by `measure`.
Exit 0 every story point passes, 1 some fail (each named, with its reason), 2 a control that did not trip or an unreadable input.
"""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from probe_common import Probe, die, read_json, load_timeline, list_frames, STAGE, IDENTITY_PIGMENTS, IDENTITY_RADIUS, hex_rgb, hue_of, hue_array, resolve_blocking_at, PROP_NATIVE, CAST_NATIVE, ROLES_FILE

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


def present_family(rec, name, f):
    """A name that stands for a family of numbered props (`stroke`: stroke-1, stroke-2, stroke-3): present when the prop of that name is, or any `<name>-<n>` is. The screenplay's state key `strokes.count` counts `stroke`, its recipes name the three props one by one."""
    names = [name] + [n for n in (rec.get("actors") or {}) if re.fullmatch(re.escape(name) + r"-\d+", n)]
    return any(present(rec, n, f) for n in names)


def read_count(film, sp, o, fb, fa, i):
    n = lambda f: sum(1 for a in o["actors"] if present_family(film.rec(f), a, f))
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


def beat_last(film, f):
    """The last frame of the beat holding `f`: a cut ends what a story point can observe of the figure's placement."""
    b = next((b for b in film.tl["beats"] if b["start"] <= f < b["end"]), None)
    return b["end"] - 1 if b else f


def read_edge_gap(film, sp, o, fb, fa, i):
    """The figure layer's rightmost ink against the left edge of the frame on the story point's first frame, in stage pixels (hand within `within` of the edge)."""
    f0 = sp["frame"]; fr = film.rec(f0).get("frame"); box = box_of(film.figure(f0))
    if not fr or not box: return False, f"no frame in the blocking or an empty figure layer at f{f0}"
    reach = box[2] / scale_of(film.figure(f0)); gap = abs(reach - fr["x"])
    return gap <= o["within"], f"the figure's rightmost ink is at x {reach:.0f} on f{f0}, the frame's left edge at x {fr['x']:.0f}: {gap:.0f} px apart (within {o['within']} px needed)"


def read_centre_crossing(film, sp, o, fb, fa, i):
    """The silhouette's centre is left of the frame's left edge on the frame the recipe starts from and at or right of it on the last frame of the beat."""
    start = film.sps[i - 1]["frame"] if o.get("since") == "previous" and i > 0 else fb; last = min(fa, beat_last(film, sp["frame"]))
    fr = film.rec(last).get("frame"); b0, b1 = box_of(film.figure(start)), box_of(film.figure(last))
    if not fr or not b0 or not b1: return False, f"no frame in the blocking or an empty figure layer at f{start} or f{last}"
    c = lambda b, f: (b[0] + b[2]) / 2 / scale_of(film.figure(f))
    c0, c1 = c(b0, start), c(b1, last)
    return (c0 < fr["x"] <= c1), f"the figure's centre is at x {c0:.0f} on f{start} and x {c1:.0f} on f{last}, the frame's left edge at x {fr['x']:.0f}" + ("" if c0 < fr["x"] <= c1 else ": it does not go from the left of the edge to the right of it")


def read_figure(film, sp, o, fb, fa, i):
    if o["measure"] == "edge-gap": return read_edge_gap(film, sp, o, fb, fa, i)
    if o["measure"] == "centre": return read_centre_crossing(film, sp, o, fb, fa, i)
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


# ---------- the measure recipes (p017-p020): every clause of a story point's `measure` is read by one of these ----------
LAG_FLOOR = 6          # frames between two samples of a stage or glow series
GLOW_RADIUS = 260      # stage px: EMITTER_RADIUS of animaticPlan.ts, the disc the glow's area is counted in
GLOW_LEVEL = 40        # luminance a pixel of the glow's disc must exceed to count as lit
SKIN_FINGER = 5        # px (of the 1280 stage) of the opening that takes a finger off the skin mask: what survives is the body, what does not is the hands
SKIN_MIN_COMPONENTS = 8    # thin skin components (area > FINGER_MIN) that make hands "visible": two hands are ten fingers, a bare face and neck are none
FINGER_MIN = 60


def beat_clip(film, f0, fa): return min(fa, beat_last(film, f0))


def lead_in(film, f0):
    """Where to start looking for what a story point's movement began with: a move may begin a few frames before the story point's own frame (the lid's first key is 6 frames ahead of the lift), never before its beat."""
    b = next((b for b in film.tl["beats"] if b["start"] <= f0 < b["end"]), None)
    return max(f0 - 12, b["start"] if b else 0)


def res_at(film, f):
    cache = film.__dict__.setdefault("_res", {})
    if f not in cache: cache[f] = resolve_blocking_at(film.rec(f), f) or {}
    return cache[f]


def rect_of(film, name, f, res=None):
    """The stage rectangle (x0, y0, x1, y1) a named thing occupies on frame f, or None when it is not there: a prop at its native size and scale, Codex and Clawd at theirs, the frame, the join (a point), the human
    (the figure layer's silhouette box). A name no table knows is a point at its anchor."""
    res = res if res is not None else res_at(film, f)
    if name == "human":
        b = box_of(film.figure(f))
        if not b: return None
        s = scale_of(film.figure(f)); return (b[0] / s, b[1] / s, b[2] / s, b[3] / s)
    if name in CAST_NATIVE:
        c = res.get(name)
        if not isinstance(c, dict): return None
        (x0, y0), (x1, y1) = CAST_NATIVE[name]; s = c.get("scale", 1.0)
        return (c["x"] + x0 * s, c["y"] + y0 * s, c["x"] + x1 * s, c["y"] + y1 * s)
    if name == "frame":
        fr = res.get("frame")
        return (fr["x"], fr["y"], fr["x"] + fr["width"], fr["y"] + fr["height"]) if isinstance(fr, dict) else None
    if name == "join":
        j = res.get("join"); return (j["x"], j["y"], j["x"], j["y"]) if isinstance(j, dict) else None
    a = (res.get("actors") or {}).get(name)
    if not a: return None
    s = a.get("scale", 1.0)
    if name in PROP_NATIVE:
        (ox, oy), (w, h) = PROP_NATIVE[name]; return (a["x"] - ox * s, a["y"] - oy * s, a["x"] - ox * s + w * s, a["y"] - oy * s + h * s)
    return (a["x"], a["y"], a["x"], a["y"])


def on_stage(r): return r is not None and r[2] > 0 and r[0] < STAGE[0] and r[3] > 0 and r[1] < STAGE[1]
def centre_of(r): return ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
def gap_of(a, b): return float(np.hypot(max(b[0] - a[2], a[0] - b[2], 0), max(b[1] - a[3], a[1] - b[3], 0)))


def thing_here(film, name, f, res=None):
    """Is the named thing on stage on frame f (a prop in the blocking's actors, the frame with any of it in the picture, Codex and Clawd with their anchor in the picture, the human with ink)."""
    res = res if res is not None else res_at(film, f); r = rect_of(film, name, f, res)
    if name in ("frame", "codex", "clawd"): return on_stage(r)
    return r is not None


def anchor_at(film, name, f):
    res = res_at(film, f)
    if name in ("codex", "clawd", "frame"): c = res.get(name); return (c["x"], c["y"]) if isinstance(c, dict) else None
    if name == "human": c = res.get("figure"); return (c["x"], c.get("y", 0)) if isinstance(c, dict) else None
    a = (res.get("actors") or {}).get(name); return (a["x"], a["y"]) if a else None


def names_of(film, o, f):
    n = o.get("actors") or o.get("actor")
    if n in (None, "*"): res = res_at(film, f); return sorted((res.get("actors") or {})) + (["frame"] if res.get("frame") else [])
    return [n] if isinstance(n, str) else list(n)


def samples(fb, fa, step=LAG_FLOOR): return sorted(set(list(range(max(fb, 0), fa + 1, step)) + [fb, fa]))


def move_start(film, name, fb, fa):
    """The first frame in (fb, fa] a thing starts to move, from the blocking's own keys: the first `at` key whose next key lies somewhere else, or the `on` frame of a prop coming on. None when it never does."""
    for f in range(fb, fa + 1):
        a, b = anchor_at(film, name, max(f - 1, 0)), anchor_at(film, name, f)
        if (a is None) != (b is None) or (a and b and np.hypot(a[0] - b[0], a[1] - b[1]) >= 0.5): return f
    return None


def events_of(film, names, kind, f0, fa):
    """{name: frame} of the frames each named prop comes on (`on`) or goes off (`off`) inside [f0, fa], from the blocking."""
    out = {}
    for n in names:
        for f in range(f0, fa + 1):
            here, before = thing_here(film, n, f), thing_here(film, n, max(f - 1, 0))
            if kind == "on" and here and not before and f > 0 or kind == "off" and before and not here: out[n] = f; break
    return out


def read_stage(film, sp, o, fb, fa, i):
    e = o["expect"]; f0 = sp["frame"]; names = names_of(film, o, fa)
    if e in ("present", "persists", "absent", "inside", "offstage", "onstage"):
        for n in names:
            here = thing_here(film, n, fa)
            if e in ("present", "persists") and not here: return False, f"{n!r} is not on stage at f{fa} (the blocking of beat {film.beat_id(fa)!r} names {sorted(res_at(film, fa).get('actors') or {}) or 'no actors'})"
            if e == "absent" and here: return False, f"{n!r} is still on stage at f{fa}"
            if e == "persists":
                lost = next((f for f in range(fa, o["until"] + 1, 5) if not thing_here(film, n, f)), None)
                if lost is not None: return False, f"{n!r} is on stage at f{fa} and gone at f{lost}, before f{o['until']}: the blocking of beat {film.beat_id(lost)!r} does not hold it"
            if e == "offstage" and here: return False, f"{n!r} is on stage at f{fa} ({anchor_at(film, n, fa)}): the blocking holds it there, it never leaves"
            if e == "onstage" and not here: return False, f"{n!r} is not on stage at f{fa}"
            if e == "inside":
                inner, outer = rect_of(film, n, fa), rect_of(film, o["of"], fa)
                if inner is None or outer is None: return False, f"{n!r} or {o['of']!r} is not on stage at f{fa}"
                cx, cy = centre_of(inner) if n not in PROP_NATIVE else anchor_at(film, n, fa)
                if not (outer[0] <= cx <= outer[2] and outer[1] <= cy <= outer[3]): return False, f"{n!r} anchor ({cx:.0f}, {cy:.0f}) is outside {o['of']!r} ({outer[0]:.0f}, {outer[1]:.0f}, {outer[2]:.0f}, {outer[3]:.0f}) at f{fa}"
        return True, f"{'/'.join(names)} {e}" + (f" {o['of']}" if e == "inside" else "") + f" at f{fa}"
    if e in ("appears", "disappears"):
        for n in names:
            before, after = thing_here(film, n, fb), thing_here(film, n, fa)
            if e == "appears" and not (after and not before): return False, f"{n!r} is {'on stage' if before else 'not on stage'} at f{fb} and {'on stage' if after else 'not on stage'} at f{fa}: it does not come on inside the story point"
            if e == "disappears" and not (before and not after): return False, f"{n!r} is {'on stage' if before else 'not on stage'} at f{fb} and {'on stage' if after else 'not on stage'} at f{fa}: it does not go inside the story point"
        return True, f"{'/'.join(names)} {e}: f{fb} -> f{fa}"
    if e == "moves":
        lo, hi = o["by"][0], (o["by"] + [None, None])[1]
        for n in names:
            a, b = anchor_at(film, n, fb), anchor_at(film, n, fa)
            if a is None or b is None: return False, f"{n!r} has no anchor at f{fb} or f{fa} (the blocking of beat {film.beat_id(fa)!r} names {sorted(res_at(film, fa).get('actors') or {}) or 'no actors'})"
            d = float(np.hypot(a[0] - b[0], a[1] - b[1]))
            if d < lo or (hi is not None and d > hi): return False, f"{n!r} moves {d:.0f} px between f{fb} and f{fa} ({a[0]:.0f}, {a[1]:.0f} -> {b[0]:.0f}, {b[1]:.0f}); {lo}{'-' + str(hi) if hi is not None else ' or more'} px needed"
        return True, f"{'/'.join(names)} moves {d:.0f} px"
    if e == "rest":
        end = min(o.get("through", fa), fa); moved = []
        for n in names:
            ref = anchor_at(film, n, f0)
            for f in samples(f0, end):
                p = anchor_at(film, n, f)
                if (ref is None) != (p is None) or (ref and p and np.hypot(ref[0] - p[0], ref[1] - p[1]) > 1.0): moved.append(f"{n} at f{f}"); break
        return (not moved), (f"{'/'.join(names) or 'nothing on stage'} {'stays' if len(names) == 1 else 'stay'} where {'it is' if len(names) == 1 else 'they are'} f{f0}-{end}" if not moved else f"{', '.join(moved)}: it moves inside f{f0}-{end}")
    if e == "carried-by": return read_carried_by(film, sp, o, fb, fa, names[0])
    if e == "returns":
        n = names[0]; start = anchor_at(film, n, fb); last = min(fa, f0 + o["within"])
        if start is None: return False, f"{n!r} is not on stage at f{fb}"
        went = [f for f in range(f0, last + 1) if (p := anchor_at(film, n, f)) and np.hypot(p[0] - start[0], p[1] - start[1]) > 6]
        if not went: return False, f"{n!r} stays at ({start[0]:.0f}, {start[1]:.0f}) the whole window: the blocking holds it for the beat, so it never leaves its start and never comes back"
        back = next((f for f in range(went[0], f0 + o["within"] + 1) if (p := anchor_at(film, n, f)) and np.hypot(p[0] - start[0], p[1] - start[1]) <= 6 and f > went[0]), None)
        return back is not None, f"{n!r} leaves its start at f{went[0]}" + (f" and is back at f{back}" if back else f" and is not back within {o['within']} frames of the story point")
    return False, f"stage expect {e!r} is not one the probe reads"


def holder_gap(film, name, holder, f):
    """How far a thing is from the one holding it on frame f, in stage px: the human is her hands (the figure layer's thin skin), Codex and Clawd their native rectangles, anything else its rectangle; None when either is not there."""
    r = rect_of(film, name, f)
    if r is None: return None
    if holder == "human": return hand_gap(film, f, r)
    h = rect_of(film, holder, f); return gap_of(r, h) if h is not None else None


def read_carried_by(film, sp, o, fb, fa, name):
    """`carried-by` with `from` and `to`: the thing is in `from`'s hand (within `within` px, 8 by default) on the first frame it is on stage at or after `since` (a frame; else the frame before the story point), and in `to`'s hand on the window's last frame."""
    within = o.get("within", 8); since = o["since"] if isinstance(o.get("since"), int) else fb
    start = next((f for f in range(max(since, 0), fa + 1) if thing_here(film, name, f)), None)
    if start is None: return False, f"{name!r} is not on stage on any frame of f{since}-{fa} (the blocking of beat {film.beat_id(fa)!r} names {sorted(res_at(film, fa).get('actors') or {}) or 'no actors'})"
    g0, g1 = holder_gap(film, name, o["from"], start), holder_gap(film, name, o["to"], fa)
    if g0 is None or g1 is None: return False, f"{o['from'] if g0 is None else o['to']} is not on stage or draws no hands at f{start if g0 is None else fa}, so {name!r} is held by no one there"
    ok = g0 <= within and g1 <= within
    return ok, f"{name!r} is {g0:.0f} px from {o['from']} at f{start} and {g1:.0f} px from {o['to']} at f{fa} (within {within} px of {o['from']} first, then of {o['to']})"


def read_count_recipe(film, sp, o, fb, fa, i):
    n = lambda f: sum(1 for a in o["actors"] if thing_here(film, a, f))
    nb, na = n(fb), n(fa); e = o["expect"]
    if e == "rises":
        ok = na > nb and (o.get("from") is None or nb == o["from"]) and (o.get("to") is None or na >= o["to"])
        return ok, f"{'/'.join(o['actors'])[:60]} count is {nb} at f{fb} and {na} at f{fa}" + ("" if ok else f" (rises{' from ' + str(o['from']) if o.get('from') is not None else ''}{' to ' + str(o['to']) if o.get('to') else ''} needed)")
    if e == "at-most": return na <= o["to"], f"{na} of {'/'.join(o['actors'])[:60]} stand at f{fa} (at most {o['to']})"
    if e == "rises-then-falls":
        series = [(f, n(f)) for f in samples(fb, fa, 2)]; peak = max(c for _, c in series)
        return (peak >= o["to"] and na < peak), f"{'/'.join(o['actors'])[:60]}: peak count {peak} (needs {o['to']}), {na} at f{fa}" + ("" if peak >= o["to"] and na < peak else ": it does not go up to the count and come down")
    return False, f"count expect {e!r} is not one the probe reads"


def read_arrivals(film, sp, o, fb, fa, i):
    f0 = sp["frame"]; names = sorted((film.rec(fa).get("actors") or {})) if not o.get("actors") else o["actors"]
    ev = events_of(film, names, "on", f0, fa); by = {}
    for n, f in ev.items(): by.setdefault(f, []).append(n)
    best = max(by.items(), key=lambda kv: len(kv[1]), default=(None, []))
    return len(best[1]) >= o["same_frame"], f"{len(best[1])} named arrival(s) on one frame at most ({best[0] if best[0] is not None else 'none'}: {', '.join(best[1]) or 'nothing comes on'}); {o['same_frame']} needed on one frame (the blocking holds one actor per name: {len(names)} named)"


def read_stagger(film, sp, o, fb, fa, i):
    f0 = sp["frame"]; names = o.get("actors") or sorted((film.rec(fa).get("actors") or {}))
    ev = events_of(film, names, o.get("event", "on"), f0, fa); fr = sorted(ev.values())
    if len(fr) < 2: return False, f"{len(fr)} prop(s) {o.get('event', 'on')} inside f{f0}-{fa} ({', '.join(ev) or 'none'}): fewer than two, so nothing is staggered"
    gaps = [b - a for a, b in zip(fr, fr[1:])]
    return min(gaps) >= o["min"], f"{o.get('event', 'on')} frames {fr}: the smallest gap is {min(gaps)} (needs {o['min']})"


def read_order(film, sp, o, fb, fa, i):
    lo = lead_in(film, sp["frame"]); a, b = move_start(film, o["first"], lo, fa), move_start(film, o["then"], lo, fa)
    if a is None or b is None: return False, f"{o['first'] if a is None else o['then']} never moves inside f{lo}-{fa}"
    return b - a >= o["by"], f"{o['first']} starts at f{a}, {o['then']} at f{b}: {b - a} frames apart ({o['by']} needed)"


def read_contact(film, sp, o, fb, fa, i):
    frames = [o["frame"]] if o.get("frame") else samples(sp["frame"], fa, 2); best = None
    for f in frames:
        res = res_at(film, f)
        if "human" in (o["a"], o["b"]):
            other = rect_of(film, o["b"] if o["a"] == "human" else o["a"], f, res)
            g = hand_gap(film, f, other) if other is not None else None
        else:
            ra, rb = rect_of(film, o["a"], f, res), rect_of(film, o["b"], f, res); g = gap_of(ra, rb) if ra is not None and rb is not None else None
        if g is not None and (best is None or g < best[0]): best = (g, f)
    if best is None: return False, f"{o['a']} or {o['b']} is not on stage on {'f%d' % o['frame'] if o.get('frame') else 'any sampled frame of the window'} (the blocking of beat {film.beat_id(fa)!r} names {sorted(res_at(film, fa).get('actors') or {}) or 'no actors'}{'; the human is her hands, the figure layer' + chr(39) + 's thin skin' if 'human' in (o['a'], o['b']) else ''})"
    return best[0] <= o["within"], f"{o['a']} and {o['b']} are {best[0]:.0f} px apart at their nearest (f{best[1]}{', the human read as her hands' if 'human' in (o['a'], o['b']) else ''}); within {o['within']} px needed"


def read_emitters(film, sp, o, fb, fa, i):
    e = o["expect"]
    if e == "count":
        lt = film.light_at(fa).get("emitter"); n = len(lt) if isinstance(lt, list) else (1 if lt else 0); row = film.xs(fa) or {}
        return (n == o["to"] and bool(row.get("emitter"))), f"light.json holds {n} emitter(s) for beat {film.beat_id(fa)!r}, the xsheet row f{fa} {'has' if row.get('emitter') else 'has no'} one; {o['to']} needed"
    rows = [film.xs(f) for f in samples(sp["frame"], fa, 2)]; em = [r.get("emitter") for r in rows if r]
    if not em or not all(em): return False, "the xsheet has no emitter on some frame of the window"
    dh = len({x["hex"] for x in em}); ds = max(x.get("strength", 1) for x in em) - min(x.get("strength", 1) for x in em)
    steady = dh == 1 and ds < 0.05
    return steady, f"emitter colours {dh} and strength spread {ds:.2f} across f{sp['frame']}-{fa}" + ("" if steady else ": the light pulses")


def read_hold(film, sp, o, fb, fa, i):
    rows = [film.xs(f) for f in range(sp["frame"], fa + 1)]; best = max(((r or {}).get("hold") or 0 for r in rows), default=0)
    return best >= o["frames"], f"the longest hold the xsheet declares inside f{sp['frame']}-{fa} is {best} frames ({o['frames']} needed)"


def lum(a): return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def glow_area(film, f, centre):
    im = film.composed(f).astype(np.float32); sc = scale_of(im)
    m = disc(im.shape, centre, GLOW_RADIUS) & ~film.fig_mask(f, FIG_PAD) & ~film.cast_mask(f)
    return int(((lum(im) > GLOW_LEVEL) & m).sum()), need_px(im)


def read_glow(film, sp, o, fb, fa, i):
    ref = move_start(film, o["after"]["actor"], lead_in(film, sp["frame"]), fa)
    if ref is None: return False, f"{o['after']['actor']!r} never moves inside the window, so there is no event for the light to follow"
    row = film.xs(ref) or {}; em = row.get("emitter")
    if not em: return False, f"the xsheet has no emitter at f{ref}"
    c = (em["x"], em["y"]); base = glow_area(film, ref, c)[0]; floor = max(base * o["min"], 1)
    series = [(f, glow_area(film, f, c)[0]) for f in samples(ref, fa, 2)]
    first = next((f for f, a in series if a - base >= floor), None); peak = max(a for _, a in series)
    if first is None: return False, f"the lit area ({GLOW_RADIUS} px around the emitter, outside the figure and the cast) is {base} px when {o['after']['actor']} starts to move (f{ref}) and never exceeds {peak} px ({100 * (peak - base) / max(base, 1):+.1f} %) by f{fa}: it does not grow {100 * o['min']:.0f} %"
    return first - ref >= o["lag"], f"the lit area grows {100 * o['min']:.0f} % at f{first}, {first - ref} frames after {o['after']['actor']} starts to move (f{ref}); lag {o['lag']} needed"


def hue_share(film, f, pair_hex):
    a = film.composed(f).astype(np.int16); h = hue_array(a); ch = a.max(axis=-1) - a.min(axis=-1)
    t = hue_of(hex_rgb(pair_hex)); d = np.abs((h - t + 180) % 360 - 180)
    return float(((d <= 25) & (ch >= 30)).mean())


def read_picture(film, sp, o, fb, fa, i):
    m = o["measure"]; sc = lambda f: film.composed(f); fb = o["from"] if isinstance(o.get("from"), int) else fb
    if m == "hue-share":
        pair = (film.light_at(fa).get("pair") or {}).get("radiance")
        if not pair: return False, f"v3/light.json has no colour pair for beat {film.beat_id(fa)!r}"
        b, a = hue_share(film, fb, pair), hue_share(film, fa, pair); rel = (a - b) / max(b, 1e-6)
        ok = a - b >= 0.02 and rel >= o["min"]
        return ok, f"{100 * b:.1f} % of the picture is in the beat's hue ({pair}) at f{fb}, {100 * a:.1f} % at f{fa} ({rel * 100:+.0f} %; at least +{100 * o['min']:.0f} % and 2 points needed)"
    if m == "luminance-outside-frame":
        def outside(f):
            im, res = sc(f), res_at(film, f); fr = res.get("frame"); k = np.ones(im.shape[:2], bool); s = scale_of(im)
            if isinstance(fr, dict): k[max(int(fr["y"] * s), 0):int((fr["y"] + fr["height"]) * s), max(int(fr["x"] * s), 0):int((fr["x"] + fr["width"]) * s)] = False
            return float(lum(im.astype(np.float32))[k].mean())
        b, a = outside(fb), outside(fa); rel = (a - b) / max(b, 1e-6)
        return rel <= -o["min"], f"mean luminance outside the frame is {b:.1f} at f{fb} and {a:.1f} at f{fa} ({rel * 100:+.0f} %; a fall of {100 * o['min']:.0f} % needed)"
    if m == "ink-share":
        def ink(f):
            im = sc(f); field = np.median(im.reshape(-1, 3), axis=0); return float((np.abs(im.astype(np.int16) - field).max(axis=2) > 40).mean())
        b, a = ink(fb), ink(fa); rel = (a - b) / max(b, 1e-6)
        return rel <= -o["min"], f"{100 * b:.1f} % of the picture is not the field colour at f{fb}, {100 * a:.1f} % at f{fa} ({rel * 100:+.0f} %; a fall of {100 * o['min']:.0f} % needed)"
    return False, f"picture measure {m!r} is not one the probe reads"


def skin_mask(fig):
    d = read_json(ROLES_FILE, "the roles file")["identity"]["humanSkin"]; greens = [hex_rgb(h) for h in d if hex_rgb(h)[1] > hex_rgb(h)[0] and hex_rgb(h)[1] > hex_rgb(h)[2]]
    m = np.zeros(fig.shape[:2], bool)
    for c in greens: m |= np.abs(fig.astype(np.int16) - np.array(c, np.int16)).sum(axis=2) <= 40
    return m


def thin_skin(fig):
    """The skin the figure layer draws that is thinner than a finger's opening: the skin mask less its opening (the body's skin is thicker), as a boolean mask."""
    from scipy import ndimage as ndi
    m = skin_mask(fig); r = max(1, round(SKIN_FINGER * scale_of(fig)))
    return m & ~ndi.binary_dilation(ndi.binary_opening(m, structure=np.ones((2 * r + 1, 2 * r + 1))), structure=np.ones((3, 3)))


def fingers(fig):
    """How many thin skin components the figure layer draws: a hand is five of them."""
    from scipy import ndimage as ndi
    thin = thin_skin(fig); lab, n = ndi.label(thin); sizes = ndi.sum(thin, lab, range(1, n + 1)) if n else []
    return int((np.array(sizes) > FINGER_MIN * scale_of(fig) ** 2).sum())


def hand_gap(film, f, rect):
    """The nearest the human's hands (the figure layer's thin skin) come to a stage rectangle, in stage px; None when the layer draws none."""
    fig = film.figure(f); ys, xs = np.nonzero(thin_skin(fig))
    if not len(xs): return None
    s = scale_of(fig); x, y = xs / s, ys / s
    return float(np.hypot(np.maximum.reduce([rect[0] - x, x - rect[2], np.zeros_like(x)]), np.maximum.reduce([rect[1] - y, y - rect[3], np.zeros_like(y)])).min())


def read_hands(film, sp, o, fb, fa, i):
    f_first = sp["frame"]; before, after = fingers(film.figure(fb)), fingers(film.figure(fa)); vis = lambda n: n >= SKIN_MIN_COMPONENTS
    if o["expect"] == "hidden": n = fingers(film.figure(f_first)); return (not vis(n)), f"{n} finger-sized skin components on f{f_first} ({SKIN_MIN_COMPONENTS} or more means both hands are drawn)" + ("" if not vis(n) else ": the hands are drawn on the story point's first frame")
    return (vis(after) and not vis(before)), f"{before} finger-sized skin components at f{fb}, {after} at f{fa} ({SKIN_MIN_COMPONENTS} or more means the hands are drawn)" + ("" if vis(after) and not vis(before) else (": the hands are already drawn before the story point" if vis(before) else ": the hands are not drawn after it"))


def read_figure_recipe(film, sp, o, fb, fa, i):
    if o.get("expect") == "lowest":
        start = next((b["start"] for b in film.tl["beats"] if b["start"] <= fa < b["end"]), 0); h = lambda f: (lambda bx: (bx[3] - bx[1]) if bx else None)(box_of(film.figure(f)))
        series = [(f, h(f)) for f in samples(start, fa, 6) if h(f) is not None]; here = h(fa)
        if here is None: return False, f"the figure layer is empty at f{fa}"
        low = min(series, key=lambda s: s[1]); return here <= low[1] * 1.02, f"the figure is {here} px tall at f{fa}; the lowest height since the beat began (f{start}) is {low[1]} px at f{low[0]}"
    return read_figure(film, sp, o, fb, fa, i)


def read_actor_recipe(film, sp, o, fb, fa, i): return READERS["actor"](film, sp, o, fb, fa, i)


def read_xsheet_recipe(film, sp, o, fb, fa, i):
    if o["field"] == "world" and o["expect"] == "equals":
        at = o.get("at"); f = fa + 1 if at == "next" else at if isinstance(at, int) else fa; r = film.xs(f)
        if not r: return False, f"v3/xsheet.json has no row at f{f}"
        w = xs_world(r); return (w == o["value"]), f"world is {w!r} at f{f} ({o['value']!r} needed)"
    return read_xsheet(film, sp, o, fb, fa, i)


def read_light_recipe(film, sp, o, fb, fa, i):
    if o["field"] == "grain" and o["expect"] == "equals": g = film.light_at(fa).get("grain"); return g == o["value"], f"light.json grain is {g!r} for beat {film.beat_id(fa)!r} ({o['value']!r} needed)"
    return read_light(film, sp, o, fb, fa, i)


RECIPE_READERS = {"stage": read_stage, "count": read_count_recipe, "arrivals": read_arrivals, "stagger": read_stagger, "order": read_order, "contact": read_contact, "emitters": read_emitters, "hold": read_hold,
                  "glow": read_glow, "picture": read_picture, "hands": read_hands, "figure": read_figure_recipe, "actor": read_actor_recipe, "xsheet": read_xsheet_recipe, "light": read_light_recipe, "gates": read_gates}


def clauses_of(measure): return [c.strip() for c in str(measure).split(";") if c.strip()]


def judge_recipes(film, i, fb, fa):
    """One check per recipe of the story point's `recipes`, and one failing check for each clause of its `measure` that no recipe says, or for a measure with no recipe at all."""
    sp = film.sps[i]; out = []; rs = sp.get("recipes") or []
    said = {r.get("says") for r in rs}; miss = [c for c in clauses_of(sp.get("measure", "")) if c not in said]
    if not rs and sp.get("measure"): out.append(("measure", False, f"the measure line has no recipe: {sp['measure']!r}"))
    elif miss: out.append(("measure", False, "no recipe reads: " + "; ".join(repr(c) for c in miss)))
    fa_c = beat_clip(film, sp["frame"], fa)
    for r in rs:
        read = RECIPE_READERS.get(r.get("kind"))
        if read is None: out.append((f"measure {r.get('says')!r}", False, f"recipe kind {r.get('kind')!r} is not one the probe reads")); continue
        try: ok, why = read(film, sp, r, fb, fa_c, i)
        except (KeyError, TypeError, ValueError) as e: ok, why = False, f"recipe is malformed ({type(e).__name__}: {e})"
        out.append((f"measure {r['says']!r}", bool(ok), why))
    return out


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
    if any((film.registry.get(k) or {}).get("observe", {}).get("world") is not False for k in sp.get("after", [])):
        best, floor = 0, 1; reg = film.props_region(fb, fa)
        for t in list(range(f0, f1, SAMPLE_EVERY)) + [fa]:
            n, floor = film.world_diff(fb, t, reg); best = max(best, n)
        recs = film.blocking_changes(fb, fa)
        fig = int(changed(film.figure(fb), film.figure(fa)).sum())
        ok = best >= floor or bool(recs)
        checks.append(("world", ok, f"props layer {best} px outside the figure and the cast (needs {floor:.0f}); records: {', '.join(recs) or 'nothing differs'}; figure layer {fig} px" + ("" if ok else ": the figure acts over a world that does not change")))
    checks += judge_recipes(film, i, fb, fa)
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


def run_control():
    res, bad = [], []
    for label, (film, i, want_ok, want_check) in synthetic().items():
        r = judge(film, i); failed = [c["check"] for c in r["checks"] if not c["ok"]]
        right = r["ok"] if want_ok else (not r["ok"] and want_check in failed)
        res.append(f"{label} -> {'pass' if r['ok'] else 'FAIL (' + ', '.join(failed) + ')'}")
        if not right: bad.append(label)
    return res, bad


def travel_films():
    """The human's three measure lines on 320x180 fixtures (scale 0.25, the frame's left edge at stage x 800 = pixel 200): Films whose figure layer is a 20 px wide block at stage x `at(f)` on frame f, one story point each at f 20 in a
    beat of 60 frames. Returns [(label, Film, story index, recipe, expected ok)]."""
    tl = {"beats": [{"id": "b", "start": 0, "end": 60}]}; ledger = {"beats": [{"id": "b", "state": []}]}
    sps = [{"id": "sp-1.1", "frame": 10, "slug": "A", "after": [], "colour": "k"}, {"id": "sp-1.2", "frame": 20, "slug": "B", "after": [], "colour": "k"}]
    def film(left, blocking_figure):
        def figure_at(f):
            im = np.full((180, 320, 3), 12, np.uint8); x = int(left(f) * 0.25); im[60:170, x:x + 5] = (200, 90, 90); return im
        return Film(sps, {"colour_keys": {}, "state_keys": {"keys": {}}}, ledger, tl, lambda f: np.full((180, 320, 3), 12, np.uint8), figure_at, lambda f: None, {}, {"b": {"frame": {"x": 800, "y": 100, "width": 400, "height": 400}, "figure": blocking_figure}}, {}, 60)
    walk = lambda dx: {"x": 100, "y": 0, "at": [{"frame": 22, "x": 100}, {"frame": 30, "x": 100 + dx}]}
    toward = {"kind": "actor", "actor": "human", "expect": "toward-frame", "min": 60}; edge = {"kind": "figure", "measure": "edge-gap", "expect": "within", "within": 8}
    cross = {"kind": "figure", "measure": "centre", "expect": "crosses-frame", "since": "previous"}
    still = {"x": 100, "y": 0}
    return [("a human who walks 70 px toward the frame", film(lambda f: 100, walk(70)), 1, toward, True), ("a human who walks 30 px toward the frame", film(lambda f: 100, walk(30)), 1, toward, False),
            ("a hand 4 px past the frame's edge", film(lambda f: 787, still), 1, edge, True), ("a hand 40 px short of the frame's edge", film(lambda f: 740, still), 1, edge, False),
            ("a body whose centre goes from left of the frame's edge to right of it", film(lambda f: 500 if f < 40 else 900, still), 1, cross, True), ("a body that stays left of the frame's edge", film(lambda f: 500, still), 1, cross, False),
            ("a body that was already across before the story point", film(lambda f: 900, still), 1, cross, False)]


def recipe_cases():
    """The recipes on 320x180 fixtures (scale 0.25, stage = 4 x pixels): one beat `b` of 90 frames, a story point at f20 (window 20-59) and one at f60. The shared blocking holds a lamp that comes on at f30, a lid that moves 80 px from f22, three props that
    arrive together on f32 and two more at f40 and f52, a box, Codex and Clawd who start to move four frames apart, a frame and a join. Returns [(label, recipe, expected ok)] and the builder of a film for a case."""
    H, W = 180, 320; dark = np.full((H, W, 3), 12, np.uint8)
    B = {"actors": {"lamp": {"x": 260, "y": 240, "scale": 1, "on": 30}, "box": {"x": 260, "y": 300, "scale": 1}, "lid": {"x": 200, "y": 300, "at": [{"frame": 22, "x": 200, "y": 300}, {"frame": 36, "x": 280, "y": 300}]},
                    "ring": {"x": 400, "y": 300, "on": 32}, "patch": {"x": 500, "y": 300, "on": 32}, "bead": {"x": 600, "y": 300, "on": 32}, "stalk": {"x": 300, "y": 200, "on": 40}, "arch": {"x": 700, "y": 300, "on": 52}},
         "codex": {"x": 100, "y": 440, "scale": 1, "at": [{"frame": 14, "x": 100}, {"frame": 20, "x": 130}]}, "clawd": {"x": 900, "y": 470, "scale": 1, "at": [{"frame": 18, "x": 900}, {"frame": 24, "x": 850}]},
         "frame": {"x": 1000, "y": 40, "width": 280, "height": 230}, "join": {"x": 420, "y": 300}}
    row = lambda f, strength=1.0, hexc="#ffffff", hold=None: {"frame": f, "world": "home", "hold": hold, "emitter": {"x": 800, "y": 360, "hex": hexc, "strength": strength}}
    def disc_frame(r, colour=(230, 230, 120)):
        im = dark.copy(); yy, xx = np.mgrid[0:H, 0:W]; im[(xx - 200) ** 2 + (yy - 90) ** 2 <= r * r] = colour; return im
    def fingers_fig(n):
        im = np.full((H, W, 3), 7, np.uint8); yy, xx = np.mgrid[0:H, 0:W]; im[(xx - 160) ** 2 + (yy - 40) ** 2 <= 20 * 20] = (0x67, 0xb4, 0x79)
        for k in range(n): im[70:82, 60 + 6 * k:62 + 6 * k] = (0x67, 0xb4, 0x79)
        return im
    sps = [{"id": "sp-1.1", "frame": 20, "slug": "A", "after": [], "colour": "k", "measure": ""}, {"id": "sp-1.2", "frame": 60, "slug": "B", "after": [], "colour": "k", "measure": ""}]
    def film(blocking=B, composed=lambda f: dark, figure=lambda f: dark, xs=lambda f: row(f, hold=26 if f == 20 else None), light=None):
        light = light or {"beats": {"b": {"emitter": {"anchor": "lamp"}, "grain": "high", "pair": {"radiance": "#0a51fb", "accent": "#ffffff"}}}}
        return Film(sps, {"colour_keys": {}, "state_keys": {"keys": {}}}, {"beats": [{"id": "b", "state": []}]}, {"beats": [{"id": "b", "start": 0, "end": 90}]}, composed, figure, xs, light, {"b": blocking}, {}, 90)
    grow = lambda start: (lambda f: disc_frame(20 if f < start else 34))
    blue = lambda share: (lambda f: np.where((np.arange(W)[None, :, None] < share * W) & (f >= 40), np.array([10, 81, 251], np.uint8), dark).astype(np.uint8))
    heights = lambda hs: (lambda f: (lambda im, h: (im.__setitem__((slice(170 - h, 170), slice(150, 170)), (200, 90, 90)), im)[1])(np.full((H, W, 3), 12, np.uint8), hs(f)))
    pen = lambda keys, on=20: {**B, "actors": {**B["actors"], "pen": {"x": 940, "y": 520, "on": on, "at": keys}}}
    to_hand = [{"frame": 20, "x": 940, "y": 520}, {"frame": 40, "x": 300, "y": 300}]
    ink = lambda share_of: (lambda f: (lambda im: (im.__setitem__((slice(0, H), slice(0, int(share_of(f) * W))), (210, 210, 210)), im)[1])(dark.copy()))
    ink_curve = lambda f: 0.10 if f < 10 else 0.40 if f < 30 else 0.15
    xs_world_at = lambda f: {**row(f), "world": "crayon" if f >= 45 else "home"}
    cases = [
        ("a pen in Clawd's hand on its first frame that is in the human's hand on the last", {"kind": "stage", "actor": "pen", "expect": "carried-by", "from": "clawd", "to": "human", "since": 18}, True, film(blocking=pen(to_hand), figure=lambda f: fingers_fig(10))),
        ("the same pen, which never leaves Clawd's hand", {"kind": "stage", "actor": "pen", "expect": "carried-by", "from": "clawd", "to": "human", "since": 18}, False, film(blocking=pen([{"frame": 20, "x": 940, "y": 520}]), figure=lambda f: fingers_fig(10))),
        ("a pen that starts in the human's hand, asked to start in Clawd's", {"kind": "stage", "actor": "pen", "expect": "carried-by", "from": "clawd", "to": "human", "since": 18}, False, film(blocking=pen([{"frame": 20, "x": 300, "y": 300}]), figure=lambda f: fingers_fig(10))),
        ("the same pen with no hands drawn at its end", {"kind": "stage", "actor": "pen", "expect": "carried-by", "from": "clawd", "to": "human", "since": 18}, False, film(blocking=pen(to_hand), figure=lambda f: fingers_fig(0))),
        ("a pen that never comes on", {"kind": "stage", "actor": "pen", "expect": "carried-by", "from": "clawd", "to": "human", "since": 18}, False, film(figure=lambda f: fingers_fig(10))),
        ("a world 'crayon' asked at f50, which is crayon from f45", {"kind": "xsheet", "field": "world", "expect": "equals", "value": "crayon", "at": 50}, True, film(xs=xs_world_at)),
        ("the same world asked at f40, before it changes", {"kind": "xsheet", "field": "world", "expect": "equals", "value": "crayon", "at": 40}, False, film(xs=xs_world_at)),
        ("a world 'crayon' asked at the window's end, which is crayon", {"kind": "xsheet", "field": "world", "expect": "equals", "value": "crayon"}, True, film(xs=xs_world_at)),
        ("ink that falls 62 % from f19, asked for 50 %", {"kind": "picture", "measure": "ink-share", "expect": "falls", "min": 0.5}, True, film(composed=ink(ink_curve))),
        ("the same ink asked to fall 50 % from f0, where it was lower", {"kind": "picture", "measure": "ink-share", "expect": "falls", "min": 0.5, "from": 0}, False, film(composed=ink(ink_curve))),
        ("the same ink asked to fall 50 % from f12, where it was high", {"kind": "picture", "measure": "ink-share", "expect": "falls", "min": 0.5, "from": 12}, True, film(composed=ink(ink_curve))),
        ("a prop that comes on inside the window", {"kind": "stage", "actor": "lamp", "expect": "appears"}, True, film()),
        ("a prop that never comes on", {"kind": "stage", "actor": "ghost", "expect": "appears"}, False, film()),
        ("a lid that moves 80 px, asked 40 to 120", {"kind": "stage", "actor": "lid", "expect": "moves", "by": [40, 120]}, True, film()),
        ("the same lid, asked 200 px", {"kind": "stage", "actor": "lid", "expect": "moves", "by": [200]}, False, film()),
        ("the frame, which holds still", {"kind": "stage", "actor": "frame", "expect": "rest"}, True, film()),
        ("the lid, which does not hold still", {"kind": "stage", "actor": "lid", "expect": "rest"}, False, film()),
        ("the lamp inside the box", {"kind": "stage", "actor": "lamp", "expect": "inside", "of": "box"}, True, film()),
        ("the lamp inside the frame", {"kind": "stage", "actor": "lamp", "expect": "inside", "of": "frame"}, False, film()),
        ("a frame that is on stage, asked to come on", {"kind": "stage", "actor": "frame", "expect": "appears"}, False, film()),
        ("three props from none", {"kind": "count", "actors": ["ring", "patch", "bead"], "expect": "rises", "from": 0, "to": 3}, True, film()),
        ("the same three, asked to rise to 5", {"kind": "count", "actors": ["ring", "patch", "bead"], "expect": "rises", "to": 5}, False, film()),
        ("three standing, at most 3", {"kind": "count", "actors": ["ring", "patch", "bead"], "expect": "at-most", "to": 3}, True, film()),
        ("three standing, at most 2", {"kind": "count", "actors": ["ring", "patch", "bead"], "expect": "at-most", "to": 2}, False, film()),
        ("three arrivals on one frame, asked 3", {"kind": "arrivals", "same_frame": 3}, True, film()),
        ("the same arrivals, asked 4 on one frame", {"kind": "arrivals", "same_frame": 4}, False, film()),
        ("arrivals 10 and 12 frames apart, asked 3", {"kind": "stagger", "event": "on", "actors": ["lamp", "stalk", "arch"], "min": 3}, True, film()),
        ("the same arrivals, asked 11", {"kind": "stagger", "event": "on", "actors": ["lamp", "stalk", "arch"], "min": 11}, False, film()),
        ("three arrivals on one frame, asked to be staggered by 3", {"kind": "stagger", "event": "on", "actors": ["ring", "patch", "bead"], "min": 3}, False, film()),
        ("Codex then Clawd four frames apart, asked 4", {"kind": "order", "first": "codex", "then": "clawd", "by": 4}, True, film()),
        ("the same pair, asked 8", {"kind": "order", "first": "codex", "then": "clawd", "by": 8}, False, film()),
        ("the ring on the join", {"kind": "contact", "a": "ring", "b": "join", "within": 8}, True, film()),
        ("Codex far from the join", {"kind": "contact", "a": "codex", "b": "join", "within": 8}, False, film()),
        ("a steady light", {"kind": "emitters", "expect": "steady"}, True, film()),
        ("a light whose strength pulses", {"kind": "emitters", "expect": "steady"}, False, film(xs=lambda f: row(f, strength=1.0 if f < 40 else 0.4))),
        ("one emitter, asked 1", {"kind": "emitters", "expect": "count", "to": 1}, True, film()),
        ("one emitter, asked 2", {"kind": "emitters", "expect": "count", "to": 2}, False, film()),
        ("a hold of 26, asked 26", {"kind": "hold", "frames": 26}, True, film()),
        ("a hold of 26, asked 40", {"kind": "hold", "frames": 40}, False, film()),
        ("a glow that grows 9 frames after the lid starts", {"kind": "glow", "expect": "grows", "after": {"actor": "lid", "event": "moves"}, "lag": 4, "min": 0.1}, True, film(composed=grow(32))),
        ("a glow that grows 2 frames after the lid starts", {"kind": "glow", "expect": "grows", "after": {"actor": "lid", "event": "moves"}, "lag": 4, "min": 0.1}, False, film(composed=grow(25))),
        ("a glow that never grows", {"kind": "glow", "expect": "grows", "after": {"actor": "lid", "event": "moves"}, "lag": 4, "min": 0.1}, False, film()),
        ("a picture whose hue share rises from 0 to a third", {"kind": "picture", "measure": "hue-share", "expect": "rises", "min": 1.0}, True, film(composed=blue(0.33))),
        ("a picture whose hue share does not change", {"kind": "picture", "measure": "hue-share", "expect": "rises", "min": 1.0}, False, film()),
        ("a picture that goes dark outside the frame", {"kind": "picture", "measure": "luminance-outside-frame", "expect": "falls", "min": 0.5}, True, film(composed=lambda f: np.full((H, W, 3), 200 if f < 40 else 20, np.uint8))),
        ("a picture that stays lit outside the frame", {"kind": "picture", "measure": "luminance-outside-frame", "expect": "falls", "min": 0.5}, False, film(composed=lambda f: np.full((H, W, 3), 200, np.uint8))),
        ("hands drawn on the first frame, asked to be hidden", {"kind": "hands", "expect": "hidden"}, False, film(figure=lambda f: fingers_fig(10))),
        ("no hands on the first frame, asked to be hidden", {"kind": "hands", "expect": "hidden"}, True, film(figure=lambda f: fingers_fig(0))),
        ("hands that come on after the story point", {"kind": "hands", "expect": "appears"}, True, film(figure=lambda f: fingers_fig(10 if f >= 30 else 0))),
        ("hands that were drawn before it", {"kind": "hands", "expect": "appears"}, False, film(figure=lambda f: fingers_fig(10))),
        ("a figure at its lowest", {"kind": "figure", "measure": "height", "expect": "lowest"}, True, film(figure=heights(lambda f: 120 if f < 30 else 60))),
        ("a figure that rose again", {"kind": "figure", "measure": "height", "expect": "lowest"}, False, film(figure=heights(lambda f: 60 if f < 30 else 120))),
        ("a figure whose hands reach the ring", {"kind": "contact", "a": "human", "b": "ring", "within": 12}, True, film(figure=lambda f: fingers_fig(10))),
        ("a figure whose hands are far from the frame", {"kind": "contact", "a": "human", "b": "frame", "within": 12}, False, film(figure=lambda f: fingers_fig(10))),
    ]
    return sps, cases


def run_recipe_control():
    sps, cases = recipe_cases(); res, bad = [], []
    for label, recipe, want, film in cases:
        sp = {**sps[0], "recipes": [{"says": "x", **recipe}], "measure": "x"}; film.sps = [sp, sps[1]]
        fb, f0, f1, fa = film.window(0); out = judge_recipes(film, 0, fb, fa)
        ok = all(c[1] for c in out); res.append(f"{label} -> {'pass' if ok else 'FAIL'}")
        if ok != want: bad.append(f"{label} ({out[0][2]})")
    film = cases[0][3]; one = {"says": "the lamp comes on", "kind": "stage", "actor": "lamp", "expect": "appears"}
    for label, sp, want in (("a measure clause no recipe says", {**sps[0], "measure": "the lamp comes on; the box glows", "recipes": [one]}, False), ("a measure with no recipe", {**sps[0], "measure": "the lamp comes on", "recipes": []}, False),
                            ("a measure whose every clause a recipe says", {**sps[0], "measure": "the lamp comes on", "recipes": [one]}, True)):
        film.sps = [sp, sps[1]]; fb, f0, f1, fa = film.window(0); out = judge_recipes(film, 0, fb, fa); ok = all(c[1] for c in out)
        res.append(f"{label} -> {'pass' if ok else 'FAIL'}")
        if ok != want: bad.append(label)
    return res, bad


def family_cases():
    """The count reader over a family name: a beat of 60 frames whose blocking brings stroke-1, stroke-2 and stroke-3 on at 30, 40 and 50. Returns [(label, actors, expected ok)] and the film."""
    tl = {"beats": [{"id": "b", "start": 0, "end": 60}]}; ledger = {"beats": [{"id": "b", "state": []}]}
    sps = [{"id": "sp-1.1", "frame": 20, "slug": "A", "after": [], "colour": "k"}, {"id": "sp-1.2", "frame": 59, "slug": "B", "after": [], "colour": "k"}]
    blocking = {"actors": {f"stroke-{k}": {"x": 100 * k, "y": 100, "scale": 1, "on": 20 + 10 * k} for k in (1, 2, 3)} | {"strokes": {"x": 5, "y": 5, "scale": 1}}}
    film = Film(sps, {"colour_keys": {}, "state_keys": {"keys": {}}}, ledger, tl, lambda f: np.full((180, 320, 3), 12, np.uint8), lambda f: np.full((180, 320, 3), 12, np.uint8), lambda f: None, {}, {"b": blocking}, {}, 60)
    return film, [("a count over `stroke` while stroke-1 to stroke-3 come on inside the window", ["stroke"], True), ("a count over `ghost`, which no prop of the beat is or is numbered from", ["ghost"], False),
                  ("a count over `strok`, a prefix of a name and not a family", ["strok"], False)]


def run_family_control():
    film, cases = family_cases(); res, bad = [], []
    for label, actors, want in cases:
        ok, why = read_count(film, film.sps[0], {"actors": actors, "expect": "rises"}, 19, 59, 0)
        res.append(f"{label} -> {'pass' if ok else 'FAIL'}")
        if bool(ok) != want: bad.append(f"{label} ({why})")
    return res, bad


def run_travel_control():
    res, bad = [], []
    for label, film, i, recipe, want in travel_films():
        sp = film.sps[i]; fb, f0, f1, fa = film.window(i); ok, why = READERS[recipe["kind"]](film, sp, recipe, fb, fa, i)
        res.append(f"{label} -> {'pass' if ok else 'FAIL'}")
        if bool(ok) != want: bad.append(f"{label} ({why})")
    return res, bad


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    j = lambda *p: os.path.join(ROOT, *p)
    ap.add_argument("screenplay", nargs="?", default=j("v3", "screenplay.json")); ap.add_argument("--frames", default=j("out", "animatic-seq")); ap.add_argument("--figure-frames", default=j("out", "animatic-fig-seq"))
    ap.add_argument("--xsheet", default=j("v3", "xsheet.json")); ap.add_argument("--light", default=j("v3", "light.json")); ap.add_argument("--blocking", default=j("v3", "blocking"))
    ap.add_argument("--keys", default=j("v3", "keys")); ap.add_argument("--poses", default=j("v3", "poses")); ap.add_argument("--ledger", default=j("v3", "beats-v2.json")); ap.add_argument("--timeline", default=j("v3", "timeline.json"))
    ap.add_argument("--story", default=None, help="comma-separated story point ids to judge (the others are not read)"); ap.add_argument("--json", default=None)
    a = ap.parse_args(); pr = Probe("story", a.json)
    (res, bad), (res_t, bad_t), (res_r, bad_r), (res_f, bad_f) = run_control(), run_travel_control(), run_recipe_control(), run_family_control()
    bad_t = bad_t + bad_r + bad_f; res_r = res_r + res_f
    pr.control(not bad and not bad_t, "; ".join(res + res_t + res_r) + ("" if not bad_t else " (NOT AS EXPECTED: " + "; ".join(bad_t) + ")"))
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
