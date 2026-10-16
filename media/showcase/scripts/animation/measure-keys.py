#!/usr/bin/env python3
"""Measures a shot's key plates on what the prompts contract (rubric C20, C21, C22, C31) and writes it per key into v3/keys/<shot>.json (`measured`) and out/<shot>-keys-table.txt.

usage: measure-keys.py <shot-id> [--no-write]        exit 0 every key has a plate and passes, 1 a key fails or needs a family, 2 a control did not trip

C20  head count and limb ratios against the model sheet, within 5 %. For a plate the solver built these are read off the posed mesh (render-plates.py stores the local scale of
     the triangles under the head and each limb: the length ratio the mesh draws against the family plate at the model sheet's scale); headCount = model.json heads / head scale.
     The key joints' own chains (shoulder-elbow-wrist, hip-knee-ankle) over the family's rest chains are listed beside them. A key without a plate has no C20.
C21  the silhouette filled black: one 8-connected component (scripts/measure-silhouette.py runs on the filled frames and its lines are printed), and, for a silhouette kind that
     declares its limbs apart (open, star, line), wrists at least 0.10 of the figure height from the spine (open and line: one, star: both). Closed and fold keys are compact by declaration.
C22  contour = twice the mean half-width of the thin pale structures (the key sheets' own measure, s01_keys_measure.contour_width), against the same measure on the model sheet's
     turnaround figures within 20 % (the plates stand at the model sheet's scale, so the same figure height; model.json's 2.83 is a coarser median of the same thing). Control first: the measure reads the model sheet's own figure as the model
     value and reads the same plate with its pale lines thickened by one pixel outside the band.
C31  probe-poses.py's per-key line-of-action, twinning and weight checks on the key sheet's joints, with the class, bow, sign and twinning score read.
rig  for a plate drawn by a parts rig (render.rig = "parts", plates-from-poses.mjs): the worst tear metrics over the parts (each part's own mesh: inverted, strained, overlap), the draw order the
     key used and why a limb is in front, and the hinge measure at the shoulders, elbows and knees (parts_tools.joint_fill: the disc one contour width wide about the joint is drawn, and the part
     in front fades over the part behind across at least half a contour width). A key whose joints fail the hinge measure is REJECTED: JOINTS. The control of render-plates.py names the joints of a
     composite with its overlap removed.
Writes out/<shot>-keys-silhouettes/element-NN.png (filled silhouettes) and out/<shot>-keys-silhouettes.png (contact sheet).
"""
import importlib.util, json, math, os, re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(ROOT, "scripts"))
from probe_common import spine_curve, twinning_score
import plate_tools as pt
import film_compare as fc
from plate_tools import model_scale, model_figure, contour_px, model_contour

spec = importlib.util.spec_from_file_location("pp", os.path.join(HERE, "probe-poses.py")); pp = importlib.util.module_from_spec(spec); spec.loader.exec_module(pp)

TOL_C20, TOL_C22, APART_H = 0.05, 0.20, 0.10
APART_KINDS = {"open": 1, "star": 2, "line": 1}      # wrists the silhouette kind needs clear of the spine; closed and fold are compact by declaration


def thickened(rgb, fg):
    """The plate with every pale pixel grown by two pixels."""
    mx = rgb.max(axis=2).astype(int); mn = rgb.min(axis=2).astype(int)
    pale = ndi.binary_dilation((mx > 170) & ((mx - mn) < 90) & fg, iterations=2)
    out = rgb.copy(); out[pale & fg] = (231, 228, 218); return out


def contour_control(model, crop_rgb):
    """(ok, text, standard): the three turnaround figures of the model sheet read within 20 % of each other by the measure, and the same plate with its pale lines grown by two pixels reads
    outside the band around their mean."""
    std, each = model_contour(model)
    thick = contour_px(thickened(crop_rgb, crop_rgb.max(axis=2) > 28))
    ok = all(abs(v - std) <= TOL_C22 * std for v in each) and abs(thick - std) > TOL_C22 * std
    return ok, (f"the model sheet's three figures read {', '.join(f'{v:.2f}' for v in each)} px (mean {std:.2f}; model.json records {model['contour']['measuredPx']} by model_measure's coarser median); "
                f"the same plate with its pale lines grown by two pixels reads {thick:.2f} px (band {std * (1 - TOL_C22):.2f}-{std * (1 + TOL_C22):.2f})"), std


