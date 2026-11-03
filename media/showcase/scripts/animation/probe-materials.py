#!/usr/bin/env python3
"""Material contract (D97): v3/materials.json declares every property of every material, in range, with an intent word, and the cross-rules between properties hold.

usage: probe-materials.py <materials.json> [--schema v3/materials.schema.json] [--board v3/references/board.json]
The schema (v3/materials.schema.json) owns the kinds, ranges and words; this probe reads it. Checks:
  shape       exactly the schema's materials, each with exactly its thirteen properties, each null (where the schema allows null) or {value, intent, ref}.
  ranges      each value is the kind the schema names (whole frames are whole numbers) and inside its minimum and maximum (or one of its words).
  intents     each intent is one of snap, float, weighted, drape, crisp, soft, still.
  refs        each ref is null or a card id on the reference board (skipped, and said so, when the board file is not found).
  cross-rules a transmissive material declares refraction and diffusion; an emissive one has albedo 1; cloth stiffness is below 0.3 and hair stiffness above 0; a lag declares a settle
              and the settle is not shorter than the lag; crayon paper boils (boil above 0).
Control first: cloth with stiffness 1, a transmissive material with no refraction, an emissive one with albedo 0.5, a lag whose settle is null, an intent outside the list, a mass of 9,
a lag of 2.5 frames and crayon paper with boil 0 must each be refused by the check that names it. Exit 0 pass, 1 refusal (named in plain words), 2 a control that did not trip or an unreadable input.
"""
import argparse, copy, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def shape_of(schema, field):
    """(nullable, rule) for one property: rule is the schema of its `value`."""
    prop = schema["$defs"]["material"]["properties"][field]
    branches = prop.get("anyOf") or [prop]
    obj = next(b for b in branches if b.get("type") == "object")
    return any(b.get("type") == "null" for b in branches), obj["properties"]["value"]


