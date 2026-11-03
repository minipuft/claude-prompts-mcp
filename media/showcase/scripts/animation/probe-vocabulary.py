#!/usr/bin/env python3
"""Direction vocabulary contract (D96): every intent word in a proposal, a ruling, a pose sheet or a material is a term of the controlled vocabulary.

usage: probe-vocabulary.py <vocabulary.json> [--overrides v3/vocabulary-overrides.json] [--proposals v3/proposals] [--rulings v3/rulings.json]
                           [--materials v3/materials.json] [--poses v3/poses] [--light v3/light.json] [--cards v3/references/board.json]
                           [--card-schema v3/references/owner/card-schema.json] [--facet-source ~/.claude/skills/inspiration/scripts/eagle_board.py] [--root <showcase root>]
Checks (a file that does not exist yet is reported as such and skipped, never failed):
  vocabulary  every domain member has a term with a one-line definition and a valid `governs` (a bible lane, a material property or a pose/acting/camera/composition/light/colour facet),
              every term sits in a domain, and the terms D96 names are all present;
  overrides   every alias points at base terms, no film term restates a base term, every hue pair named exists in v3/light.json;
  facets      every word of the inspiration board's aligned facets (eagle_board.py FACET_VOCAB and card-schema.json) is a term, an alias, or declared unmapped, so the two vocabularies cannot drift apart;
  proposals   `intent`, `options` and `default` resolve; an owner-ask proposal carries all three;
  rulings     a ruling in the form `... because <intent word> (ref <card id>)` has an intent word that resolves and a ref that is a card on the board (parsed by rulings.mjs; older free prose
              and a because clause longer than three words are not checked);
  poses       each breakdown `kind` is a timing term; a key's `intent`, `register` and `business`, when present, resolve;
  materials   every `intent` resolves in the material domain; a preset named by registers resolves as registers.
Control first: a proposal with intent `vibey`, a ruling with `because vibey`, a materials entry with intent `bouncy`, a pose breakdown of kind `wobbly`, a facet word `zany`, an owner-ask with no
default, an alias to a term the vocabulary lacks and a vocabulary with `whip` removed must each be refused by the check that names it, and a clean fixture of each kind must be accepted.
Exit 0 pass, 1 refusal (the refused word is quoted), 2 a control that did not trip or an unreadable input.
"""
import argparse, ast, copy, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RULINGS_PARSER = os.path.join(HERE, "rulings.mjs")

# The terms D96 / p004 name; a vocabulary that lost one is refused, so a term cannot be deleted to make a word pass.
REQUIRED = {
    "shot.size": ["extreme wide", "wide", "medium wide", "medium", "medium close", "close", "insert"],
    "shot.angle": ["eye", "low", "high", "overhead", "dutch", "pov"],
    "shot.move": ["locked", "push", "pull", "pan", "tilt", "orbit", "drift", "whip"],
    "staging": ["centre", "third-left", "third-right", "edge", "low", "high", "doorway", "window", "negative-space", "radial", "pair", "tower"],
    "timing": ["hold", "moving hold", "anticipation", "action", "overshoot", "settle", "breakdown", "passing position", "favour", "snap", "float", "even", "staggered", "on twos", "on ones"],
    "acting.register": ["warm", "playful", "inviting", "reverent", "comic", "tense", "focused", "neutral"],
    "acting.business": ["lean in", "reach", "grip", "lift", "turn", "slump", "rise", "step", "threshold", "nudge", "look through"],
    "light.role": ["key", "rim", "fill", "practical", "motivated", "volume", "emitter", "bounce"],
    "light.quality": ["hard", "soft", "flood", "cone", "narrow", "settled", "noisy", "rising", "falling"],
    "light.behaviour": ["lag", "memory", "pulse", "seam"],
    "material.intent": ["snap", "float", "weighted", "drape", "crisp", "soft", "still"],
    "transition": ["cut", "morph", "crossing", "refill", "reduce-to-lines", "swell", "push-through"],
    "colour": ["pair", "radiance", "accent", "identity pigment", "field", "lit-paper"],
}
MATERIAL = {"material.intent"}
REGISTER = {"acting.register"}
BUSINESS = {"acting.business"}
TIMING = {"timing"}


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def die(msg):
    print(f"refused: {msg}", flush=True)
    sys.exit(2)