def silhouette(rgba):
    a = rgba[..., 3] >= 128
    lab, n = ndi.label(a, structure=np.ones((3, 3)))
    sizes = ndi.sum(a, lab, range(1, n + 1)) if n else []
    comps = int((np.array(sizes) >= 12).sum()) if n else 0
    import cv2
    pts = np.column_stack(np.nonzero(a))[:, ::-1].astype(np.int32)
    hull = cv2.contourArea(cv2.convexHull(pts)) if len(pts) > 2 else 1.0
    return a, comps, float(a.sum() / max(1.0, hull))


def to_plate(p, info):
    return ((p[0] - info["originMask"][0]) * info["scale"], (p[1] - info["originMask"][1]) * info["scale"])


def apart(joints, H):
    """Both wrists' distance from the spine polyline (root, torso, neck, head) over the figure height."""
    spine = [np.array(joints[n], float) for n in ("root", "torso", "neck", "head")]
    def d(p):
        p = np.array(p, float); best = 1e9
        for a, b in zip(spine, spine[1:]):
            ab = b - a; t = float(np.clip((p - a) @ ab / (ab @ ab), 0, 1)); best = min(best, float(np.hypot(*(p - (a + t * ab)))))
        return best / H
    return {"wristL": round(d(joints["wristL"]), 3), "wristR": round(d(joints["wristR"]), 3)}


def contact_sheet(tiles, names, path):
    h = max(t.shape[0] for t in tiles) + 34; w = sum(t.shape[1] for t in tiles) + 16 * (len(tiles) + 1)
    sheet = Image.new("RGB", (w, h), (236, 232, 222)); d = ImageDraw.Draw(sheet); x = 16
    for t, n in zip(tiles, names):
        im = Image.fromarray(np.where(t[..., None], 12, 236).astype(np.uint8).repeat(3, axis=2), "RGB")
        sheet.paste(im, (x, h - 24 - t.shape[0])); d.text((x, h - 20), n, fill=(40, 40, 50)); x += t.shape[1] + 16
    sheet.save(path)


