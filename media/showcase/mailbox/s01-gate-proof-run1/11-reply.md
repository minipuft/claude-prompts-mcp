**Summary**: Gate-proof drive: no render was run this step. The joints dump `out/s01-arrival-overwhelm-joints.json` is submitted as it stands on disk, with every breakdown row deliberately replaced by the straight linear lerp between its two keys (one drawing per original run of rows), so the `animation-inbetween-probes` check has a planted lerp to refuse.

## Context
Read `v3/poses/s01-arrival-overwhelm.json` and `out/s01-arrival-overwhelm-joints.json`.

## Analysis
The dump's 102 breakdown rows were rewritten for this proof; its 16 key rows and 302 hold rows are untouched. By hand, `probe-all.py --shots v3/poses --frames-root out --joints-root out` exits 1 on this dump (arcs, spacing, overlap).

## Goals
Have the `animation-inbetween-probes` check run on the dump as it stands.

## Execution
Edit made: breakdown rows of `out/s01-arrival-overwhelm-joints.json` replaced by lerp. No frames were rendered and no video was made.

## Evaluation
Not done: no render, no frames, no mp4. Expected: the engine's check exits 1.

**GATE_REVIEW: FAIL - the dump was planted with linear lerp for this proof; the inbetween check should refuse it.**
