**Summary**: The timing chart `v3/charts/s01-arrival-overwhelm.json` (with `v3/charts/s01-arrival-overwhelm.md`) is unchanged (last written 2026-10-15 11:40, before run 5); its camera row follows the layout contract's zoom 0.6. The pose pass owns how the human travels between these keys.

- **Key List (human)**: rest-on-lid 0, grip 42, lift 66, awe 104, brace 154, joy-a 190, joy-b 228, shrink 272. The chart keys equal the pose sheet's keys by name and frame.
- **Charts**: unchanged.
- **Staggers and Lag**: unchanged.
- **Boil and Pulses**: unchanged.
- **Camera**: locked 0-150, widen 150-210 to (604, 103, x0.6) per the layout contract, held to 420.
- **Checks run**: `probe-timeline.py v3/timeline.json` passes; `probe-poses.py v3/poses v3/keys v3/charts --joints solved` exits 0.
- **Library Changes Needed**: none.
- **Artifact Handoff**: `v3/charts/s01-arrival-overwhelm.json`, `v3/charts/s01-arrival-overwhelm.md`; no `motion.md`.
- **Concerns**: none new; this step edits nothing.
