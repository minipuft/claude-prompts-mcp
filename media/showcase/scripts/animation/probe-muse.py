#!/usr/bin/env python3
"""Muse (contract only, no frames): an asset enters a scene only after a muse sheet (rubric C19, D55).

usage: probe-muse.py v3/shots.json assets/props [--picks v3/references/owner/picks.json] [--shot <id> ...] [--require-accepted] [--json out]

Every `object_inventory` entry of `kind: "prop"` that a shot's `objects` names (all shots, or the --shot ones) needs a muse sheet: an `assets/props/<asset>/muse.json` whose `covers`
lists it. A character (`kind: "character"`) has its own model sheet and is not read here; an entry with no `kind` is refused (exit 2) because the probe cannot tell which gate owns it.
Per sheet:
  variants   at least 3, each with a distinct id and an image that exists and matches its `sha256`.
  cards      each variant cites at least one `borrows` entry whose `card` is an id in picks.json, whose `facet` (dotted path, e.g. light.source) the card carries, with the card's value
             (a list facet such as fx holds it); a card the library does not hold, or a facet or value it does not carry, is refused.
  cast       each variant names one existing cast property (`cast_property`: `cast` and `property`), the end of the space the variant sits between.
--require-accepted also asks for the inventory entry's `sheet_accepted` (the owner's call); the chain gate does not pass it, acceptance is tracked, not gated.
An inventory entry with `sheet_proposed` must name a muse.json that exists. Objects a shot names that the inventory does not list are printed as `unlisted:` and are not this probe's property.
The first line is the control: a fixture sheet that passes, then the fixture with no sheet, 2 variants, an unknown card, an unknown facet and no cast property, each of which must be named
by its own code; a control that does not trip exits 2 without reporting (a refusal is not a verified negative).
Exit codes: 0 pass, 1 a prop without a complete sheet, 2 input error or a control that did not trip.
"""
import argparse, copy, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import Probe

MIN_VARIANTS = 3


def facet_value(card, path):
    cur = card.get("facets", {})
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None, False
        cur = cur[part]
    return cur, True


def check_variant(v, picks, image_ok):
    """Failure codes for one variant: [(code, text)]."""
    bad = []
    if not v.get("image") or not image_ok(v):
        bad.append(("image", f"{v.get('id', '?')}: image missing or its sha256 differs from muse.json"))
    for b in v.get("borrows", []):
        card = picks.get(b.get("card"))
        if card is None:
            bad.append(("unknown-card", f"{v.get('id')}: cites {b.get('card')}, which picks.json does not hold"))
            continue
        have, present = facet_value(card, b.get("facet", ""))
        want = b.get("value")
        if not present or not (want in have if isinstance(have, list) else have == want):
            bad.append(("facet", f"{v.get('id')}: {b['card']} does not carry {b.get('facet')}={want}"))
            continue
    if not v.get("borrows"):
        bad.append(("no-card", f"{v.get('id')}: cites no reference card property"))
    cast = v.get("cast_property") or {}
    if not (cast.get("cast") and cast.get("property")):
        bad.append(("no-cast", f"{v.get('id')}: names no existing cast property"))
    return bad


def check_prop(obj, entry, sheets, picks, image_ok, require_accepted):
    """Failure codes for one prop: [(code, text)]."""
    covering = [s for s in sheets if obj in s.get("covers", [])]
    if not covering:
        return [("no-sheet", f"{obj}: no muse sheet covers it")]
    sheet = covering[0]
    bad = []
    variants = sheet.get("variants", [])
    if len({v.get("id") for v in variants}) < MIN_VARIANTS:
        bad.append(("variants", f"{obj}: {len({v.get('id') for v in variants})} variants, need {MIN_VARIANTS}+"))
    for v in variants:
        bad += check_variant(v, picks, image_ok)
    if require_accepted and not entry.get("sheet_accepted"):
        bad.append(("not-accepted", f"{obj}: sheet_accepted is not set (the owner's call)"))
    return bad


def fixture():
    picks = {"P1": {"id": "P1", "facets": {"light": {"source": "single-emitter"}, "fx": ["glow", "rim"]}}}
    variants = [{"id": f"muse-0{i}", "image": f"muse-0{i}.png", "sha256": "x",
                 "borrows": [{"card": "P1", "facet": "light.source", "value": "single-emitter"}, {"card": "P1", "facet": "fx", "value": "glow"}],
                 "cast_property": {"cast": "clawd", "property": "stubby plated body"}} for i in (1, 2, 3)]
    return picks, [{"asset": "fixture", "covers": ["fixture"], "variants": variants}]


