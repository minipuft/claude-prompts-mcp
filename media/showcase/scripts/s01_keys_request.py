#!/usr/bin/env python3
"""Builds the imagegen request of one plate family of the s01 key sheet from the pose sheet (v3/poses/s01-arrival-overwhelm.json) and optionally runs the tool.

usage: s01_keys_request.py <family> [--nn 01] [--fail "<key>: <failing property>"] [--run] [--timeout 900]

The request (prompt, references, out) is written to evidence/s01/r2/keys-req-<family>-<nn>.json; with --run it is piped to the imagegen tool's script.py
(server/resources/prompts/development/showcase_key_sheet/tools/imagegen/script.py) and the reply is written to evidence/s01/r2/imagegen-keys-<family>-<nn>.json.
References: 1 the model sheet, 2 the approved pick, 3 the cinematography sheet (row 2 only), 4 the pose guide of the family (spine, shoulders, hips and legs of the
pose sheet's solved joints: scripts/s01_pose_guides.py). Key numbers K1..K8 follow the chart's order.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "../../server/resources/prompts/development/showcase_key_sheet/tools/imagegen/script.py")
SIDE = {"L": "image-left", "R": "image-right"}


def curve_words(l):
    side = "left" if l["sign"] < 0 else "right"
    base = f"the spine is ONE {'S' if l['class'] == 'S' else 'C'} curve: its belly bows to the image-{side} by about {round(l['bow'] * 100)} percent of the figure's height away from the straight line from hips to head"
    if l["class"] == "S": base += f", crossing over about {round(l.get('inflection', 0.5) * 100)} percent of the way up, so the lower lobe bows the {side} way and the upper lobe the other way"
    lean = l.get("lean", 0)
    return base + (f"; the head sits about {abs(lean)} degrees {'right' if lean > 0 else 'left'} of straight above the hips" if abs(lean) >= 4 else "")


def weight_words(w):
    if w["foot"] == "both": return "weight even on both feet"
    return f"weight on the {SIDE[w['foot']]} foot (the hips sit {round(w['over'] * 100)} percent of the way toward it from the other foot), the other foot light"


def lead_words(ld):
    parts = [f"the {SIDE[ld[p]]} {p} leads" for p in ("arm", "leg") if ld[p] != "none"]
    return "; ".join(parts) if parts else "no arm or leg leads"


def key_line(n, k):
    return (f"K{n} ({k['name']}, frame {k['frame']}): {k['moment']} Line of action: {curve_words(k['lineOfAction'])}. {weight_words(k['weight']).capitalize()}. {lead_words(k['lead']).capitalize()}. "
            f"Silhouette kind: {k['silhouette']}." + (f" It is a deliberate symmetric pose: {k['twinned']['why']}." if k.get("twinned") else " Do NOT draw the two arms or the two legs as mirror twins."))


def build(family, nn, fail):
    sheet = json.load(open(os.path.join(ROOT, "v3/poses/s01-arrival-overwhelm.json")))
    ks = [(i, k) for i, k in enumerate(sheet["keys"], 1) if k["plateFamily"] == family]
    if not ks: sys.exit(f"no key in plate family {family}")
    n = len(ks); names = ", ".join(f"K{i}" for i, _ in ks); fnames = ", ".join(f"F{i}" for i, _ in ks)
    layout = "locked medium-wide poster camera: the plain hip-high box in front of the human, Codex small on the left and Clawd small on the right, the hairline of blue light on the lid seam"
    prompt = (
        f"Create ONE key sheet for the human of a silent animated film, shot s01. Use case: illustration-story. Plate family '{family}' ({n} key{'s' if n > 1 else ''}: {names}). Pure black sheet, two rows, 16:9.\n"
        "REFERENCE ROLES. Image 1 is the approved MODEL SHEET of the human: keep this exact character (green skin, mauve-and-blue angular poncho, one trailing swoop of cream-and-mauve hair, large hands, flared trousers and boots), the same proportions (about eight heads tall, long thin limbs), the same flat colours with identity pigments, and the same thin pale contour (about one 166th of the figure's height). "
        "Image 2 is the approved pick: its line quality, tapered tips and stipple shadow. Image 3 is the cinematography sheet of the shot: use it only for ROW 2 (camera, the plain box, Codex and Clawd, the blue light). "
        f"Image 4 is a POSE GUIDE: for each key a pale stick figure of the spine, shoulders, hips and legs on one baseline, numbered {names}. Draw the human so that her spine follows the guide's curve, her hips and feet stand where the guide's do and the same foot carries the weight; the arms are NOT in the guide, draw them as the words say. Do not copy the guide's lines, dots or numerals into the picture.\n"
        f"ROW 1 (upper 70 percent of the sheet): {n} full-length figure{'s' if n > 1 else ''} of the SAME human{', left to right,' if n > 1 else ','} numbered {names} in cream numerals under {'each' if n > 1 else 'it'}, each figure FULL LENGTH with both boots visible, all at exactly the same scale (about 62 percent of the sheet height) on one shared pale baseline, flat shapes, pale contour, stipple shadow, no gradients, no box and no props in row 1 (draw the hands where the invisible lid would be), every pose on ONE clear line of action, the silhouette reading when filled black (arms, hands and legs apart from the torso mass where the pose allows it). Keep the head, the hair swoop, the poncho and the trousers identical in design to the model sheet.\n"
        "POSES:\n" + "\n".join(key_line(i, k) for i, k in ks) + "\n"
        f"ROW 2 (lower 30 percent): the same {n} key{'s' if n > 1 else ''} as small 16:9 frame thumbnail{'s' if n > 1 else ''} numbered {fnames} under {'them' if n > 1 else 'it'}, each at the shot's camera: the {layout}; the human at the size the cinematography sheet draws her, one emitter in blue (#0a51fb) with the yellow accent (#fad204) only as the second colour of the pair, black field. These thumbnails are staging proof only.\n"
        "No other text. Do not add background scenery to row 1."
    )
    if fail: prompt += f"\nFAILING PROPERTY TO CORRECT (the previous drawing of this plate was rejected for exactly this and nothing else): {fail}"
    refs = [os.path.join(ROOT, p) for p in ("assets/human/model-01.png", "v3/studies/human-gen-16-swoop.png", "assets/layouts/s01-layout-02.png", f"out/s01-02-guides/{family}.png")]
    out = os.path.join(ROOT, f"out/s01-arrival-overwhelm-keys-human-{family}-{nn}.png")
    return {"prompt": prompt, "references": refs, "out": out, "workdir": f"/tmp/s01/imagegen-work-{family}-{nn}"}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("family"); ap.add_argument("--nn", default="01"); ap.add_argument("--fail", default=None); ap.add_argument("--run", action="store_true"); ap.add_argument("--timeout", type=int, default=900)
    a = ap.parse_args(); req = build(a.family, a.nn, a.fail); req["timeout"] = a.timeout
    d = os.path.join(ROOT, "evidence/s01/r2"); os.makedirs(d, exist_ok=True)
    rp = os.path.join(d, f"keys-req-{a.family}-{a.nn}.json"); json.dump(req, open(rp, "w"), indent=1); print("request", os.path.relpath(rp, ROOT))
    if not a.run: return
    os.makedirs(req["workdir"], exist_ok=True)
    run = subprocess.run([sys.executable, TOOL], input=json.dumps(req), capture_output=True, text=True)
    op = os.path.join(d, f"imagegen-keys-{a.family}-{a.nn}.json"); open(op, "w").write(run.stdout)
    print(run.stdout[:600], run.stderr[-300:])


if __name__ == "__main__": main()
