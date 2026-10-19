#!/usr/bin/env python3
"""Bible contract (D94): v3/bible.json covers the timeline, its proposals sit inside their beats and close properly, and the page shows the bible it was built from.

usage: probe-bible.py <bible.json> [--page out/bible.html] [--proposals v3/proposals] [--timeline v3/timeline.json] [--spec v3/creative-spec.md] [--rulings v3/rulings.json] [--root <showcase root>]
Checks: every per-beat track (pacing, script, blocking, camera, light, colour-script, look) covers frame 0 to the timeline's duration with no gap and nothing past it,
and the pacing items are the timeline's beats; every proposal file has an item and every item a file, each anchored inside the frame range of its beat (a frame anchor
inside the beat, a beat range on beats the timeline has); a proposal with status ruled names a D-number ruling, and its kind is one of the five; the page footer's
hash prefix and the hash the page carries equal the bible's inputsHash; the inputsHash equals the hash of the declared inputs' bytes today (a stale bible is refused);
no flag says an input disagrees with another (stale xsheet or timeline, an unresolved reference, a script section without a beat); every ruling bullet in the spec has an
entry in the rulings mirror (v3/rulings.json) whose raw bullet equals the spec's; every D-number a proposal's `ruling` names is a ruling in the spec; when v3/materials.json exists the bible
carries it unchanged as `materials` and probe-materials.py's checks (shape, ranges, intents, refs, cross-rules) pass on it.
Control first: a copy of the bible with the last pacing item dropped, one with a proposal anchored at frame 5 of beat the-frame, one with a ruled proposal and no
ruling, one page whose footer hash differs, one bible whose inputsHash is not the hash of its inputs, one carrying a stale flag, a rulings mirror with one spec ruling deleted and a proposal whose ruling
names a D-number the spec lacks, and (with materials) a cloth whose stiffness is 1 must each be refused by the check that names it. Exit 0 pass, 1 refusal (named in plain words), 2 a control that did not trip or an unreadable input.
"""
import argparse, copy, hashlib, importlib.util, json, os, re, sys

KINDS = ("change", "inspiration", "eureka", "owner-ask", "finding")
DENSE = ("pacing", "script", "blocking", "camera", "light", "colour-script", "look")
BULLET = re.compile(r"^- (D\d+(?:/D\d+)*)")
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def track(b, name):
    return next((t for t in b["tracks"] if t["name"] == name), None)


def check_coverage(b, tl, **_):
    p, dur = [], tl["durationInFrames"]
    if b["duration"] != dur: p.append(f"the bible says {b['duration']} frames, the timeline {dur}")
    for name in DENSE:
        t = track(b, name)
        if t is None: p.append(f"track {name!r} is missing"); continue
        reach = 0
        for it in sorted(t["items"], key=lambda i: (i["start"], i["end"])):
            if it["start"] > reach: p.append(f"track {name!r} has a gap from frame {reach} to {it['start']}"); break
            reach = max(reach, it["end"])
        else:
            if reach < dur: p.append(f"track {name!r} ends at frame {reach}, the timeline at {dur}")
        over = [it for it in t["items"] if it["end"] > dur or it["start"] < 0]
        if over: p.append(f"track {name!r} has an item outside 0-{dur} ({over[0]['label']!r} {over[0]['start']}-{over[0]['end']})")
    pace = track(b, "pacing")
    if pace:
        want = [(x["id"], x["start"], x["end"]) for x in tl["beats"]]
        got = [(i["beat"], i["start"], i["end"]) for i in pace["items"]]
        if want != got: p.append("the pacing items are not the timeline's beats: " + (f"first difference {next(g for g, w in zip(got, want) if g != w)} against {next(w for g, w in zip(got, want) if g != w)}" if len(got) == len(want) else f"{len(got)} items against {len(want)} beats"))
    return not p, "; ".join(p) if p else f"{len(DENSE)} per-beat tracks cover 0-{dur} with no gap and the pacing items are the timeline's {len(tl['beats'])} beats"


