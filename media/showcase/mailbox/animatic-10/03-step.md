### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: Animatic 10 of the 65 s eight-beat episode, the first run with the film reading story point by story point: every one of the 28 story points of v3/screenplay.json passes probe-story, the four themes p...
- **context**: 

> Use the animation-direction vocabulary (<episode_root>/vocabulary.json); an intent word outside it is refused by the animation-vocabulary gate.

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:
## Context
Animatic 10 of the 65 s, eight-beat episode (ledger `v3/beats-v2.json`, revision 2026-10-13, D78 worlds and guides, D79 65 s, D93 beat 4 = 10 s). This is the timeline step; the timeline is compiled by `node scripts/animation/compile-timeline.mjs` (`timeline: 8 beats, 1950 frames (declared duration 1950), 4 crossings -> v3/timeline.json`), never typed by hand.

## Analysis
| Beat | World | Frames | Seconds | In / out | Crossing window | State flips (scope) |
| --- | --- | --- | --- | --- | --- | --- |
| arrival | home | 0-180 | 6 | title held / the bubble swells into beat 2, no cut | none | box.open, gadget.visible (permanent) |
| everything-at-once | home | 180-420 | 8 | continuous / pieces keep arriving into beat 3 | none | hue s01 Turrell blue (beats 2-3); pieces.count many (until beat 8) |
| cant-build | home | 420-630 | 7 | continuous / the stalk slides back toward Clawd | none | hue s02 steel (beats 3-4); gadget.held false (until beat 8); grain high (beats 3-4) |
| the-frame | home | 630-930 | 10 | the frame rising / the human steps through alone, the push crosses the frame edge | 895-965 (home to crayon, 70, split 35/35) | human.garment swoop (permanent); emitter frame interior (beats 4-7); world crayon (beat 5) |
| art-world | crayon | 930-1230 | 10 | refill from the frame's glass / reduce to contour lines | 1195-1265 (crayon to line) | world line (beat 6); field paper (beat 5 only); pieces.made_by_human 1 (permanent) |
| crossing | line | 1230-1350 | 4 | reduce-to-lines / refill into the shaded world | 1315-1385 (line to shaded) | world shaded (beat 7); guide.lead codex (beats 6-7) |
| programming-world | shaded | 1350-1650 | 10 | refill from lines / the structure's silhouette leads the pull home | 1615-1685 (shaded to home) | world home (beat 8); joins.lit n and chain.ran true (permanent) |
| home-settle | home | 1650-1950 | 10 | pull along the structure's silhouette / title | none | hue s04 coral (beat 8); grain low and gadget.held rests (permanent) |

## Goals
Pacing: every beat fits its seconds at the hold band. `probe-timeline.py`: `ok every beat can hold: every beat has >= 11 frames clear of crossing windows`; the shortest beat (the crossing, 120 frames, of which 70 + 70 overlap its two windows by 35 each) keeps 50 clear frames, and the beats' action counts were checked against N x 11 frames in the earlier runs (no beat's seconds changed since animatic 04).
Asks the ledger leaves open, each with its default: art-world, "which object the human draws first" (default: the first stalk, which the film draws); programming-world, "how many gates light" (default: three, the third is the one the human made, which the film draws).

## Execution
Ran `node scripts/animation/compile-timeline.mjs` (above) and `python3 scripts/animation/probe-timeline.py v3/timeline.json`:
`pass: timeline-contract - 8 beats cover 1950 frames, 4 crossings sit inside both beats, every beat can hold` (its first line is its positive control: a planted 0-frame beat, a 3-frame gap, a crossing outside its beat, an unknown world and an 8-frame beat are each refused).
The server's own run of the step's gates, quoted from the step text: `Animation Timeline Contract - PASSED, exit 0 (246 ms)`, `Animation Story Contract - PASSED` for `probe-screenplay.py v3/screenplay.json` (exit 0, 146 ms) and for `probe-theme.py v3/screenplay.json` (exit 0, 539 ms).

## Evaluation
Timeline gate and story contract hold on the files as they stand. The film reads `pass: story - 28 of 28 story points pass` by hand on `out/animatic-10-draft-seq` (the chain's own render step writes `out/animatic-seq`).

## Refinement
Changed: no ledger seconds, no timeline file by hand. Files written this slice by the planner side of the work (not by this step): `v3/beats-v2.json` crossing `effects.emitter` and `effects.radiance` (a lantern on the carried stalk), `v3/worlds/line.json` `radiance.on`, `v3/blocking/crossing.json` and `programming-world.json` (emitter keys), `v3/screenplay.json` sp-5.1 recipe form.
Receipt: `evidence/drive-5AI5jX`, `mailbox/animatic-10/01-step.md`, payload `workflow-payloads/254-drive-animation_animatic-10.json`.

Read `timeline.json`, the ledger's actions per beat, every `layouts/<shot>.json` (D77 cinematography sheets: camera, figure heights, emitter path), `blocking/test-scene.json` (the schema and the proven test staging) and board §8 composition cards. For each beat write `blocking/<beat-id>.json`: every actor the beat's actions name with position, scale and facing; props and gates; the emitter anchor at the beat's start and end; `card` (a composition card id, through the /inspiration skill, filed with provenance); `derivedFrom` (the layout or test-scene) and `provisional: true`. Keep identity boxes apart (Codex and Clawd never overlap each other or the human's crop) and keep the arch, gates and floor where the world contracts expect them unless the beat says otherwise. Render `PoseSheet`/`WorldSheet` with the beat's blocking for one beat per world as a staging still under `studies/`. The gate runs `probe-blocking.py`; quote its lines. Reply: Blocking (table: beat · actors placed · emitter start→end · card · derivedFrom), Stills, Deviations from the layouts (with why), Changed, Receipt.

---

## Inline Gates

### Checks

- **Animation Blocking Contract** — check: runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`
- **Animation Vocabulary** — check: runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json`
- **Animation Story** — check: runs `python3 scripts/animation/probe-screenplay.py v3/screenplay.json`

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
→ Progress 2/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
