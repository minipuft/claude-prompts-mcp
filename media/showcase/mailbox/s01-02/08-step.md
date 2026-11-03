### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **shot**: s01-arrival-overwhelm
- **output_root**: media/showcase
- **brief**: First demo of the film's intro, beats arrival (frames 0-180) and everything-at-once (180-420) of v3/beats-v2.json, home world, 420 frames at 30 fps (v3/timeline.json wins over shots.json's older 0-330...
- **renderer**: remotion
- **frames**: first,key,last,strip
- **constraints**: 1280x720 at 30 fps, swangle here; the camera follows the layout contract (D64, D77); one emitter at a time; drawn on twos, light on ones; every key a pose on one curve, every breakdown a pose, never a...

> You produce client-side creative work guided by the Claude Prompts MCP server. The server renders prompts, propagates step results and manages reviews; the client agents research, write artifacts, implement and render. Use existing services and authored resource contracts. Never invent MCP parameters, workflow schemas or a parallel orchestrator. Preserve actual provenance: recording, source-derived depiction, smoke fixture and conceptual animation are different evidence classes. Do not imply a simulated agent or UI is a recorded Claude/Codex run. No narration, unsolicited public posting, git refs, commits or files outside caller-owned scope. A missing consequential choice becomes a concern; do not silently fabricate it. Read prior context and chain history, and cite actual paths/URLs used. Revisions must have observable rationale. If the selected story uses an environment or travel metaphor, keep its boundaries explicit: the client/resource author creates reusable prompts, gates and frameworks through resource_manager; problems may motivate authored improvements but the server does not learn or author them automatically. Frameworks structure reasoning; a depicted journey represents state/context progression and does not imply physical enforcement.

Brief: First demo of the film's intro, beats arrival (frames 0-180) and everything-at-once (180-420) of v3/beats-v2.json, home world, 420 frames at 30 fps (v3/timeline.json wins over shots.json's older 0-330). Frame 0 is the poster: Codex, the human and Clawd around a plain box on the settled black field with a tiny emitter at the box seam. The human opens the lid (reach, contact, lift); the lid lifts and the gadget rises on its bubble while Codex and Clawd lean in; the bubble swells, leading the eye up, into beat 2 with no cut. The camera widens to the full field, led by the bubble and then the first stalk's curl (frames 150-210); the gadget projects every piece, structure and route around the trio along staggered leading lines; the Turrell blue radiance #0a51fb floods with the accent #fad204 everywhere (the overwhelm exception to C6). The human turns with joy, then shrinks; Codex leans in and catches a piece; Clawd leans in and is pushed by a stalk; pieces keep arriving as the human reaches, into beat 3.
Constraints: 1280x720 at 30 fps, swangle here; the camera follows the layout contract (D64, D77); one emitter at a time; drawn on twos, light on ones; every key a pose on one curve, every breakdown a pose, never a favour alone (D83).
Production root: media/showcase
Previous handoff:
**Summary**: Shot s01 is rendered through the pose chart on the re-keyed sheet: `out/s01-02.mp4` (420 frames, 30 fps, 1280x720), the figure-only sequence, the joints dump and the gate's one-line probe. The first run of the gate on the new keys FAILED 16 of 17 inbetween checks (the breakdown arcs and lags had been authored for the run 1 key geometry); the pose sheet was re-authored and the gate now passes 3 of 3.

## Frames Rendered (path, sha256 prefix)
`out/s01-02.mp4` (3.3 MB); strip `out/s01-02-strip.png` (12 frames, 0 42 66 104 130 154 178 190 228 272 330 419; also `out/s01-arrival-overwhelm-strip.png`). Stills `out/s01-arrival-overwhelm-f<NNN>.png`: 000 4fd7a328a17e, 042 57a3ca6e34a2, 066 e9b1888a95e1, 104 e453b6d97125, 154 ba8652b45240, 190 1d3b8b86d345, 228 10943ec15dd7, 272 9a91dc42fcbf, 330 36b59964fa7b, 419 6d308d7dfe2e. Figure-only: `out/s01-arrival-overwhelm-figure-seq/` (420 PNG), `out/s01-arrival-overwhelm-joints.json`, `out/s01-arrival-overwhelm-xsheet.json`. Before the re-key: `out/s01-02-pose-chart-run1-keys.mp4`, `out/s01-arrival-overwhelm-joints-run1-keys.json`. Arcs before and after: `out/s01-02-arcs.png`.

