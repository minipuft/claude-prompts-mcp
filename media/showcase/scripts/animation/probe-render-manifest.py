#!/usr/bin/env python3
"""Render manifest (row 6.13, D81, D87): a frame set is current only when its manifest still matches the contracts on disk.

usage: probe-render-manifest.py <out/<shot>/render-manifest.json> [--json out]
       probe-render-manifest.py --all <out dir> [--json out]        every <out>/*/render-manifest.json
Per manifest (written by `npm run render -- <shot>`, scripts/animation/render-cached.mjs):
  layers    figure, props, world, light, light-sdf and camera are all there; a layer taken out of the manifest is named.
  light-sdf the light layer (D98) reads the figure and props layers and runs on a GPU path: its `layer:<name>` inputs are those layers' cacheKeys (what a drawing of theirs reads at draw time) and are hashed again from the
            files on disk, so an edit under the figure or props names light-sdf stale as well; its `backend:name` input is the hash of the browser and WebGL renderer the render recorded (`backend` of the manifest and of the layer),
            and a manifest whose backend was edited, or recorded no backend, is refused by name.
  inputs    every file or JSON subtree (`path#a.b`) a layer read is hashed again from the disk; a layer whose hash differs from the manifest's, or whose `inputsHash` is not the hash of its
            own inputs, is STALE, and the input that changed is named (a contract edited after the render).
  frames    every frame of the range has a row naming drawings its layers hold, and its composed file (out/<shot>-seq/element-NNN.png) exists with the hash the row recorded.
  cache     every layer's `cacheKey` is the hash of its inputs less its `projectionOnly` ones (what a drawing reads at draw time), and `projectionOnly` names only inputs the layer has.
  confirm   the frames the browser drew whole and compared with the composed ones exist and none is beyond the determinism tolerance (2 levels on at most 0.01 % of the pixels; read from the
            recorded counts, not from the `ok` the renderer wrote). The plan that chose them is checked against the frame rows: every frame where a drawing of any layer changes from the frame
            before and a prop is magnified above the plan's threshold is a candidate; all candidates are in the plan, or the plan says it was thinned and holds `cap` frames in all; every
            frame compared is in the plan, with a reason, and every frame in the plan was compared.
Control first: a fixture manifest over three scratch files must pass; then a contract edited after the render, a layer removed, a layer whose inputsHash is not its inputs' hash, a cacheKey that is
not the hash of the drawing inputs, a missing composed frame, a confirm frame over tolerance, a plan that leaves out a magnified frame it had room for, a plan frame never compared and a plan that
claims more candidates than the rows hold must each be refused by name; a control that does not trip exits 2 without reporting.
Exit codes: 0 every manifest current, 1 a stale layer, a missing layer, a missing frame or a confirm frame over tolerance, 2 input error or a control that did not trip.
"""
import argparse, copy, glob, hashlib, json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import Probe, die

REQUIRED = ["figure", "props", "world", "light", "light-sdf", "camera"]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))      # media/showcase


def sha256_bytes(b): return hashlib.sha256(b).hexdigest()


def canon(v):
    """The canonical JSON render-manifest.mjs hashes a subtree by: keys sorted, no spaces, integral numbers without a point."""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    if isinstance(v, bool) or v is None or isinstance(v, (int, float, str)): return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list): return "[" + ",".join(canon(x) for x in v) + "]"
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(v[k]) for k in sorted(v)) + "}"


def input_hash(spec, root):
    path, _, sub = spec.partition("#")
    full = os.path.join(root, path)
    if not os.path.isfile(full): return "absent"
    with open(full, "rb") as f: data = f.read()
    if not sub: return sha256_bytes(data)
    node = json.loads(data.decode("utf-8"))
    for k in sub.split("."):
        node = node.get(k) if isinstance(node, dict) else None
    return "absent" if node is None else sha256_bytes(canon(node).encode("utf-8"))


def inputs_hash(inputs): return sha256_bytes("\n".join(f"{k}={inputs[k]}" for k in sorted(inputs)).encode("utf-8"))