def number(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def value_problem(rule, v):
    """Why `v` is outside the schema rule `rule`, or None."""
    if "enum" in rule: return None if v in rule["enum"] else f"{v!r} is not one of {', '.join(rule['enum'])}"
    if not number(v): return f"{v!r} is not a number"
    if rule.get("type") == "integer" and v != int(v): return f"{v} is not a whole number of frames"
    if "minimum" in rule and v < rule["minimum"]: return f"{v} is below the minimum {rule['minimum']}"
    if "exclusiveMinimum" in rule and v <= rule["exclusiveMinimum"]: return f"{v} is not above {rule['exclusiveMinimum']}"
    if "maximum" in rule and v > rule["maximum"]: return f"{v} is above the maximum {rule['maximum']}"
    return None


def check_materials(data, schema, board_ids=None):
    """[(check, where, text)] for everything wrong in a materials object: check is one of shape, ranges, intents, refs, cross-rules; where is `material.field`."""
    out = []
    add = lambda check, where, text: out.append((check, where, text))
    mdef = schema["$defs"]["material"]
    fields = list(mdef["properties"])
    intents = schema["$defs"]["intent"]["enum"]
    if not isinstance(data, dict): return [("shape", "file", "the file is not an object of materials")]
    for mid in schema["required"]:
        if mid not in data: add("shape", mid, f"material {mid} is missing")
    for mid in data:
        if mid not in schema["required"]: add("shape", mid, f"material {mid} is not one the schema names ({', '.join(schema['required'])})")
    for mid, m in data.items():
        if not isinstance(m, dict): add("shape", mid, f"{mid} is not an object of properties"); continue
        for f in fields:
            if f not in m: add("shape", f"{mid}.{f}", f"{mid} does not declare {f} (null where it has none)")
        for f in m:
            if f not in fields: add("shape", f"{mid}.{f}", f"{mid}.{f} is not a property the schema names")
        for f in fields:
            if f not in m: continue
            r, where = m[f], f"{mid}.{f}"
            nullable, rule = shape_of(schema, f)
            if r is None:
                if not nullable: add("shape", where, f"{where} is null, and this property is declared by every material")
                continue
            if not isinstance(r, dict) or set(r) != {"value", "intent", "ref"}:
                add("shape", where, f"{where} must be exactly {{value, intent, ref}}"); continue
            bad = value_problem(rule, r["value"])
            if bad: add("ranges", where, f"{where}: {bad}")
            if r["intent"] not in intents: add("intents", where, f"{where} has intent {r['intent']!r}, not one of {', '.join(intents)}")
            if r["ref"] is not None and not isinstance(r["ref"], str): add("refs", where, f"{where} has a ref that is not a card id or null")
            elif r["ref"] is not None and board_ids is not None and r["ref"] not in board_ids: add("refs", where, f"{where} cites card {r['ref']!r}, which is not on the reference board")
    v = lambda mid, f: (data.get(mid, {}).get(f) or {}).get("value") if isinstance(data.get(mid), dict) and isinstance(data.get(mid, {}).get(f), dict) else None
    for mid, m in data.items():
        if not isinstance(m, dict): continue
        occ = v(mid, "occluder")
        if occ == "transmissive":
            for f in ("refraction", "diffusion"):
                if v(mid, f) is None: add("cross-rules", f"{mid}.{f}", f"{mid} is transmissive and declares no {f}: the glass pass has nothing to read")
        if occ == "emissive" and v(mid, "albedo") not in (None, 1) : add("cross-rules", f"{mid}.albedo", f"{mid} is emissive and has albedo {v(mid, 'albedo')}, not 1")
        lag, settle = v(mid, "lagFrames"), v(mid, "settleFrames")
        if lag is not None and settle is None: add("cross-rules", f"{mid}.settleFrames", f"{mid} declares a lag of {lag} and no settle")
        if lag is not None and settle is not None and number(lag) and number(settle) and settle < lag: add("cross-rules", f"{mid}.settleFrames", f"{mid} settles in {settle} frames, before its {lag}-frame lag has passed")
    if v("cloth", "stiffness") is not None and number(v("cloth", "stiffness")) and v("cloth", "stiffness") >= 0.3: add("cross-rules", "cloth.stiffness", f"cloth.stiffness is {v('cloth', 'stiffness')}: a cloth that holds its shape is not cloth (below 0.3)")
    if "hair" in data and number(v("hair", "stiffness")) and v("hair", "stiffness") <= 0: add("cross-rules", "hair.stiffness", "hair.stiffness is 0: the swoop is lost (above 0)")
    if "paper" in data and number(v("paper", "boil")) and v("paper", "boil") <= 0: add("cross-rules", "paper.boil", "paper.boil is 0: crayon paper that does not boil reads as clean card")
    return out


def planted(data):
    """{name: (data, (check, where))}: each fault must be refused by the check that names it, at the property it names."""
    out = {}
    def make(name, edit, expect):
        d = copy.deepcopy(data); edit(d); out[name] = (d, expect)
    def put(mid, f, **kw):
        def edit(d):
            d[mid][f] = {**(d[mid][f] or {"value": None, "intent": "soft", "ref": None}), **kw}
        return edit
    make("cloth stiffness 1", put("cloth", "stiffness", value=1), ("cross-rules", "cloth.stiffness"))
    make("a transmissive material with no refraction", lambda d: d["glass"].__setitem__("refraction", None), ("cross-rules", "glass.refraction"))
    make("an emissive material with albedo 0.5", put("light", "albedo", value=0.5), ("cross-rules", "light.albedo"))
    make("a lag with a null settle", lambda d: d["cloth"].__setitem__("settleFrames", None), ("cross-rules", "cloth.settleFrames"))
    make("an intent outside the list", put("hair", "mass", intent="bouncy"), ("intents", "hair.mass"))
    make("a mass of 9", put("box", "mass", value=9), ("ranges", "box.mass"))
    make("a lag of 2.5 frames", put("body", "lagFrames", value=2.5), ("ranges", "body.lagFrames"))
    make("paper boil 0", put("paper", "boil", value=0), ("cross-rules", "paper.boil"))
    return out


def load(path, what):
    try:
        with open(path, encoding="utf8") as f: return json.load(f)
    except (OSError, ValueError) as e:
        print(f"refused: cannot read {what} {path}: {e}"); sys.exit(2)


def board_ids_of(path):
    if not os.path.exists(path): return None
    b = load(path, "the reference board")
    return {c["id"] for s in b["sections"] for c in s["cards"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("materials"); ap.add_argument("--schema", default=None); ap.add_argument("--board", default=None)
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(a.materials))
    schema = load(a.schema or os.path.join(here, "materials.schema.json"), "the schema")
    data = load(a.materials, "the materials")
    board = board_ids_of(a.board or os.path.join(here, "references", "board.json"))
    # control: the real file is judged only after each planted fault has been refused by the check that names it
    res, bad = [], []
    for name, (d, (check, where)) in planted(data).items():
        hit = [p for p in check_materials(d, schema, board) if p[0] == check and p[1] == where]
        res.append(f"{name} -> {'refused (' + hit[0][2] + ')' if hit else 'NOT REFUSED'}")
        if not hit: bad.append(name)
    print("control: " + "; ".join(res), flush=True)
    if bad:
        print("refused: the probe did not refuse " + ", ".join(bad) + ", so a pass from it would mean nothing"); sys.exit(2)
    problems = check_materials(data, schema, board)
    n_props = sum(1 for m in data.values() if isinstance(m, dict) for r in m.values() if r is not None) if isinstance(data, dict) else 0
    names = {"shape": f"{len(data) if isinstance(data, dict) else 0} materials, each with its {len(schema['$defs']['material']['properties'])} properties", "ranges": f"{n_props} declared values inside the schema's kinds and ranges",
             "intents": f"{n_props} intents, each one of the seven words", "refs": ("every ref is null or a card on the board" if board is not None else "skipped: no reference board found next to the materials"),
             "cross-rules": "transmissive declares refraction, emissive has albedo 1, cloth stiffness below 0.3, hair above 0, every lag declares a settle it does not outrun, paper boils"}
    failed = []
    for check in ("shape", "ranges", "intents", "refs", "cross-rules"):
        mine = [p for p in problems if p[0] == check]
        print(f"  {'FAIL' if mine else 'ok  '} {check}: " + ("; ".join(p[2] for p in mine[:4]) + (f" (+{len(mine) - 4} more)" if len(mine) > 4 else "") if mine else names[check]), flush=True)
        if mine: failed.append(check)
    if failed:
        print("refused: " + "; ".join(p[2] for p in problems[:3]) + (f" (+{len(problems) - 3} more)" if len(problems) > 3 else "")); sys.exit(1)
    print(f"pass: materials - {len(data)} materials, {n_props} declared values, each in range with its intent word, and the cross-rules hold")


if __name__ == "__main__": main()
