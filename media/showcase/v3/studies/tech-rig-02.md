# tech-rig-02 — deformation rig for the puppet (>>tech_recommendation, 2026-10-13)

Follows tech-rig-01 (skeleton SSOT, TRIAL AnimatedDrawings) and D72 (pose-to-pose, key sheets, timing charts).
Owner ruling this session: no 3D characters; go straight to a 2D mesh-deformation rig.

## Context

- Puppet today: `src/library/cast/HumanPuppet.tsx`, nested rotation-only cutouts, hand-typed anchors, parts from a separate sheet generation. Limbs separate at joints; inbetweens are pivots, not deformation.
- D72 fixes identity at keys (generated key plates) but inbetweens still fall on this rig.
- Box: WSL2, RTX 3090 24 GB, node + Remotion 4.0.530, `@remotion/three` already a dependency, no Blender, no python igl.
- Baseline: nothing deforms today. Cost of doing nothing: every breakdown is a pivot pose, joints open on any rotation over ~20°, so each shot either hides joints or generates more plates. Cost of hand-rolling: an ARAP solver is ~330 lines of numpy in AnimatedDrawings (`animated_drawings/model/arap.py`, MIT, measured 329 lines, scipy sparse solve); a TypeScript port with a dense solver is a 1–2 day job. Solved-problem check: 2D ARAP is a 2005 paper with reference implementations; hand-rolling the maths from scratch is worse than porting, porting is not.

## Analysis

| Candidate | Licence | Authoring without an editor | Runs headless in TS/React | Verdict |
|---|---|---|---|---|
| AnimatedDrawings ARAP (Igarashi 2005, Smith 2023) | MIT, archived 2025-09 | yes: mask + joints yaml | Python; port needed | **port core** |
| mikecokina/puppet-warp | GPL-3 | yes (pins) | Python only | avoid (licence) |
| three.js SkinnedMesh LBS | MIT, in deps | needs weights; 1/d² à la Pose Animator | yes | fallback renderer only |
| Pose Animator | Apache-2 | SVG + fixed rig; LBS | browser TF.js | prior art for weights |
| Rive runtime | MIT runtime | **no**, .riv comes from the closed editor | yes | avoid |
| SkelForm | GPL-3 editor, JS runtime | editor-made files | runtime yes | hold |
| DragonBones | MIT runtime, unmaintained | editor-made | pixi | avoid |
| Spine | paid editor | editor-made | paid runtime | avoid |
| ToonCrafter (generative inbetweens) | Apache-2 | n/a | GPU, 512×320 | hold; revisit for texture of breakdowns |
| EbSynth 2 (keyframe propagation) | closed, terms | n/a | no | hold; idea only |

## Goals

1. One generated figure + one skeleton → connected limbs at every breakdown, no open joints (measured: silhouette is one connected component at every frame of the puppet-proof).
2. Key plates swap in at charted frames and the rig carries the breakdowns between them (D72 charts).
3. Registration gate from tech-rig-01 stays: rest-pose IoU ≥ 0.97, joints ≤ 2 px.
4. Render in Remotion headless at 1080p24 ≥ 10 fps per frame batch (ARAP solve per frame ≤ 20 ms at ≤ 800 vertices).

## Execution

### Verdict: ADOPT — port the AnimatedDrawings ARAP core to TypeScript; render as a textured triangle mesh through @remotion/three. Confidence: High.

> One figure, one skeleton, ARAP pins at the joints; key plates are just a second figure registered to the same skeleton.

