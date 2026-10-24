#!/usr/bin/env python3
"""The raster half of plates-from-poses.mjs: draws the key plates of a pose sheet from the family meshes the node half posed.

usage: render-plates.py <job.json> <result.json>
job = {"shot", "actor", "outDir", "items": [{"key", "number", "candidates": [{"family", "keySpace": {"scale", "translate"}, "posed": [x0, y0, x1, y1, ...]}]}]}
Per item the candidates are tried in order: the first whose posed mesh holds (plate_tools.HOLD_LIMITS: not turned inside out, not strained, no part drawn over another) is
rendered to <outDir>/K<number>.png (RGBA, role colours, soft alpha) and K<number>-crop.png (the same over a pure black field), and the item reports it. An item none of whose
candidates holds writes nothing: the result lists every candidate's metrics and the key is `needs-family`, never drawn anyway.
A candidate with `"rig": "parts"` is a parts rig (parts_tools.py): its items carry the posed vertices of every part, the draw order (front first), the flags each part's fade reads (`front`),
the posed bone vectors and the key's joints. Every part's own mesh is measured (inverted, strained, overlap: a limb across the torso is a part drawn over another part, which is what the order
holds, not a tear); it holds when every part holds. A drawn parts plate also carries the hinge measure at the shoulders, elbows and knees.
Control first: the rest pose of the home family holds, a rigid shift of it holds, and an arm folded across the torso (the vertices of one arm rotated 140 degrees about its shoulder)
does not (the single mesh); for the parts rig, the rest pose holds, a rigid shift of the parts holds, one part's vertices scrambled by a half turn does not, and the hinge measure reads a composite with
its overlap removed as open at the joints it names while the real parts fill them. The run refuses (exit 2) when a control does not trip.
"""
import hashlib, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plate_tools import *
from parts_tools import load_parts, part_metrics, render_parts, joint_fill, JOINT_PAIRS


def family_files(actor, family):
    d = os.path.join(ROOT, "assets", actor, "families", family)
    mesh = json.load(open(os.path.join(d, "mesh.json"))); meta = json.load(open(os.path.join(d, "joints.json")))
    return d, np.array(mesh["vertices"], float).reshape(-1, 2), np.array(mesh["triangles"], int).reshape(-1, 3), meta


def hold_control(actor):
    """(ok, text): the hold metrics see what they are for. Rest and a rigid shift hold; one arm turned 140 degrees across the torso does not."""
    _, rest, tris, meta = family_files(actor, "home")
    base = hold_metrics(rest, rest, tris)
    shifted = hold_metrics(rest, rest + np.array([37.0, -12.0]), tris)
    sh, el, wr = (np.array(meta["joints"][n], float) for n in ("shoulderL", "elbowL", "wristL"))
    arm = np.hypot(*(rest - sh).T) < 1e9
    d_bone = []
    for a, b in ((sh, el), (el, wr)):
        ab = b - a; t = np.clip(((rest - a) @ ab) / (ab @ ab), 0, 1); d_bone.append(np.hypot(*(rest - (a + t[:, None] * ab)).T))
    arm = (np.minimum(*d_bone) < 30) & (rest[:, 0] < sh[0] + 5) & (rest[:, 1] > sh[1] - 25) & (rest[:, 1] < wr[1] + 60)
    th = np.radians(-140.0); R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    folded = rest.copy(); folded[arm] = sh + (rest[arm] - sh) @ R.T
    bad = hold_metrics(rest, folded, tris)
    ok = holds(base) and holds(shifted) and not holds(bad) and base["inverted"] == 0 and base["overlap"] == 0
    return ok, (f"rest pose -> holds {base}; the same mesh shifted rigidly -> holds {shifted}; the left arm ({int(arm.sum())} vertices) turned 140 degrees across the torso -> refused {bad}; "
                f"limits {HOLD_LIMITS}")


def sha(path): return hashlib.sha256(open(path, "rb").read()).hexdigest()


