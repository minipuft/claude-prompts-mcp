**Summary**: The timing chart from run 1 (`v3/charts/s01-arrival-overwhelm.json`, with `s01-arrival-overwhelm.md`) is kept; the checks found no defect in it, and its camera row now follows the layout contract's zoom 0.6. The pose pass (next step) owns how the human travels between these keys; the chart's own favour-only breakdowns are superseded there.

- **Key List (human)**: rest-on-lid 0 (hold 26), grip 42 (16), lift 66 (26), awe 104 (26), brace 154 (24), joy-a 190 (22), joy-b 228 (20), shrink 272 (148, declared long hold). These eight frames are the contract the pose sheet must keep.
- **Charts**: unchanged; non-human tracks (box.lid, bubble.size, gadget.rise/glow, codex/clawd lean, codex.catch, clawd.push, stalk0.grow, light.seam/dial/flood/grain) and 50 pieces as in run 1.
- **Staggers and Lag**: pieces start 3-5 frames apart; Codex's lean 4 frames before Clawd's; light lag 3 frames, recovery 12.
- **Boil and Pulses**: boil 3 variants at rate 4, seed 11; pulses at frame 44 (lid cracks) and 180 (the pop).
- **Camera**: locked 0-150, widen 150-210 on ones to (604, 103, x0.6) per `v3/layouts/s01-arrival-overwhelm.json` `cameraPose`, held to 420; led by the bubble then stalk0's curl. Chart note, `v3/shots.json` and `scripts/s01_chart.py` updated from 0.425.
- **Checks run**: `probe-timeline.py v3/timeline.json` passes (arrival 0-180, everything-at-once 180-420, no crossing in the shot); `v3/blocking/arrival.json` and `everything-at-once.json` exist; the eight chart keys equal the pose sheet's keys by name and frame (`probe-poses` keys category: 8 of 8 ok).
- **Library Changes Needed**: none new for this step.
- **Artifact Handoff**: `v3/charts/s01-arrival-overwhelm.json`, `v3/charts/s01-arrival-overwhelm.md`; no `motion.md` is written (the chart .md carries the per-beat rhythm, as in run 1).
- **Concerns**: the chart still holds the 33 favour-only breakdowns of run 1; they are not played (the pose sheet's breakdowns replace them in `shotS01Plan.ts`) but they remain in the file as the older reading.
