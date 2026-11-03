**Summary**: The key sheet `v3/keys/s01-arrival-overwhelm.json` is restored byte-for-byte from the pre-drive backup (`cmp` clean), so key `awe` carries its declared S spine again. No plates were rebuilt; the sheet is the one run 5 produced.

## Context
Read `v3/keys/s01-arrival-overwhelm.json` and `v3/poses/s01-arrival-overwhelm.json`.

## Analysis
The planted straight spine on key `awe` was undone by restoring the file. All eight keys are the run 5 keys.

## Goals
Have the `animation-key-fit` check pass on the restored key sheet.

## Execution
Restored `v3/keys/s01-arrival-overwhelm.json` from `~/.cache/showcase-gateproof/before/`. `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys` exits 0 by hand.

## Evaluation
Done: restore verified with `cmp`; the keys probe passes by hand. Not done: no plates rebuilt.

**GATE_REVIEW: PASS - the restored key sheet reads as declared on every key.**

HANDOFF RESULT
node: keys
Proposed Gate Review:
- Animation Key Fit: PASS — the keys probe exits 0 on the restored sheet.