def load(path, what):
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        die(f"cannot read {what} {path}: {e}")


def flatten(domains):
    out = {}
    for k, v in domains.items():
        if isinstance(v, dict):
            for k2, v2 in v.items():
                out[f"{k}.{k2}"] = v2
        else:
            out[k] = v
    return out


# ---------- the index every check resolves a word against ----------
def index(base, ov):
    terms, aliases = {}, {}
    for path, members in flatten(base.get("domains", {})).items():
        for m in members:
            terms.setdefault(norm(m), set()).add(path)
    for a, t in (base.get("aliases") or {}).items():
        aliases[norm(a)] = [norm(t)]
    for a, t in ((ov or {}).get("aliases") or {}).items():
        aliases[norm(a)] = [norm(x) for x in t]
    for k, e in ((ov or {}).get("terms") or {}).items():
        terms.setdefault(norm(k), set()).add(e.get("domain", "film"))
    return {"terms": terms, "aliases": aliases}


def resolves(word, idx, domains=None):
    n = norm(word)
    if not n:
        return False
    names = idx["aliases"].get(n, [n])
    return all(t in idx["terms"] and (domains is None or idx["terms"][t] & domains) for t in names)


def unresolved(phrase, idx, domains=None):
    """The words of an intent phrase (one word, or a list joined by comma, slash, `and`, `+`) that are not in the vocabulary."""
    if resolves(phrase, idx, domains):
        return []
    parts = [p for p in re.split(r"\s*(?:,|/|&|\+|\band\b)\s*", str(phrase).strip().lower()) if p]
    bad = [p for p in parts if not resolves(p, idx, domains)]
    return bad or [str(phrase)]


def intents_of(value):
    return [value] if isinstance(value, str) else [v for v in (value or []) if isinstance(v, str)]