def hard_cut(P):
    """The same parts with their overlap removed: each part is only its own cell (no slab, no cap) and nothing fades; a cutout hinge."""
    out = {"file": P["file"], "owners": P["owners"], "parts": {}}
    for n, p in P["parts"].items():
        own = (p["owners"] == p["spec"]["id"])
        rgba = p["rgba"].copy(); rgba[..., 3] = np.where(own, rgba[..., 3], 0)
        out["parts"][n] = {**p, "rgba": rgba, "ramp": np.zeros_like(p["ramp"])}
    return out


def bent_pose(joints, bend_deg=90.0):
    """`joints` with both forearms and both lower legs turned bend_deg about their elbows and knees (the arm below the elbow, the leg below the knee, and everything hung from it)."""
    th = math.radians(bend_deg); R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    out = {n: np.array(p, float) for n, p in joints.items()}
    for s, sign in (("L", 1), ("R", -1)):
        for top, rest_ in ((f"elbow{s}", [f"wrist{s}"]), (f"knee{s}", [f"ankle{s}"])):
            Rm = R if sign > 0 else R.T
            for n in rest_: out[n] = out[top] + Rm @ (out[n] - out[top])
    return out


def pose_parts(P, rig_rest, now):
    """Parts posed by the rigid motion of their bones, for the controls: every pin of a part at its joint's position plus the offset it had at rest turned by the bone, solved as the rig does,
    but by a closed form (a rigid transform of the part's own vertices) so the control needs no node: each part moves as one piece about its pivot joint by the bone's turn."""
    posed = {}
    for n, p in P["parts"].items():
        a, b = p["spec"]["bone"]; piv = p["spec"]["pivot"]
        t = math.atan2(*(now[b] - now[a])[::-1]) - math.atan2(*(rig_rest[b] - rig_rest[a])[::-1]); c, s_ = math.cos(t), math.sin(t)
        R = np.array([[c, -s_], [s_, c]])
        posed[n] = (p["rest"] - rig_rest[piv]) @ R.T + now[piv]
    return posed


def parts_control(actor):
    """(ok, text): the parts rig's tear metrics and hinge measure see what they are for."""
    P = load_parts(actor, "home"); meta = json.load(open(os.path.join(ROOT, "assets", actor, "families", "home", "joints.json")))
    rest_j = {n: np.array(p, float) for n, p in meta["joints"].items()}
    order = sorted(P["parts"], key=lambda n: -P["parts"][n]["spec"]["z"])
    ids = {n: P["parts"][n]["spec"]["id"] for n in order}
    def flags(n):
        f = np.zeros(len(order) + 1, np.uint8); f[0] = 1
        for m in order: f[ids[m]] = 1 if order.index(n) < order.index(m) else 0
        return f
    fr = {n: flags(n) for n in order}
    rest_posed = {n: p["rest"].copy() for n, p in P["parts"].items()}
    base = part_metrics(P, rest_posed, meta["joints"])
    shifted = part_metrics(P, {n: v + np.array([37.0, -12.0]) for n, v in rest_posed.items()}, meta["joints"])
    scrambled = {n: v.copy() for n, v in rest_posed.items()}
    c = scrambled["poncho"].mean(0); th = math.radians(150); R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    half = scrambled["poncho"][:, 0] > c[0]; scrambled["poncho"][half] = c + (scrambled["poncho"][half] - c) @ R.T
    bad = part_metrics(P, scrambled, meta["joints"])
    # the hinge measure on the real parts and on the same parts with their overlap removed, both bent 90 degrees at the elbows and knees
    now = bent_pose(rest_j); posed_b = pose_parts(P, rest_j, now)
    cut = hard_cut(P)
    contour = model_contour_px()
    res = {}; at_rest = {}
    for label, parts in (("real", P), ("cut", cut)):
        img, info, lay = render_parts(parts, posed_b, order, fr, model_scale(), keep_layers=True)
        res[label] = joint_fill(parts, img, info, now, order, lay, contour)
        img, info, lay = render_parts(parts, pose_parts(P, rest_j, rest_j), order, fr, model_scale(), keep_layers=True)
        at_rest[label] = joint_fill(parts, img, info, rest_j, order, lay, contour)
    bent_named = [j for j, v in res["cut"][0].items() if not v["pass"]]
    rest_named = [j for j, v in at_rest["cut"][0].items() if not v["pass"]]
    ov = lambda v: max(v["fade"], v["depth"])
    ok = (base["holds"] and shifted["holds"] and not bad["holds"] and res["real"][1] and at_rest["real"][1] and not res["cut"][1] and len(bent_named) >= 4 and len(rest_named) >= 5
          and all(not res["cut"][0][j]["pass"] and res["cut"][0][j]["fill"] < 1.0 for j in ("elbowL", "elbowR", "kneeL", "kneeR")))
    text = (f"parts rig: rest pose -> holds (worst inverted {base['worst']['inverted']['value']}, strained {base['worst']['strained']['value']}, overlap {base['worst']['overlap']['value']}); the parts shifted rigidly -> holds; "
            f"the poncho's right half turned 150 degrees -> refused ({ {k: (v['part'], v['value']) for k, v in bad['worst'].items()} }); "
            f"hinge measure, real parts at rest: every shoulder, elbow and knee disc filled with an overlap of at least {min(ov(v) for v in at_rest['real'][0].values())} contour widths, "
            f"bent 90 degrees at the elbows and knees: filled (min fill {min(v['fill'] for v in res['real'][0].values())}); "
            f"the same parts with their overlap removed, at rest -> straight seam named at " + ", ".join(f"{j} (overlap {ov(at_rest['cut'][0][j])})" for j in rest_named)
            + "; bent 90 degrees -> open at " + ", ".join(f"{j} (fill {res['cut'][0][j]['fill']})" for j in bent_named if res["cut"][0][j]["fill"] < 1.0))
    return ok, text


