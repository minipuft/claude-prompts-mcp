#!/usr/bin/env python3
"""Theme invariants (row 9.8, p021): the film's themes are checked against its staging before any frame is drawn.

usage: probe-theme.py [v3/screenplay.json] [--blocking v3/blocking] [--timeline v3/timeline.json] [--json out.json]
The screenplay's `themes` (probe-screenplay.py holds their shape) each carry a `check` with a `kind`. Four kinds are read here, on the blocking (`v3/blocking/<beat>.json`, each frame resolved with
`probe_common.resolve_blocking_at`, the one copy of how a prop, Codex, Clawd and the carried frame stand on a frame) and the story points (their frames, `eye`, `emitter`, `after`); the others (channels, child-detail,
register) are the screenplay's own and are read by probe-screenplay.py. One line per theme:
  portal       th-frame-portal  the frame prop is on no frame before the story point named by `enters` (sp-4.2) and on every frame from the next story point (a carried frame takes the story point to come in) to the end of the film.
  glass        th-glass         on every frame where `actor` (the gadget) is on stage its anchor lies in one of the `holders` (the bubble, the frame's interior inside its bar, the structure), except inside an `except` span
                                 (`from` story point to `until` story point): the one stretch the gadget stands free, the overwhelm after the pop.
  one-join     th-one-join      after the story point named by `after` (sp-4.6) no story point's window brings more than one new prop on stage (`on` inside the window), and any two arrivals in the film are at least `stagger`
                                 frames apart (3) unless both fall inside the window of a story point in `unstaggered` (sp-2.3, the flood). `joins.lit` in an `after` list counts as one arrival.
  light-leads  th-light-leads   every story point names an `eye` or an `emitter`, and the line resolves to a target the eye trace can measure (`probe-eyetrace.resolve_target`: its target table, and the beat's blocking has the
                                 `frame` or `join` the line points at): a line outside the table, or one whose source is missing, is refused naming it.
Control first, on a synthetic film that is clean by construction (three beats, six story points): the frame on stage on frame 0, the frame gone from the end, the gadget outside every holder, the gadget free outside the
excepted span, two arrivals in one story point after the boundary, two arrivals one frame apart outside the flood, an eye line outside the table, a story point naming neither eye nor emitter and a `frame interior` line in
a beat whose blocking has no frame must each be refused by the check that names them; the clean film, the same film with the arrivals inside the flood and with the excepted span declared must pass.
Exit 0 pass, 1 a refusal, 2 a control that did not trip or an unreadable input.
"""
import argparse, copy, importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from probe_common import Probe, die, read_json, load_timeline, resolve_blocking_at, PROP_NATIVE, FRAME_BAR, STAGE

KINDS = ("portal", "glass", "one-join", "light-leads")