## Probes
- Gate command `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out` (exit 0, `out/s01-02-probe-all-shots.txt`): twos-ones pass, hold-band pass, inbetweens pass; `pass: probe-all --shots - 3 of 3 probe runs passed, 0 shot(s) skipped`. Controls tripped first (zigzag refused on a, double-back on bc, hairpin on c, linear lerp refused on arcs/spacing/overlap-and-moving-holds, snapped secondary refused on overlap).
- Inbetween lines (`out/s01-02-inbetweens.txt`): `s01-arrival-overwhelm · pass · 7 moves, 57 items measured, 0 failed`. Lead-wrist arcs: max deviation 25-107 px, 0 sign changes, 1 declared back-step (the anticipation on awe -> brace), 0 undeclared. Before this row's fix (first gate run on the new keys): 16 of 17 checks failed (arcs 8, overlap 6, spacing 1, pixel ease 1; `out/s01-02-probe-all-shots.txt` was overwritten by the passing run).
- Determinism (C12, same pipeline): frame 0 sha 4fd7a328a17e twice, frame 154 ba8652b45240 twice, identical.
- Twos and ones (C16, C27, full frames at half scale, `out/s01-02-frame-change.json`): in the locked frames 1-149 the figure crop changes on 0.016 % of pixels per odd frame (max 0.30 %) against 2.10 % per even frame (max 7.3 %); frames 210-419, whole frame, odd 0.000 % against even 5.08 %. Light (C18): whole-frame change 176-190 shows the pop at 180 (10.1 %), the lamp 182 (11.5 %), the flood 183-185 (10.9, 9.5, 7.6 %), decaying to 0.9 % by 190.
- Model-sheet overlay (C20): from the key step (heights -3 to +12 %, limbs over 105 % on K3, K4, K6, K7, K8), not re-measured on frames.
- Identity samples (C1): Clawd coral at (231, 106, 75) on frames 0 and 154 and (232, 108, 78) on 330 against #e8694a; Codex blue (80, 126, 241), (80, 125, 242), (75, 132, 246) against #4f7df2.
- Identity pass (D70): `out/s01-02-identity-pass.png`, the head on frame 0 at 4x of a face about 35 px wide: green skin, hair swoop and poncho roles read. From frame 272 the folded human shows only raised hands above the box; the face is not visible on 330 and 419 (viewed).

## What changed to get the gate green (pose sheet, `v3/poses/s01-arrival-overwhelm.json`)
- Settle favour 0.98 on every move (0.95 left the lead wrist outside the 10 % arrival band, which hid the secondaries' lag); breakdown arc offsets re-authored to the new chords (root arcs 30-38 px on grip -> lift, lift -> awe, awe -> brace, brace -> joy-a); rest-on-lid -> grip favours 0.25 / 0.65 / 0.75 / 0.98.
- `scripts/animation/author-breakdowns.mjs` (new): for awe -> brace, brace -> joy-a and joy-b -> shrink the angle-space blend swings a wrist round a bone longer than the move (a zigzag or back-step on the lead wrist), so those breakdowns carry authored `joints` (the straight world-space blend plus one arc per joint, `authored: "world blend + arc"`). Numbers: 30/60, 55/55, 25/90 px (root/wrist).
- brace -> joy-a lost its overshoot (the declared shape still holds: 3-6 drawings, one settle): with it the lagging right hand read "too early". poncho stretch 0.6 -> 1.0, handR stretch 0.5.
- The gate was not changed. `probe-poses.py --joints solved` still passes (`out/s01-02-probe-poses-solved.txt`).

## Receipt Skeleton Path
`out/s01-arrival-overwhelm-probes.json` (frames, determinism, gate line, keys table; Changed, Grades, Controls, Owner, Next left empty for the study).

## Renderer Used
Remotion 4.0.530 (`ShotS01`, `ShotS01Figure`), h264 crf 18.

## Concerns
- The human is small and her rig deformations are rough on K2, K3, K5, K6, K7, K8 (`out/s01-02-pose-sheet.png`): the single mesh cannot hold crossed arms or hands to the chest (gap 9 of run 1), and the K8 fold shows only hands.
- Straight world-space blends on three moves shorten limbs mid-move; they were not viewed in motion (the mp4 was not watched).
- The study's strip frames 42-190 were viewed; the other frames were not opened one by one.

Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings D41–D72, medium, palette law, animation language, Craft baseline), `script.md` (resource vocabulary and beats), `rubric.md` (criteria C1–C23 and the receipt shape). They are the contract; this prompt does not restate them.

