═════════════════════════════════════════════════════════════════
EXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)
═════════════════════════════════════════════════════════════════

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **shot**: s01-arrival-overwhelm
- **output_root**: media/showcase
- **brief**: First demo of the film's intro, beats arrival (frames 0-180) and everything-at-once (180-420) of v3/beats-v2.json, home world, 420 frames at 30 fps (v3/timeline.json wins over shots.json's older 0-330...
- **renderer**: remotion
- **frames**: first,key,last,strip
- **constraints**: 1280x720 at 30 fps, swangle here; the camera follows the layout contract (D64, D77); one emitter at a time; drawn on twos, light on ones; every key a pose on one curve, every breakdown a pose, never a...

---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Showcase Key Sheet.

Apply the C.A.G.E.E.R.F framework systematically:

**Context**: Establish comprehensive situational awareness and environmental factors
**Analysis**: Apply structured, systematic examination of the problem or opportunity
**Goals**: Define specific, measurable, actionable objectives with clear success criteria
**Execution**: Develop practical, implementable approach with detailed action steps
**Evaluation**: Create robust success metrics and assessment methods
**Refinement**: Enable continuous improvement and iteration processes

Ensure each phase builds logically on the previous phases while maintaining focus on practical, actionable outcomes. Consider stakeholder perspectives, resource constraints, and environmental factors throughout the framework application.


Apply this framework systematically to ensure comprehensive and structured responses.

---


Shot: s01-arrival-overwhelm
Actors: every actor with keys in the pose sheet
Production root: media/showcase
Pose sheet handoff:
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

Read `v3/creative-spec.md` (D65–D72, D74, D77, D83, D85, Craft baseline, clean-up standard), `v3/rubric.md` (C20–C22, C25, C31), `v3/poses/<shot>.json` (the contract: per key the moment, curve, weight, lead, silhouette kind, plate family and the solved joints; a missing or unsolved pose sheet is BLOCKED, run animation_poses and `npm run solve-poses -- <shot>`), `v3/layouts/<shot>.json` (a missing or unapproved layout is BLOCKED, run showcase_layout_sheet), each actor's `assets/<actor>/model.json` and plate families under `assets/<actor>/families/` (an actor with no approved model sheet is BLOCKED, run showcase_model_sheet), and `scripts/animation/README.md` §plates.

The plates are built here, not described to a generator (D85). Run `npm run plates -- <shot>`: every key is rendered from its solved joints through its plate family's mesh at the model sheet's scale and baseline on the black field (D71, D76), its joints written to `v3/keys/<shot>.json` with `source: solver`, and its measurements recorded per key: model-sheet overlay (C20: head count and limb ratios within 5 %), silhouette read (C21), contour ratio against the model sheet (C22, ±20 %), and the spine fit against the declaration (C31, `probe-poses.py --shot <shot> --joints keys`). A key the script reports as NEEDS FAMILY is a silhouette the rig cannot hold (a fold, crossed or overhead arms, a stoop): propose that family's plate once through the `imagegen` tool (`tool:imagegen`) with `references` = the model sheet, the approved pick and the cited pose cards, and a `prompt` naming the silhouette kind, the curve in words, the weight foot and the lead side, with the solved joints drawn as a guide; cut it with `scripts/cutout.py --field black`, build its mesh and register its joints with the skeleton toolchain (or the documented fit, flagged `registration: fit`), never by eye; then re-run `npm run plates`. A family plate that fails C20 or C22 is regenerated once with the failing property named; a second failure stays NEEDS FAMILY on the sheet for the owner. Row 2 of the key sheet (the keys as frame thumbnails at the layout camera, C25) is rendered from the same plates through the `KeySheet` composition, with the measured curve drawn over each key. Companions are drawn from their official plates under `assets/codex` and `assets/clawd`; a garment transition (D69) is five flat roles, never cloth. The gate runs `probe-poses.py --joints keys` over the key sheet; quote its lines.

Return: Keys (actor, family, source solver|family-plate, id, frame, C20 head/limbs, C21, C22, C31 declared vs measured class/bow/sign/twinning, plate path, sha256); Families (new families proposed, how registered); Frame Keys (F1…Fn: figure height vs layout, emitter vs layout); Probe Lines; Sheet Paths; Generation Receipts (family plates only); Needs Family; Concerns.

### Chain History (prior step outputs)

#### Step 1: Showcase Cinematography Sheet

**Summary**: Run 5 keeps the run 4 layout contract (`v3/layouts/s01-arrival-overwhelm.json`) unchanged; no sheet was regenerated because the checks found no defect in it. The widen ends at zoom 0.6.