def model_contour_px():
    model = json.load(open(os.path.join(ROOT, "assets/human/model.json")))
    return model_contour(model)[0]


def part_table(meta, ks):
    """The parts whose local scale stands for C20: the head and the four limbs (both bones), in the family's mesh space."""
    j = {n: np.array(p, float) for n, p in meta["joints"].items()}; H = meta["restHeightPx"] * ks["scale"]
    parts = {"head": ("disc", j["head"] + np.array([0.0, -0.063 * H]), 0.06 * H)}
    for side in ("L", "R"):
        parts[f"arm{side}"] = ("chain", [("bone", j[f"shoulder{side}"], j[f"elbow{side}"], 0.02 * H), ("bone", j[f"elbow{side}"], j[f"wrist{side}"], 0.02 * H)])
        parts[f"leg{side}"] = ("chain", [("bone", j[f"hip{side}"], j[f"knee{side}"], 0.02 * H), ("bone", j[f"knee{side}"], j[f"ankle{side}"], 0.02 * H)])
    return parts


def part_ratios(rest, posed, tris, meta, ks):
    flat = {}
    for name, spec in part_table(meta, ks).items():
        if spec[0] == "disc": flat[name] = spec
        else:
            for i, b in enumerate(spec[1]): flat[f"{name}.{i}"] = b
    got = part_scales(rest, posed, tris, meta["joints"], flat)
    out = {"head": round(got["head"], 4)}
    for n in ("armL", "armR", "legL", "legR"): out[n] = round(float(np.nanmean([got[f"{n}.0"], got[f"{n}.1"]])), 4)
    return out


