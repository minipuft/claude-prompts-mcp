#!/usr/bin/env python3
"""Screenplay contract (p014): v3/screenplay.json is the film's story points, and everything that reads them (the bindings, the bible's script lane, the state-change probe) can rely on its shape.

usage: probe-screenplay.py [v3/screenplay.json] [--ledger v3/beats-v2.json] [--timeline v3/timeline.json] [--shots v3/shots.json] [--vocabulary v3/vocabulary.json]
                           [--overrides v3/vocabulary-overrides.json] [--md v3/screenplay.md] [--fountain v3/screenplay.fountain] [--json out.json]
Checks:
  ids        every id is `sp-<beat number>.<n>`, unique, ascending, in the beat of that number; frames strictly ascend; every beat of the ledger has at least 2 story points
  frames     every story point's frame lies inside its beat on the timeline (v3/timeline.json)
  shots      the shots' `frames` ranges [start, end) tile the timeline (from frame 0 to its duration, no gap, no overlap) and each range starts and ends on a beat boundary; every story point's `shot`
             (written by compile-screenplay.mjs) is the one shot whose range holds its frame, and its beat lies inside that range; a frame in no shot, or in two, is named, never guessed
  after      every `after` key is a state key of the story point's beat in beats-v2.json, or a key the json's `state_keys` declares for that beat; every declared key carries a readable `observe`
             (kind prop, count, actor, xsheet, light, figure or gates) and an origin that is true (a beats-v2 key is in a beat's state, a screenplay key is in none of them)
  colour     every colour key (the parts of `a -> b` each) is a key of `colour_keys`, with a hue pair or a kit and field
  register   every register, and every `intent` where a story point has one, is a word or alias of the direction vocabulary (v3/vocabulary.json and its overrides)
  themes     the film's themes (`themes`, each with id, name, source, invariant, measure and a `check.kind` a probe reads): every theme is carried by at least 2 story points, every story point's themes and channels
             are declared, every beat carries at least one theme, each act (the th-channels check's `acts`) covers eyes, heart and humour, and the registers word `reverent` appears only in the beats the
             th-register check names. Advisory, not refused: a beat with no story point tagged th-child-detail is named (the detail is the director's to write; flips to a refusal when the draft carries one per beat)
  drive      every beat has a story point with a `want` or a `turn` (row 9.8, story first); a beat with no want and one with no turn are named, not refused
  recipes    every story point carries `recipes` (kinds the story probe executes: stage, count, arrivals, stagger, order, contact, emitters, hold, glow, picture, hands, figure, actor, xsheet, light, gates, each with the
             fields its reader needs) and every `;` clause of its `measure` is the `says` of one of them: a measure line no probe reads cannot exist. What no layer of the film records goes in `texture`, not in `measure`
  renders    v3/screenplay.md and v3/screenplay.fountain each start with the line `generated from screenplay.json ... source <hash> body <hash>`, the source hash is that of today's screenplay.json
             and beats-v2.json, and the body hash is that of the file below the line: a render older than its json, or edited by hand, is refused
Control first: a theme no story point carries, a beat with no theme, an act with no heart channel, a story point with no theme, a beat whose story points have neither want nor turn, `reverent` in beat 2, a measure clause no recipe says, a recipe of a kind no probe reads and a recipe missing a field must each be refused
by the check that names it; and a story point moved outside its beat, a duplicate id, an `after` key no beat declares, a register that is not vocabulary, a colour key that is not declared, a story point whose frame
leaves its shot (and one in no shot), a render made from an older json and a render edited by hand must each be refused by the check that names it, and the draft untouched must pass.
Exit 0 pass, 1 refusal, 2 a control that did not trip or an unreadable input.
"""
import argparse, copy, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from probe_common import Probe, die, read_json, load_timeline

ID = re.compile(r"^sp-(\d+)\.(\d+)$")
KINDS = {"prop": ("actor", "expect"), "count": ("actors", "expect"), "actor": ("actor", "expect"), "xsheet": ("field", "expect"), "light": ("field", "expect"), "figure": ("measure", "expect"), "gates": ("expect",)}
STAMP = re.compile(r"generated from screenplay\.json .*source ([0-9a-f]{12}) · body ([0-9a-f]{12})")

