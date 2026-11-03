**Summary**: `v3/poses/s01-arrival-overwhelm.json` is re-confirmed against the prompt's rules: eight keys at the chart's frames, each borrowing curve class, weight kind and lead from a named reference card, each naming its plate family, each with the `solved` joints `solvePose` draws (`npm run solve-poses -- s01-arrival-overwhelm`, byte-identical to run 4). Nine card uses are recorded against this drive's receipt. Both the solved-joints probe (this step's gate) and the measured-joints probe on the current key sheet pass, so the re-key brief is empty.

## Context
Shot s01-arrival-overwhelm, 420 frames. Read: `v3/charts/s01-arrival-overwhelm.json`, `v3/layouts/s01-arrival-overwhelm.json` (camera ends at zoom 0.6), `v3/blocking/arrival.json` and `everything-at-once.json`, `assets/human/model.json`, `v3/references/owner/picks.json`, `v3/rubric.md` v1.9 (C16, C21, C31-C33), `src/library/animation/pose.ts`, `scripts/animation/README.md` pose pass tools.

## Analysis
- Rules re-read against the sheet: bow 0.06 or more on every key (0.06 to 0.14); each class has a sign, the S keys an inflection; weight foot and `over` on all eight; lead arm and leg declared; the four twinned keys (rest-on-lid, grip, brace, shrink) carry `twinned.why`; each key has a family; each of the seven moves has 3 to 6 drawings on the timing shape (rest-on-lid to grip 4, grip to lift 3, lift to awe 3, awe to brace 6 with one anticipation at 130, brace to joy-a 4, joy-a to joy-b 3, joy-b to shrink 5), passing drawings between +0.25 and +0.75, settle +0.98 or +0.99; no move carries an overshoot in this sheet.
- Secondaries: poncho (stretch 1), handL (side L, stretch 0) and handR (side R, stretch 0.5) lag 2 drawings; each hand names its side, so the lead wrist is authored motion on the moves its side leads (lead-arm check ok on all 6 pairs that matter). A moving hold on every key (drift 4 to 6 px; brace over 24 frames, shrink over 60).
- `keysHash`: breakdowns authored in world space carry the sha256 of the two keys they were built on (grip to lift, awe to brace, brace to joy-a, joy-a to joy-b, joy-b to shrink); the `breakdowns` line passes, so none is stale. Rest-on-lid to grip and lift to awe are angle-space blends and carry none by design.
- Solver check: declared against solved class and bow within 0.02 on C keys (rest-on-lid 0.06 reads 0.062, grip 0.10 reads 0.102, lift 0.062, brace 0.082, joy-a 0.122, shrink 0.142); the two S keys read under their bow (awe 0.10 reads 0.075, joy-b 0.12 reads 0.071), above the 0.06 floor, as `check-pose.mjs` allows.
- No declaration was changed: nothing in the rules contradicts run 4's, and no declaration was edited to match a plate.

## Goals
Pose sheet judged before any plate is touched (`--joints solved`); the key sheet then rebuilt from it; card uses recorded so the ledger says which reference led to which key.

## Execution
Poses (key · frame · curve class/bow/sign/lean · weight · lead arm/leg · silhouette · family · card):

| key | frame | curve | weight | lead | silhouette | family | card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rest-on-lid | 0 | C 0.06 / -1 / 12 | both 0.5 | none / none | closed | lid | MFJFS03XZOP7E |
| grip | 42 | C 0.10 / -1 / 18 | R 0.6 | R / none | fold | lid | MFJG10AXINU2X |
| lift | 66 | C 0.06 / +1 / -8 | R 0.7 | R / L | open | lid | MFJG10AXINU2X |
| awe | 104 | S 0.10 / -1 / -6, infl 0.5 | L 0.6 | R / R | open | open | MFJFS03X49AQO |
| brace | 154 | C 0.08 / +1 / -14 | L 0.55 | L / R | closed | guard | MFJG10AX4YB91 |
| joy-a | 190 | C 0.12 / -1 / -18 | R 0.8 | L / L | star | burst-a | MFJFTELH7A9UQ, MFJFRODX2CIQ5 |
| joy-b | 228 | S 0.12 / +1 / 18, infl 0.45 | L 0.8 | R / L | star | burst-b | MFI6SYYWK85H4 |
| shrink | 272 | C 0.14 / -1 / 4 | both 0.5 | none / none | fold | fold | MFJG10AV4V3U5 |

Breakdowns (between · frames · kind · arc): rest-on-lid to grip 26, 30, 34, settle 38 (root 8, 30, 20 px); grip to lift 58, 62, settle 64 (root 34); lift to awe 92, 96, settle 100 (root -26, -32); awe to brace anticipation 130 (wristL 30 px), passing 134, 138, 142, 146 (root 30), settle 150; brace to joy-a 178, 182, 186, settle 188 (root 55); joy-a to joy-b 216, 220, settle 224 (root 24); joy-b to shrink 254, 258, 262, 266, settle 268 (root -25).

Cards Applied (id · to · recorded in `v3/references/owner/picks.json`, receipt `evidence/drive-P7TOpp`): MFJFS03XZOP7E to #rest-on-lid · MFJG10AXINU2X to #grip and #lift · MFJFS03X49AQO to #awe · MFJG10AX4YB91 to #brace · MFJFTELH7A9UQ and MFJFRODX2CIQ5 to #joy-a · MFI6SYYWK85H4 to #joy-b · MFJG10AV4V3U5 to #shrink. `eagle_board.py ledger`: pose section 10 picks, 8 applied; 18 uses on this contract (9 from run 2's drive, 9 from this one).

Probe Lines (full output `out/s01-05-probe-poses-solved.txt`), command `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints solved`, exit 0, 20 ok lines, controls tripped:
`pass: poses - 1 shot(s) (solved joints): keys, line of action, twinning, weight, breakdowns, secondaries, holds, timing shape and lead arm all as declared`

Re-key Brief: the same command with `--joints keys` against the current key sheet (`out/s01-05-probe-poses-keys-prepare.txt`) exits 0 with 20 ok lines, so no key is refused; the key step rebuilds the plates from the solved joints anyway (`npm run plates`).

## Evaluation
Done: solved probe exit 0; keys probe exit 0 on the current sheet; `solve-poses` rerun leaves the sheet byte-identical (diff empty). Not done here: nothing is measured on the rebuilt plates until the key step.

Changed: `v3/references/owner/picks.json` (nine `applied` entries, receipt `evidence/drive-P7TOpp`); `v3/poses/s01-arrival-overwhelm.json` unchanged.

Receipt: `evidence/drive-P7TOpp`.

**Gate Coverage**:
- [1] PASS: `probe-poses.py v3/poses v3/keys v3/charts --joints solved` exited 0, 20 ok lines, control line present in the output.

**GATE_REVIEW: PASS - the pose sheet meets the prompt's rules, the solved-joints probe passes and the key sheet it is compared with passes too.**
