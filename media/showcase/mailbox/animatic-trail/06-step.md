### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placehold...
- **context**: 

> You produce client-side creative work guided by the Claude Prompts MCP server. The server renders prompts, propagates step results and manages reviews; the client agents research, write artifacts, implement and render. Use existing services and authored resource contracts. Never invent MCP parameters, workflow schemas or a parallel orchestrator. Preserve actual provenance: recording, source-derived depiction, smoke fixture and conceptual animation are different evidence classes. Do not imply a simulated agent or UI is a recorded Claude/Codex run. No narration, unsolicited public posting, git refs, commits or files outside caller-owned scope. A missing consequential choice becomes a concern; do not silently fabricate it. Read prior context and chain history, and cite actual paths/URLs used. Revisions must have observable rationale. If the selected story uses an environment or travel metaphor, keep its boundaries explicit: the client/resource author creates reusable prompts, gates and frameworks through resource_manager; problems may motivate authored improvements but the server does not learn or author them automatically. Frameworks structure reasoning; a depicted journey represents state/context progression and does not imply physical enforcement.

Brief: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placeholders allowed for keys; every gate line quoted.
Constraints: media/showcase/v3
Production root: media/showcase
Previous handoff:
**Summary**: Re-rendered the whole animatic from the unchanged contracts (xsheet, light, timeline byte-identical after regeneration) because a fresh 60-frame determinism sample against the old sequence FAILED on one crayon frame. On the new frames `probe-all.py` passes 7 of 7 (exit 0). The mp4 was rendered twice: 65.000 s, 1950 frames, 640x360, h264, 5.4 MB each.

## Context
Renderer `media/showcase`, episode `v3`. `npm run xsheet` -> `xsheet: 1950 rows (1950 <tr> in the file) for 1950 frames`, `v3/xsheet.json` identical to the one on disk (`cmp`); `npm run light` identical too. The frames on disk dated from 20:16 (figure layers) and 22:10 (full sequence); source files under `src/library/worlds/` and `src/library/animation/light.ts` carried later edit times than the figure layers, so reuse needed a measured test.

## Analysis
Reuse test (stated as asked): 60 frames (7, 39, 71 ... 1927, every 32nd from 7, all four worlds and the crossings) rendered fresh with `Animatic65 --sequence --scale=0.5 --concurrency=4 --props captions:false --frames=...` into `out/animatic-det60`, then `probe-determinism.py out/animatic-seq out/animatic-det60 --subset`: FAIL, 59 of 60 match, frame 1063 (crayon) differs on 203 pixels beyond 2 levels (allowance 23, largest 42 levels), region x 14-185, y 20-230 (the arch). Two lone renders of 1063 are identical to each other and to the sequence (0 pixels), so the sequence render is the stable reference and the 60-frame subset render is the one that drifts. Verdict: frames not reused; everything re-rendered.
Fresh renders (`out/animatic-seq`, `-seq-b`, `-fig-seq`, `-figline-seq`; the replaced ones kept as `*-prev`):
- full sequence new against old: 1948 of 1950 frames within tolerance, over the bar at 841 (102 pixels, largest 22 levels) and 1111 (194 pixels, largest 41 levels), both crayon. So two full renders of this film are not equal within the probe's bar, which row 4.1 of the plan recorded as fixed.
- new seq-b (195 frames, every 10th) against new seq: 195 of 195 within tolerance.
- figure layer new against old: 1950 of 1950; figure-line layer: 142 of 142.
mp4 twice: `out/animatic-01.mp4` and `out/animatic-01b.mp4`: both 1950 frames, 65.000 s; 1438 of 1950 decoded frames byte-equal, 512 differ with PSNR at least 40.6 dB (mean 51.1 dB), the crayon beat and its crossings. The first attempt at the second mp4 died at frame 1109 on a 33 s page-render timeout while the machine ran at load 26 with another render; re-run with `--timeout=180000` (the only changed flag) finished.

## Goals
All seven probes pass on the real frames, every probe's control line trips first, and the figure-layer and line-layer frames are from the same contracts as the full sequence.

