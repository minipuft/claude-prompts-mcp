**Summary**: Run 5 of s01-arrival-overwhelm is graded against `v3/rubric.md` v1.9 and written to `v3/studies/s01-05.md` with copies under `v3/studies/s01-05/`. The measured rows move (C20, C31 HOLDS; C22's weight in band) but the acting does not: C14, C21, C22 (clean-up) and C25 FAIL. I did not watch the mp4.

## Inspected Evidence
Viewed: `out/s01-05-strip.png` (12 frames), `out/s01-05-key-stills.png` (8 key stills, figure layer, 2x), `out/s01-05-keys-silhouettes.png`, `out/s01-05-c22-crop-k5.png` (3x), `out/s01-05-c22-crop-k1.png`. Measured: `out/s01-05-keys-table.txt`, `out/s01-05-probe-all-shots.txt`, `out/s01-05-inbetweens.txt`, `out/s01-05-frame-change.json`, `out/s01-05-measure.json`, frames 0 and 154 rendered twice. Not viewed: `out/s01-05.mp4`.

## Grades
- C1 HOLDS [still, sampled pixel] coral (232,106,75) and blue (80,126,241) on frames 0 and 154; skin 0 px on 200 under the flood.
- C12 HOLDS [sha256 of two renders] frames 0 and 154 identical (b59133fc1e12733e, 451bd3aa6453b818).
- C14 FAILS [key stills, strip; mp4 not watched] lift and awe read; grip, brace, joy-a, joy-b, shrink do not; frames 190-419 show no readable turn or fold.
- C16 HOLDS [consecutive frames, measured] 0 odd-frame changes, 106 even; one anticipation; no overshoot on the human.
- C18 HOLDS [consecutive frames, measured] change jumps at 180, 182, 183-186, 1.1 % by 190.
- C20 HOLDS [key table] 8.00 heads, limbs 1.00 (0.0 %); cannot fail on a solver plate (study gap 3).
- C21 FAILS [filled silhouettes] 8 of 8 one component; K5 a lump, K8 crossed forearms not visible.
- C22 FAILS [3x crop, measured contour] contour +7 to +16 % in band; torso seams ragged, no pale contour on several shapes at K1, K5, K7.
- C23 HOLDS [joints dump against sheet] 28 of 28 favours played at their frames.
- C24 UNPROVEN colour mask counts the human's palette (20 of 70 frames over 2 %).
- C25 FAILS [layout against frames] lamp 0.09 % of width off at frame 300; the 5 % figure-height clause unmet (48.6 % against 78.1 %).
- C27 HOLDS, C28 HOLDS [figure-only frames] controls tripped.
- C31 HOLDS [pose sheet + key sheet joints] 8 of 8 class and sign as declared, `--joints keys` 20 ok lines.
- C32 HOLDS, C33 HOLDS [joints dump + figure frames] 54 items measured, 0 failed.

## Controls
C31, C20, C22 (weight) flipped from run 2's FAILS; failing controls tripped in `out/s01-05-plates.log` and `out/s01-05-probe-poses-keys.txt` (a straight spine declared S, a grown contour, a swapped draw order). C14, C21, C22 (clean-up), C25 did not flip.

## Owner
1. TASTE (C14) Pile-of-parts torso on grip, brace and joy-b acceptable for a first cut? Default: draw those three plates.
2. TASTE (C14, D70) Face unreadable from frame 190 (18 px at 419): keep the layout framing or hold closer at 272? Default: keep the layout.

## Next
C14: watch the mp4 and give `SILHOUETTE_ARMS` per-key gesture targets; C21: shrink forearms outside the head silhouette, brace hands off the torso; C22: per-part seam contour and a measure for it; C25: take the 5 % clause from the key sheet's rig height and measure the frame-0 emitter at the seam.

## Rubric Evolution
None proposed: C31, C27, C28, C32, C33 have now graded HOLDS in two consecutive studies (runs 2 and 5), one short of baking. A candidate row for a per-part contour measure (gap 4) waits for an owner ruling.

## Concerns
- Two of the three inline gates (`animation-key-fit` on the delegated key step, `animation-inbetween-probes` on render) produced no gate review or shell verification in this drive; I ran both commands by hand (exit 0) and quoted them (study gap 1).
- The four contracts are byte-identical to the pre-drive copies and the plates to run 4's: the run proves determinism and the gates, not a design change (gap 2).
- Documentation reminders on this step attested not applicable below.