def check_anchors(b, tl, proposals, **_):
    p, beats = [], {x["id"]: x for x in tl["beats"]}
    items = {i["data"]["id"]: i for i in track(b, "proposals")["items"]}
    for pid in sorted(set(proposals) - set(items)): p.append(f"proposal {pid} has a file and no item in the bible")
    for pid in sorted(set(items) - set(proposals)): p.append(f"proposal {pid} is in the bible and has no file")
    for pid, raw in sorted(proposals.items()):
        a, it = raw.get("anchor") or {}, items.get(pid)
        if not a: p.append(f"proposal {pid} has no anchor"); continue
        names = a["beats"] if "beats" in a else [a["beat"]] if "beat" in a else []
        missing = [n for n in names if n not in beats]
        if missing: p.append(f"proposal {pid} is anchored to {missing[0]!r}, which is not a beat on the timeline"); continue
        if names:
            lo, hi = beats[names[0]]["start"], beats[names[-1]]["end"]
        elif "frames" in a: lo, hi = 0, tl["durationInFrames"]
        else: lo, hi = 0, tl["durationInFrames"]
        if "frame" in a and not lo <= a["frame"] < hi: p.append(f"proposal {pid} is anchored at frame {a['frame']}, outside {names[0]!r} ({lo}-{hi})")
        if "frames" in a and not (lo <= a["frames"][0] < a["frames"][1] <= hi): p.append(f"proposal {pid} is anchored at frames {a['frames'][0]}-{a['frames'][1]}, outside {lo}-{hi}")
        if it and not (lo <= it["start"] < it["end"] <= hi): p.append(f"proposal {pid} sits at frames {it['start']}-{it['end']} in the bible, outside its beat range {lo}-{hi}")
    return not p, "; ".join(p) if p else f"{len(proposals)} proposal(s) each anchored inside the frame range of their beat"


def check_rulings(b, tl, proposals, **_):
    p = []
    seen = [(it["data"]["id"], it["data"], "the bible") for it in track(b, "proposals")["items"]] + [(pid, {"kind": r.get("kind"), "status": r.get("status"), "ruling": r.get("ruling")}, "its file") for pid, r in sorted(proposals.items())]
    for pid, d, where in seen:
        if d["kind"] not in KINDS: p.append(f"proposal {pid} has kind {d['kind']!r} in {where}, not one of {', '.join(KINDS)}")
        if d["status"] == "ruled" and not (d.get("ruling") and re.search(r"D\d+", str(d["ruling"]))): p.append(f"proposal {pid} is ruled in {where} and names no D-number ruling (ruling is {d.get('ruling')!r})")
        if d["status"] == "open" and d.get("ruling"): p.append(f"proposal {pid} is open in {where} and carries ruling {d['ruling']!r}")
    return not p, "; ".join(p) if p else f"{len(proposals)} proposal(s) in the bible and in their files: kind one of the five, a ruled one names its D-number"


def check_page(b, tl, page=None, **_):
    if page is None: return True, "no page given (--page), nothing to compare"
    want = b["inputsHash"]
    m = re.search(r"<footer[^>]*>\s*bible ([0-9a-f]{6,64}) ", page)
    if not m: return False, "the page has no footer carrying a bible hash"
    p = []
    if not want.startswith(m.group(1)): p.append(f"the page footer says bible {m.group(1)}, the bible's inputsHash starts {want[:len(m.group(1))]}")
    e = re.search(r'"inputsHash":"([0-9a-f]{64})"', page)
    if not e: p.append("the page carries no inputsHash of its own")
    elif e.group(1) != want: p.append(f"the bible embedded in the page has inputsHash {e.group(1)[:12]}, the bible file {want[:12]}")
    return not p, "; ".join(p) if p else f"the page footer and the bible inside it both carry {want[:12]}"


def check_hash(b, tl, root=DEFAULT_ROOT, **_):
    h, gone = hashlib.sha256(), []
    for rel in b["generatedFrom"]:
        path = os.path.normpath(os.path.join(root, rel))
        if not os.path.exists(path): gone.append(rel); continue
        with open(path, "rb") as f: h.update(f.read())
    if gone: return False, f"declared input {gone[0]} is gone ({len(gone)} missing); the bible cannot be checked against it"
    if h.hexdigest() != b["inputsHash"]: return False, f"the bible says {b['inputsHash'][:12]}, its {len(b['generatedFrom'])} inputs hash to {h.hexdigest()[:12]}: it is stale, re-run compile-bible.mjs"
    return True, f"the {len(b['generatedFrom'])} declared inputs hash to {b['inputsHash'][:12]}, as the bible says"


def check_flags(b, tl, **_):
    bad = [f for f in b["flags"] if re.search(r"stale|is on neither|names no beat|has no section|no blocking file|has no entry|does not have", f["text"])]
    if bad: return False, "; ".join(f"{f['beat']}: {f['text']}" for f in bad[:3]) + (f" (+{len(bad) - 3} more)" if len(bad) > 3 else "")
    return True, f"{len(b['flags'])} flag(s), none says an input disagrees with another"


def spec_rulings(spec):
    """{first D-number: raw bullet} and the set of every D-number a bullet header names."""
    bullets = [ln for ln in spec.split("\n") if BULLET.match(ln)]
    return {BULLET.match(ln).group(1).split("/")[0]: ln for ln in bullets}, {d for ln in bullets for d in BULLET.match(ln).group(1).split("/")}