def drawing_inputs_hash(layer, root):
    """The cacheKey a layer's inputs give today: the files hashed again from the disk, the `code:` entry as recorded (the source closure is checked apart, under codeVersion), the projectionOnly ones left out."""
    inputs = {k: (v if k.startswith(("code:", "backend:")) else input_hash(k, root)) for k, v in layer.get("inputs", {}).items() if not k.startswith("layer:")}
    return inputs_hash({k: v for k, v in inputs.items() if k not in layer.get("projectionOnly", [])})


def check_manifest(m, root, manifest_dir=None):
    """[(code, layer-or-frame, text)] for everything wrong with manifest `m` read against the files under `root`."""
    bad = []
    layers = m.get("layers", {})
    for name in REQUIRED:
        if name not in layers: bad.append(("missing-layer", name, f"the {name} layer is not in the manifest"))
    for name, layer in layers.items():
        inputs = layer.get("inputs", {})
        changed = [k for k in inputs if not k.startswith(("code:", "layer:", "backend:")) and input_hash(k, root) != inputs[k]]
        for k in inputs:
            if k.startswith("layer:"):                          # a layer this one reads: its cacheKey today against the one recorded here and the one the manifest records for it
                other = layers.get(k[6:])
                if other is None: bad.append(("layer-input", name, f"the {name} layer reads {k[6:]}, which the manifest does not hold")); continue
                if inputs[k] != other.get("cacheKey"): bad.append(("layer-input", name, f"the {name} layer's {k} is not the cacheKey the manifest records for the {k[6:]} layer: the manifest was edited or is damaged"))
                elif drawing_inputs_hash(other, root) != inputs[k]: changed.append(k)
            if k.startswith("backend:"):
                rec = m.get("backend")
                if not rec or not rec.get("name"): bad.append(("backend", name, f"the {name} layer depends on the backend and the manifest records none"))
                elif sha256_bytes(rec["name"].encode("utf-8")) != inputs[k]: bad.append(("backend", name, f"the {name} layer's backend input is not the hash of the recorded backend ({rec['name'][:60]}...): the manifest was edited or is damaged"))
                elif layer.get("backend") and layer["backend"].get("name") != rec["name"]: bad.append(("backend", name, f"the {name} layer records a different backend than the render did"))
        if inputs_hash(inputs) != layer.get("inputsHash"):
            bad.append(("inputs-hash", name, f"the {name} layer's inputsHash is not the hash of its own inputs: the manifest was edited or is damaged"))
        drawing = {k: v for k, v in inputs.items() if k not in layer.get("projectionOnly", [])}
        if any(k not in inputs for k in layer.get("projectionOnly", [])):
            bad.append(("cache-key", name, f"the {name} layer names a projectionOnly input it does not read"))
        if inputs_hash(drawing) != layer.get("cacheKey"):
            bad.append(("cache-key", name, f"the {name} layer's cacheKey is not the hash of its drawing inputs: the manifest was edited or is damaged"))
        if changed:
            bad.append(("stale-layer", name, f"the {name} layer is stale: {', '.join(changed[:4])}{' and ' + str(len(changed) - 4) + ' more' if len(changed) > 4 else ''} changed after the render"))
    # the renderer's own source files are inputs of every layer (the `code:` key), listed in `codeFiles` and hashed under codeVersion
    if m.get("codeFiles") and inputs_hash({f: input_hash(f, root) for f in m["codeFiles"]}) != m.get("codeVersion"):
        for name, layer in layers.items():
            if any(k.startswith("code:") for k in layer.get("inputs", {})):
                bad.append(("stale-layer", name, f"the {name} layer is stale: the renderer's source changed after the render (codeVersion {m.get('codeVersion', '')[:12]} is not the hash of the files on disk)"))
    lo, hi = m.get("range", [0, 0])
    rows = {r["frame"]: r for r in m.get("frames", [])}
    shot = m.get("shot", "")
    seq = os.path.join(root, "out", f"{shot}-seq")
    missing = [f for f in range(lo, hi) if f not in rows]
    if missing: bad.append(("missing-frame", "frames", f"{len(missing)} frames of {lo}-{hi - 1} have no row (first {missing[:5]})"))
    gone, wrong = [], []
    for f in range(lo, hi):
        r = rows.get(f)
        if not r: continue
        p = os.path.join(seq, f"element-{f:03d}.png")
        if not os.path.isfile(p): gone.append(f); continue
        with open(p, "rb") as fh:
            if r.get("outputHash") and sha256_bytes(fh.read()) != r["outputHash"]: wrong.append(f)
    if gone: bad.append(("missing-frame", "frames", f"{len(gone)} composed frames are not on disk (first {gone[:5]})"))
    if wrong: bad.append(("frame-hash", "frames", f"{len(wrong)} composed frames differ from the hash the render recorded (first {wrong[:5]})"))
    held = {name: {d["id"] for d in l.get("drawings", [])} for name, l in layers.items()}
    for f, r in rows.items():
        for name, ids in r.get("layers", {}).items():
            for i in ids:
                if name in held and i not in held[name]:
                    bad.append(("unknown-drawing", name, f"frame {f} names drawing {i}, which the {name} layer does not hold")); break
    conf = m.get("confirm")
    bad += check_plan(m, conf, rows, lo, hi)
    if not conf or not conf.get("frames"):
        bad.append(("no-confirm", "confirm", "the manifest has no confirm block: no frame was drawn whole by the browser and compared"))
    else:
        for c in conf["frames"]:
            if c["beyond"] > c["allowance"]:
                bad.append(("confirm-over", c.get("worstLayer", "?"), f"confirm frame {c['frame']} is beyond the tolerance: {c['beyond']} pixels differ by more than {conf['tolerance']['levels']} levels (allowance {c['allowance']}), largest in the {c.get('worstLayer', '?')} layer"))
    return bad


