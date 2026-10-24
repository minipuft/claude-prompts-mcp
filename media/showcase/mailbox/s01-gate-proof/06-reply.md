**Summary**: The key sheet `v3/keys/s01-arrival-overwhelm.json` is submitted as it stands on disk, byte-identical to the pre-drive backup (`cmp` clean). No plates were rebuilt this step.

## Context
Read `v3/poses/s01-arrival-overwhelm.json` and `v3/keys/s01-arrival-overwhelm.json`.

## Analysis
All eight keys are the run 5 keys, including `awe` with its declared S spine.

## Goals
Have the `animation-key-fit` check run on the key sheet as it stands.

## Execution
No edits. `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys` exits 0 by hand.

## Evaluation
Done: the keys probe passes by hand. Not done: no plates rebuilt.

**GATE_REVIEW: PASS - the key sheet reads as declared on every key.**

HANDOFF RESULT
node: keys
Proposed Gate Review:
- Animation Key Fit: PASS — the keys probe exits 0 on the sheet as it stands.
