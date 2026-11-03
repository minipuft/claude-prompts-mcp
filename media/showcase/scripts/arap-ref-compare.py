#!/usr/bin/env python3
"""Port-correctness check (D73): run the AnimatedDrawings ARAP reference (MIT, facebookresearch) and src/library/motion/arap.ts
on the same mesh and the same pin sets, and report the max vertex error in px.

usage: python3 -I scripts/arap-ref-compare.py <arap.py copy> <pinsets.json from measure-mesh.mjs>
The reference uses np.bool8, removed in numpy 2.0: pass a copy with `sed s/np.bool8/np.bool_/`; nothing else is changed.
"""
import importlib.util, json, sys, time
import numpy as np

ref_path, sets_path = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("arap_ref", ref_path)
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

d = json.load(open(sets_path))
verts = np.array(d["mesh"]["vertices"], dtype=np.float32).reshape(-1, 2)
tris = np.array(d["mesh"]["triangles"], dtype=np.int32).reshape(-1, 3)
rest = np.array(d["restPins"], dtype=np.float32).reshape(-1, 2)
t0 = time.time()
arap = mod.ARAP(rest, tris, verts)
print(f"reference constructed in {time.time() - t0:.1f}s: {len(verts)} vertices, {len(tris)} triangles, {arap.pin_num} of {len(rest)} pins inside")
worst = 0.0
for s, ours in zip(d["sets"], d["solutions"]):
    pins = np.array(s["pins"], dtype=np.float32).reshape(-1, 2)
    t0 = time.time()
    theirs = arap.solve(pins)
    ms = (time.time() - t0) * 1000
    err = np.linalg.norm(theirs - np.array(ours).reshape(-1, 2), axis=1)
    moved = np.linalg.norm(theirs - verts, axis=1)
    worst = max(worst, err.max())
    print(f"key frame {s['frame']:>3}: max vertex error {err.max():.5f} px, mean {err.mean():.5f} px; reference moved vertices up to {moved.max():.1f} px; reference solve {ms:.0f} ms")
print(f"worst over {len(d['sets'])} pin sets: {worst:.5f} px")