def main():
    job = json.load(open(sys.argv[1])); actor = job["actor"]
    ok, text = hold_control(actor)
    print(f"control: {text}", flush=True)
    if not ok: print("refused: the hold metrics did not trip their control"); sys.exit(2)
    scale = model_scale(); result = {"scale": scale, "items": {}}
    tex_cache = {}; parts_cache = {}
    if any(c.get("rig") == "parts" for it in job["items"] for c in it["candidates"]):
        ok, text = parts_control(actor)
        print(f"control: {text}", flush=True)
        if not ok: print("refused: the parts rig's metrics did not trip their control"); sys.exit(2)
    contour = model_contour_px()
    for item in job["items"]:
        tried = []; chosen = None
        for cand in item["candidates"]:
            d, rest, tris, meta = family_files(actor, cand["family"])
            if cand.get("rig") == "parts":
                if cand["family"] not in parts_cache: parts_cache[cand["family"]] = load_parts(actor, cand["family"])
                P = parts_cache[cand["family"]]
                posed = {n: np.array(v, float).reshape(-1, 2) for n, v in cand["posed"].items()}
                pm = part_metrics(P, posed, meta["joints"])
                worst = {k: v["value"] for k, v in pm["worst"].items()}
                tried.append({"family": cand["family"], "rig": "parts", "metrics": worst, "worstParts": {k: v["part"] for k, v in pm["worst"].items()}, "holds": pm["holds"]})
                if not pm["holds"]: continue
                img, info, lay = render_parts(P, posed, cand["order"], {n: np.array(v, np.uint8) for n, v in cand["front"].items()}, scale, keep_layers=True)
                n = item["number"]; plate = os.path.join(job["outDir"], f"K{n}.png"); crop = os.path.join(job["outDir"], f"K{n}-crop.png")
                save_png(img, plate, "RGBA"); save_png(on_black(img), crop, "RGB")
                jf, jf_ok = joint_fill(P, img, info, cand["joints"], cand["order"], lay, contour)
                chosen = {"family": cand["family"], "registration": meta["registration"], "plate": os.path.relpath(plate, ROOT), "plateSha256": sha(plate), "crop": os.path.relpath(crop, ROOT), "info": info,
                          "metrics": worst, "rig": "parts", "order": cand["order"], "parts": {k: {m: v[m] for m in ("inverted", "strained", "overlap")} for k, v in pm["parts"].items()},
                          "worstParts": {k: v["part"] for k, v in pm["worst"].items()}, "partScales": pm["scales"], "jointFill": jf}
                break
            ks = cand["keySpace"]; posed = np.array(cand["posed"], float).reshape(-1, 2)
            m = hold_metrics(rest, posed, tris, rest_overlap=cand.get("restOverlap"))
            tried.append({"family": cand["family"], "metrics": m, "holds": holds(m)})
            if not holds(m): continue
            if cand["family"] not in tex_cache: tex_cache[cand["family"]] = load_texture(os.path.join(d, "plate.png"))
            floor = FLOOR * ks["scale"] + ks["translate"][1]
            img, info = render_posed(tex_cache[cand["family"]], rest, posed, tris, scale / ks["scale"], floor=floor)
            n = item["number"]; plate = os.path.join(job["outDir"], f"K{n}.png"); crop = os.path.join(job["outDir"], f"K{n}-crop.png")
            save_png(img, plate, "RGBA"); save_png(on_black(img), crop, "RGB")
            info["originMask"] = [(info["originMask"][0] - ks["translate"][0]) / ks["scale"], (info["originMask"][1] - ks["translate"][1]) / ks["scale"]]
            chosen = {"family": cand["family"], "registration": meta["registration"], "plate": os.path.relpath(plate, ROOT), "plateSha256": sha(plate), "crop": os.path.relpath(crop, ROOT),
                      "info": info, "metrics": m, "partScales": part_ratios(rest, posed, tris, meta, ks)}
            break
        result["items"][item["key"]] = {"chosen": chosen, "tried": tried}
        print(f"{item['key']:12s} " + (f"family {chosen['family']} ({chosen['registration']}{', parts' if chosen.get('rig') else ''}) {chosen['metrics']}" + (f" worst {chosen['worstParts']}" if chosen.get("rig") else "") if chosen else "NEEDS FAMILY: " + "; ".join(f"{t['family']} {t['metrics']}" + (f" (worst {t['worstParts']})" if t.get("rig") else "") for t in tried)), flush=True)
    json.dump(result, open(sys.argv[2], "w"), indent=1)


if __name__ == "__main__": main()
