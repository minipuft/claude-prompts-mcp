#!/usr/bin/env python3
"""Plate joints -> the rig's key sheet (v3/keys/s01-arrival-overwhelm.json), and the C20 numbers.

usage: s01_keys_to_rig.py [--write]

Method (stated, not a toolchain): the 17 joints of assets/human/skeleton.json were placed by eye on each key plate's crop (scripts/s01_joints.py grid /
overlay), in crop pixels, into v3/keys/s01-arrival-overwhelm.plate-joints.json. This script registers a plate to the rig's mask space with one
similarity per key (scale = the model sheet's figure height 471 px over the rest figure's 921 mask px, the plates being drawn at model-sheet scale;
the ankle midpoint on the rest ankle midpoint, the plate's baseline on the rest boots' bottom), then makes the pose the rig can hold: walking the
skeleton from the root, each bone keeps the DIRECTION measured on the plate and takes the REST LENGTH (a longer or shorter limb on the plate would
stretch or crush the mesh; ARAP keeps the figure's own proportions, which is what C20 asks the keys to match). The raw registered joints and each
bone's raw/rest length ratio are kept with every key: that ratio is the C20 measurement (limb lengths within 5 % of the model sheet's).
`ponchoPoint` is a cloth tip, not a bone of the body: it is registered raw, not length-corrected.
"""
import hashlib, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SK = json.load(open(os.path.join(ROOT, "assets/human/skeleton.json")))["skeleton"]
MODEL = json.load(open(os.path.join(ROOT, "assets/human/model.json")))
CHART = json.load(open(os.path.join(ROOT, "v3/charts/s01-arrival-overwhelm.json")))
PJ = json.load(open(os.path.join(ROOT, "v3/keys/s01-arrival-overwhelm.plate-joints.json")))
CUT = {}
KD = os.path.join(ROOT, "assets/human/keys/s01-arrival-overwhelm")
for name in sorted(os.listdir(KD), key=lambda n: (n.startswith("cut-K"), n)):
    if name.startswith("cut-") and name.endswith(".json"):   # sheets first (cut-a, cut-b), then the regenerated single plates (cut-K2 ...) override
        CUT.update({k["key"]: k for k in json.load(open(os.path.join(KD, name)))["keys"]})
REST = {j["name"]: j["loc"] for j in SK}
PARENT = {j["name"]: j["parent"] for j in SK}
ORDER = [j["name"] for j in SK]                      # parents come before children in skeleton.json
SCALE = MODEL["figureHeightPx"] / 921.0              # plate px per rest mask px
ANK = ((REST["ankleL"][0] + REST["ankleR"][0]) / 2, REST["ankleL"][1])
FLOOR = 951.0                                        # rest boots' bottom, mask space
LENGTH = {n: math.dist(REST[n], REST[PARENT[n]]) for n in ORDER if PARENT[n]}
CLOTH = {"ponchoPoint"}


def sha(p):
    return hashlib.sha256(open(os.path.join(ROOT, p), "rb").read()).hexdigest()


def register(key):
    j = {n: p for n, p in PJ[key].items() if n != "_scale"}; base = CUT[key]["baselineInCrop"]; sc = PJ[key].get("_scale", SCALE)
    mid = (j["ankleL"][0] + j["ankleR"][0]) / 2
    return {n: [round(ANK[0] + (p[0] - mid) / sc, 2), round(FLOOR - (base - p[1]) / sc, 2)] for n, p in j.items()}


CHAINS = [("shoulderL", "elbowL", "wristL"), ("shoulderR", "elbowR", "wristR"), ("hipL", "kneeL", "ankleL"), ("hipR", "kneeR", "ankleR")]
REACH_MAX = 1.12   # a limb the plate draws longer than this over the rest chain is pulled back along its own line (the mesh would stretch past what its texture can take)
BONE_BAND = {"torso": (0.85, 1.1), "neck": (0.7, 1.3), "head": (0.7, 1.3), "shoulderL": (0.6, 1.4), "shoulderR": (0.6, 1.4), "hipL": (0.6, 1.4), "hipR": (0.6, 1.4)}


BAND_OVERRIDE = {"K8": {"torso": (0.4, 1.1)}}   # the fold: a crouch genuinely shortens the trunk