# ---------- rulings go through the one parser (rulings.mjs) ----------
def parse_rulings(raws):
    node = shutil.which("node")
    if not node:
        die("node is not on PATH, so the rulings cannot be parsed by scripts/animation/rulings.mjs")
    r = subprocess.run([node, RULINGS_PARSER, "--parse", "-"], input=json.dumps(raws), capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        die(f"rulings.mjs could not parse the rulings: {r.stderr.strip()[:300]}")
    return json.loads(r.stdout)


# ---------- checks: each returns (ok, plain words) ----------
def governs_ok(g, vocab):
    gv = vocab.get("governs") or {}
    allowed = set(gv.get("lanes", [])) | set(gv.get("materialProperties", []))
    groups = tuple(x + "." for x in gv.get("facetGroups", []))
    toks = [t.strip() for t in str(g).split(",") if t.strip()]
    bad = [t for t in toks if t not in allowed and not t.startswith(groups)]
    return bool(toks) and not bad, bad


def check_vocabulary(vocab, **_):
    p = []
    if vocab.get("schema") != "animation-direction.vocabulary.1":
        p.append(f"schema is {vocab.get('schema')!r}, this probe reads animation-direction.vocabulary.1")
    doms, terms = flatten(vocab.get("domains", {})), vocab.get("terms", {})
    keys = {}
    for k in terms:
        keys.setdefault(norm(k), []).append(k)
    for n, ks in keys.items():
        if len(ks) > 1:
            p.append(f"terms {ks} are the same word")
    seen = set()
    for path, members in doms.items():
        if len(set(norm(m) for m in members)) != len(members):
            p.append(f"domain {path} lists a term twice")
        for m in members:
            seen.add(norm(m))
            if norm(m) not in keys:
                p.append(f"{m!r} is in {path} and has no entry in terms")
    for k, e in terms.items():
        if norm(k) not in seen:
            p.append(f"term {k!r} sits in no domain")
        d = e.get("definition", "")
        if not isinstance(d, str) or not d.strip() or "\n" in d:
            p.append(f"term {k!r} has no one-line definition")
        ok, bad = governs_ok(e.get("governs", ""), vocab)
        if not ok:
            p.append(f"term {k!r} governs {bad or 'nothing'}, which is not a bible lane, a material property or a facet")
    for path, want in REQUIRED.items():
        have = {norm(m) for m in doms.get(path, [])}
        gone = [w for w in want if norm(w) not in have]
        if gone:
            p.append(f"domain {path} lost {gone}")
    n = len(terms)
    return not p, "; ".join(p) if p else f"{n} terms in {len(doms)} domains, each with a one-line definition and a lane, material property or facet it governs, and every term D96 names is present"


def check_overrides(vocab, idx=None, ov=None, light=None, **_):
    if ov is None:
        return True, "no overrides file given"
    p = []
    base_only = {norm(k) for k in vocab.get("terms", {})}
    if ov.get("schema") != "animation-direction.overrides.1":
        p.append(f"schema is {ov.get('schema')!r}, this probe reads animation-direction.overrides.1")
    for a, targets in (ov.get("aliases") or {}).items():
        gone = [t for t in targets if norm(t) not in base_only]
        if gone:
            p.append(f"alias {a!r} points at {gone}, which the vocabulary does not have")
    for k, e in (ov.get("terms") or {}).items():
        if norm(k) in base_only:
            p.append(f"film term {k!r} restates a vocabulary term")
        if not e.get("definition") or "\n" in e.get("definition", ""):
            p.append(f"film term {k!r} has no one-line definition")
        ok, bad = governs_ok(e.get("governs", ""), vocab)
        if not ok:
            p.append(f"film term {k!r} governs {bad or 'nothing'}")
    pairs = None
    if light is not None:
        pairs = set()
        beats = light.get("beats", {})
        for b in (beats.values() if isinstance(beats, dict) else beats):
            pr = b.get("pair") or {}
            if pr.get("radiance") and pr.get("accent"):
                pairs.add((pr["radiance"].lower(), pr["accent"].lower()))
        for k, e in (ov.get("terms") or {}).items():
            if "pair" in e and (e["pair"].get("radiance", "").lower(), e["pair"].get("accent", "").lower()) not in pairs:
                p.append(f"hue pair {k!r} ({e['pair'].get('radiance')}, {e['pair'].get('accent')}) is in no beat of the light script")
    n_pairs = sum(1 for e in (ov.get("terms") or {}).values() if "pair" in e)
    tail = "" if light is not None else " (no light script to read the hue pairs against)"
    return not p, "; ".join(p) if p else f"{len(ov.get('aliases') or {})} register phrases map to vocabulary terms, {len(ov.get('terms') or {})} film words (worlds and hue pairs) restate no vocabulary term, {n_pairs} hue pairs match the light script{tail}"


def check_facets(vocab, idx=None, facet_words=None, **_):
    if facet_words is None:
        return True, "no inspiration facet source found, skipped"
    p, n = [], 0
    for facet, spec in (vocab.get("facets") or {}).items():
        unmapped = {norm(u) for u in spec.get("unmapped", [])}
        for w in facet_words.get(facet) or []:
            n += 1
            if not resolves(w, idx) and norm(w) not in unmapped:
                p.append(f"facet {facet} word {w!r} is not a vocabulary term, an alias or declared unmapped")
    return not p, "; ".join(p) if p else f"{n} words of {len(vocab.get('facets') or {})} aligned facets of the inspiration board are each a term, an alias or declared unmapped"


def check_proposals(vocab, idx=None, proposals=None, **_):
    if proposals is None:
        return True, "no proposals directory yet"
    p, carrying = [], 0
    for pid, d in sorted(proposals.items()):
        has = any(k in d for k in ("intent", "options", "default"))
        carrying += has
        if d.get("kind") == "owner-ask":
            missing = [k for k in ("intent", "options", "default") if not d.get(k)]
            if missing:
                p.append(f"owner-ask {pid} has no {', '.join(missing)}")
            elif len(d["options"]) < 2:
                p.append(f"owner-ask {pid} offers fewer than two options")
        for field in ("intent", "default"):
            for w in intents_of(d.get(field)):
                bad = unresolved(w, idx)
                if bad:
                    p.append(f"proposal {pid} {field} {bad[0]!r} is not in the vocabulary")
        for w in intents_of(d.get("options")):
            bad = unresolved(w, idx)
            if bad:
                p.append(f"proposal {pid} option {bad[0]!r} is not in the vocabulary")
        if d.get("default") and d.get("options") and not any(norm(d["default"]) == norm(o) for o in d["options"]):
            p.append(f"proposal {pid} default {d['default']!r} is not one of its options")
    older = len(proposals) - carrying
    return not p, "; ".join(p) if p else f"{len(proposals)} proposals read: {carrying} carry an intent word and all resolve, {older} older ones carry none (free prose, not checked)"


def check_rulings(vocab, idx=None, parsed=None, cards=None, **_):
    if parsed is None:
        return True, "no rulings file yet"
    p, forms, checked, prose = [], 0, 0, 0
    for r in parsed:
        if not r["form"]:
            continue
        forms += 1
        if r["intent"] is not None:
            checked += 1
            bad = unresolved(r["intent"], idx)
            if bad:
                p.append(f"{r['id']} because {bad[0]!r} is not in the vocabulary")
        else:
            prose += 1
        if cards is not None:
            for ref in r["refs"]:
                if ref not in cards:
                    p.append(f"{r['id']} cites card {ref!r}, which is not on the board")
    return not p, "; ".join(p) if p else f"{len(parsed)} rulings read: {forms} in the ruling form ({checked} with an intent word, all in the vocabulary; {prose} with a sentence of reasons, not checked), the rest free prose"


def walk_intents(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "intent":
                yield path or "<root>", v
            else:
                yield from walk_intents(v, f"{path}.{k}" if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk_intents(v, f"{path}[{i}]")


def check_materials(vocab, idx=None, materials=None, **_):
    if materials is None:
        return True, "no file yet"
    p, n = [], 0
    for where, value in walk_intents(materials):
        for w in intents_of(value):
            n += 1
            bad = unresolved(w, idx, MATERIAL)
            if bad:
                p.append(f"{where} has intent {bad[0]!r}, which is not a material intent")
    presets = materials.get("presets") if isinstance(materials, dict) else None
    for name in (presets or {}):
        bad = [w for w in re.split(r"[-_\s]+", name) if w and not resolves(w, idx, REGISTER)]
        if bad:
            p.append(f"preset {name!r} names {bad[0]!r}, which is not an acting register")
    return not p, "; ".join(p) if p else f"{n} material intents read, all material terms; {len(presets or {})} presets named by registers"


def check_poses(vocab, idx=None, poses=None, **_):
    if poses is None:
        return True, "no pose sheets yet"
    p, n = [], 0
    for name, d in sorted(poses.items()):
        for b in d.get("breakdowns", []):
            n += 1
            if b.get("kind") and unresolved(b["kind"], idx, TIMING):
                p.append(f"{name} breakdown {b.get('between')} has kind {b['kind']!r}, which is not a timing term")
        for k in d.get("keys", []):
            for field, dom in (("intent", None), ("register", REGISTER), ("business", BUSINESS)):
                for w in intents_of(k.get(field)):
                    n += 1
                    bad = unresolved(w, idx, dom)
                    if bad:
                        p.append(f"{name} key {k.get('name')} {field} {bad[0]!r} is not in the vocabulary")
    return not p, "; ".join(p) if p else f"{len(poses)} pose sheets read, {n} breakdown kinds and key intents are vocabulary terms"


CHECKS = [("vocabulary", check_vocabulary), ("overrides", check_overrides), ("facets", check_facets), ("proposals", check_proposals),
          ("rulings", check_rulings), ("poses", check_poses), ("materials", check_materials)]


# ---------- control: planted faults that must be refused, and clean fixtures that must be accepted ----------
def run_control(vocab, ov, parsed_sample):
    idx = index(vocab, ov)
    ctx = {"idx": idx, "ov": ov}
    clean_card = {"samurai-jack-holds"}
    raw_ok = "- D100, owner, 2026-10-18: set the cloak drag to float because drape (ref samurai-jack-holds) (closes p005)"
    raw_bad = "- D101, owner, 2026-10-18: set the cloak drag to float because vibey (ref samurai-jack-holds) (closes p005)"
    ruled = parse_rulings([raw_ok, raw_bad])
    v_lost = copy.deepcopy(vocab)
    v_lost["domains"]["shot"]["move"] = [m for m in v_lost["domains"]["shot"]["move"] if m != "whip"]
    ov_bad = copy.deepcopy(ov) if ov else {"schema": "animation-direction.overrides.1", "aliases": {}, "terms": {}}
    ov_bad.setdefault("aliases", {})["gentle gag"] = ["zesty"]
    asks = {"p900": {"id": "p900", "kind": "owner-ask", "intent": "close", "options": ["close", "wide"]}}
    cases = [
        ("proposal intent 'vibey'", False, check_proposals(vocab, proposals={"p900": {"id": "p900", "kind": "change", "intent": "vibey"}}, **ctx)),
        ("proposal option 'zesty'", False, check_proposals(vocab, proposals={"p900": {"id": "p900", "kind": "owner-ask", "intent": "close", "options": ["close", "zesty"], "default": "close"}}, **ctx)),
        ("owner-ask with no default", False, check_proposals(vocab, proposals=asks, **ctx)),
        ("ruling 'because vibey'", False, check_rulings(vocab, parsed=[ruled[1]], cards=clean_card, **ctx)),
        ("ruling citing card 'no-such-card'", False, check_rulings(vocab, parsed=[dict(ruled[0], refs=["no-such-card"])], cards=clean_card, **ctx)),
        ("materials intent 'bouncy'", False, check_materials(vocab, materials={"materials": {"cloth": {"intent": "bouncy"}}}, **ctx)),
        ("materials intent 'warm' (a register, not a material intent)", False, check_materials(vocab, materials={"materials": {"cloth": {"intent": "warm"}}}, **ctx)),
        ("pose breakdown kind 'wobbly'", False, check_poses(vocab, poses={"s": {"breakdowns": [{"between": ["a", "b"], "kind": "wobbly"}], "keys": []}}, **ctx)),
        ("facet word 'zany'", False, check_facets(vocab, facet_words={"camera.angle": ["eye", "zany"]}, **ctx)),
        ("vocabulary without 'whip'", False, check_vocabulary(v_lost)),
        ("alias to a term the vocabulary lacks", False, check_overrides(vocab, idx=index(vocab, ov_bad), ov=ov_bad, light=None)),
        ("clean proposal intent 'wide'", True, check_proposals(vocab, proposals={"p900": {"id": "p900", "kind": "change", "intent": "wide"}}, **ctx)),
        ("clean owner-ask", True, check_proposals(vocab, proposals={"p900": {"id": "p900", "kind": "owner-ask", "intent": "close", "options": ["close", "wide"], "default": "wide"}}, **ctx)),
        ("clean ruling 'because drape'", True, check_rulings(vocab, parsed=[ruled[0]], cards=clean_card, **ctx)),
        ("clean materials intent 'drape'", True, check_materials(vocab, materials={"materials": {"cloth": {"intent": "drape"}}}, **ctx)),
        ("clean pose breakdown kind 'passing'", True, check_poses(vocab, poses={"s": {"breakdowns": [{"between": ["a", "b"], "kind": "passing"}], "keys": []}}, **ctx)),
    ]
    out, bad = [], []
    for label, want_ok, (ok, _text) in cases:
        right = ok == want_ok
        out.append(f"{label} -> {'accepted' if ok else 'refused'}{'' if right else ' (WRONG)'}")
        if not right:
            bad.append(label)
    return out, bad


def read_dir_json(path):
    if not os.path.isdir(path):
        return None
    out = {}
    for f in sorted(os.listdir(path)):
        if f.endswith(".json"):
            d = load(os.path.join(path, f), "a file in " + path)
            out[d.get("id", f[:-5])] = d
    return out


def facet_words_from(source, card_schema):
    """FACET_VOCAB from eagle_board.py read as a literal (never imported) merged with the project's card-schema vocab; None when neither is readable."""
    words, found = {}, False
    if source and os.path.isfile(source):
        try:
            tree = ast.parse(open(source, encoding="utf8").read())
            for node in tree.body:
                if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "FACET_VOCAB" for t in node.targets):
                    words.update(ast.literal_eval(node.value))
                    found = True
        except (OSError, ValueError, SyntaxError) as e:
            die(f"cannot read FACET_VOCAB from {source}: {e}")
    if card_schema and os.path.isfile(card_schema):
        words.update(load(card_schema, "the card schema").get("vocab", {}))
        found = True
    return {k: v for k, v in words.items() if v} if found else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    j = lambda *a: os.path.join(ROOT, *a)
    ap.add_argument("vocabulary")
    ap.add_argument("--overrides", default=None)
    ap.add_argument("--proposals", default=j("v3", "proposals"))
    ap.add_argument("--rulings", default=j("v3", "rulings.json"))
    ap.add_argument("--materials", default=j("v3", "materials.json"))
    ap.add_argument("--poses", default=j("v3", "poses"))
    ap.add_argument("--light", default=j("v3", "light.json"))
    ap.add_argument("--cards", default=j("v3", "references", "board.json"))
    ap.add_argument("--card-schema", default=j("v3", "references", "owner", "card-schema.json"))
    ap.add_argument("--facet-source", default=os.path.expanduser("~/.claude/skills/inspiration/scripts/eagle_board.py"))
    ap.add_argument("--root", default=ROOT)
    a = ap.parse_args()

    vocab = load(a.vocabulary, "the vocabulary")
    ov = load(a.overrides, "the overrides") if a.overrides else None
    if not isinstance(vocab, dict) or "domains" not in vocab or "terms" not in vocab:
        die(f"{a.vocabulary} has no domains or terms, so there is no vocabulary to check words against")

    out, bad = run_control(vocab, ov, None)
    print("control: " + "; ".join(out), flush=True)
    if bad:
        print("refused: the probe was wrong about " + ", ".join(bad) + ", so a pass from it would mean nothing", flush=True)
        sys.exit(2)

    idx = index(vocab, ov)
    proposals = read_dir_json(a.proposals)
    poses = read_dir_json(a.poses)
    rulings_file = load(a.rulings, "the rulings") if os.path.isfile(a.rulings) else None
    parsed = parse_rulings([r["raw"] for r in rulings_file]) if rulings_file else None
    materials = load(a.materials, "the materials") if os.path.isfile(a.materials) else None
    light = load(a.light, "the light script") if os.path.isfile(a.light) else None
    cards = None
    if os.path.isfile(a.cards):
        cards = set()
        stack = [load(a.cards, "the board")]
        while stack:
            o = stack.pop()
            if isinstance(o, dict):
                if isinstance(o.get("id"), str):
                    cards.add(o["id"])
                stack.extend(o.values())
            elif isinstance(o, list):
                stack.extend(o)
    facet_words = facet_words_from(a.facet_source, a.card_schema)
    ctx = dict(idx=idx, ov=ov, light=light, facet_words=facet_words, proposals=proposals, parsed=parsed, cards=cards, materials=materials, poses=poses)

    failed = []
    for name, fn in CHECKS:
        ok, text = fn(vocab, **ctx)
        if name == "materials" and materials is None:
            text = "materials: no file yet"
            print(f"  ok   {text}", flush=True)
            continue
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {text}", flush=True)
        if not ok:
            failed.append((name, text))
    if failed:
        print("refused: " + "; ".join(f"{n}: {t}" for n, t in failed) + " - replace a refused word with a term of the vocabulary; do not edit the vocabulary to pass", flush=True)
        sys.exit(1)
    print(f"pass: {len(vocab['terms'])} vocabulary terms, {len((ov or {}).get('terms') or {})} film words and {len((ov or {}).get('aliases') or {})} register phrases; every intent word in the proposals, rulings, pose sheets and materials that exist resolves", flush=True)


if __name__ == "__main__":
    main()