## Execution
Wall time: xsheet 1 s; determinism sample 36 s; full sequence 570 s; seq-b 79 s; figure layer 45 s; figure-line layer 13 s; mp4 first 602 s; mp4 second 615 s (after a failed attempt of 532 s); the probe 235 s. Contact strip `out/animatic-02-contact.png` (12 frames: every beat and every crossing's mid-frame).
Gate `animation-animatic-probes`, `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq`, exit 0 (verbatim, `out/animatic-trail-probe-all.txt`):
```
twos-ones · pass · control: change on frame 7 -> FAIL (odd-frame figure changes at [7]); changes on even frames only with the camera moving every frame -> pass (0 odd-frame changes, 7 even-frame changes, camera moved on 24 odd frames); a figure change on frame 27 inside a crossing window 20-35 -> FAIL on the figure layer (odd-frame changes at [27]), exempt (pass) on full frames
hold-band · pass · control: 40-frame hold -> FAIL (hold of 40 frames at 0-39 is over 27 and no key declares it); 16-frame hold, 4-drawing move -> pass (2 holds, move of 4); 40-frame hold declared by key 'K1' -> pass and listed; 1-drawing move -> FAIL; a pose change on frame 28 inside a crossing window with no key row -> FAIL on the figure layer (stray change at [28]), exempt on full frames; the same change with a key row -> pass
screen-time · pass · control: beat 'b' shifted 3 frames against the same xsheet -> FAIL (beat 'a' ends at frame 30 in the xsheet, 33 in the timeline); unshifted -> pass (0 problems)
eye-trace · pass · control: bright blob 10 % of the width off the emitter -> FAIL (offset 10.0 % > 3 %); blob on the emitter -> pass (0.0 %); identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at 46 %); the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL (10.9 %), so the camera is read; 120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset 2.2 % blurred, 8.7 % unblurred
loop-closure · pass · control: synthetic closed outline closed=True (height 1.000, share 1.000); 4 px band erased across the shins (row 127) closed=False (height 0.744, share 0.588) flips
colour-continuity · pass · control: magenta patch off both pairs -> FAIL (frame 5: 576 of 15376 saturated pixels outside); hue detour through green across a crossing -> FAIL (crossing 14-34 detours: sample 1 (205 deg) sits 16 deg behind the start); clean sequence with identity, garment and kit-accent patches (all saturated, all off the pair) -> pass; a pale blue glow on the emitter reads 221 deg -> inside the blue pair, the same glow in pale green reads 144 deg -> off it, a frame with no glow reads nothing
determinism · pass · control: two writes of the same frame -> pass; 1 pixel 1 level off (rasteriser noise) -> pass; 40 pixels 1 level off (noise) -> pass; 60 pixels 40 levels off -> FAIL (60 beyond 2 levels, allowance 5); every pixel 3 levels off -> FAIL (57600 beyond 2 levels); 1 pixel 40 levels off -> tolerated (inside the allowance of 5)
pass: probe-all - 7 of 7 probes passed
```

## Evaluation
Probes (7 of 7) all print their control line first. What the probes do not see, from watching 24 frames: every beat plays the same standing pose with raised arms, so nothing acts out the ledger's actions; the box and bubble of `arrival`, the stalks and the structure are in the contracts but not drawn; every crossing is the line world's contour drawing, so the shaded and crayon worlds never cross into each other; at frame 780 Clawd sits cut by the left edge. I have not watched the mp4 in motion.

## Refinement
Provisional parts of this film: keys (one chart for every beat), blocking (provisional, eight files), box and bubble not drawn, one crossing operator. Owner questions go in the study of the next step. Receipt: no `Shell Verification Results` in this step's rendered prompt either; the probe output above is a hand run, the first run recorded by the engine in this drive was step 1 only.

Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings D41–D72, medium, palette law, animation language, Craft baseline), `script.md` (resource vocabulary and beats), `rubric.md` (criteria C1–C23 and the receipt shape). They are the contract; this prompt does not restate them.

Grade the actual rendered artifact against `rubric.md` by criterion id; do not grade anything you have not viewed. Use only the four marks: HOLDS, FAILS, UNPROVEN, TASTE. Each mark cites its evidence at or above the criterion's minimum tier (still, 3x crop, consecutive frames, moving render, owner viewing) and names the failing control it beats. Measure where the rubric allows it: per-frame pixel change for twos versus ones (C16), two renders hashed for determinism (C12), a sampled pixel for identity pigments (C1), the key-over-model-sheet overlay (C20), the filled silhouette of each key (C21), the measured contour weight (C22), and each breakdown's displacement against its charted favouring (C23).

Motion contract:
Use the recorded Motion Contract step; flag missing handoff.

Write the receipt in the rubric's five parts, in order: Changed (by file); Grades (one line per criterion touched); Controls (which earlier study each flipped FAILS beats); Owner (at most two TASTE questions, each with the default the planner takes if unanswered); Next (one fix per FAILS). Save it as `v3/studies/<name>.md` beside the artifact copies, copied unchanged from `out/` with sha256 prefixes. A render that is absent is BLOCKED, not PASS. Propose a rubric change only through its Evolution rules: a new ruling adds a row; three consecutive HOLDS bakes one; a standing TASTE is ruled or deleted.

Return: Inspected Evidence; Grades; Controls; Owner; Next; Rubric Evolution; Concerns.

---

## Inline Gates

### Reminders

### Animation Review Rubric
Advisory, not a check: nothing here has a positive control. Grade only what was viewed, one mark per touched criterion (HOLDS, FAILS, UNPROVEN, TASTE) with evidence at or above the criterion's minimum tier. The episode-tier criteria (timeline conformance, twos/ones split, hold band, eye trace, colour continuity) are DECIDED by the probe gate, not here: cite its lines, do not re-grade them. Grade here what no probe can: acting reads without text (C14), composition hierarchy per beat (C10), the crossings read as drawn (C13), the story lands in the screen time given. Every TASTE mark asks the owner one question with a default. Receipt in five parts: Changed, Grades, Controls, Owner, Next.

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

Chain: chain-animation_animatic#1
→ Progress 5/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
