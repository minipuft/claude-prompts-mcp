#!/usr/bin/env python3
"""Marks each key of v3/keys/s01-arrival-overwhelm.json accepted or rejected by what `probe-poses.py --joints keys` measures, and prints the per-key table.

usage: s01_keys_status.py [--write]

Per key: the class and bow the spine fit reads (against the declared class and bow), twinning, and whether the root sits over the declared weight foot. A key with a
failing line-of-action, twinning or weight item is `rejected` with the probe's reasons in `rejectedFor`; a key that passes the probe but whose spine bows the other way, or more than 0.02 under the declared bow (the step prompt's own rule, not a probe check), carries `flags` for the owner; --write stores `status` and `rejectedFor` on the key. Run it
after a key was regenerated once: a second failure stays rejected on the sheet for the owner.
"""
import importlib.util, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "animation"))
spec = importlib.util.spec_from_file_location("pp", os.path.join(HERE, "animation/probe-poses.py")); pp = importlib.util.module_from_spec(spec); spec.loader.exec_module(pp)
from probe_common import spine_curve, twinning_score

poses = json.load(open(os.path.join(ROOT, "v3/poses/s01-arrival-overwhelm.json"))); kp = os.path.join(ROOT, "v3/keys/s01-arrival-overwhelm.json"); keys = json.load(open(kp))
chart = json.load(open(os.path.join(ROOT, "v3/charts/s01-arrival-overwhelm.json")))
res = pp.check_shot(poses, keys, chart, "keys")
print(f"{'key':12s} {'declared':14s} {'measured':22s} {'twin':>5s}  status")
for p, k in zip(poses["keys"], keys["keys"]):
    bad = [t for cat in ("line of action", "twinning", "weight") for item, ok, t in res[cat] if not ok and re.match(re.escape(p["name"]) + r"(/|$)", item)]
    got = spine_curve(k["joints"], poses["heightPx"]); l = p["lineOfAction"]
    print(f"{p['name']:12s} {l['class'] + ' ' + format(l['bow'], '.2f') + ' ' + format(l['sign'], '+d'):14s} {got['class'] + ' ' + format(got['bow'], '.3f') + ' ' + format(got['sign'], '+d'):22s} {twinning_score(k['joints']):5.2f}  {'REJECTED: ' + '; '.join(b.split(': ', 1)[-1] for b in bad) if bad else 'accepted'}")
    flags = ([f"the spine bows {'right' if got['sign'] > 0 else 'left'}, the declaration {'right' if l['sign'] > 0 else 'left'}"] if got["sign"] != l["sign"] and got["bow"] >= 0.03 else []) + \
            ([f"measured bow {got['bow']:.3f} is more than 0.02 under the declared {l['bow']:.2f}"] if l["bow"] - got["bow"] > 0.02 and not bad else [])
    k["status"] = "rejected" if bad else "accepted"; k["rejectedFor"] = [b.split(": ", 1)[-1] for b in bad]; k["flags"] = flags
    if not bad: del k["rejectedFor"]
    if not flags: del k["flags"]
    if flags: print(f"{'':12s} flag: {'; '.join(flags)}")
if "--write" in sys.argv:
    json.dump(keys, open(kp, "w"), indent=1); open(kp, "a").write("\n"); print("wrote", os.path.relpath(kp, ROOT))