THEME_FIELDS = ("id", "name", "source", "invariant", "measure")
THEME_KINDS = ("portal", "glass", "one-join", "light-leads", "channels", "child-detail", "register")
CHANNELS = ("eyes", "heart", "humour")
STAGE_EXPECT = ("present", "persists", "absent", "inside", "offstage", "onstage", "appears", "disappears", "moves", "rest", "returns")
RECIPE_NEEDS = {"stage": (("actor", "actors"), "expect"), "count": ("actors", "expect"), "arrivals": ("same_frame",), "stagger": ("min",), "order": ("first", "then", "by"), "contact": ("a", "b", "within"),
                "emitters": ("expect",), "hold": ("frames",), "glow": ("expect", "after", "lag", "min"), "picture": ("measure", "expect", "min"), "hands": ("expect",), "figure": ("measure", "expect"),
                "actor": ("actor", "expect"), "xsheet": ("field", "expect"), "light": ("field", "expect"), "gates": ("expect",)}
RECIPE_EXTRA = {"stage": {"moves": ("by",), "inside": ("of",), "returns": ("within",), "persists": ("until",)}, "count": {"at-most": ("to",), "rises-then-falls": ("to",)}, "emitters": {"count": ("to",)}}


def sha(*parts): return hashlib.sha256("\n".join(parts).encode("utf8")).hexdigest()


def colour_parts(key): return [p.strip() for p in re.split(r"→|->", str(key))]


def vocabulary_words(vocab, overrides):
    """Every phrase that resolves: a base term or alias, a film term or alias; a comma list resolves when each member does."""
    words = set(vocab.get("terms", {})) | set(vocab.get("aliases", {})) | set(overrides.get("terms", {})) | set(overrides.get("aliases", {}))
    for dom in vocab.get("domains", {}).values():
        for v in (dom.values() if isinstance(dom, dict) else [dom]):
            words |= set(v if isinstance(v, list) else [])
    return {w.lower() for w in words}


def resolves(phrase, words):
    p = str(phrase).strip().lower()
    return p in words or (bool(p) and all(q.strip() in words for q in p.split(",")))


def shot_range(shot):
    r = shot.get("frames")
    return (r[0], r[1]) if isinstance(r, list) and len(r) == 2 and all(isinstance(x, int) for x in r) else None


def check_ids(d, ctx):
    p, seen, last, per_beat = [], set(), None, {}
    order = [b["id"] for b in ctx["ledger"]["beats"]]
    for sp in d["story_points"]:
        m = ID.match(sp["id"])
        if not m: p.append(f"{sp['id']!r} is not sp-<beat>.<n>"); continue
        if sp["id"] in seen: p.append(f"id {sp['id']} is used twice")
        seen.add(sp["id"])
        key = (int(m.group(1)), int(m.group(2)))
        if last and not (key > last[0]): p.append(f"{sp['id']} does not come after {last[1]}")
        if last and sp["frame"] <= last[2]: p.append(f"{sp['id']} at frame {sp['frame']} does not come after {last[1]} at {last[2]}")
        last = (key, sp["id"], sp["frame"])
        if sp["beat"] not in order: p.append(f"{sp['id']} is in beat {sp['beat']!r}, which beats-v2.json does not have")
        elif order.index(sp["beat"]) + 1 != key[0]: p.append(f"{sp['id']} is in beat {sp['beat']!r}, which is beat {order.index(sp['beat']) + 1}, not {key[0]}")
        per_beat[sp["beat"]] = per_beat.get(sp["beat"], 0) + 1
    p += [f"beat {b!r} has {per_beat.get(b, 0)} story point(s), needs at least 2" for b in order if per_beat.get(b, 0) < 2]
    return not p, "; ".join(p) if p else f"{len(d['story_points'])} story points, ids unique and ascending, {len(order)} beats each with at least 2"


def check_frames(d, ctx):
    beats = {b["id"]: b for b in ctx["timeline"]["beats"]}
    p = [f"{sp['id']} is at frame {sp['frame']}, outside its beat {sp['beat']!r} ({beats[sp['beat']]['start']}-{beats[sp['beat']]['end']})"
         for sp in d["story_points"] if sp["beat"] in beats and not beats[sp["beat"]]["start"] <= sp["frame"] < beats[sp["beat"]]["end"]]
    p += [f"{sp['id']} is in beat {sp['beat']!r}, which the timeline does not have" for sp in d["story_points"] if sp["beat"] not in beats]
    return not p, "; ".join(p) if p else "every story point's frame is inside its beat"


