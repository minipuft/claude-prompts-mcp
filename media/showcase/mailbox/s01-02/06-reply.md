**Summary**: The human's eight keys were redrawn per plate family from the pose sheet through `imagegen` (6 sheets, then each failing family regenerated once with its failing property named), cut, registered to the rig and measured. 2 of 8 keys pass `probe-poses.py --joints keys` (rest-on-lid, shrink) and 6 stay REJECTED on the sheet after their one regeneration (grip, lift, awe, brace, joy-a, joy-b). The joints are placed by eye (no skeleton toolchain), so a verdict within about 0.02 of the 0.06 bow bar is not conclusive.

## Keys (id · frame · declared vs measured (class bow sign) · twinning · plate · status)
| key | frame | declared | measured | twin | plate | status |
| --- | --- | --- | --- | --- | --- | --- |
| K1 rest-on-lid | 0 | C 0.06 -1 | C 0.094 +1 | 0.66 | `assets/human/keys/s01-arrival-overwhelm/K1.png` | accepted, flag: bows right, declared left |
| K2 grip | 42 | C 0.10 -1 | C 0.101 +1 | 0.60 | K2.png | REJECTED: weight on R at 0.60 but the root is over the left foot (58 % of the stance off) |
| K3 lift | 66 | C 0.06 +1 | I 0.035 -1 | 0.20 | K3.png | REJECTED: reads I, bow 0.035 |
| K4 awe | 104 | S 0.10 -1 | C 0.051 +1 | 0.84 | K4.png | REJECTED: reads C not S, bow 0.051, limbs twinned (0.84) with no `twinned.why` |
| K5 brace | 154 | C 0.08 +1 | I 0.013 -1 | 0.26 | K5.png | REJECTED: reads I, bow 0.013 |
| K6 joy-a | 190 | C 0.12 -1 | I 0.033 +1 | 0.00 | K6.png | REJECTED: reads I, bow 0.033 |
| K7 joy-b | 228 | S 0.12 +1 | C 0.048 +1 | 0.11 | K7.png | REJECTED: reads C not S, bow 0.048, weight on L at 0.80 but the root is 29 % of the stance off |
| K8 shrink | 272 | C 0.14 -1 | C 0.072 -1 | 0.68 | K8.png | accepted, flag: bow 0.072 is more than 0.02 under 0.14 |
Sheets (round 1 kept in `assets/human/keys/s01-arrival-overwhelm/rejected-r2/`, round 2 in `out/`): `out/s01-arrival-overwhelm-keys-human-{lid,open,guard,burst-a,burst-b}-02.png` (`-open-02-clean.png` is the open sheet with the panel border it drew round row 1 painted black so the cutter finds the baseline). K8's plate is round 1 (it passed, so it was not regenerated). Joints registered: yes, all eight (`v3/keys/s01-arrival-overwhelm.json`, from `v3/keys/s01-arrival-overwhelm.plate-joints.json` by `scripts/s01_keys_to_rig.py`; status per key from `scripts/s01_keys_status.py`).

## Frame Keys / Model-sheet Overlay / Silhouettes / Clean-up
- Frame keys F1-F7 (row 2): the figure's height in a thumbnail and the emitter were NOT measured: the blue test also catches Codex, and the figure's feet are hidden behind the box (the same flaw as run 1, gap 5). Row 2 shows the plain box, the seam light and both companions on every thumbnail (viewed).
- Overlay (C20, `out/s01-keys-measure.json`): figure height against the model by plate scale (scale estimated from face and hair-to-baseline, so not independent): K1 -1.3 %, K2 -3.1 %, K3 +5.4 %, K4 +11.8 %, K5 -2.7 %, K6 +10.8 %, K7 +0.8 %, K8 +5.9 %. Limbs over 105 % of the model's: K3 ankleL 117 %, K4 all four (wristL 144 %), K6 ankleL and wristL, K7 ankleL, ankleR and wristL, K8 wristR 112 %.
- Silhouettes (C21, `out/s01-02-keys-silhouettes.png`, filled black, the fill closes the gap between the legs): K4, K6 and K7 read (arms apart), K1 and K3 read, K5 reads weakly (hands inside the torso), K8 is one lump with the hands lost.
- Contour (C22): ratio to the model within 10 % for K1-K5 and K7 (-2, -8, -1, +8, +6, +11 %), K6 +21 %, K8 +15 % (`out/s01-keys-measure.json`, quantised proxy).
- Pose picture: `out/s01-02-pose-sheet.png` (`PoseSheetS01`, plate left and rig right).

## Probe Lines
`python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys` before the re-key: 16 of 34 checks failed (`out/s01-02-probe-poses-keys-before.txt`); after round 1 of generations: 16 of 34 (`-a1.txt`, 8 of 8 keys line of action but K8); after the one regeneration: 13 of 30 (`out/s01-02-probe-poses-keys-a2.txt`). Table: `out/s01-02-keys-table.txt`.

## Generation Receipts
`evidence/s01/r2/keys-req-<family>-<01|02>.json` and `imagegen-keys-<family>-<01|02>.json` (families lid, open, guard, burst-a, burst-b, fold-01). References per request: model sheet, the approved pick, the cinematography sheet, and a pose guide (`out/s01-02-guides/<family>.png`, new `scripts/s01_pose_guides.py`: spine as one curve with its dim chord, shoulders, hips and legs of the SOLVED joints, no arms). The cited pose picks were not attached as images (the library thumbnails are 220 x 124); their facets are in the prompts.

## Rejected Keys
K2, K3, K4, K5, K6, K7 (reasons in the table). Not regenerated a second time, as the step says.

## Concerns
- Joints by eye: the rig's neck and head joints are 18-19 mask px apart, so a 5-10 px placement error moves a measured bow by about 0.02, and `hold()` clamps those bones. All eight keys read the OPPOSITE spine sign where they read a sign at all (K1, K2, K4, K6 declared left read right; K3 and K5 declared right read left); the same convention reads the solved joints correctly (8 of 8), so this is either the plates or the placement, and the probe does not check the sign (the step's own rule does, as a flag).
- The solver's arms are one swing and one flex, so the guide leaves them out; K2 and K3 arms and the rest come from the prompt's words.
- Round 1 row 2 and the run 1 `sheet-a/b` files in the key directory are stale inputs of `scripts/s01_keys_measure.py`'s row 2 part; its F-lines are run 1's, not run 2's.

HANDOFF RESULT
node: keys