def main():
    shot = sys.argv[1]; write = "--no-write" not in sys.argv
    kp = os.path.join(ROOT, "v3/keys", f"{shot}.json"); keys = json.load(open(kp))
    poses = json.load(open(os.path.join(ROOT, "v3/poses", f"{shot}.json"))); chart = json.load(open(os.path.join(ROOT, "v3/charts", f"{shot}.json")))
    model = json.load(open(os.path.join(ROOT, "assets/human/model.json"))); H = poses["heightPx"]
    out_dir = os.path.join(ROOT, "out"); sil_dir = os.path.join(out_dir, f"{shot}-keys-silhouettes"); os.makedirs(sil_dir, exist_ok=True)
    scale = model_scale()
    # controls first
    home_rest = os.path.join(ROOT, "assets/human/families/home/plate.png")
    probe_crop = None
    for k in keys["keys"]:
        if k.get("plate"): probe_crop = np.asarray(Image.open(os.path.join(ROOT, k["plate"].replace(".png", "-crop.png"))).convert("RGB")); break
    lines = []
    if probe_crop is not None:
        ok, text, std = contour_control(model, probe_crop); lines.append(f"control C22: {text}")
        if not ok: print("\n".join(lines)); print("refused: the contour measure did not trip its control"); sys.exit(2)
    else: std = model_contour(model)[0]
    # the film control: the film rig's picture of one key with the draw order of one hand swapped must be named by the plate-versus-film measure
    swap = re.search(r"SWAP: [^=]*= \{key: (\d+), parts: \[([^\]]+)\]\}", open(os.path.join(ROOT, "src/scenes/KeyFilmS01.tsx")).read())
    if swap and any(k.get("plate") for k in keys["keys"]):
        sk = keys["keys"][int(swap.group(1)) - 1]
        if sk.get("plate"):
            plate_sk = np.asarray(Image.open(os.path.join(ROOT, sk["plate"])).convert("RGBA"))
            ctl = fc.compare_key(plate_sk, fc.film_frame(shot, len(keys["keys"])), sk["plateInfo"], sk["joints"], std)
            clean = fc.compare_key(plate_sk, fc.film_frame(shot, int(swap.group(1)) - 1), sk["plateInfo"], sk["joints"], std)
            lines.append(f"control FILM: key {sk['name']}: film rig as drawn -> mad {clean['mad']}, worst centroid {clean['worstPart']} {clean['worstPx']} px (pass {clean['pass']}); with {swap.group(2).replace(chr(39), '')} exchanging their places in the draw order -> mad {ctl['mad']} (bar {fc.MAD_BAR}), worst centroid {ctl['worstPart']} {ctl['worstPx']} px (bar {ctl['bar']['centroidPx']}) -> {'named' if not ctl['pass'] else 'NOT NAMED'}")
            if ctl["pass"] or not clean["pass"]: print("\n".join(lines)); print("refused: the plate-versus-film measure did not trip its control"); sys.exit(2)
    res = pp.check_shot(poses, keys, chart, "keys")
    skel = json.load(open(os.path.join(ROOT, "assets/human/families/home/joints.json")))["joints"]
    chains = {"armL": ("shoulderL", "elbowL", "wristL"), "armR": ("shoulderR", "elbowR", "wristR"), "legL": ("hipL", "kneeL", "ankleL"), "legR": ("hipR", "kneeR", "ankleR")}
    chain_len = lambda j, c: sum(math.dist(j[a], j[b]) for a, b in zip(c, c[1:]))
    rows, tiles, names = [], [], []
    for i, (p, k) in enumerate(zip(poses["keys"], keys["keys"]), 1):
        j = k["joints"]; got = spine_curve(j, H); l = p["lineOfAction"]; tw = twinning_score(j)
        bad = [t for cat in ("line of action", "twinning", "weight") for item, ok, t in res[cat] if not ok and re.match(re.escape(p["name"]) + r"(/|$)", item)]
        c31 = {"declared": f"{l['class']} {l['bow']:.2f} {l['sign']:+d}", "read": {"class": got["class"], "bow": round(got["bow"], 3), "sign": got["sign"]}, "twinning": round(tw, 2), "pass": not bad, "refused": [b.split(": ", 1)[-1] for b in bad]}
        m = {"c31": c31}
        chain = {n: round(chain_len(j, c) / chain_len(skel, c), 3) for n, c in chains.items()}
        if k.get("plate"):
            rgba = np.asarray(Image.open(os.path.join(ROOT, k["plate"])).convert("RGBA")); crop = np.asarray(Image.open(os.path.join(ROOT, k["plate"].replace(".png", "-crop.png"))).convert("RGB"))
            ps = k["render"]["partScales"]; head = ps["head"]
            limbs = {n: ps[n] for n in chains}
            worst = max([abs(head - 1)] + [abs(v - 1) for v in limbs.values()])
            m["c20"] = {"headScale": head, "headCount": round(model["heads"] / head, 2), "limbScales": limbs, "jointChains": chain, "worstDevPct": round(worst * 100, 1), "pass": worst <= TOL_C20}
            a, comps, solid = silhouette(rgba); info = k["plateInfo"]; fig_h = H * info["scale"]
            wr = apart({n: to_plate(q, info) for n, q in j.items()}, fig_h)
            need = APART_KINDS.get(p["silhouette"], 0); apart_n = sum(v >= APART_H for v in wr.values())
            m["c21"] = {"components": comps, "solidity": round(solid, 2), "wristsFromSpineH": wr, "kind": p["silhouette"], "wristsApartRequired": need, "wristsApart": apart_n,
                        "pass": comps == 1 and apart_n >= need}
            cw = contour_px(crop); m["c22"] = {"contourPx": cw, "targetPx": std, "vsModelPct": round(100 * (cw / std - 1), 1), "pass": abs(cw - std) <= TOL_C22 * std}
            Image.fromarray(np.where(a[..., None], 12, 236).astype(np.uint8).repeat(3, axis=2), "RGB").save(os.path.join(sil_dir, f"element-{i:02d}.png"))
            tiles.append(a); names.append(f"K{i} {p['name']}")
            rend = k.get("render", {}); jf = rend.get("jointFill")
            if jf:
                m["joints"] = {"fill": min(v["fill"] for v in jf.values()), "fade": min(max(v["fade"], v.get("depth", 0)) for v in jf.values()), "pass": all(v["pass"] for v in jf.values()), "open": [j for j, v in jf.items() if not v["pass"]]}
            m["film"] = fc.compare_key(rgba, fc.film_frame(shot, i - 1), info, j, std)
            checks = [c for c in ("c20", "c21", "c22", "c31", "joints", "film") if c in m]
            passed = all(m[c]["pass"] for c in checks)
            m["verdict"] = "accepted" if passed else "REJECTED: " + ", ".join(c.upper() for c in checks if not m[c]["pass"])
        else:
            m["c20"] = {"jointChains": chain, "pass": None}; m["verdict"] = f"NEEDS FAMILY {k['needsFamily']['family']} ({k['needsFamily']['silhouette']})"
        k["measured"] = m
        rows.append((i, p, k, m))
    # the existing silhouette script on the filled frames, control included
    sil = subprocess.run([sys.executable, os.path.join(ROOT, "scripts/measure-silhouette.py"), sil_dir], capture_output=True, text=True)
    sil_lines = [l for l in (sil.stdout + sil.stderr).strip().splitlines() if l]
    if tiles: contact_sheet(tiles, names, os.path.join(out_dir, f"{shot}-keys-silhouettes.png"))
    # the table
    fmt = lambda x: "n/a" if x is None else x
    head = f"{'key':6s}{'name':12s}{'family':8s}{'source':8s}{'C20 head/limbs (worst dev)':34s}{'C21 comps/solid/wrists':26s}{'C22 contour':18s}{'C31 class bow sign twin':26s} verdict"
    table = [f"keys table · {shot} · {len(rows)} keys · model sheet scale {scale:.4f} plate px per mask px", *lines, *[f"silhouette script: {l}" for l in sil_lines], head]
    rig_rows = []
    for i, p, k, m in rows:
        c20, c21, c22, c31 = m.get("c20", {}), m.get("c21"), m.get("c22"), m["c31"]
        rend = k.get("render") or {}
        if rend.get("rig"):
            hold, wp, dep = rend["hold"], rend["worstParts"], rend.get("depths", {})
            front = ", ".join(f"{n}:{d['reason']}" for n, d in dep.items() if d.get("front")) or "none"
            fm = m["film"]; film_t = f"film mad {fm['mad']:.1f} worst {fm['worstPart']} {fm['worstPx']:.2f}px" + ("" if fm["pass"] else " FAIL")
            rig_rows.append(f"K{i:<5d}{p['name']:12s}{'parts':8s}{'worst inverted ' + format(hold['inverted'] * 100, '.2f') + '% ' + str(wp['inverted']):34s}{'strained ' + format(hold['strained'] * 100, '.2f') + '% ' + str(wp['strained']):30s}{'overlap ' + format(hold['overlap'] * 100, '.2f') + '%':18s}"
                            f"{'joints fill ' + format(m['joints']['fill'], '.2f') + ' overlap ' + format(m['joints']['fade'], '.2f') + 'cw' + ('' if m['joints']['pass'] else ' OPEN ' + ','.join(m['joints']['open'])):38s} in front: {front}; order {' > '.join(rend['order'][:5])} ... | {film_t}")
        c20t = f"{c20['headCount']:.2f} heads / {'/'.join(f'{v:.2f}' for v in c20['limbScales'].values())} ({c20['worstDevPct']:.1f}%)" if "headCount" in c20 else "n/a (no plate)"
        c21t = f"{c21['components']}/{c21['solidity']:.2f}/{max(c21['wristsFromSpineH'].values()):.2f}" + ("" if c21["pass"] else " FAIL") if c21 else "n/a"
        c22t = f"{c22['contourPx']:.2f}px {c22['vsModelPct']:+.0f}%" + ("" if c22["pass"] else " FAIL") if c22 else "n/a"
        r = c31["read"]; c31t = f"{r['class']} {r['bow']:.3f} {r['sign']:+d} tw {c31['twinning']:.2f}" + ("" if c31["pass"] else " FAIL")
        table.append(f"K{i:<5d}{p['name']:12s}{(k.get('family') or '-'):8s}{k['source']:8s}{c20t:34s}{c21t:26s}{c22t:18s}{c31t:26s} {m['verdict']}")
    if rig_rows: table += ["", f"parts rig · per key: worst tear metric over the parts (limits inverted {pt.HOLD_LIMITS['inverted'] * 100:.0f}%, strained {pt.HOLD_LIMITS['strained'] * 100:.0f}%, overlap {pt.HOLD_LIMITS['overlap'] * 100:.0f}%), hinge measure at shoulders/elbows/knees (fill = share of the contour-width disc drawn, overlap = the fade or depth in contour widths), limbs in front and draw order", *rig_rows]
    open(os.path.join(out_dir, f"{shot}-keys-table.txt"), "w").write("\n".join(table) + "\n")
    print("\n".join(table))
    if write: json.dump(keys, open(kp, "w"), indent=1); open(kp, "a").write("\n"); print("wrote measured into", os.path.relpath(kp, ROOT))
    sys.exit(0 if all(m["verdict"] == "accepted" for _, _, _, m in rows) else 1)


if __name__ == "__main__": main()