**Strengths**: MIT reference with a measured 329-line core; the exact pipeline (mask → triangulate → pins at joints → ARAP) shipped in a research demo used by millions of uploads (Smith et al. 2023, TOG); `@remotion/three` already present so the renderer is a `BufferGeometry` with per-frame position updates and the figure PNG as texture, no skinning shader needed; drawn key plates fit as separate meshes sharing the skeleton.
**Concerns**: ARAP is as-rigid-as-possible, so a big squash or a smear is still a drawn key, never a solver output (that is D72's rule anyway); self-overlap (forearm across torso) needs the rig split into 2 layers (arm in front) with their own meshes; the archived repo gets no fixes.
**Tradeoffs accepted**: no editor, poses are typed as joint positions in charts; linear-ish deformation between keys, so timing comes from the chart, not from a curve editor.

### Prior art, cited

- Igarashi, Moscovich, Hughes 2005, *As-Rigid-As-Possible Shape Manipulation* (SIGGRAPH) and Igarashi & Igarashi 2009 implementation paper (JGT 14:1). Technique: two-pass scale-free then scale-adjust solve with pins. Fits: single image, few handles. Tooling: the port. Cost: 1–2 days.
- Smith et al. 2023, *A Method for Animating Children's Drawings of the Human Figure* (ACM TOG) and facebookresearch/AnimatedDrawings (MIT). Technique: mask + 17-joint skeleton + ARAP; `char_cfg.yaml` as the rig SSOT. Fits: no hand-authored multi-part rig. Cost: port + yaml reader.
- Pose Animator (TensorFlow blog 2020, Apache-2): LBS over SVG with 1/d² nearest-bone weights. Fits: fallback weights if ARAP self-overlap needs a hybrid. Cost: half a day.
- Mercury Filmworks on *Hilda* (Toon Boom, 2022, updated 2025-05): rigs plus deliberately traditional methods "to retain a drawn aesthetic"; drawings are tweaked instead of redrawn; lighting posed with the rig. Fits: the D72 hybrid (rig carries breakdowns, drawn keys carry the acting) is the broadcast-standard shape of this look.
- webglfundamentals *WebGL Skinning* (Gregg Tavares): bind-pose inverse and bone matrices in a texture. Fits: only if the LBS fallback is taken.

### Step 1 — setup (day 1)

```bash
cd media/showcase && npm i earcut && npm i -D @types/earcut
# skeleton SSOT: assets/<c>/char_cfg.yaml (AnimatedDrawings shape) — mask.png already exists for human
```

### Step 2 — proof of concept (day 1–2)

```ts
// src/library/motion/arap.ts  (port of animated_drawings/model/arap.py, MIT)
export type Mesh = { vertices: Float32Array; triangles: Uint32Array };
export class Arap {
  constructor(mesh: Mesh, pinsRest: Float32Array, w = 1000) { /* build + factor L1, L2 */ }
  solve(pinsNow: Float32Array): Float32Array { /* two passes, returns vertices */ }
}
// src/library/cast/MeshFigure.tsx — <ThreeCanvas> BufferGeometry(positions from arap.solve, uv from rest), MeshBasicMaterial(map: figure PNG, transparent)
// pins = joint positions from the chart at this frame (pose-to-pose on twos via motion.ts)
```

### Step 3 — integration (week 1)

- [ ] `maskToMesh(mask.png) -> Mesh` (contour via marching squares, simplify, earcut; interior points on a grid so ARAP has interior freedom)
- [ ] `char_cfg.yaml` reader; joints become pins; registration gate measures rest-pose IoU and joint error (tech-rig-01)
- [ ] `MeshFigure` replaces `HumanPuppet` in `RigSheet` column 2; puppet-proof-03 renders the same 40 frames
- [ ] key plates: a plate registered to the skeleton is a second `MeshFigure`; `motion.ts` `holdKey()` / `breakdown()` choose which figure is visible at a charted frame
- [ ] layer split for overlap: front arm as its own mesh with its own pins

## Evaluation

| Metric | Target | Measure after |
|---|---|---|
| connected silhouette | 1 component at every frame of puppet-proof-03 | step 3 |
| joint error at rest | ≤ 2 px, IoU ≥ 0.97 | step 3 |
| solve time | ≤ 20 ms/frame at ≤ 800 verts | step 2 |
| rubric C21/C23 on s02 | pass | first shot under D72 |

## Refinement

- Flip to HOLD if ARAP cannot hold a forearm-across-torso pose without a layer split that costs more than a drawn key.
- Revisit ToonCrafter when a breakdown's texture (fabric, hair) reads as warped; it would texture between drawn keys rather than replace the rig.

| Risk | Mitigation | Owner |
|---|---|---|
| port bugs in the sparse solve | compare against the Python reference on one pose set (same mesh, same pins, max vertex error < 0.5 px) | rig step |
| GPL contamination | puppet-warp never imported; only the MIT repo is read | rig step |
| texture stretch on big bends | that pose becomes a key (D72 rule) | motion step |

## Outcome 2026-10-13 (puppet-proof-03)
ADOPT held: port landed (`src/library/motion/arap.ts`, `mesh.ts`, `cast/MeshFigure.tsx`), silhouette one component on all 90 frames against three on the cutout puppet, rest IoU 0.9879, joint error 0 px, solve median 1.3 ms. Reference finding: the shipped AnimatedDrawings solver is float32 and errs by up to 219 px at rest for this mesh at w = 1000; a float64 copy agrees with the port to 0.0002 px. Refinement check: raises past ~105° drag the poncho in a single layer; per D72 a raise is a drawn key, so the layer split stays unbuilt until a shot needs it.