- **Camera**: start locked medium-wide (640, 360, x1); end the full field at (604, 103, x0.6) over frames 150-210 on ones; move: widen (pull back and up, no cut); led by the bubble swelling out of the box (f150-180), then the first stalk's curl (f180-210).
- **Emitter**: start the box's lid seam (0.52, 0.777); end the gadget's dial (0.545, 0.311).
- **Figure Heights**: panel 1 78.1 percent (face-derived, over-reads, see `figure.note`), panel 2 33.2 percent (sheet framing); heads 8.0. The render stands the human at 350 px (48.6 percent) at rest and 210 px at the end zoom.
- **Hue**: D74 pair radiance #0a51fb, accent #fad204.
- **Cards Used**: eagle-lyio3is7tokub, eagle-mf83t1h77o7bm, eagle-m92nkizilu1cb, eagle-mram46lymigko (unchanged).
- **Sheet Path**: `assets/layouts/s01-layout-02.png`, sha256 66445f7f...f19f; the copy in `public/assets/layouts/` has the identical hash (checked this step). Panel 2 still draws the 0.425 framing; `cameraPose` supersedes it.
- **layout.json Path**: `v3/layouts/s01-arrival-overwhelm.json` (provisional: true).
- **Generation Receipt**: `evidence/s01/imagegen-layout-s01-02.json` (nothing generated in run 5).
- **Rejected Generations**: `out/s01-layout-01.png` (run 1).
- **Checks run**: `probe-timeline.py v3/timeline.json` passes; `v3/blocking/arrival.json` and `everything-at-once.json` exist; `assets/human/model.json` exists.
- **Concerns**: panel 2 of the sheet and the contract disagree about the end framing until the sheet is redrawn; the render and C25 read the contract.

#### Step 2: Showcase Motion

**Summary**: Run 5 keeps the timing chart (`v3/charts/s01-arrival-overwhelm.json` with its `.md`); the checks found no defect in it and its camera row already follows the layout contract's zoom 0.6. The pose pass (next step) owns how the human travels between these keys.

- **Key List (human)**: rest-on-lid 0, grip 42, lift 66, awe 104, brace 154, joy-a 190, joy-b 228, shrink 272 (declared long hold). The chart keys equal the pose sheet's keys by name and frame (8 of 8).
- **Charts**: unchanged; non-human tracks (box.lid, bubble.size, gadget.rise/glow, codex/clawd lean, codex.catch, clawd.push, stalk0.grow, light seam/dial/flood/grain) and the 50 pieces as in run 4.
- **Staggers and Lag**: pieces start 3-5 frames apart; Codex's lean 4 frames before Clawd's; light lag 3 frames, recovery 12.
- **Boil and Pulses**: boil 3 variants at rate 4, seed 11; pulses at frames 44 (lid cracks) and 180 (the pop).
- **Camera**: locked 0-150, widen 150-210 on ones to (604, 103, x0.6) per the layout contract `cameraPose`, held to 420; led by the bubble then stalk0's curl. Chart camera row matches (checked by reading `camera.note` and `span`).
- **Checks run**: `probe-timeline.py v3/timeline.json` passes (8 beats, 1950 frames); `v3/blocking/arrival.json` and `everything-at-once.json` exist; `probe-poses.py ... --joints solved` passes (keys category included).
- **Library Changes Needed**: none.
- **Artifact Handoff**: `v3/charts/s01-arrival-overwhelm.json`, `v3/charts/s01-arrival-overwhelm.md`; no `motion.md` (the chart .md carries the per-beat rhythm).
- **Concerns**: the chart still carries the 33 favour-only breakdowns of run 1; they are not played (the pose sheet's breakdowns replace them in `shotS01Plan.ts`).

### Result Contract

Return your complete work product as plain text — it becomes the chain’s step output verbatim.

You are the worker for this one step. Do not call `prompt_engine` or any other chain tool, and do not put chain metadata or tool calls in your reply — the orchestrating agent owns the run and resumes it with your text.

End your reply with this exact block — `node` is how the server matches your result back to this step:

```
HANDOFF RESULT
node: keys
```

═════════════════════════════════════════════════════════════════
END EXECUTION BRIEF
═════════════════════════════════════════════════════════════════

⚡ HANDOFF: Execute Step 4 ("Showcase Key Sheet") via sub-agent for context isolation.

═════════════════════════════════════════════════════════════════
HANDOFF INSTRUCTIONS
═════════════════════════════════════════════════════════════════

→ Handoff: Use your client's sub-agent/handoff capability
→ Prompt: Pass the EXECUTION BRIEF above (everything between the BRIEF delimiters) as the agent's prompt
→ Result: Include the sub-agent's result in user_response to continue the chain

⚠️ CONSTRAINT: Use handed-off execution when available; do not answer inline if handoff exists.
⚠️ RESULT CONTRACT: Include handed-off output in user_response and then resume the chain.

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

Chain: chain-showcase_shot#1
→ Progress 4/7
Next: Handoff via your client sub-agent mechanism (see instructions above), then: chain_id="chain-showcase_shot#1", user_response="<sub-agent result>"