def check_plan(m, conf, rows, lo, hi):
    """The confirm plan against the frame rows: the rule the renderer states, recomputed from what the manifest itself recorded about every frame."""
    if not conf or not conf.get("frames"): return []
    plan = conf.get("plan")
    if not plan: return [("no-plan", "confirm", "the confirm block has no plan: nothing says why these frames were drawn whole")]
    bad = []
    chosen = {c["frame"]: c for c in plan.get("chosen", [])}
    compared = {c["frame"] for c in conf["frames"]}
    for f in sorted(compared - set(chosen)): bad.append(("plan-frame", "confirm", f"frame {f} was compared but the plan never chose it"))
    for f in sorted(set(chosen) - compared): bad.append(("plan-frame", "confirm", f"frame {f} is in the plan and was never compared with the browser's"))
    for f, c in chosen.items():
        if not c.get("reasons"): bad.append(("plan-reason", "confirm", f"frame {f} is in the plan with no reason"))
    layer_names = ("figure", "props", "world", "light", "light-sdf")
    cands = [f for f in range(lo + 1, hi) if f in rows and f - 1 in rows and any(rows[f]["layers"].get(l) != rows[f - 1]["layers"].get(l) for l in layer_names) and rows[f].get("magnification", 0) > plan["magnified"]]
    if plan.get("candidates") != len(cands):
        bad.append(("plan-candidates", "confirm", f"the plan counts {plan.get('candidates')} frames where a drawing changes above magnification {plan['magnified']}; the frame rows hold {len(cands)}"))
    left = [f for f in cands if f not in chosen]
    if left and not plan.get("trimmed"):
        bad.append(("plan-misses", "confirm", f"the plan leaves out {len(left)} magnified frames where a drawing changes, with no cap to blame (first {left[:5]})"))
    if plan.get("trimmed") and len(chosen) < min(plan["cap"], len(cands)):
        bad.append(("plan-misses", "confirm", f"the plan says it was thinned to {plan['cap']} frames and holds {len(chosen)}"))
    return bad


