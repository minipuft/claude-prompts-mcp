**Summary**: Gate-proof drive: the key sheet `v3/keys/s01-arrival-overwhelm.json` is submitted as it stands on disk. No plates were rebuilt this step. For this proof the spine joints of key `awe` (torso, neck, shoulders) were deliberately placed on the root-to-head chord, so the engine's key-fit check has a planted straight spine to refuse.

## Context
Read `v3/poses/s01-arrival-overwhelm.json` and `v3/keys/s01-arrival-overwhelm.json`.

## Analysis
Key `awe` declares an S line of action (bow 0.10, sign -1). Its spine joints were flattened by hand for this proof; the other seven keys are untouched.

## Goals
Have the `animation-key-fit` check run on the key sheet as it stands.

## Execution
Edit made: key `awe` joints torso, neck, shoulderL and shoulderR moved onto the chord. No plate was rebuilt.

## Evaluation
Not done: no plates built, no probe claimed passing here. A local run of `probe-poses.py ... --joints keys` reports FAIL for key awe (line of action, bow, twinning, keysHash).

**GATE_REVIEW: FAIL - key awe was planted straight for this proof; the key-fit check should refuse it.**

HANDOFF RESULT
node: keys
Proposed Gate Review:
- Animation Key Fit: FAIL — key awe's spine reads straight, not the declared S (planted).
