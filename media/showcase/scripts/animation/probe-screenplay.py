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
  renders    v3/screenplay.md and v3/screenplay.fountain each start with the line `generated from screenplay.json ... source <hash> body <hash>`, the source hash is that of today's screenplay.json
             and beats-v2.json, and the body hash is that of the file below the line: a render older than its json, or edited by hand, is refused
Control first: a story point moved outside its beat, a duplicate id, an `after` key no beat declares, a register that is not vocabulary, a colour key that is not declared, a story point whose frame
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


CHECKS = [("ids", check_ids), ("frames", check_frames), ("shots", check_shots), ("after", check_after), ("colour", check_colour), ("register", check_register), ("renders", check_renders)]


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
        clean = label.endswith("(clean)")
        base_ok, base_why = fns[check](d, ctx)
        refused = (not ok) if not clean else False
        if not clean and ok is False and not base_ok and why == base_why: refused = False      # the draft already fails this way: the planted fault added nothing
        res.append(f"{label} -> {'accepted' if ok else 'refused'}" if clean else f"planted {label} -> {'refused' if refused else 'NOT REFUSED'} ({check})")
        if (clean and not ok) or (not clean and not refused): bad.append(label)
    pr.control(not bad, "; ".join(res))
    for name, fn in CHECKS:
        ok, why = fn(d, ctx)
        pr.check(name, ok, why)
    pr.finish(f"{len(d['story_points'])} story points hold the contract")


if __name__ == "__main__": main()