def fixture(tmp):
    """A manifest over three scratch files and four composed frames: the props change on frames 1-3, a prop is magnified on frames 1 and 2 (the plan's two candidates), frame 0 is a default."""
    os.makedirs(os.path.join(tmp, "v3"), exist_ok=True); os.makedirs(os.path.join(tmp, "out", "demo-seq"), exist_ok=True)
    with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.6}}, "staging": {"x": 1}}, f)
    with open(os.path.join(tmp, "v3", "keys.json"), "w") as f: json.dump({"keys": [1, 2]}, f)
    for n in range(4):
        with open(os.path.join(tmp, "out", "demo-seq", f"element-{n:03d}.png"), "wb") as f: f.write(f"frame-{n}".encode())
    specs = {"figure": ["v3/keys.json", "v3/layout.json#staging"], "props": ["v3/layout.json#staging"], "world": ["v3/keys.json"], "light": ["v3/keys.json"], "light-sdf": ["v3/keys.json"], "camera": ["v3/layout.json#cameraPose"]}
    backend = {"name": "FixtureChrome/1 | FixtureGPU (planted)"}
    layers = {}
    for name, files in specs.items():
        inputs = {f: input_hash(f, tmp) for f in files}
        projection_only = ["v3/keys.json"] if name == "figure" else []
        if name == "light-sdf": inputs["layer:figure"] = inputs_hash({k: v for k, v in layers["figure"]["inputs"].items() if k not in layers["figure"]["projectionOnly"]}); inputs["backend:name"] = sha256_bytes(backend["name"].encode("utf-8"))
        ids = ["props-a", "props-b", "props-c", "props-d"] if name == "props" else [f"{name}-a"]
        layers[name] = {"inputs": inputs, "inputsHash": inputs_hash(inputs), "projectionOnly": projection_only, "cacheKey": inputs_hash({k: v for k, v in inputs.items() if k not in projection_only}), "drawings": [{"id": i, "frames": [0]} for i in ids], **({"backend": backend} if name == "light-sdf" else {})}
    frames = [{"frame": n, "magnification": [0.5, 2.0, 2.0, 1.0][n], "layers": {k: (["props-" + "abcd"[n]] if k == "props" else [f"{k}-a"]) for k in specs}, "outputHash": sha256_bytes(f"frame-{n}".encode())} for n in range(4)]
    confirm_frames = [{"frame": n, "beyond": 3, "allowance": 92, "largest": 2} for n in (0, 1, 2)]
    plan = {"rule": "fixture", "cap": 40, "magnified": 1.5, "candidates": 2, "trimmed": False, "chosen": [{"frame": 0, "reasons": ["default"]}, {"frame": 1, "reasons": ["a drawing changes at magnification 2"]}, {"frame": 2, "reasons": ["a drawing changes at magnification 2"]}]}
    return {"shot": "demo", "range": [0, 4], "layers": layers, "codeFiles": [], "codeVersion": "", "backend": backend, "frames": frames, "confirm": {"tolerance": {"levels": 2, "share": 0.0001}, "plan": plan, "frames": confirm_frames}}


