**Summary**: Recompiled the timeline with `node scripts/animation/compile-timeline.mjs` (8 beats, 1950 frames, 4 crossings) and `cmp` against a backup shows `v3/timeline.json` byte-identical. Every beat's drawn actions fit its clear frames; no ledger change is proposed. This is the closing drive of the animatic run (row 3.2): contracts and frames are reused, nothing is re-rendered.

## Context
Episode root `media/showcase/v3`, renderer `media/showcase`. Ledger `v3/beats-v2.json` (D78 worlds, D79 65 s, provisional until the plot asks are answered). Hold band 11-27 frames, 3-6 drawings per move (`studies/craft-ref-01.md`). Compile output: `timeline: 8 beats, 1950 frames (declared duration 1950), 4 crossings -> v3/timeline.json`.

## Analysis
Timeline (30 fps; crossing windows are 35 frames a side of each cut):

| id | world | start-end | seconds | in / out | crossing window | state flips (scope) |
| --- | --- | --- | --- | --- | --- | --- |
| arrival | home | 0-180 | 6 | title held / bubble swells | none | box.open, gadget.visible (permanent) |
| everything-at-once | home | 180-420 | 8 | continuous / pieces keep arriving | none | hue to s01 blue (beats 2-3), pieces.count many (until home-settle) |
| cant-build | home | 420-630 | 7 | continuous / frame bar rises | none | hue to s02 steel, grain high (beats 3-4), gadget.held false (until home-settle) |
| the-frame | home | 630-810 | 6 | frame rising / human steps through | out 775-845 | human.garment cloak to swoop (permanent), emitter to frame interior (beats 4-7) |
| art-world | crayon | 810-1170 | 12 | refill from glass / reduce to contour lines | in 775-845, out 1135-1205 | field paper (this beat), pieces.made_by_human (permanent) |
| crossing | line | 1170-1290 | 4 | reduce to lines / refill into shaded | in 1135-1205, out 1255-1325 | guide.lead clawd to codex (beats 6-7) |
| programming-world | shaded | 1290-1650 | 12 | refill from lines / silhouette leads the pull back | in 1255-1325, out 1615-1685 | joins.lit, chain.ran (permanent) |
| home-settle | home | 1650-1950 | 10 | pull along the silhouette / title | in 1615-1685 | hue to s04 coral, grain low, gadget.held rests (permanent) |

## Goals
Every beat has frames, the frames sum to 1950, every crossing window sits inside both beats, and each beat's actions fit its seconds at the hold band.

## Execution
Pacing per beat (clear frames = beat frames minus crossing-window frames; one drawn action needs at least 11): arrival 180 clear, 4 actions, 44 needed, fits. everything-at-once 240, 4, 44, fits. cant-build 210, 3, 33, fits. the-frame 145, 4, 44, fits. art-world 290, 4, 44, fits. crossing 50, 4, 44, fits with 6 frames to spare, so a 3-6 drawing move per action does not fit and it reads as one continuous re-route. programming-world 290, 4, 44, fits. home-settle 265, 5, 55, fits.
Asks left open by the ledger, each with its default: (1) art-world, which object the human draws first, default the first stalk; (2) programming-world, how many gates light, default three, the third the one the human made. Neither changes a frame count.
Changed (files): none.

## Evaluation
Gate command `python3 scripts/animation/probe-timeline.py v3/timeline.json`, exit 0, fresh run:
```
control: planted 0-frame beat -> FAIL (beats cover the duration); planted 3-frame gap -> FAIL (beats cover the duration); planted crossing outside its beat -> FAIL (crossing windows inside both beats); planted unknown world -> FAIL (worlds in the registry); planted 8-frame beat -> FAIL (every beat can hold); clean timeline -> pass (0 failures)
  ok   beats cover the duration: 8 beats contiguous from 0, summing to 1950 frames
  ok   crossing windows inside both beats: 4 windows, each inside the two beats it joins
  ok   worlds in the registry: all worlds in ['crayon', 'home', 'line', 'shaded']
  ok   every beat can hold: every beat has >= 11 frames clear of crossing windows
pass: timeline-contract - 8 beats cover 1950 frames, 4 crossings sit inside both beats, every beat can hold
```

## Refinement
Not proposed: lengthening the crossing beat from 4 s; a ledger diff would be `crossing: 4 -> 5`, moving every later beat +30 frames, for the owner to decide after watching the animatic.
