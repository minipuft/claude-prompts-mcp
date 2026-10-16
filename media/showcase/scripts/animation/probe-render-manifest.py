#!/usr/bin/env python3
"""Render manifest (row 6.13, D81, D87): a frame set is current only when its manifest still matches the contracts on disk.

usage: probe-render-manifest.py <out/<shot>/render-manifest.json> [--json out]
       probe-render-manifest.py --all <out dir> [--json out]        every <out>/*/render-manifest.json
Per manifest (written by `npm run render -- <shot>`, scripts/animation/render-cached.mjs):
  layers    figure, props, world, light and camera are all there; a layer taken out of the manifest is named.
  inputs    every file or JSON subtree (`path#a.b`) a layer read is hashed again from the disk; a layer whose hash differs from the manifest's, or whose `inputsHash` is not the hash of its
            own inputs, is STALE, and the input that changed is named (a contract edited after the render).
  frames    every frame of the range has a row naming drawings its layers hold, and its composed file (out/<shot>-seq/element-NNN.png) exists with the hash the row recorded.
  confirm   the frames the browser drew whole and compared with the composed ones exist and none is beyond the determinism tolerance (2 levels on at most 0.01 % of the pixels; read from the
            recorded counts, not from the `ok` the renderer wrote).
Control first: a fixture manifest over three scratch files must pass; then a contract edited after the render, a layer removed, a layer whose inputsHash is not its inputs' hash, a missing
composed frame and a confirm frame over tolerance must each be refused by name; a control that does not trip exits 2 without reporting.
Exit codes: 0 every manifest current, 1 a stale layer, a missing layer, a missing frame or a confirm frame over tolerance, 2 input error or a control that did not trip.
"""
import argparse, copy, glob, hashlib, json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_common import Probe, die

REQUIRED = ["figure", "props", "world", "light", "camera"]
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


def check_manifest(m, root, manifest_dir=None):
    """[(code, layer-or-frame, text)] for everything wrong with manifest `m` read against the files under `root`."""
    bad = []
    layers = m.get("layers", {})
    for name in REQUIRED:
        if name not in layers: bad.append(("missing-layer", name, f"the {name} layer is not in the manifest"))
    for name, layer in layers.items():
        inputs = layer.get("inputs", {})
        changed = [k for k in inputs if not k.startswith("code:") and input_hash(k, root) != inputs[k]]
        if inputs_hash(inputs) != layer.get("inputsHash"):
            bad.append(("inputs-hash", name, f"the {name} layer's inputsHash is not the hash of its own inputs: the manifest was edited or is damaged"))
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
    if not conf or not conf.get("frames"):
        bad.append(("no-confirm", "confirm", "the manifest has no confirm block: no frame was drawn whole by the browser and compared"))
    else:
        for c in conf["frames"]:
            if c["beyond"] > c["allowance"]:
                bad.append(("confirm-over", c.get("worstLayer", "?"), f"confirm frame {c['frame']} is beyond the tolerance: {c['beyond']} pixels differ by more than {conf['tolerance']['levels']} levels (allowance {c['allowance']}), largest in the {c.get('worstLayer', '?')} layer"))
    return bad


def fixture(tmp):
    """A manifest over three scratch files and one composed frame."""
    os.makedirs(os.path.join(tmp, "v3"), exist_ok=True); os.makedirs(os.path.join(tmp, "out", "demo-seq"), exist_ok=True)
    with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.6}}, "staging": {"x": 1}}, f)
    with open(os.path.join(tmp, "v3", "keys.json"), "w") as f: json.dump({"keys": [1, 2]}, f)
    with open(os.path.join(tmp, "out", "demo-seq", "element-000.png"), "wb") as f: f.write(b"frame-0")
    specs = {"figure": ["v3/keys.json", "v3/layout.json#staging"], "props": ["v3/layout.json#staging"], "world": ["v3/keys.json"], "light": ["v3/keys.json"], "camera": ["v3/layout.json#cameraPose"]}
    layers = {}
    for name, files in specs.items():
        inputs = {f: input_hash(f, tmp) for f in files}
        layers[name] = {"inputs": inputs, "inputsHash": inputs_hash(inputs), "drawings": [{"id": f"{name}-a", "frames": [0]}]}
    return {"shot": "demo", "range": [0, 1], "layers": layers, "codeFiles": [], "codeVersion": "", "frames": [{"frame": 0, "layers": {n: [f"{n}-a"] for n in specs}, "outputHash": sha256_bytes(b"frame-0")}],
            "confirm": {"tolerance": {"levels": 2, "share": 0.0001}, "frames": [{"frame": 0, "beyond": 3, "allowance": 92, "largest": 2}]}}


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
        results["the staging edited after the render"] = ({n for c, n, _ in staged if c == "stale-layer"} == {"figure", "props"}, "names figure and props, not camera")
        with open(os.path.join(tmp, "v3", "layout.json"), "w") as f: json.dump({"cameraPose": {"end": {"zoom": 0.6}}, "staging": {"x": 1}}, f)
        gone = copy.deepcopy(m); del gone["layers"]["light"]
        results["the light layer removed"] = (any(c == "missing-layer" and n == "light" for c, n, _ in check_manifest(gone, tmp)), "names light")
        tampered = copy.deepcopy(m); tampered["layers"]["world"]["inputsHash"] = "0" * 64
        results["a layer whose inputsHash is not its inputs' hash"] = (any(c == "inputs-hash" and n == "world" for c, n, _ in check_manifest(tampered, tmp)), "names world")
        over = copy.deepcopy(m); over["confirm"]["frames"][0].update({"beyond": 5000, "worstLayer": "light"})
        results["a confirm frame over tolerance"] = (any(c == "confirm-over" and n == "light" for c, n, _ in check_manifest(over, tmp)), "names the frame and light")
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
