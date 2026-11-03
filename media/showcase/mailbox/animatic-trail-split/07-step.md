### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placehold...
- **context**: 

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:
**Summary**: The eight `v3/blocking/<beat>.json` contracts are the ones the animatic frames in `out/animatic-seq` were drawn from, so none were rewritten for this re-drive. For this attempt `v3/blocking/arrival.json` carries a deliberately planted defect (the `x` of actor `clawd` removed, original backed up under `~/.cache/animatic-split/before/arrival.json`) to prove the chain refuses; `probe-blocking.py` exits 1 on it. This reply is expected to be refused and will be re-sent after the file is restored.

## Context
Beats from `v3/timeline.json` (8, byte-identical after recompile in step 1). Layouts on disk: `v3/layouts/s01-arrival-overwhelm.json` and `s02-cant-build-frame.json`. Schema and proven staging: `v3/blocking/test-scene.json`. Each blocking file cites its board card by id (`card`, `cardNote`).

## Analysis
Blocking (beat, actors placed, emitter start to end in stage px, card, derivedFrom):

| beat | actors placed | emitter | card | derivedFrom |
| --- | --- | --- | --- | --- |
| arrival | figure 0.68 at (420,40), codex, clawd (x missing in this planted copy), box (1010,440), bubble (1010,380) | (1000,396) to (1010,384) | eagle-lyio3is7tokub | test-scene |
| everything-at-once | figure 0.68, codex, clawd, gadget (1040,330), stalk (900,300, left) | (1010,384) to (1040,330) | seuss-no-one-youer | test-scene |
| cant-build | figure 0.58 at (452,85), codex, clawd, stalk (900,440, right) | (441.6,637.9) fixed | eagle-lxu2uuohr9v2c | s02 layout emitter.startXY |
| the-frame | figure 0.58, codex, clawd, frame (910,70) 280x230 | (1000,140) to (1060,200) | seuss-nested-frames | s02 layout emitter.endXY |
| art-world | figure 0.58, codex, clawd, test-scene props | (1000,390) to (1080,390) | seuss-cat-stairway | test-scene |
| crossing | same | (1040,390) fixed | eagle-mf83t1h77o7bm | test-scene |
| programming-world | same, gates (150,388) (235,382) (325,376) | (150,388) to (325,376) | seuss-archbishop-katz | test-scene |
| home-settle | figure 0.58, codex, clawd, gadget, structure (1040,440, x1.2) | (1000,340) to (1080,340) | seuss-green-cat-lights | test-scene |

Every file is `provisional: true`.

## Goals
Every actor the ledger names has a position, the emitter sits inside the frame, a card is cited, identity boxes stay apart. With the planted copy the first of these is false on purpose.

## Execution
Stills are the animatic's own frames at mid-beat in `v3/studies/animatic-02/` (`staging-0090.png` arrival, `staging-0990.png` art-world, `staging-1230.png` crossing, `staging-1470.png` programming-world), rendered in the earlier run from the unplanted contracts; nothing was re-rendered here.
Deviations from the layouts: (1) `arrival` and `everything-at-once` derive from the test scene although an s01 layout now exists, because re-pointing the emitter would change the rendered light and invalidate the existing frames. (2) The contract lists a `box` and a `bubble` for `arrival` that the render does not draw; the probe reads the contract, not the picture. (3) The human plays one lift pose in every still, from the provisional pose chart.
Changed (files): `v3/blocking/arrival.json` temporarily, `clawd.x` removed as a planted defect, restored byte-for-byte before the retry.

## Evaluation
Gate command `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking` on the planted copy, exit 1, run by hand before this reply:
```
  ok   one file per beat: 8 beats, 9 blocking files
  FAIL actors positioned and scaled: beat 'arrival': actor 'clawd' has no position (x, y)
  ok   emitter inside the frame: emitter start and end inside the frame on every beat
  ok   composition card cited: every beat cites a card
  ok   identity boxes apart: Codex, Clawd and the human's crop never overlap
FAIL: blocking-contract - 1 of 5 checks failed: actors positioned and scaled
```

## Refinement
The corrected answer follows after the file is restored and `cmp` matches the backup.

Read `timeline.json`, `shots.json` (`hue.radiance`/`hue.accent` per shot, beats mapped by each shot's `beat` list), the ledger's `effects` per beat (emitter, radiance, grain, boil), `worlds/*.json` (each world's radiance colour) and `rubric.md` C6, C15, C18, C24. Write `<episode_root>/light.json`: per beat the hue pair, the emitter (anchor, start→end position from blocking, intensity on ones, colour), radiance level, grain; per crossing window the hue path from the from-beat's pair to the to-beat's (monotonic in hue, through the line world's no-radiance hold, never grey); and every handoff (one emitter at a time: the frame where one goes out and the next comes on, 2–4 frames apart per C18). Keep one hue pair per beat; a beat that needs a second saturated hue outside identity pigments is a FAIL to name, not a third colour to add. The gate runs `probe-colour.py --contract light.json`; quote its lines. Reply: Light script (table: beat · pair · emitter · intensity · handoff frame), Crossings (hue path each), Fails named, Changed, Receipt.

---

## Inline Gates

### Checks

- **Animation Colour Script** — check: runs `python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json`

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Required Sections** — emit these headers verbatim; they are graded structurally:
- `## Context` (required)
- `## Analysis` (required)
- `## Goals` (required)
- `## Execution` (required)
- `## Evaluation` (optional)
- `## Refinement` (optional)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

Chain: chain-animation_animatic#1
→ Progress 3/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