def load_eyetrace():
    spec = importlib.util.spec_from_file_location("probe_eyetrace", os.path.join(HERE, "probe-eyetrace.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


def ranges(frames):
    """[(first, last)] of a sorted list of frames, contiguous runs joined."""
    out = []
    for f in frames:
        if out and f == out[-1][1] + 1: out[-1][1] = f
        else: out.append([f, f])
    return [(a, b) for a, b in out]


def fmt(rs, limit=4):
    text = ", ".join(f"f{a}" if a == b else f"f{a}-{b}" for a, b in rs[:limit])
    return text + (f" and {len(rs) - limit} more run(s)" if len(rs) > limit else "")


class Film:
    """What the invariants read: the story points by id, the beat of a frame, the blocking of a frame as it stands on it (cached)."""
    def __init__(self, d, blocking, tl):
        self.d, self.blocking, self.tl = d, blocking, tl
        self.sps = d["story_points"]; self.by_id = {s["id"]: s for s in self.sps}; self.duration = tl["duration"]; self._res = {}

    def beat_at(self, f):
        b = next((b for b in self.tl["beats"] if b["start"] <= f < b["end"]), None); return b["id"] if b else None

    def res(self, f):
        if f not in self._res: self._res[f] = resolve_blocking_at(self.blocking.get(self.beat_at(f)), f) or {}
        return self._res[f]

    def sp_frame(self, sid, check):
        if sid not in self.by_id: raise ValueError(f"{check} names story point {sid!r}, which the screenplay does not have")
        return self.by_id[sid]["frame"]

    def next_frame(self, sid):
        i = [s["id"] for s in self.sps].index(sid); return self.sps[i + 1]["frame"] if i + 1 < len(self.sps) else self.duration

    def window(self, i): return self.sps[i]["frame"], (self.sps[i + 1]["frame"] if i + 1 < len(self.sps) else self.duration)


def frame_on_stage(res):
    fr = res.get("frame")
    return isinstance(fr, dict) and fr["x"] + fr["width"] > 0 and fr["x"] < STAGE[0] and fr["y"] + fr["height"] > 0 and fr["y"] < STAGE[1]


def check_portal(film, t):
    c = t["check"]; actor = c.get("actor", "frame")
    if actor != "frame": return False, f"portal reads the frame prop, the theme names {actor!r}"
    enter = film.sp_frame(c["enters"], "th-frame-portal"); settled = film.next_frame(c["enters"])
    early = [f for f in range(0, enter) if frame_on_stage(film.res(f))]
    late = [f for f in range(settled, film.duration) if not frame_on_stage(film.res(f))]
    p = []
    if early: p.append(f"the frame is on stage on {len(early)} frame(s) before {c['enters']} (f{enter}): {fmt(ranges(early))}, in beat {film.beat_at(early[0])!r}")
    if late: p.append(f"the frame is off stage on {len(late)} frame(s) from f{settled} to the end: {fmt(ranges(late))}, in beat {film.beat_at(late[0])!r}")
    return not p, "; ".join(p) if p else f"the frame is on no frame before {c['enters']} (f{enter}) and on every frame from f{settled} to f{film.duration - 1}"


def holder_rects(res, holders):
    out = []
    for h in holders:
        if h == "frame":
            fr = res.get("frame")
            if isinstance(fr, dict): out.append((h, fr["x"] + FRAME_BAR, fr["y"] + FRAME_BAR, fr["x"] + fr["width"] - FRAME_BAR, fr["y"] + fr["height"] - FRAME_BAR))
            continue
        a = (res.get("actors") or {}).get(h)
        if a and h in PROP_NATIVE:
            (ox, oy), (w, hh) = PROP_NATIVE[h]; s = a.get("scale", 1.0); out.append((h, a["x"] - ox * s, a["y"] - oy * s, a["x"] - ox * s + w * s, a["y"] - oy * s + hh * s))
    return out


def check_glass(film, t):
    c = t["check"]; actor, holders = c["actor"], c["holders"]
    free = [(film.sp_frame(e["from"], "th-glass"), film.sp_frame(e["until"], "th-glass")) for e in c.get("except", [])]
    bad, seen = [], 0
    for f in range(film.duration):
        a = (film.res(f).get("actors") or {}).get(actor)
        if not a: continue
        seen += 1
        if any(lo <= f < hi for lo, hi in free): continue
        if not any(x0 <= a["x"] <= x1 and y0 <= a["y"] <= y1 for _, x0, y0, x1, y1 in holder_rects(film.res(f), holders)): bad.append(f)
    if bad: return False, f"the {actor} is on stage outside {', '.join(holders)} on {len(bad)} frame(s): {fmt(ranges(bad))}, in beat {film.beat_at(bad[0])!r} (its anchor {(lambda a: (round(a['x']), round(a['y'])))(film.res(bad[0])['actors'][actor])}), outside the declared free span(s) {free or 'none'}"
    return True, f"the {actor} is on stage on {seen} frame(s), each inside {', '.join(holders)}" + (f" except f{free[0][0]}-{free[0][1] - 1}, where it stands free" if free else "")


def arrivals(film):
    """[(frame, actor)] each prop's `on` frame from the blocking, in film frames."""
    return sorted((a["on"], n) for b in film.blocking.values() for n, a in (b.get("actors") or {}).items() if isinstance(a, dict) and isinstance(a.get("on"), int))


def check_one_join(film, t):
    c = t["check"]; p = []; after = film.sp_frame(c["after"], "th-one-join"); allowed = [film.sp_frame(s, "th-one-join") for s in c.get("unstaggered", [])]
    allowed = [(lo, film.next_frame(s)) for s, lo in zip(c.get("unstaggered", []), allowed)]
    ev = arrivals(film)
    for i, sp in enumerate(film.sps):
        lo, hi = film.window(i)
        if sp["frame"] <= after: continue
        names = [n for f, n in ev if lo <= f < hi] + (["joins.lit"] if "joins.lit" in sp.get("after", []) else [])
        if len(names) > 1: p.append(f"{sp['id']} brings {len(names)} new joins ({', '.join(names)}) after {c['after']}: one lit join at a time")
    for (f1, n1), (f2, n2) in zip(ev, ev[1:]):
        if f2 - f1 < c.get("stagger", 3) and not any(lo <= f1 < hi and lo <= f2 < hi for lo, hi in allowed):
            p.append(f"{n1} (f{f1}) and {n2} (f{f2}) arrive {f2 - f1} frame(s) apart in beat {film.beat_at(f1)!r}, outside the flood: {c.get('stagger', 3)} needed")
    return not p, "; ".join(p) if p else f"{len(ev)} arrivals, each at least {c.get('stagger', 3)} frames from the next (or inside {', '.join(c.get('unstaggered', [])) or 'no flood'}); no story point after {c['after']} brings more than one"


def check_light_leads(film, t, eye):
    p = []
    for sp in film.sps:
        line = (sp.get("eye") or sp.get("emitter") or "").strip()
        if not line: p.append(f"{sp['id']} names neither an `eye` nor an `emitter`: nothing says where its light pushes"); continue
        tgt, why = eye.resolve_target(line, f"story point {sp['id']}", None, film.blocking.get(sp["beat"]) or {})
        if tgt is None: p.append(f"{sp['id']}: {why}")
    return not p, "; ".join(p) if p else f"every story point's eye or emitter line resolves to a target the eye trace measures ({len(film.sps)} story points)"


READERS = {"portal": check_portal, "glass": check_glass, "one-join": check_one_join}


def run_checks(d, blocking, tl, eye):
    film = Film(d, blocking, tl); out = []
    for t in d["themes"]:
        k = (t.get("check") or {}).get("kind")
        if k not in KINDS: continue
        try: ok, why = check_light_leads(film, t, eye) if k == "light-leads" else READERS[k](film, t)
        except (KeyError, ValueError) as e: ok, why = False, f"{t['id']} cannot be read: {e}"
        out.append((t["id"], k, ok, why))
    return out


# ---------- control ----------
def synthetic():
    """Three beats of 100 frames, six story points (two per beat), one theme of each kind. Clean by construction: the frame comes in at sp-3.1 (f200, settled at f240), the gadget lives in the bubble and, after the pop at
    sp-2.1, stands free until sp-3.1; arrivals are 20 frames apart; every light line is in the eye trace's table."""
    tl = {"duration": 300, "beats": [{"id": "a", "start": 0, "end": 100}, {"id": "b", "start": 100, "end": 200}, {"id": "c", "start": 200, "end": 300}]}
    sps = [{"id": sid, "beat": bid, "frame": f, "emitter": "gadget dial", "after": []} for sid, bid, f in (("sp-1.1", "a", 0), ("sp-1.2", "a", 50), ("sp-2.1", "b", 100), ("sp-2.2", "b", 150), ("sp-3.1", "c", 200), ("sp-3.2", "c", 240))]
    base = {"figure": {"x": 400, "y": 40}, "codex": {"x": 60, "y": 440}, "clawd": {"x": 900, "y": 470}}
    bl = {"a": {**base, "id": "a", "actors": {"bubble": {"x": 600, "y": 300, "scale": 1.0}, "gadget": {"x": 600, "y": 300, "scale": 0.5, "on": 20}}},
          "b": {**base, "id": "b", "actors": {"bubble": {"x": 600, "y": 300, "scale": 1.0, "off": 130}, "gadget": {"x": 600, "y": 300, "scale": 0.5}, "ring": {"x": 200, "y": 400, "on": 160}, "patch": {"x": 300, "y": 400, "on": 180}}},
          "c": {**base, "id": "c", "frame": {"x": 590, "y": 190, "width": 400, "height": 410, "carriedBy": "clawd"}, "clawd": {"x": 1700, "y": 499, "at": [{"frame": 200, "x": 1700}, {"frame": 230, "x": 1002}]},
                "actors": {"structure": {"x": 700, "y": 500, "scale": 1.0}, "gadget": {"x": 700, "y": 420, "scale": 0.5}}}}
    themes = [{"id": "th-frame-portal", "check": {"kind": "portal", "actor": "frame", "enters": "sp-3.1"}},
              {"id": "th-glass", "check": {"kind": "glass", "actor": "gadget", "holders": ["bubble", "frame", "structure"], "except": [{"from": "sp-2.1", "until": "sp-3.1"}]}},
              {"id": "th-one-join", "check": {"kind": "one-join", "after": "sp-2.2", "unstaggered": ["sp-2.1"], "stagger": 3}},
              {"id": "th-light-leads", "check": {"kind": "light-leads"}}]
    return {"story_points": sps, "themes": themes}, bl, tl


def run_control(eye):
    d, bl, tl = synthetic(); res, bad = [], []
    clean = run_checks(d, bl, tl, eye)
    if not all(ok for _, _, ok, _ in clean): return [f"the clean film is refused: {[(i, w) for i, _, ok, w in clean if not ok]}"], ["clean film"]
    res.append(f"a clean film -> pass on {len(clean)} invariants")
    def plant(label, theme, mutate, want_ok=False):
        d2, bl2, tl2 = copy.deepcopy(d), copy.deepcopy(bl), copy.deepcopy(tl); mutate(d2, bl2)
        got = {i: ok for i, _, ok, _ in run_checks(d2, bl2, tl2, eye)}
        res.append(f"{label} -> {'pass' if got[theme] else 'refused'} ({theme})")
        if got[theme] != want_ok or any(ok is False for i, ok in got.items() if i != theme): bad.append(label)
    plant("the frame on stage on frame 0", "th-frame-portal", lambda d_, b: b["a"].update(frame={"x": 1000, "y": 40, "width": 280, "height": 230}))
    plant("the frame gone from the last beat", "th-frame-portal", lambda d_, b: b["c"].pop("frame"))
    plant("the gadget outside the bubble", "th-glass", lambda d_, b: b["a"]["actors"]["gadget"].update(x=100, y=100))
    plant("the gadget free outside the excepted span", "th-glass", lambda d_, b: d_["themes"][1]["check"].update({"except": []}))
    plant("two arrivals in one story point after the boundary", "th-one-join", lambda d_, b: b["c"]["actors"].update(arch={"x": 100, "y": 400, "on": 260}, stalk={"x": 150, "y": 400, "on": 270}))
    plant("two arrivals one frame apart outside the flood", "th-one-join", lambda d_, b: b["a"]["actors"].update(ring={"x": 200, "y": 400, "on": 60}, patch={"x": 300, "y": 400, "on": 61}))
    plant("two arrivals one frame apart inside the flood", "th-one-join", lambda d_, b: b["b"]["actors"].update(ring={"x": 200, "y": 400, "on": 101}, patch={"x": 300, "y": 400, "on": 102}), want_ok=True)
    plant("an eye line outside the table", "th-light-leads", lambda d_, b: d_["story_points"][0].update(eye="the leaf"))
    plant("a story point naming neither eye nor emitter", "th-light-leads", lambda d_, b: d_["story_points"][1].pop("emitter"))
    plant("a `frame interior` line in a beat with no frame", "th-light-leads", lambda d_, b: d_["story_points"][2].update(emitter="frame interior"))
    plant("the gadget free inside the excepted span (clean)", "th-glass", lambda d_, b: None, want_ok=True)
    return res, bad


def load_blocking(path):
    out = {}
    if not os.path.isdir(path): die(f"blocking directory {path} does not exist")
    for fn in sorted(os.listdir(path)):
        if fn.endswith(".json"): b = read_json(os.path.join(path, fn), "a blocking file"); out[b.get("id", fn[:-5])] = b
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    j = lambda *p: os.path.join(ROOT, *p)
    ap.add_argument("screenplay", nargs="?", default=j("v3", "screenplay.json")); ap.add_argument("--blocking", default=j("v3", "blocking")); ap.add_argument("--timeline", default=j("v3", "timeline.json")); ap.add_argument("--json", default=None)
    a = ap.parse_args(); pr = Probe("theme", a.json); eye = load_eyetrace()
    res, bad = run_control(eye)
    pr.control(not bad, "; ".join(res) + ("" if not bad else " (NOT AS EXPECTED: " + "; ".join(bad) + ")"))
    d = read_json(a.screenplay, "the screenplay"); tl = load_timeline(a.timeline); blocking = load_blocking(a.blocking)
    if d.get("schema") != "showcase.screenplay.1": die(f"{a.screenplay} has schema {d.get('schema')!r}")
    if not isinstance(d.get("themes"), list): die(f"{a.screenplay} has no `themes`")
    out = run_checks(d, blocking, tl, eye)
    if not out: die("the screenplay's themes carry none of the check kinds this probe reads: " + ", ".join(KINDS))
    for tid, kind, ok, why in out: pr.check(f"{tid} ({kind})", ok, why)
    pr.finish(f"{len(out)} theme invariants hold on the blocking and the story points")


if __name__ == "__main__": main()
