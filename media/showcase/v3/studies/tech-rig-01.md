# Study tech-rig-01 · why the rig is not 1:1, and the jumping-off project

2026-10-13 · `>>tech_recommendation` run 2 (chain-tech_recommendation#1, second execution) on the owner's question: the rig should be 1:1 with the generated figure; what leads to the inconsistencies and disconnected limbs, and which project to start from.

## Diagnosis (cause, not symptom)
1. Two generations, one figure: parts came from a separate parts-sheet generation (`human-gen-18`), not from the approved plate (`human-gen-16` Swoop). No transform maps a sheet part to the plate, so 1:1 is impossible by construction.
2. Anchors without a skeleton: `rig.json` stores per-part PNG anchors, not shared joints. An elbow is one point owned by two parts; per-part anchors let them drift, which is the disconnected limb.
3. No overlap at joints: sheet parts end at the joint, so any rotation opens a seam. Cutout practice extends each child past its joint under the parent (a cap disc).
4. No registration: nothing measured the assembled rest pose against the plate; gaps were found by eye on the third sheet.

## Verdict: TRIAL — Meta AnimatedDrawings as the RIG SOURCE OF TRUTH; Remotion stays the renderer
- Smith, Zheng, Li, Jain, Hodgins, "A Method for Animating Children's Drawings of the Human Figure", ACM TOG 42(3) 2023 · github.com/facebookresearch/AnimatedDrawings (MIT, weights MIT, archived 2025-09-03, read-only).
- Taken: detector + pose estimator → `char_cfg.yaml` (mask, 17 joints with parents) + `fix_annotations.py` web UI for joint corrections. Runs in Docker/TorchServe on CPU (README names 16 GB RAM, no GPU).
- Not taken: its Delaunay/ARAP mesh animation, BVH retargeting and OpenGL renderer (tweens on ones, ignores roles, renders outside Remotion).
- Own deterministic half (~300 lines Python, Pillow/NumPy): parts cut FROM THE PLATE by nearest-bone assignment (Pose Animator's 1/d² rule, Huang 2020, hard-assigned) with a cap disc at each root joint for overlap; `rig.json` GENERATED from the skeleton (pivot = root joint, parent = bone parent); registration gate = rest-pose mask IoU ≥ 0.97 against the plate AND every joint within 2 px.
- Avoided for now: See-Through + Stretchy Studio (anime-trained decomposer, GPU-shaped, browser editor); MediaPipe/OpenPose (photo priors) kept only as a comparator.

## Owner question
Approve the trial toolchain (conda env + Docker TorchServe, once per character) and the retirement of the parts-sheet generation step. On approval this becomes D72: rig SSOT = skeleton on the approved plate; parts derived; rest pose must register before a rig is accepted.

## Next on approval
1. Run the detector on `human-gen-16` Swoop (inverted to a white field for detection only), fix joints, commit `char_cfg.yaml` with sha.
2. `scripts/rig_from_skeleton.py` + `register_rig.py`; `cutout.py --skeleton`; `HumanPuppet` reads `rig.skeleton`, rotation targets are joint names.
3. rig-sheet-03 with the plate ghosted under the rest pose and the IoU/joint numbers; then the Cloak by the same path as the real trial (target ≤ 30 min).
