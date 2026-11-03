**Summary**: `v3/poses/s01-arrival-overwhelm.json` now names, for each of the eight chart keys, the reference card it borrows curve class, weight kind and lead from (nine `eagle_board.py apply` uses recorded), the plate family it is cut from, and the `solved` joints `solvePose` draws for the declaration (`npm run solve-poses -- s01-arrival-overwhelm`, new). The solved-joints probe passes on the sheet; the key sheet from run 1 fails the measured-joints probe on 8 of 8 keys, which is the re-key brief.

## Context
Shot s01-arrival-overwhelm, 420 frames. Inputs read: `v3/charts/s01-arrival-overwhelm.json` (keys), `v3/layouts/s01-arrival-overwhelm.json` (camera now ends at zoom 0.6), `v3/blocking/arrival.json`, `everything-at-once.json`, `assets/human/model.json` and `skeleton.json`, `v3/references/owner/picks.json`, `v3/rubric.md` v1.9 (C16, C21, C31-C33), `src/library/animation/pose.ts`.

## Analysis
- The run 1 declarations were a first reading from the chart's prose. Re-reading each key against the cards, the curve class and lead stayed; what changed is provenance (a named card per key), the plate family, and the lead leg of joy-b (the kick card has opposite arm and leg lead: arm R, leg L).
- Twinning: solved grip scored 0.71 and brace 0.73 (over 0.7) with no reason given. The solver leaves both legs near mirror in an upright stance (thigh and shin within 1-4 degrees) and a lead leg moves the ankle only, so adding one to grip made it worse (0.79). Both are matched gestures on purpose (both hands take the lid; both hands drawn to the chest), so each now carries `twinned.why`. This is a declaration, not a change to `solvePose`; the plates will show whether it is the right call.
- `solvePose` reads back every declared class with the bow within 0.02 (`check-pose.mjs` 8 of 8) and the weight check passes on all 8 solved keys, so no solver defect was found.

## Goals
Pose sheet judged before any plate exists (`--joints solved`); key sheet re-cut per plate family from the sheet; cards recorded so the ledger can say which reference led to which key.

## Execution
Poses (key · frame · curve class/bow/sign/lean · weight · lead arm/leg · silhouette · family · card):

| key | frame | curve | weight | lead | silhouette | family | card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rest-on-lid | 0 | C 0.06 / -1 / 12 | both | none / none | closed | lid | MFJFS03XZOP7E |
| grip | 42 | C 0.10 / -1 / 18 | R 0.6 | R / none | fold | lid | MFJG10AXINU2X |
| lift | 66 | C 0.06 / +1 / -8 | R 0.7 | R / L | open | lid | MFJG10AXINU2X |
| awe | 104 | S 0.10 / -1 / -6, infl 0.5 | L 0.6 | R / R | open | open | MFJFS03X49AQO |
| brace | 154 | C 0.08 / +1 / -14 | L 0.55 | L / R | closed | guard | MFJG10AX4YB91 |
| joy-a | 190 | C 0.12 / -1 / -18 | R 0.8 | L / L | star | burst-a | MFJFTELH7A9UQ, MFJFRODX2CIQ5 |
| joy-b | 228 | S 0.12 / +1 / 18, infl 0.45 | L 0.8 | R / L | star | burst-b | MFI6SYYWK85H4 |
| shrink | 272 | C 0.14 / -1 / 4 | both | none / none | fold | fold | MFJG10AV4V3U5 |

Each moment is the key's `moment` in the sheet (unchanged from run 1). Plate families: keys share one only when one inbetweens to the other without a limb crossing the torso or the figure turning; joy-b turns the other way, so burst-a and burst-b are separate, and brace (hands to the chest) is not in awe's open family.

Breakdowns, secondaries and moving holds are the run 1 authored set, unchanged (the timing shape and lead-arm rules are kept): 7 moves of 3-6 drawings (awe -> brace opens with the one anticipation at frame 130, brace -> joy-a carries the one overshoot at 1.15), poncho (stretch 0.6) and both hands (sides L and R) lag 2 drawings, a moving hold on every key.

Cards Applied (id · to · note, as recorded in `v3/references/owner/picks.json`): MFJFS03XZOP7E rest-on-lid (curve C, weight both) · MFJG10AXINU2X grip (C, back foot, lead arm) · MFJG10AXINU2X lift (back foot, lead arm, C flipped) · MFJFS03X49AQO awe (S, one foot, lead leg) · MFJG10AX4YB91 brace (C, lead arm, closed) · MFJFTELH7A9UQ joy-a (star, lead both sides) · MFJFRODX2CIQ5 joy-a (C) · MFI6SYYWK85H4 joy-b (S, one foot, opposite arm and leg lead) · MFJG10AV4V3U5 shrink (C, fold). `eagle_board.py ledger`: pose section 10 picks, 8 applied; 9 uses on the sheet; receipt `evidence/drive-VcQYuF`.

Probe Lines (full output `out/s01-02-probe-poses-solved.txt`), command `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints solved`, exit 0:
`pass: poses - 1 shot(s) (solved joints): keys, line of action, twinning, weight, breakdowns, secondaries, holds, timing shape and lead arm all as declared` (line of action 16 items ok, twinning 8 ok, weight 8 ok, 7 timing-shape lines ok).

Re-key Brief (the run 1 key sheet under `--joints keys`, `out/s01-02-probe-poses-keys-before.txt`, 16 of 34 checks fail): line of action refused on rest-on-lid (reads I, bow 0.038), lift (I, 0.014), awe (I, 0.007), brace (I, 0.021), joy-b (reads C, bow 0.064, declared S); bow under 0.06 on grip (0.059) and shrink (0.045); weight refused on lift (root x 416, expected 363), awe (442 vs 317), brace (418 vs 327), joy-a (311 vs 382), joy-b (414 vs 288). All eight keys are re-drawn.

## Evaluation
Done: solved-joints probe exit 0 with its controls tripped (including the new solved-mode control: straight solved joints declared S refused on line of action only); `check-pose.mjs` 8 of 8. Not done here: nothing is measured on plates yet.

Changed: `v3/poses/s01-arrival-overwhelm.json` (cards, plateFamily, twinned.why on grip and brace, joy-b lead leg L, solved + solvedAt, note), `v3/references/owner/picks.json` (nine applies), `scripts/animation/solve-poses.mjs` (new), `scripts/animation/probe-poses.py` (`--joints keys|solved`), `scripts/animation/README.md`, `package.json` (`solve-poses`), `src/library/animation/pose.ts` (optional `solved`, `solvedAt` on `PoseKey`).

Receipt: `evidence/drive-VcQYuF`.

**Gate Coverage**:
- [1] PASS: `probe-poses.py v3/poses v3/keys v3/charts --joints solved` exits 0; control line printed first and tripped.

**GATE_REVIEW: PASS - the pose sheet passes the solved-joints contract; the measured-joints failures of the run 1 key sheet are the re-key brief for the next step**
