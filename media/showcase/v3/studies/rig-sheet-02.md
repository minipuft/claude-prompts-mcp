# Study rig-sheet-02 · D71 part renderings side by side, hair behind the head

2026-10-13 · supersedes `rig-sheet-01.png`. Same rig (`assets/human/rig.json`), same 15 parts, three renderings of every part compared at rest with the head enlarged under each: hard cut (the cutter's nearest-colour PNG) · soft alpha + contour (blurred mask σ≈1.1 at plate scale, pale halo ~5 px one step lighter drawn under) · vector + contour (VTracer spline over the same halo). Face is row 2 (D70 revised). Nothing drawn by hand.

Files (absolute): `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v3/studies/rig-sheet-02.png` (sha 5ba46018eb8a), `rig-sheet-02-heads-x3.png` (the three head windows at 3×).

## Changed
- `src/library/cast/HumanPuppet.tsx`: `render` prop (`hard` | `soft` | `vector`, default `soft`); soft and vector draw `<part>-contour.png` under the part; soft and contour files carry the cutter's 8 px pad and are placed at anchor − 8. A child whose `z` is below its parent's now draws BEHIND the parent — before this the hair (child of head, z 1 < 5) drew over the face on every render, visible in rig-sheet-01 as one eye peeking through hair.
- `src/scenes/RigSheet.tsx`: middle column = the three renderings + head windows; face states at 1:1 sit on their contour halos.

## Grades
- D71 HOLDS on the sheet — the hard cut shows stair-stepped edges on every hair and arm contour at 0.34 scale and at the head window; soft and vector read as drawn lines with a continuous pale contour.
- C3/C4 (stipple shadow survives) — hard and soft keep the stipple dots on the hair underside; vector merges them into blobs at `color_precision=4`.
- Identity pass at ≈40 px HOLDS for all four row-2 states, now with the face unobstructed.
- Open on the pose strip (pre-existing, unchanged): frames 28–36 the forearms cross the torso in anticipation; a rig anchor edit, not a rendering one.

## Controls
- Hard column is the control: identical rig and pose, only the file per part differs.

## Owner
1. Rendering for the film. Default **soft + contour**: it keeps the generated stipple the vector flattens, and costs nothing per frame. Vector stays as the option for a part that has to scale large (a close-up head).

## Next
- Hair anchor: the swoop now sits behind the head; check it against `human-gen-16` where the hair wraps the crown, and move it if the crown should be covered.
- The Cloak as a second puppet, the s02 cloak→swoop transition, boil (2–3 contour variants or seeded displacement on the soft masks), then `>>showcase_shot shot:"s02-cant-build-frame"`.
