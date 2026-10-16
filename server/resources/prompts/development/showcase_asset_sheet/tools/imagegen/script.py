#!/usr/bin/env python3
"""imagegen: draw one asset with Codex's image tool from board images (D65/D66).
stdin JSON: {prompt, references: [abs paths], out: abs png path, workdir?}
Runs `codex exec --skip-git-repo-check -C <workdir> -i ref... -- "<prompt>"` (the `--` is required or the prompt is read from stdin),
parses the generated path Codex prints, copies it to `out` unchanged, and returns {valid, path, sha256, bytes, referenced_image_paths}.
Refuses, never fabricates: a missing file or a missing path in the output is valid:false with the reason."""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile
data = json.load(sys.stdin)
prompt = data.get("prompt", "").strip(); refs = data.get("references", []); out = data.get("out")
if not prompt or not out: print(json.dumps({"valid": False, "errors": ["prompt and out are required"]})); sys.exit(0)
missing = [r for r in refs if not os.path.isfile(r)]
if missing: print(json.dumps({"valid": False, "errors": [f"reference missing: {m}" for m in missing]})); sys.exit(0)
if not shutil.which("codex"): print(json.dumps({"valid": False, "errors": ["codex CLI not on PATH"]})); sys.exit(0)
workdir = data.get("workdir") or tempfile.mkdtemp(prefix="imagegen-")
ask = ("Use your image generation tool exactly once, with every attached image as a reference, for this request:\n" + prompt +
       "\nThen print only: the absolute path of the generated file on one line, and on the next lines a JSON object with the exact tool arguments you used (prompt, referenced_image_paths, transparent_background).")
cmd = ["codex", "exec", "--skip-git-repo-check", "-C", workdir]
for r in refs: cmd += ["-i", r]
cmd += ["--", ask]
try:
    run = subprocess.run(cmd, capture_output=True, text=True, timeout=int(data.get("timeout", 280)))
except subprocess.TimeoutExpired:
    print(json.dumps({"valid": False, "errors": ["codex exec timed out"]})); sys.exit(0)
text = run.stdout + "\n" + run.stderr
paths = re.findall(r"(/[^\s'\"`]+\.png)", text)
paths = [p for p in paths if os.path.isfile(p) and "generated_images" in p]
if not paths: print(json.dumps({"valid": False, "errors": ["no generated file path found in codex output", text[-600:]]})); sys.exit(0)
src = paths[-1]
args = None
m = re.search(r"\{[\s\S]*\"referenced_image_paths\"[\s\S]*?\}\s*$", text.strip()) or re.search(r"\{[\s\S]*\"referenced_image_paths\"[\s\S]*\}", text)
if m:
    try: args = json.loads(m.group(0))
    except Exception: args = {"raw": m.group(0)[:1200]}
os.makedirs(os.path.dirname(out), exist_ok=True)
shutil.copyfile(src, out)
raw = open(out, "rb").read()
print(json.dumps({"valid": True, "path": out, "source": src, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "referenced_image_paths": refs, "tool_arguments": args, "summary": {"references": len(refs)}}))