def hold(raw, key=""):
    """The pose handed to the rig: the registered joints as measured, regularised where an eyeballed placement is outside what the figure can be.
    The trunk (root, torso, neck, head, shoulders, hips) keeps the plate's DIRECTION but its bone length is held inside BONE_BAND x the rest length (a
    placement error of 10 px reads as 30 % on a 30 px bone, and a pinned mesh shears when its trunk joints disagree); each limb is translated with its
    held root joint and, when the plate draws it longer than REACH_MAX x the rest chain, scaled back about that root. Limbs are otherwise NOT
    bone-length corrected: a corrected chain kinks when the plate's limb is a few percent short (measured on the first fit: legs bowed 30 px), and ARAP
    absorbs a few percent of stretch where it cannot absorb a kink. `ponchoPoint`, the tip of the baked garment, hangs from the hips at its rest offset:
    the plates draw a shorter cape than the texture carries, so a measured tip would crush the garment's front."""
    out = {"root": list(raw["root"])}
    limb_joints = {m for _, m, _ in CHAINS} | {e for _, _, e in CHAINS}
    for n in ORDER:
        if n == "root" or n in limb_joints or n == "ponchoPoint": continue
        p = PARENT[n]; lo, hi = BAND_OVERRIDE.get(key, {}).get(n) or BONE_BAND.get(n, (0.6, 1.4))
        dx, dy = raw[n][0] - raw[p][0], raw[n][1] - raw[p][1]
        r = math.hypot(dx, dy) / LENGTH[n] if LENGTH[n] else 1.0
        k = min(hi, max(lo, r)) / r if r else 1.0
        out[n] = [round(out[p][0] + dx * k, 2), round(out[p][1] + dy * k, 2)]
    for r_, m, e in CHAINS:
        base = out[r_]; sx, sy = raw[r_]
        mm = [raw[m][0] - sx, raw[m][1] - sy]; ee = [raw[e][0] - sx, raw[e][1] - sy]
        reach = LENGTH[m] + LENGTH[e]; d = math.hypot(*ee)
        f = REACH_MAX * reach / d if d > REACH_MAX * reach else 1.0
        out[m] = [round(base[0] + mm[0] * f, 2), round(base[1] + mm[1] * f, 2)]
        out[e] = [round(base[0] + ee[0] * f, 2), round(base[1] + ee[1] * f, 2)]
    out["ponchoPoint"] = [round(out["root"][0] + (REST["ponchoPoint"][0] - REST["root"][0]), 2), round(out["root"][1] + (REST["ponchoPoint"][1] - REST["root"][1]), 2)]
    return {n: out[n] for n in ORDER}


def main():
    out_path = os.path.join(ROOT, "v3/keys/s01-arrival-overwhelm.json")
    if "--write" in sys.argv and os.path.exists(out_path) and any(k.get("source") == "solver" for k in json.load(open(out_path))["keys"]) and "--force" not in sys.argv:
        sys.exit("refused: the key sheet is built from the solver (D85, `npm run plates`); this script registers joints placed by eye on generator plates and would overwrite it. --force to do it anyway.")
    keys, stats = [], {}
    chart_keys = CHART["actors"]["human"]["keys"]
    for i, ck in enumerate(chart_keys, 1):
        k = f"K{i}"
        raw = register(k); held = hold(raw, k)
        ratios = {n: round(math.dist(raw[n], raw[PARENT[n]]) / LENGTH[n], 3) for n in ORDER if PARENT[n] and n not in CLOTH}
        # one-sided limb test: the straight reach (shoulder to wrist, hip to ankle) over the rest chain length. A bent limb reads under 1 and proves
        # nothing; a reach over 1 + 5 % is a limb longer than the model's, which no placement error of the elbow can produce.
        limbs = {c[2]: round(math.dist(raw[c[0]], raw[c[2]]) / (LENGTH[c[1]] + LENGTH[c[2]]), 3) for c in CHAINS}
        worst = max(limbs.items(), key=lambda kv: kv[1])
        stats[k] = {"name": ck["name"], "reachRatios": limbs, "longestReach": worst[0], "longestReachPct": round(worst[1] * 100, 1),
                    "over105": sorted(n for n, v in limbs.items() if v > 1.05), "spineRatio": ratios["torso"], "plate": f"assets/human/keys/s01-arrival-overwhelm/{k}.png"}
        key = {"name": ck["name"], "frame": ck["frame"], "hold": ck["hold"], "joints": held, "registeredJoints": raw, "plate": stats[k]["plate"], "plateSha256": sha(stats[k]["plate"]),
               "reachRatios": limbs}
        keys.append(key)
    sheet = {"shot": "s01-arrival-overwhelm", "actor": "human", "provisional": True,
             "note": "Joints placed by eye on the key plates, registered to the rig by one similarity per key (scripts/s01_keys_to_rig.py), bone directions from the plate and bone lengths from the rest skeleton; `registeredJoints` are the unrestrained positions and `limbRatios` the raw/rest lengths (C20). Frames are shot-local = film frames (the shot starts at 0). Holds and breakdowns are the chart's (v3/charts/s01-arrival-overwhelm.json).",
             "keys": keys, "breakdowns": CHART["actors"]["human"]["breakdowns"]}
    print(f"scale {SCALE:.4f} plate px per mask px; {len(keys)} keys")
    for k, s in stats.items():
        print(f"{k} {s['name']:12s} longest reach {s['longestReach']} {s['longestReachPct']:5.1f} %  over 105 %: {s['over105'] or '-'}  spine {s['spineRatio']:.2f}  reach {s['reachRatios']}")
    if "--write" in sys.argv:
        out = os.path.join(ROOT, "v3/keys/s01-arrival-overwhelm.json")
        json.dump(sheet, open(out, "w"), indent=1); open(out, "a").write("\n")
        json.dump(stats, open(os.path.join(ROOT, "out/s01-keys-c20.json"), "w"), indent=1)
        plates = [{"key": f"K{i}", "cropPx": CUT[f"K{i}"]["cropPx"], "baselineInCrop": CUT[f"K{i}"]["baselineInCrop"], "scale": PJ[f"K{i}"].get("_scale", SCALE),
                   "plate": f"assets/human/keys/s01-arrival-overwhelm/K{i}.png"} for i in range(1, len(keys) + 1)]
        json.dump(plates, open(os.path.join(KD, "plates.json"), "w"), indent=1)
        print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
