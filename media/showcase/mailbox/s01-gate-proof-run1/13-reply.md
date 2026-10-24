**Summary**: The joints dump `out/s01-arrival-overwhelm-joints.json` is restored byte-for-byte from the pre-drive backup (`cmp` clean), so its breakdown rows carry the run 5 arcs and eases again. No render was run this drive; the dump and frames are the ones run 5 produced.

## Context
Read `v3/poses/s01-arrival-overwhelm.json` and `out/s01-arrival-overwhelm-joints.json`.

## Analysis
The planted linear lerp was undone by restoring the file. By hand, `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out` exits 0 (3 of 3 probe runs passed).

## Goals
Have the `animation-inbetween-probes` check pass on the restored dump.

## Execution
Restored `out/s01-arrival-overwhelm-joints.json` from `~/.cache/showcase-gateproof/before/`. Nothing else was edited.

## Evaluation
Done: restore verified with `cmp`; the probe passes by hand. Not done: nothing was rendered this drive.

**GATE_REVIEW: PASS - the restored dump reads as arcs that ease.**
