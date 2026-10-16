**Summary**: `v3/poses/s01-arrival-overwhelm.json` is unchanged (last written 2026-10-15 17:32, before this drive): eight keys at the chart's frames, each with its curve class, weight, lead and family, and solved joints. No declaration was edited.

## Context
Read `v3/poses/s01-arrival-overwhelm.json`, `v3/charts/s01-arrival-overwhelm.json`, `v3/layouts/s01-arrival-overwhelm.json`, `assets/human/model.json`. Nothing was edited.

## Analysis
The pose sheet keeps eight keys (rest-on-lid 0, grip 42, lift 66, awe 104, brace 154, joy-a 190, joy-b 228, shrink 272) with their breakdowns as in run 5. The solved-joints probe reads the sheet as declared.

## Goals
Keep the pose sheet so the key step rebuilds the plates from it.

## Execution
No edits. Probe: `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints solved` exits 0 (output saved to `~/.cache/showcase-gateproof/probe-poses-solved.txt`). The same probe with `--joints keys` on the current key sheet also exits 0.

## Evaluation
Done: both probes exit 0. Not done: no card use recorded this drive (nothing changed).