def control(pr):
    """The control: the clean fixture passes, each plant is refused by its own code and names what it should."""
    with tempfile.TemporaryDirectory() as tmp:
        m = fixture(tmp)
        clean = check_manifest(m, tmp)
        results = {"clean fixture": (not clean, "passes")}
        with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.61}}, "staging": {"x": 1}}, f)
        edited = check_manifest(m, tmp)
        results["a camera value edited after the render"] = (any(c == "stale-layer" and n == "camera" for c, n, _ in edited) and not any(n in ("figure", "props") for c, n, _ in edited), "names camera only")
        with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.6}}, "staging": {"x": 2}}, f)
        staged = check_manifest(m, tmp)
        results["the staging edited after the render"] = ({n for c, n, _ in staged if c == "stale-layer"} == {"figure", "props", "light-sdf"}, "names figure and props, and light-sdf through the figure it reads, not camera")
        with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.6}}, "staging": {"x": 1}}, f)
        gone = copy.deepcopy(m); del gone["layers"]["light"]
        results["the light layer removed"] = (any(c == "missing-layer" and n == "light" for c, n, _ in check_manifest(gone, tmp)), "names light")
        tampered = copy.deepcopy(m); tampered["layers"]["world"]["inputsHash"] = "0" * 64
        results["a layer whose inputsHash is not its inputs' hash"] = (any(c == "inputs-hash" and n == "world" for c, n, _ in check_manifest(tampered, tmp)), "names world")
        over = copy.deepcopy(m); over["confirm"]["frames"][0].update({"beyond": 5000, "worstLayer": "light"})
        results["a confirm frame over tolerance"] = (any(c == "confirm-over" and n == "light" for c, n, _ in check_manifest(over, tmp)), "names the frame and light")
        keyless = copy.deepcopy(m); keyless["layers"]["figure"]["cacheKey"] = "0" * 64
        results["a cacheKey that is not the hash of the drawing inputs"] = (any(c == "cache-key" and n == "figure" for c, n, _ in check_manifest(keyless, tmp)), "names figure")
        skipped = copy.deepcopy(m); skipped["confirm"]["plan"]["chosen"] = [c for c in skipped["confirm"]["plan"]["chosen"] if c["frame"] != 2]; skipped["confirm"]["frames"] = [c for c in skipped["confirm"]["frames"] if c["frame"] != 2]
        results["a plan that leaves out a magnified frame it had room for"] = (any(c == "plan-misses" for c, _, _ in check_manifest(skipped, tmp)), "names the frames left out")
        unseen = copy.deepcopy(m); unseen["confirm"]["plan"]["chosen"].append({"frame": 3, "reasons": ["named"]})
        results["a plan frame the browser never drew"] = (any(c == "plan-frame" for c, _, _ in check_manifest(unseen, tmp)), "names frame 3")
        inflated = copy.deepcopy(m); inflated["confirm"]["plan"]["candidates"] = 5
        results["a plan that counts candidates the rows do not hold"] = (any(c == "plan-candidates" for c, _, _ in check_manifest(inflated, tmp)), "names the count")
        moved_backend = copy.deepcopy(m); moved_backend["backend"]["name"] = "OtherChrome/2 | OtherGPU"
        results["a backend edited after the render"] = (any(c == "backend" and n == "light-sdf" for c, n, _ in check_manifest(moved_backend, tmp)), "names light-sdf")
        no_backend = copy.deepcopy(m); del no_backend["backend"]
        results["a light layer with no backend recorded"] = (any(c == "backend" and n == "light-sdf" for c, n, _ in check_manifest(no_backend, tmp)), "names light-sdf")
        forged = copy.deepcopy(m); forged["layers"]["light-sdf"]["inputs"]["layer:figure"] = "0" * 64
        results["a layer input that is not the layer's cacheKey"] = (any(c == "layer-input" and n == "light-sdf" for c, n, _ in check_manifest(forged, tmp)), "names light-sdf")
        planless = copy.deepcopy(m); del planless["confirm"]["plan"]
        results["a confirm block with no plan"] = (any(c == "no-plan" for c, _, _ in check_manifest(planless, tmp)), "names the missing plan")
        os.remove(os.path.join(tmp, "out", "demo-seq", "element-000.png"))
        results["a composed frame deleted"] = (any(c == "missing-frame" for c, _, _ in check_manifest(m, tmp)), "names the missing frames")
    ok = all(v[0] for v in results.values())
    pr.control(ok, "; ".join(f"{k} -> {'refused, ' + v[1] if k != 'clean fixture' else v[1]}" if v[0] else f"{k} -> NOT as wanted" for k, v in results.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="?"); ap.add_argument("--all", default=None, metavar="OUT_DIR"); ap.add_argument("--json", default=None)
    ap.add_argument("--root", default=ROOT, help="the renderer root the manifest's paths are relative to (default media/showcase)")
    a = ap.parse_args()
    pr = Probe("render-manifest", a.json)
    control(pr)
    if a.all:
        paths = sorted(glob.glob(os.path.join(a.all, "*", "render-manifest.json")))
        if not paths: die(f"no render manifest under {a.all}/*/ (run `npm run render -- <shot>`)")
    elif a.manifest: paths = [a.manifest]
    else: die("a manifest path or --all <out dir> is required")
    for p in paths:
        try:
            with open(p) as f: m = json.load(f)
        except (OSError, ValueError) as e: die(f"manifest {p}: {e}")
        bad = check_manifest(m, a.root)
        layers = m.get("layers", {})
        frames = m.get("frames", []); conf = (m.get("confirm") or {}).get("frames", [])
        pr.check(m.get("shot", p), not bad,
                 f"{len(frames)} frames, layers {', '.join(layers)} all current by inputs hash, {sum(1 for c in conf if c['beyond'] <= c['allowance'])} of {len(conf)} confirm frames inside the tolerance" if not bad else "; ".join(t for _, _, t in bad))
    pr.finish(f"{len(paths)} manifest(s) current: every layer's inputs hash to what the render recorded, every composed frame is on disk, every confirm frame is inside the tolerance")


if __name__ == "__main__": main()
