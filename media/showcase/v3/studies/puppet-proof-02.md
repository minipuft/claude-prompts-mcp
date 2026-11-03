# Study puppet-proof-02 · the generated human moves, drawn on twos

2026-10-13 · first puppet under D65/D68/D69: parts from `human-gen-18-parts` cut by `scripts/cutout.py --field black` (15 parts), assembled by `assets/human/rig.json` (14 parts in a parent hierarchy; the full figure part00 is the assembly control), moved by `src/library/cast/HumanPuppet.tsx` through `motion.ts`. Nothing drawn by hand.

Files (absolute): `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v3/studies/puppet-proof-02.mp4` (90 frames, sha 942e324a7728), `-f000.png`, `-f040.png`, `-tri.png` (rest · frame 30 · raised), `-strip.png` (frames 28–39). Pass 01 (first rig, arms detached at rest, lift swung inward) is superseded by pass 02: limb pivots at each part's top center, anchors chained, rotation signs corrected.

## Changed
- `assets/human/parts.json`, `rig.json`, `public/assets/human/*` (parts served to Remotion).
- `src/library/cast/HumanPuppet.tsx` (nested peg hierarchy: shoulder → forearm → hand, with lag 3 and 5 frames), `src/scenes/PuppetProof.tsx`, `PuppetProof` composition.
- `src/library/tokens.ts`: human garment roles = Katz blue `#2f45a8`, mauve `#b983c0`, navy, cream, gold.

## Grades
- C16 HOLDS — per-frame pixel change in the drawn region over frames 29–39: 0.0, 8.5, 0.01, 11.52, 0.0, 10.74, 0.0, 2.24, 0.0, 2.68, 0.0: every other frame is a hold, the pose steps on twos — beats the linear tween control.
- C17 HOLDS — shoulder, forearm, hand start staggered by the lag chain (3 and 5 frames); visible in the strip as the hand arriving last.
- C14 UNPROVEN at this tier — a lift reads; reach, contact and settle need a scene.
- C1 HOLDS — hands sample `#67b479` after quantization.
- C2 HOLDS — fills are the role hexes by construction of the cut; no hex in the component.
- C13 UNPROVEN — no boil yet (needs 2–3 generated variants of the contour or a seeded displacement pass).
- C3/C4 HOLDS — the generated stipple shadows survive the quantization as the shadow role.

## Controls
- C16/C17: beats45-08 (SVG) held the same law; this is the first time it holds on generated parts.

## Owner
1. Face row from `human-gen-17-faces.png` (default row 2).
2. TASTE — at full raise the hands leave the frame top at this scale; the scene will place the puppet lower or raise less. No regeneration needed.

## Next
- Face parts from the picked row (eyes open/closed, mouth closed/o, pupils center/left) swapped on the head part.
- The Cloak as a second puppet (parts sheet of the left direction) and the cloak→swoop transition on s02.
- Boil: three generations of the contour layer, or a seeded displacement pass.