def controls():
    always = lambda v: True
    picks, sheets = fixture()
    codes = lambda p, s: {c for c, _ in check_prop("fixture", {}, s, p, always, False)}
    results = {"complete fixture passes": codes(picks, sheets) == set()}
    s = copy.deepcopy(sheets); s[0]["covers"] = []
    results["no sheet named"] = codes(picks, s) == {"no-sheet"}
    s = copy.deepcopy(sheets); s[0]["variants"] = s[0]["variants"][:2]
    results["2 variants named"] = codes(picks, s) == {"variants"}
    s = copy.deepcopy(sheets); s[0]["variants"][1]["borrows"][0]["card"] = "NOSUCHCARD"
    results["unknown card named"] = codes(picks, s) == {"unknown-card"}
    s = copy.deepcopy(sheets); s[0]["variants"][1]["borrows"][0]["facet"] = "light.direction"
    results["unknown facet named"] = codes(picks, s) == {"facet"}
    s = copy.deepcopy(sheets); s[0]["variants"][2]["cast_property"] = {}
    results["no cast property named"] = codes(picks, s) == {"no-cast"}
    results["unaccepted refused under --require-accepted"] = {c for c, _ in check_prop("fixture", {}, sheets, picks, always, True)} == {"not-accepted"}
    return results


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"input error: {what} {path}: {e}", flush=True)
        sys.exit(2)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description="C19 muse-sheet probe")
    ap.add_argument("shots"), ap.add_argument("props_dir")
    ap.add_argument("--picks", default="v3/references/owner/picks.json")
    ap.add_argument("--shot", action="append", default=[])
    ap.add_argument("--require-accepted", action="store_true")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    pr = Probe("probe-muse", a.json)
    res = controls()
    pr.control(all(res.values()), "; ".join(f"{k}: {'ok' if v else 'DID NOT TRIP'}" for k, v in res.items()))

    shots = load_json(a.shots, "shot list")
    picks = {p["id"]: p for p in load_json(a.picks, "picks")["picks"]}
    inventory = {o["object"]: o for o in shots.get("object_inventory", [])}
    undeclared = [k for k, o in inventory.items() if o.get("kind") not in ("prop", "character")]
    if undeclared:
        print(f"input error: inventory entries with no kind (prop or character): {', '.join(undeclared)}", flush=True)
        sys.exit(2)
    scope = [s for s in shots.get("shots", []) if not a.shot or s["id"] in a.shot]
    if a.shot and len(scope) != len(set(a.shot)):
        print(f"input error: --shot names a shot v3/shots.json does not hold: {a.shot}", flush=True)
        sys.exit(2)
    named = {}
    for s in scope:
        for o in s.get("objects", []):
            named.setdefault(o, []).append(s["id"])
    for o, ids in named.items():
        if o not in inventory:
            pr.note(f"unlisted: {o} ({', '.join(ids)}) has no inventory entry; not this probe's property")

    sheets = []
    for d in sorted(os.listdir(a.props_dir)):
        p = os.path.join(a.props_dir, d, "muse.json")
        if os.path.isfile(p):
            sh = load_json(p, "muse sheet")
            sh["_dir"] = os.path.join(a.props_dir, d)
            sheets.append(sh)

    def image_ok(v):
        # a variant's image path is relative to the working directory (the renderer root)
        return os.path.isfile(v["image"]) and (not v.get("sha256") or sha256(v["image"]) == v["sha256"])

    props = [o for o in named if o in inventory and inventory[o]["kind"] == "prop"]
    for obj in props:
        entry = inventory[obj]
        bad = check_prop(obj, entry, sheets, picks, image_ok, a.require_accepted)
        sp = entry.get("sheet_proposed")
        if sp and not os.path.isfile(sp):
            bad.append(("proposed", f"{obj}: sheet_proposed {sp} does not exist"))
        if bad:
            pr.check(obj, False, "; ".join(t for _, t in bad))
        else:
            sh = next(s for s in sheets if obj in s["covers"])
            pr.check(obj, True, f"{sh['asset']} sheet, {len(sh['variants'])} variants, each citing a library card and a cast property"
                     + (", accepted" if a.require_accepted else ""))
    pr.finish(f"{len(props)} props named by {len(scope)} shot(s), every one with a muse sheet")


if __name__ == "__main__":
    main()
