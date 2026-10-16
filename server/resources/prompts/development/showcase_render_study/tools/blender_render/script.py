#!/usr/bin/env python3
"""Blender path for a showcase shot. Explicit trigger only (tool:blender_render). Refuses with a named reason when Blender is not reachable; never reports a render it did not make."""
import json, os, shutil, subprocess, sys
data = json.load(sys.stdin)
blend = data.get("blend_file"); script = data.get("python_script"); out = data.get("out_dir", "out/blender")
frames = data.get("frames", [0])
exe = os.environ.get("BLENDER") or shutil.which("blender")
if not exe:
    print(json.dumps({"valid": False, "errors": ["blender is not on PATH and BLENDER is unset; this box (WSL2) has no Blender; run the shot on the Windows host or set BLENDER to the host binary"]}))
    sys.exit(0)
if not blend or not os.path.isfile(blend):
    print(json.dumps({"valid": False, "errors": [f"blend_file missing or not a file: {blend}"]}))
    sys.exit(0)
os.makedirs(out, exist_ok=True)
rendered = []
for f in frames:
    cmd = [exe, "-b", blend, "-o", os.path.join(out, "frame_####"), "-F", "PNG", "-f", str(int(f))]
    if script:
        cmd = [exe, "-b", blend, "--python", script, "--", "--frame", str(int(f)), "--out", out]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    if r.returncode != 0:
        print(json.dumps({"valid": False, "errors": [f"blender exited {r.returncode} on frame {f}", r.stderr[-800:]], "rendered": rendered}))
        sys.exit(0)
    rendered.append(f)
print(json.dumps({"valid": True, "summary": {"renderer": "blender", "executable": exe, "frames": rendered, "out_dir": out}}))