def check_mirror(b, tl, rulings=None, spec=None, **_):
    by_spec, _all = spec_rulings(spec)
    mirror = {r["id"]: r for r in rulings}
    p = [f"ruling {d} is in the spec and has no entry in the rulings mirror" for d in by_spec if d not in mirror]
    p += [f"the rulings mirror has {d}, which the spec does not carry" for d in mirror if d not in by_spec]
    p += [f"the rulings mirror entry {d} is not the spec's bullet (re-run compile-bible.mjs)" for d, r in mirror.items() if d in by_spec and r.get("raw") != by_spec[d]]
    return not p, "; ".join(p[:3]) + (f" (+{len(p) - 3} more)" if len(p) > 3 else "") if p else f"{len(by_spec)} spec ruling(s) each mirrored with the spec's own bullet"


def check_proposal_rulings(b, tl, proposals, spec=None, **_):
    _by, known = spec_rulings(spec)
    seen = [(it["data"]["id"], it["data"].get("ruling"), "the bible") for it in track(b, "proposals")["items"]] + [(pid, r.get("ruling"), "its file") for pid, r in sorted(proposals.items())]
    p = [f"proposal {pid} names ruling {ruling!r} in {where}, which the spec's rulings list does not carry" for pid, ruling, where in seen if ruling and not set(re.findall(r"D\d+", str(ruling))) <= known]
    return not p, "; ".join(p) if p else f"{sum(1 for _i, r, _w in seen if r)} ruling name(s) on proposals, each a ruling in the spec"