def check_shots(d, ctx):
    p, tl = [], ctx["timeline"]
    ranges = {s["id"]: shot_range(s) for s in ctx["shots"]}
    for sid, r in ranges.items():
        if r is None: p.append(f"shot {sid} has no `frames` range [start, end)")
    live = sorted((r, sid) for sid, r in ranges.items() if r)
    edges = {b["start"] for b in tl["beats"]} | {tl["beats"][-1]["end"]}
    end = 0
    for (lo, hi), sid in live:
        if lo != end: p.append(f"shots leave frames {end}-{lo - 1} uncovered or overlapping before {sid} (starts at {lo})")
        if hi <= lo: p.append(f"shot {sid} range {lo}-{hi} is empty")
        for edge in (lo, hi):
            if edge not in edges: p.append(f"shot {sid} range edge {edge} is not a beat boundary of the timeline")
        end = max(end, hi)
    if end != tl["beats"][-1]["end"]: p.append(f"shots end at frame {end}, the timeline at {tl['beats'][-1]['end']}")
    for sp in d["story_points"]:
        beat = next((b for b in tl["beats"] if b["start"] <= sp["frame"] < b["end"]), None)
        hits = sorted(sid for sid, r in ranges.items() if r and r[0] <= sp["frame"] < r[1])
        if not hits: p.append(f"{sp['id']} (frame {sp['frame']}) is in no shot of v3/shots.json: no shot's `frames` range holds it"); continue
        if len(hits) > 1: p.append(f"{sp['id']} (frame {sp['frame']}) is in {len(hits)} shots ({', '.join(hits)})"); continue
        if sp.get("shot") != hits[0]: p.append(f"{sp['id']} says shot {sp.get('shot')!r}, its frame {sp['frame']} is in {hits[0]} (run compile-screenplay.mjs)")
        else:
            b = next((x for x in tl["beats"] if x["id"] == sp["beat"]), None); lo, hi = ranges[hits[0]]
            if b is None or not (lo <= b["start"] and b["end"] <= hi): p.append(f"{sp['id']} names beat {sp['beat']!r}, which lies outside the range {lo}-{hi} of shot {hits[0]}")
    return not p, "; ".join(p) if p else f"every story point's frame is inside its shot ({len({sp.get('shot') for sp in d['story_points']})} shots, pipeline ids `<shot>/<sp-id>`)"


def check_after(d, ctx):
    p, ledger = [], {b["id"]: {s["key"] for s in b.get("state", [])} for b in ctx["ledger"]["beats"]}
    reg = d.get("state_keys", {}).get("keys", {})
    for key, e in sorted(reg.items()):
        o = e.get("observe", {})
        need = KINDS.get(o.get("kind"))
        if need is None: p.append(f"state key {key!r} observes by {o.get('kind')!r}, not one of {', '.join(KINDS)}"); continue
        miss = [f for f in need if f not in o]
        if miss: p.append(f"state key {key!r} ({o['kind']}) lacks {', '.join(miss)}")
        if e.get("origin") == "screenplay":
            beats = e.get("beats") or []
            if not beats: p.append(f"screenplay key {key!r} names no beat")
            clash = [b for b in beats if key in ledger.get(b, set())]
            if clash: p.append(f"key {key!r} is declared as the screenplay's and is a state key of {clash[0]!r} in beats-v2.json")
        elif e.get("origin") == "beats-v2":
            if not any(key in s for s in ledger.values()): p.append(f"key {key!r} says it is a beats-v2 key and no beat of beats-v2.json declares it")
        else: p.append(f"state key {key!r} has origin {e.get('origin')!r}, not beats-v2 or screenplay")
    for sp in d["story_points"]:
        for key in sp.get("after", []):
            e = reg.get(key)
            if key in ledger.get(sp["beat"], set()):
                if not e: p.append(f"{sp['id']} after {key!r}: a state key of {sp['beat']!r}, but state_keys carries no `observe` for it")
            elif e and e.get("origin") == "screenplay" and sp["beat"] in (e.get("beats") or []): pass
            else: p.append(f"{sp['id']} after {key!r}: no beat declares it for {sp['beat']!r} (beats-v2.json state keys {sorted(ledger.get(sp['beat'], set())) or 'none'}; state_keys {'declares it for ' + str(e.get('beats')) if e else 'does not carry it'})")
    return not p, "; ".join(p) if p else f"{sum(len(sp.get('after', [])) for sp in d['story_points'])} `after` keys, each a state key of its beat ({sum(1 for e in reg.values() if e.get('origin') == 'beats-v2')} from beats-v2.json) or one state_keys declares for it ({sum(1 for e in reg.values() if e.get('origin') == 'screenplay')}), each with an observe"


