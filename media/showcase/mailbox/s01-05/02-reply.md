**Summary**: Run 5 keeps the timing chart (`v3/charts/s01-arrival-overwhelm.json` with its `.md`); the checks found no defect in it and its camera row already follows the layout contract's zoom 0.6. The pose pass (next step) owns how the human travels between these keys.

- **Key List (human)**: rest-on-lid 0, grip 42, lift 66, awe 104, brace 154, joy-a 190, joy-b 228, shrink 272 (declared long hold). The chart keys equal the pose sheet's keys by name and frame (8 of 8).
- **Charts**: unchanged; non-human tracks (box.lid, bubble.size, gadget.rise/glow, codex/clawd lean, codex.catch, clawd.push, stalk0.grow, light seam/dial/flood/grain) and the 50 pieces as in run 4.
- **Staggers and Lag**: pieces start 3-5 frames apart; Codex's lean 4 frames before Clawd's; light lag 3 frames, recovery 12.
- **Boil and Pulses**: boil 3 variants at rate 4, seed 11; pulses at frames 44 (lid cracks) and 180 (the pop).
- **Camera**: locked 0-150, widen 150-210 on ones to (604, 103, x0.6) per the layout contract `cameraPose`, held to 420; led by the bubble then stalk0's curl. Chart camera row matches (checked by reading `camera.note` and `span`).
- **Checks run**: `probe-timeline.py v3/timeline.json` passes (8 beats, 1950 frames); `v3/blocking/arrival.json` and `everything-at-once.json` exist; `probe-poses.py ... --joints solved` passes (keys category included).
- **Library Changes Needed**: none.
- **Artifact Handoff**: `v3/charts/s01-arrival-overwhelm.json`, `v3/charts/s01-arrival-overwhelm.md`; no `motion.md` (the chart .md carries the per-beat rhythm).
- **Concerns**: the chart still carries the 33 favour-only breakdowns of run 1; they are not played (the pose sheet's breakdowns replace them in `shotS01Plan.ts`).