def probe_materials():
    """probe-materials.py as a module (its file name has a hyphen, so it is loaded by path)."""
    spec = importlib.util.spec_from_file_location("probe_materials", os.path.join(HERE, "probe-materials.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def check_materials(b, tl, root=DEFAULT_ROOT, **_):
    file = os.path.join(root, "v3", "materials.json")
    if not os.path.exists(file): return True, "no v3/materials.json, nothing to check"
    if "materials" not in b: return False, "v3/materials.json exists and the bible carries no materials block: re-run compile-bible.mjs"
    pm = probe_materials()
    schema = load(os.path.join(root, "v3", "materials.schema.json"), "the materials schema")
    board = pm.board_ids_of(os.path.join(root, "v3", "references", "board.json"))
    problems = [p[2] for p in pm.check_materials(b["materials"], schema, board)]
    if b["materials"] != load(file, "the materials"): problems.append("the bible's materials block is not v3/materials.json as it is today: re-run compile-bible.mjs")
    if problems: return False, "; ".join(problems[:3]) + (f" (+{len(problems) - 3} more)" if len(problems) > 3 else "")
    return True, f"the bible carries {len(b['materials'])} materials as the file declares them, each in range with its intent word and the cross-rules holding"


CHECKS = [("tracks cover the timeline", check_coverage), ("proposals inside their beats", check_anchors), ("rulings close properly", check_rulings),
          ("page shows this bible", check_page), ("bible matches its inputs", check_hash), ("inputs agree", check_flags),
          ("rulings mirror the spec", check_mirror), ("proposal rulings exist in the spec", check_proposal_rulings), ("materials in range", check_materials)]


def planted(b, proposals, page, tl, rulings, spec):
    out = {}
    x = copy.deepcopy(b); track(x, "pacing")["items"].pop(); out["tracks not covering the duration"] = ("tracks cover the timeline", dict(b=x, proposals=proposals, page=page))
    x, pr = copy.deepcopy(b), copy.deepcopy(proposals)
    beat = next(i for i in track(x, "pacing")["items"] if i["beat"] == "the-frame") if any(i["beat"] == "the-frame" for i in track(x, "pacing")["items"]) else track(x, "pacing")["items"][0]
    if pr:
        pid = sorted(pr)[0]; pr[pid]["anchor"] = {"beat": beat["beat"], "frame": 5}
        it = next(i for i in track(x, "proposals")["items"] if i["data"]["id"] == pid); it["start"], it["end"] = 5, 6
    out["proposal anchored outside its beat"] = ("proposals inside their beats", dict(b=x, proposals=pr, page=page))
    x, pr = copy.deepcopy(b), copy.deepcopy(proposals)
    if track(x, "proposals")["items"]: d = track(x, "proposals")["items"][0]["data"]; d["status"], d["ruling"] = "ruled", None
    for r in pr.values(): r["status"], r["ruling"] = "ruled", None
    out["ruled proposal with no ruling"] = ("rulings close properly", dict(b=x, proposals=pr, page=page))
    pg = re.sub(r"(<footer[^>]*>\s*bible )[0-9a-f]+", r"\g<1>deadbeef0000", page) if page else "<footer>bible deadbeef0000 · read-only</footer>"
    out["page footer hash differs from the bible"] = ("page shows this bible", dict(b=b, proposals=proposals, page=pg))
    x = copy.deepcopy(b); x["inputsHash"] = "0" * 64
    out["inputsHash is not the hash of the inputs"] = ("bible matches its inputs", dict(b=x, proposals=proposals, page=page))
    x = copy.deepcopy(b); x["flags"].append({"beat": "x", "text": "xsheet stale: planted"})
    out["a stale-input flag"] = ("inputs agree", dict(b=x, proposals=proposals, page=page))
    pr = copy.deepcopy(proposals) or {"p000": {"id": "p000", "kind": "change", "status": "open", "ruling": None}}
    pr[sorted(pr)[0]]["ruling"] = "D9999"
    out["a proposal naming a ruling the spec lacks"] = ("proposal rulings exist in the spec", dict(b=b, proposals=pr, page=page))
    out["a spec ruling with no mirror entry"] = ("rulings mirror the spec", dict(b=b, proposals=proposals, page=page, rulings=[r for r in rulings if r["id"] != rulings[-1]["id"]]))
    if "materials" in b:
        x = copy.deepcopy(b); x["materials"]["cloth"]["stiffness"]["value"] = 1
        out["cloth stiffness 1 in the materials block"] = ("materials in range", dict(b=x, proposals=proposals, page=page))
    return out


def load(path, what):
    try:
        with open(path, encoding="utf8") as f: return json.load(f)
    except (OSError, ValueError) as e:
        print(f"refused: cannot read {what} {path}: {e}"); sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bible"); ap.add_argument("--page"); ap.add_argument("--proposals", default=os.path.join(DEFAULT_ROOT, "v3", "proposals"))
    ap.add_argument("--timeline", default=os.path.join(DEFAULT_ROOT, "v3", "timeline.json")); ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--spec", default=os.path.join(DEFAULT_ROOT, "v3", "creative-spec.md")); ap.add_argument("--rulings", default=os.path.join(DEFAULT_ROOT, "v3", "rulings.json"))
    a = ap.parse_args()
    b, tl = load(a.bible, "the bible"), load(a.timeline, "the timeline")
    if b.get("schema") != "showcase.bible.1": print(f"refused: {a.bible} has schema {b.get('schema')!r}, this probe reads showcase.bible.1"); sys.exit(2)
    rulings = load(a.rulings, "the rulings mirror")
    try: spec = open(a.spec, encoding="utf8").read()
    except OSError as e: print(f"refused: cannot read the spec {a.spec}: {e}"); sys.exit(2)
    if not rulings or not spec_rulings(spec)[0]: print("refused: the spec or the rulings mirror carries no ruling, so the mirror check could observe nothing"); sys.exit(2)
    proposals = {}
    if os.path.isdir(a.proposals):
        for f in sorted(os.listdir(a.proposals)):
            if f.endswith(".json"): raw = load(os.path.join(a.proposals, f), "a proposal"); proposals[raw["id"]] = raw
    page = None
    if a.page:
        try: page = open(a.page, encoding="utf8").read()
        except OSError as e: print(f"refused: cannot read the page {a.page}: {e}"); sys.exit(2)
    checks = dict(CHECKS)
    # control: each planted fault must be refused by the check that names it
    res, bad = [], []
    for name, (check, kw) in planted(b, proposals, page, tl, rulings, spec).items():
        ok, text = checks[check](kw["b"], tl, proposals=kw["proposals"], page=kw["page"], root=a.root, rulings=kw.get("rulings", rulings), spec=spec)
        res.append(f"planted {name} -> {'refused' if not ok else 'NOT REFUSED'}")
        if ok: bad.append(name)
    print("control: " + "; ".join(res), flush=True)
    if bad:
        print("refused: the probe did not refuse " + ", ".join(bad) + ", so a pass from it would mean nothing"); sys.exit(2)
    failed = []
    for name, fn in CHECKS:
        ok, text = fn(b, tl, proposals=proposals, page=page, root=a.root, rulings=rulings, spec=spec)
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {text}", flush=True)
        if not ok: failed.append((name, text))
    if failed:
        print("refused: " + "; ".join(f"{n}: {t}" for n, t in failed)); sys.exit(1)
    n = sum(len(t["items"]) for t in b["tracks"])
    print(f"pass: bible {b['inputsHash'][:12]} covers {b['duration']} frames in {len(b['tracks'])} tracks ({n} items), {len(proposals)} proposal(s) sit inside their beats, {len(rulings)} ruling(s) mirrored, and {'the page shows this bible' if page else 'no page was given'}")


if __name__ == "__main__": main()