def check_colour(d, ctx):
    keys, p = d.get("colour_keys", {}), []
    for k, v in keys.items():
        if not (("hue" in v and "accent" in v) or ("kit" in v and "field" in v)): p.append(f"colour key {k!r} has neither a hue and accent nor a kit and field")
    for sp in d["story_points"]:
        for part in colour_parts(sp.get("colour", "")):
            if part not in keys: p.append(f"{sp['id']} has colour key {part!r}, which colour_keys does not declare")
    return not p, "; ".join(p) if p else f"every story point's colour key is declared ({len(keys)} keys)"


def check_register(d, ctx):
    words = ctx["words"]
    p = [f"{sp['id']} {f} {sp[f]!r} is not a word of the direction vocabulary" for sp in d["story_points"] for f in ("register", "intent") if f in sp and not resolves(sp[f], words)]
    return not p, "; ".join(p) if p else f"every register is a vocabulary word or alias ({len({sp['register'] for sp in d['story_points']})} distinct)"


def clauses_of(measure): return [c.strip() for c in str(measure).split(";") if c.strip()]


def check_themes(d, ctx):
    """The theme ledger and the story points' tags (th-* ids, channels): the contract a director's draft keeps before any frame is staged."""
    p, themes, sps = [], d.get("themes"), d["story_points"]
    if not isinstance(themes, list) or not themes: return False, "screenplay.json has no `themes` list"
    ids = [t.get("id") for t in themes]
    for t in themes:
        miss = [f for f in THEME_FIELDS if not str(t.get(f, "")).strip()]
        if miss: p.append(f"theme {t.get('id')!r} lacks {', '.join(miss)}")
        k = (t.get("check") or {}).get("kind")
        if k not in THEME_KINDS: p.append(f"theme {t.get('id')!r} has check kind {k!r}, not one a probe reads ({', '.join(THEME_KINDS)})")
    p += [f"theme id {i!r} is declared twice" for i in sorted({i for i in ids if ids.count(i) > 1})]
    for sp in sps:
        p += [f"{sp['id']} carries theme {t!r}, which `themes` does not declare" for t in sp.get("themes", []) if t not in ids]
        p += [f"{sp['id']} has channel {c!r}, not one of {', '.join(CHANNELS)}" for c in sp.get("channels", []) if c not in CHANNELS]
    p += [f"{sp['id']} carries no theme: a story point that serves none of the film's themes is not yet a story point" for sp in sps if not sp.get("themes")]
    for t in ids:
        n = sum(1 for sp in sps if t in sp.get("themes", []))
        if n < 2: p.append(f"theme {t} is carried by {n} story point(s), needs at least 2")
    order = [b["id"] for b in ctx["ledger"]["beats"]]
    p += [f"beat {b!r} carries no theme" for b in order if not any(sp.get("themes") for sp in sps if sp["beat"] == b)]
    by_kind = {(t.get("check") or {}).get("kind"): t for t in themes}
    ch = (by_kind.get("channels") or {}).get("check", {}); reg = (by_kind.get("register") or {}).get("check", {})
    if not ch: p.append("no theme has check kind 'channels': the acts cannot be read")
    for act, beats in (ch.get("acts") or {}).items():
        have = {c for sp in sps if sp["beat"] in beats for c in sp.get("channels", [])}
        p += [f"act {act} ({', '.join(beats)}) carries no story point on the {c} channel" for c in ch.get("wants", CHANNELS) if c not in have]
    if not reg: p.append("no theme has check kind 'register': the reverent beats cannot be read")
    p += [f"{sp['id']} (beat {sp['beat']!r}) is {sp['register']!r}: reverent belongs to {', '.join(reg.get('reverent_only', []))} only" for sp in sps if "reverent" in sp.get("register", "").lower() and sp["beat"] not in reg.get("reverent_only", [])]
    detail = next((t["id"] for t in themes if (t.get("check") or {}).get("kind") == "child-detail"), None)
    lacking = [b for b in order if detail and not any(detail in sp.get("themes", []) for sp in sps if sp["beat"] == b)]
    note = f"; advisory, not refused: no story point of {', '.join(lacking)} carries {detail}" if lacking else ""
    return not p, "; ".join(p) if p else f"{len(ids)} themes, each carried by at least 2 story points; every beat carries a theme; each act covers {', '.join(ch.get('wants', CHANNELS))}; reverent only where the register theme allows{note}"


