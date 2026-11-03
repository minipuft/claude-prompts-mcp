# Study puppet-proof-03 · the same lift on a deformed mesh (D73)

2026-10-13 · tech-rig-02 Steps 1–3 executed: the cutout puppet's rotation-only parts are replaced, for this proof, by one triangle mesh of the generated figure (`part00` of `human-gen-18-parts`) moved by an As-Rigid-As-Possible solver (Igarashi 2005 · Igarashi & Igarashi 2009, ported from facebookresearch/AnimatedDrawings `arap.py`, MIT). Nothing drawn by hand. The chart has three keys (rest held to 24 · raise with overshoot at 36 · settle at 50); the solver carries every breakdown.

Files (absolute, `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/`): `v3/studies/puppet-proof-03.mp4` (90 frames, sha 13a0ec7b27f5), `-f000.png`, `-f040.png`, `-tri.png` (frames 0 · 32 · 40), `-strip.png` (frames 28–39, same layout as puppet-proof-02-strip).

## Measured

| Claim | Command | Baseline | Measured | Goal |
|---|---|---|---|---|
| Silhouette is one connected component at every frame | `npx remotion render src/index.ts MeshProof out/meshproof-seq --sequence --image-format=png && python3 scripts/measure-silhouette.py out/meshproof-seq` | PuppetProof, same command on `PuppetProof`: 1 component on frames 0–31, **3 on frames 32–89** (58 of 90) | **1 on all 90 frames** (8- and 4-connected). Positive control in the same run: frame 0 with a 4 px band erased across the shins gives 3 | 1 |
| Rest-pose IoU, deformed mesh vs `mask.png` (figure region) | `node scripts/measure-mesh.mjs` | n/a | **0.9879** (418 vertices). Sweep by contour tolerance: 3 px 0.9767 (333 v) · 2 px 0.9842 (371 v) · 1.5 px **0.9879 (418 v, shipped)** · 1 px 0.9910 (727 v) | ≥ 0.97 |
| Max joint error at rest | same command | n/a | **0 px** (17 pins, none dropped; the solve returns the rest vertices bit-for-bit in float32). At the posed keys 36 and 50 the pins land within 0.0006 px of their targets | ≤ 2 px |
| Solve time per frame | same command, 450 solves over the 90 lift poses × 5 passes | n/a | median **1.3 ms**, p95 1.6–2.1 ms, max 2.4–5.6 ms over runs, at 418 vertices (727 vertices: median 4.2 ms). Factoring the two normal matrices, once per process: 131 ms | ≤ 20 ms at ≤ 800 v |
| Port matches the Python reference | `python3 scripts/arap-ref-compare.py /tmp/arapref/arap_ref64.py /tmp/arap-pinsets.json` (same mesh, the 3 key pin sets) | reference as shipped, `arap_ref.py` (only `np.bool8` → `np.bool_`): max vertex error **219 px** (rest key), 105 and 107 px (keys 36, 50) | float64 reference, `arap_ref64.py` (that, plus `dtype=np.float32` → `np.float64`; nothing else): max vertex error **0.0002 px** on all three sets | < 0.5 px |
| Render cost | `npx remotion render src/index.ts MeshProof out/meshproof.mp4 --codec=h264 --crf=18` | n/a | 90 frames in about 7 s wall, `swangle` WebGL | n/a |

Reading the port row: the reference as shipped fails its own rest test (identity pins must return the rest mesh; it moves vertices by up to 219 px), so the 0.5 px goal was checked against the reference with float64 matrices. That is a one-variable change (the array dtype), and it takes the disagreement from 219 px to 0.0002 px, which puts the error in the reference's float32 normal equations (pin weight 1000, coordinates in the hundreds), not in the port. The reference is unusable at this scale as shipped; its demos use coordinates within ±15.

## What the proof shows

- **Connected.** The limbs never separate: the silhouette is one component through the whole lift, where the cutout puppet is three components for the last 58 frames (its arms leave the shoulders; the hands also leave the frame top at this scale, which may add to that count).
- **The deformation reads for a V raise.** Strip frames 28–35: arms rise to a V, the poncho lifts with them, nothing opens at a joint.
- **A single layer cannot do arms overhead.** At the first attempt (125 degrees upper arm, the puppet's own range scaled) the poncho was dragged into a narrow column and the hands crossed over the face; with the pose range held to 105 degrees the figure stays legible. The arms are part of the same drawing as the poncho (they leave it at the hem), so a raised arm carries the cloth with it and no arm layer exists to show it leaving. This is the "layer split for overlap" concern of tech-rig-02, now measured: raising past about 100 degrees needs the arm as its own mesh with an inpainted shoulder end, or a drawn key.

## Joint provenance (assets/human/skeleton.json, `joint_provenance`)

The assembled puppet (`rig.json`) and `part00` are two separate drawings: the assembled rest pose has the arms hanging, `part00` has them spread and the legs apart, and a template match of each rig part inside `part00` scores 0.5 to 1.07 normalised SSD, so only the head and torso pivots could be carried over.
- Derived (2 of 17): `head`, `torso`, from the rig pivots through that template match, cross-checked by eye.
- Guessed (15): placed by eye on `part00` over a 50 px grid: `root`, `neck`, both shoulders, elbows, wrists, hips, knees, ankles, and the cloth anchor `ponchoPoint`. The rig has no knee and no root. The hierarchy and names come from the rig's parent chain.
- Registration to HumanPuppet's canvas: scale 1.0694 (matches the assembled puppet's 986 px footprint height), top at y 20, head x at 348. Frame 0 footprints (PuppetProof vs MeshProof, both clipped by the frame bottom): top 50 vs 54 px, height 670 vs 666 px, width 345 vs 428 px (the figure's arms are spread).

## Changed
- New: `src/library/motion/arap.ts`, `src/library/motion/mesh.ts`, `src/library/cast/MeshFigure.tsx`, `src/library/cast/humanPose.ts`, `src/scenes/MeshProof.tsx`, `assets/human/skeleton.json`, `assets/human/mesh.json`, `public/assets/human/cutout.png` (copy, so `staticFile` serves the texture), `scripts/mesh.mjs`, `scripts/lib/png-gray.mjs`, `scripts/measure-mesh.mjs`, `scripts/measure-silhouette.py`, `scripts/arap-ref-compare.py`.
- Edited: `src/library/motion.ts` (`poseAt` and its types appended; existing exports untouched), `src/Root.tsx` (one import and one `MeshProof` composition line), `package.json` and `package-lock.json` (`earcut`, `@types/earcut`).

## Next
- Arm layer: the front arm as its own mesh with its own pins, plus an inpainted shoulder end (the one open item of tech-rig-02 Step 3), or a drawn key at the top of the raise.
- Face states on the mesh (the head is part of the `cutout.png` texture; the D70 faces are separate PNGs).
- Key plates as a second `MeshFigure` registered to the same skeleton (tech-rig-02 Step 3, `holdKey()`).