Grade the actual rendered artifact against `rubric.md` by criterion id; do not grade anything you have not viewed. Use only the four marks: HOLDS, FAILS, UNPROVEN, TASTE. Each mark cites its evidence at or above the criterion's minimum tier (still, 3x crop, consecutive frames, moving render, owner viewing) and names the failing control it beats. Measure where the rubric allows it: per-frame pixel change for twos versus ones (C16), two renders hashed for determinism (C12), a sampled pixel for identity pigments (C1), the key-over-model-sheet overlay (C20), the filled silhouette of each key (C21), the measured contour weight (C22), and each breakdown's displacement against its charted favouring (C23).

Motion contract:
**Summary**: Run 2 keeps the run 1 cinematography sheet and its contract (`v3/layouts/s01-arrival-overwhelm.json`); no sheet was regenerated, because the checks found no defect in it. One change: the widen now ends at zoom 0.6 (owner default recorded in the plan), not 0.425.

- **Camera**: start locked medium-wide (640, 360, x1); end the full field at (604, 103, x0.6) over frames 150-210 on ones; move: widen (pull back and up, no cut); led by the bubble swelling out of the box (f150-180), then the first stalk's curl (f180-210). Was (604, -144, x0.425); y 103 keeps the trio's feet at 688 of 720 px as the old pose did. The chart note, `v3/shots.json` camera string and `scripts/s01_chart.py` note follow.
- **Emitter**: start the box's lid seam (0.52, 0.777); end the gadget's dial, now (0.545, 0.311) of the frame (was (0.532, 0.512) at zoom 0.425; recomputed from the dial at stage (699, -124) through the new camera).
- **Figure Heights**: panel 1 78.1 % (face-derived, over-reads, see `figure.note`), panel 2 33.2 % (sheet, 0.425 framing); heads 8.0. The render stands the human at 350 px (48.6 %) at rest and 210 px (29.2 %) at the new end zoom.
- **Hue**: D74 pair radiance #0a51fb, accent #fad204 (unchanged).
- **Cards Used**: eagle-lyio3is7tokub, eagle-mf83t1h77o7bm, eagle-m92nkizilu1cb, eagle-mram46lymigko (unchanged).
- **Sheet Path**: `assets/layouts/s01-layout-02.png` (sha256 66445f7f...f19f; copy in `public/assets/layouts/` identical). Panel 2 still draws the 0.425 framing; the numbers in `cameraPose` supersede it (stated in `cameraPose.note`).
- **layout.json Path**: `v3/layouts/s01-arrival-overwhelm.json` (provisional: true). Still: `out/s01-layout-02-run2-still.png` (`LayoutSheetS01`).
- **Generation Receipt**: `evidence/s01/imagegen-layout-s01-02.json` (run 1; nothing generated in run 2).
- **Rejected Generations**: `out/s01-layout-01.png` (run 1: human at about 95 % of panel 1 against 50 % asked).
- **Concerns**: the sheet's panel 2 and the contract disagree about the end framing until the sheet is redrawn; the render and C25 read the contract. The exposure sheet (`out/s01-xsheet.json`) must be regenerated (`node scripts/s01-xsheet.mjs`) before the probes run.

Write the receipt in the rubric's five parts, in order: Changed (by file); Grades (one line per criterion touched); Controls (which earlier study each flipped FAILS beats); Owner (at most two TASTE questions, each with the default the planner takes if unanswered); Next (one fix per FAILS). Save it as `v3/studies/<name>.md` beside the artifact copies, copied unchanged from `out/` with sha256 prefixes. A render that is absent is BLOCKED, not PASS. Propose a rubric change only through its Evolution rules: a new ruling adds a row; three consecutive HOLDS bakes one; a standing TASTE is ruled or deleted.

Return: Inspected Evidence; Grades; Controls; Owner; Next; Rubric Evolution; Concerns.

---

## Inline Gates

### Reminders

### Showcase Review Rubric
Grade only what was viewed. One mark per touched criterion: HOLDS, FAILS, UNPROVEN or TASTE, each with evidence at or above the criterion's minimum tier and the failing control it beats. Identity pigments unchanged (C1); role fills, no hex in assets (C2); designed, stippled shadows (C3, C4); black negative space, one emitter under the assets (C5, C6); frame interior refracted and drawn in depth (C7, C8); grain subordinate (C9); interior is the subject (C10); gadget familiar-impossible (C11); byte-identical renders (C12); no shimmer, drawn on twos, staggered, light lagging (C13, C16, C17, C18); acting reads without text (C14); palette travel never greys (C15); every asset mused (C19); craft baseline D72: keys match the model sheet within 5 % (C20), each key has a line of action and a filled silhouette that reads (C21), clean-up standard measured on the plate (C22), breakdowns sit at their charted favouring (C23). Receipt in five parts: Changed, Grades, Controls, Owner, Next.

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

Chain: chain-showcase_shot#1
→ Progress 6/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