def check_recipes(d, ctx):
    """Every measure clause is read by a recipe of a kind the story probe executes."""
    p = []
    for sp in d["story_points"]:
        rs = sp.get("recipes")
        if not isinstance(rs, list) or not rs: p.append(f"{sp['id']} has no `recipes`: its measure {sp.get('measure', '')!r} is a line no probe reads"); continue
        for r in rs:
            k = r.get("kind"); say = r.get("says")
            if k not in RECIPE_NEEDS: p.append(f"{sp['id']} recipe {say!r} has kind {k!r}, not one the story probe reads ({', '.join(RECIPE_NEEDS)})"); continue
            need = [f for f in RECIPE_NEEDS[k] if not (any(x in r for x in f) if isinstance(f, tuple) else f in r)]
            need += list(RECIPE_EXTRA.get(k, {}).get(r.get("expect"), ())) and [f for f in RECIPE_EXTRA[k][r["expect"]] if f not in r]
            if k == "stage" and r.get("expect") not in STAGE_EXPECT: need.append(f"expect one of {', '.join(STAGE_EXPECT)}")
            if need: p.append(f"{sp['id']} recipe {say!r} ({k}) lacks {', '.join(str(x) for x in need)}")
        said = [r.get("says") for r in rs]; clauses = clauses_of(sp.get("measure", ""))
        p += [f"{sp['id']} measure clause {c!r} is read by no recipe" for c in clauses if c not in said]
        p += [f"{sp['id']} recipe says {s_!r}, which is not a clause of its measure" for s_ in said if s_ not in clauses]
        tx = sp.get("texture", [])
        if not isinstance(tx, list) or not all(isinstance(t, str) and t.strip() for t in tx): p.append(f"{sp['id']} `texture` is not a list of lines")
        p += [f"{sp['id']} texture {t!r} is also a measure clause" for t in (tx if isinstance(tx, list) else []) if t in clauses]
    n = sum(len(sp.get("recipes", [])) for sp in d["story_points"])
    return not p, "; ".join(p) if p else f"{n} recipes read every measure clause of {len(d['story_points'])} story points ({sum(len(sp.get('texture', [])) for sp in d['story_points'])} texture lines no layer records)"


def check_drive(d, ctx):
    """Story first (row 9.8): a beat wants something or turns something. At least one story point of every beat names a `want` or a `turn`; the rest may hold. Advisory, not refused: a beat with no want and a beat with no turn are named."""
    sps, p = d["story_points"], []
    order = [b["id"] for b in ctx["ledger"]["beats"]]
    for b in order:
        mine = [sp for sp in sps if sp["beat"] == b]
        if not any(str(sp.get("want", "")).strip() or str(sp.get("turn", "")).strip() for sp in mine): p.append(f"beat {b!r} has no story point with a want or a turn ({', '.join(sp['id'] for sp in mine)}): nothing in it asks or changes")
    no_want = [b for b in order if not any(str(sp.get("want", "")).strip() for sp in sps if sp["beat"] == b)]; no_turn = [b for b in order if not any(str(sp.get("turn", "")).strip() for sp in sps if sp["beat"] == b)]
    note = (f"; advisory, not refused: no want in {', '.join(no_want)}" if no_want else "") + (f"; no turn in {', '.join(no_turn)}" if no_turn else "")
    return not p, "; ".join(p) if p else f"every beat of {len(order)} has a story point that wants or turns something{note}"


def check_renders(d, ctx):
    p, want = [], sha(ctx["screenplay_text"], ctx["ledger_text"])[:12]
    for name, text in (("screenplay.md", ctx["md"]), ("screenplay.fountain", ctx["fountain"])):
        if text is None: p.append(f"{name} does not exist (run compile-screenplay.mjs)"); continue
        first, _, body = text.partition("\n")
        m = STAMP.search(first)
        if not m: p.append(f"{name} does not start with a `generated from screenplay.json` line"); continue
        if m.group(1) != want: p.append(f"{name} was made from source {m.group(1)}, screenplay.json and beats-v2.json hash to {want}: it is stale (run compile-screenplay.mjs)")
        elif m.group(2) != sha(body)[:12]: p.append(f"{name} was edited by hand: its body hashes to {sha(body)[:12]}, the line says {m.group(2)}")
    return not p, "; ".join(p) if p else f"screenplay.md and screenplay.fountain are the render of source {want} and carry no edit of their own"


CHECKS = [("ids", check_ids), ("frames", check_frames), ("shots", check_shots), ("after", check_after), ("colour", check_colour), ("register", check_register), ("themes", check_themes), ("recipes", check_recipes), ("drive", check_drive), ("renders", check_renders)]


def planted(d, ctx):
    out = {}
    def mutate(label, check, fn, **ctx_over):
        x = copy.deepcopy(d); fn(x); out[label] = (check, x, {**ctx, **ctx_over})
    sp = lambda x, i: x["story_points"][i]
    arrival_late = next(i for i, s in enumerate(d["story_points"]) if s["beat"] == "arrival")
    mutate("a story point outside its beat", "frames", lambda x: sp(x, arrival_late).update(frame=ctx["timeline"]["beats"][1]["start"] + 5))
    mutate("a duplicate id", "ids", lambda x: sp(x, 1).update(id=sp(x, 0)["id"]))
    mutate("an after key no beat declares", "after", lambda x: sp(x, 1).update(after=["lid.up"]))
    mutate("a register that is not vocabulary", "register", lambda x: sp(x, 0).update(register="vibey"))
    mutate("a colour key that is not declared", "colour", lambda x: sp(x, 0).update(colour="mauve"))
    mutate("a story point whose shot is not the shot of its frame", "shots", lambda x: sp(x, 0).update(shot=d["story_points"][-1]["shot"]))
    mutate("a story point whose frame is in no shot", "shots", lambda x: None, shots=[s for s in ctx["shots"] if s["id"] != d["story_points"][0]["shot"]])
    def overlap(shots): s = copy.deepcopy(shots); s[1]["frames"] = [s[1]["frames"][0] - 30, s[1]["frames"][1]]; return s
    mutate("shot ranges that overlap", "shots", lambda x: None, shots=overlap(ctx["shots"]))
    def off_boundary(shots): s = copy.deepcopy(shots); s[0]["frames"][1] += 7; s[1]["frames"][0] += 7; return s
    mutate("shot ranges that end inside a beat", "shots", lambda x: None, shots=off_boundary(ctx["shots"]))
    theme_ids = [t["id"] for t in d["themes"]]
    def drop_theme(x, tid):
        for s_ in x["story_points"][1:]: s_["themes"] = [t for t in s_.get("themes", []) if t != tid]
    mutate("a theme no story point carries", "themes", lambda x: drop_theme(x, "th-frame-portal"))
    mutate("a beat with no theme", "themes", lambda x: [s_.update(themes=[]) for s_ in x["story_points"] if s_["beat"] == "crossing"])
    mutate("an act with no heart channel", "themes", lambda x: [s_.update(channels=[c for c in s_.get("channels", []) if c != "heart"]) for s_ in x["story_points"] if s_["beat"] in ("art-world", "crossing", "programming-world", "home-settle")])
    mutate("reverent in beat 2", "themes", lambda x: next(s_ for s_ in x["story_points"] if s_["beat"] == "everything-at-once").update(register="reverent"))
    mutate("a story point tagged with an undeclared theme", "themes", lambda x: sp(x, 0).update(themes=sp(x, 0)["themes"] + ["th-nothing"]))
    mutate("a measure clause no recipe says", "recipes", lambda x: sp(x, 0).update(measure=sp(x, 0)["measure"] + "; the box glows"))
    mutate("a story point with a measure and no recipes", "recipes", lambda x: sp(x, 0).update(recipes=[]))
    mutate("a recipe of a kind no probe reads", "recipes", lambda x: sp(x, 0)["recipes"][0].update(kind="vibes"))
    mutate("a recipe missing the field its reader needs", "recipes", lambda x: next(r for s_ in x["story_points"] for r in s_["recipes"] if r.get("expect") == "moves").pop("by"))
    mutate("a beat whose story points have neither want nor turn", "drive", lambda x: [s_.update(want="", turn="") for s_ in x["story_points"] if s_["beat"] == "everything-at-once"])
    mutate("a story point with no theme", "themes", lambda x: sp(x, 2).update(themes=[]))
    def all_detail(x):
        did = next(t["id"] for t in x["themes"] if t["check"]["kind"] == "child-detail")
        for b in {s_["beat"] for s_ in x["story_points"]}:
            first = next(s_ for s_ in x["story_points"] if s_["beat"] == b)
            if did not in first["themes"]: first["themes"] = first["themes"] + [did]
    out["a draft whose every beat carries a child detail names no advisory"] = ("themes", (lambda x: (all_detail(x), x)[1])(copy.deepcopy(d)), ctx)
    # the renders are controlled on a synthetic pair that is current by construction, so a stale real render cannot hide a probe that would not see one
    body = "# synthetic\n\nbody line\n"
    line = lambda text_: f"<!-- generated from screenplay.json by compile-screenplay.mjs · source {sha(text_, ctx['ledger_text'])[:12]} · body {sha(body)[:12]} -->"
    synth = f"{line(ctx['screenplay_text'])}\n{body}"
    out["a current render (clean)"] = ("renders", d, {**ctx, "md": synth, "fountain": synth})
    mutate("a render made from an older json", "renders", lambda x: None, md=synth, fountain=synth, screenplay_text=ctx["screenplay_text"] + " ")
    mutate("a render edited by hand", "renders", lambda x: None, md=synth.replace("body line", "body edited"), fountain=synth)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    j = lambda *a: os.path.join(ROOT, *a)
    ap.add_argument("screenplay", nargs="?", default=j("v3", "screenplay.json")); ap.add_argument("--ledger", default=j("v3", "beats-v2.json")); ap.add_argument("--timeline", default=j("v3", "timeline.json"))
    ap.add_argument("--shots", default=j("v3", "shots.json")); ap.add_argument("--vocabulary", default=j("v3", "vocabulary.json")); ap.add_argument("--overrides", default=j("v3", "vocabulary-overrides.json"))
    ap.add_argument("--md", default=j("v3", "screenplay.md")); ap.add_argument("--fountain", default=j("v3", "screenplay.fountain")); ap.add_argument("--json", default=None)
    a = ap.parse_args(); pr = Probe("screenplay", a.json)
    def text(path, what, must=True):
        try:
            with open(path, encoding="utf8") as f: return f.read()
        except OSError as e:
            if must: die(f"{what} {path}: {e}")
            return None
    sp_text, led_text = text(a.screenplay, "the screenplay"), text(a.ledger, "the ledger")
    try: d, ledger = json.loads(sp_text), json.loads(led_text)
    except ValueError as e: die(f"unreadable json: {e}")
    if d.get("schema") != "showcase.screenplay.1": die(f"{a.screenplay} has schema {d.get('schema')!r}, this probe reads showcase.screenplay.1")
    ctx = {"ledger": ledger, "timeline": load_timeline(a.timeline), "shots": read_json(a.shots, "the shot list")["shots"],
           "words": vocabulary_words(read_json(a.vocabulary, "the vocabulary"), read_json(a.overrides, "the vocabulary overrides")),
           "screenplay_text": sp_text, "ledger_text": led_text, "md": text(a.md, "the screenplay render", False), "fountain": text(a.fountain, "the fountain render", False)}
    fns = dict(CHECKS)
    res, bad = [], []
    for label, (check, x, c) in planted(d, ctx).items():
        ok, why = fns[check](x, c)
        clean = label.endswith("(clean)"); quiet = label.endswith("names no advisory")
        base_ok, base_why = fns[check](d, ctx)
        refused = (not ok) if not (clean or quiet) else False
        if not (clean or quiet) and ok is False and not base_ok and why == base_why: refused = False      # the draft already fails this way: the planted fault added nothing
        res.append(f"{label} -> {'accepted' if ok else 'refused'}" if clean else f"{label} -> {'no advisory' if 'advisory' not in why else 'ADVISORY STILL NAMED'}" if quiet else f"planted {label} -> {'refused' if refused else 'NOT REFUSED'} ({check})")
        if (clean and not ok) or (quiet and "advisory" in why) or (not (clean or quiet) and not refused): bad.append(label)
    pr.control(not bad, "; ".join(res))
    for name, fn in CHECKS:
        ok, why = fn(d, ctx)
        pr.check(name, ok, why)
    pr.finish(f"{len(d['story_points'])} story points hold the contract")


if __name__ == "__main__": main()
