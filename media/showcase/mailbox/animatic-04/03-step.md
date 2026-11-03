### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: Animatic 04 of the 65 s eight-beat episode: the blocking step resolves the prop collisions animatic 03 left open (the box over the kit blocks and the join glow, the stalk in the air at 300, the struct...
- **context**: 

> Use the animation-direction vocabulary (<episode_root>/vocabulary.json); an intent word outside it is refused by the animation-vocabulary gate.

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:
**Summary**: Recompiled the timeline with `node scripts/animation/compile-timeline.mjs` (8 beats, 1950 frames, 4 crossings); `git status` shows `v3/timeline.json` unchanged, so the D93 pacing (beat 4 = 10 s, the art and programming worlds 10 s each) is what the compile gives. Every beat's drawn actions fit its clear frames; no ledger change is proposed. This is animatic 04 (row 8.7): the timeline step changes nothing and the work of the run is in the blocking and render steps.

## Context
Episode root `media/showcase/v3`, renderer `media/showcase`. Ledger `v3/beats-v2.json` (revision note: D78 worlds and guides, D79 65 s, D88/D91 register and light per beat, D93 beat 4 = 10 s and worlds 10 s each). Hold band 11-27 frames and 3-6 drawings per move (`v3/studies/craft-ref-01.md`). Duration ruling D79/D93: 65 s = 1950 frames at 30 fps.

## Analysis
Timeline (table per beat; `transition in/out` abbreviated from the ledger, `crossing` is the window in frames):

| id | world | frames | seconds | transition in | transition out | crossing window(s) | state flips (key: from -> to, scope) |
|---|---|---|---|---|---|---|---|
| arrival | home | 0-180 | 6 | title held | the bubble swells (leading line up) into beat 2, no cut | none | box.open: False -> True, permanent; gadget.visible: False -> True, permanent |
| everything-at-once | home | 180-420 | 8 | continuous from beat 1 | pieces keep arriving as the human reaches, into beat 3 | none | hue: settled -> s01 Turrell blue, beats 2-3; pieces.count: 0 -> many, until beat 8 reduces them to the structure |
| cant-build | home | 420-630 | 7 | continuous | the stalk slides back toward Clawd; the frame's left bar ris | none | hue: s01 blue -> s02 steel, beats 3-4; gadget.held: True -> False, until beat 8; grain: rising -> high, beats 3-4 |
| the-frame | home | 630-930 | 10 | the frame rising | the human steps through alone; the guides follow (plot defau | 895-965 (home>crayon) | human.garment: cloak -> swoop, permanent; emitter: dial -> frame interior, beats 4-7; world: home -> crayon, beats 5 |
| art-world | crayon | 930-1230 | 10 | refill from the frame's glass into crayon | the piece and the world reduce to their contour lines (the c | 895-965 (home>crayon), 1195-1265 (crayon>line) | world: crayon -> line, beat 6; field: black -> paper, beat 5 only; pieces.made_by_human: 0 -> 1, permanent |
| crossing | line | 1230-1350 | 4 | reduce-to-lines | refill into the shaded world (beat 7) | 1195-1265 (crayon>line), 1315-1385 (line>shaded) | world: line -> shaded, beat 7; guide.lead: clawd -> codex, beats 6-7 |
| programming-world | shaded | 1350-1650 | 10 | refill from lines into shaded forms | the structure's silhouette leads the pull back home (beat 8) | 1315-1385 (line>shaded), 1615-1685 (shaded>home) | world: shaded -> home, beat 8; joins.lit: 0 -> n, permanent; chain.ran: False -> True, permanent |
| home-settle | home | 1650-1950 | 10 | pull along the structure's silhouette | title; settled state returns | 1615-1685 (shaded>home) | hue: world hues -> s04 coral, beat 8; grain: none -> low, permanent; gadget.held: False -> rests, permanent |

## Goals
Pacing (fits / does not, per beat): every beat has at least 11 frames clear of crossing windows (gate line `every beat can hold`) and the drawn actions fit.

| beat | drawn actions | clear frames | needs (N x 11) | verdict |
|---|---|---|---|---|
| arrival | 4 | 180 | 44 | fits |
| everything-at-once | 4 | 240 | 44 | fits |
| cant-build | 3 | 210 | 33 | fits |
| the-frame | 4 | 265 | 44 | fits |
| art-world | 4 | 230 | 44 | fits |
| crossing | 4 | 50 | 44 | fits |
| programming-world | 4 | 230 | 44 | fits |
| home-settle | 5 | 265 | 55 | fits |

Beat 4 plays six keys (slump, turn, rise, step, threshold, through) held 26+16+20+14+24+30 = 130 frames and five moves of 26-40 frames; the `through` key (900) sits inside the first half of the crossing out (895-930), which the pose sheet and the exposure sheet already account for.

Asks (ledger `asks`, each with its default): art-world: which object the human draws first (default: the first stalk); programming-world: how many gates light (default: three, the third is the one the human made). All other beats list none.

## Execution
Commands run in `media/showcase`: `node scripts/animation/compile-timeline.mjs` -> `timeline: 8 beats, 1950 frames (declared duration 1950), 4 crossings -> v3/timeline.json`; `python3 scripts/animation/probe-timeline.py v3/timeline.json` by hand (identical lines to the engine's run, below).

## Evaluation
Gate `animation-timeline-contract` (engine run, exit 0, quoted in the review): `ok beats cover the duration: 8 beats contiguous from 0, summing to 1950 frames`; `ok crossing windows inside both beats: 4 windows, each inside the two beats it joins`; `ok worlds in the registry: all worlds in ['crayon', 'home', 'line', 'shaded']`; `ok every beat can hold: every beat has >= 11 frames clear of crossing windows`; `pass: timeline-contract - 8 beats cover 1950 frames, 4 crossings sit inside both beats, every beat can hold`.

## Refinement
Nothing to refine here; the next steps need the blocking restaged (prop collisions) and beat 4 played from `v3/poses/s02-the-frame.json`.

Changed (files): none (`v3/timeline.json` recompiled byte-identical). Receipt: drive `evidence/drive-uzeuoq`, mailbox `mailbox/animatic-04/01-step.md`.

Read `timeline.json`, the ledger's actions per beat, every `layouts/<shot>.json` (D77 cinematography sheets: camera, figure heights, emitter path), `blocking/test-scene.json` (the schema and the proven test staging) and board §8 composition cards. For each beat write `blocking/<beat-id>.json`: every actor the beat's actions name with position, scale and facing; props and gates; the emitter anchor at the beat's start and end; `card` (a composition card id, through the /inspiration skill, filed with provenance); `derivedFrom` (the layout or test-scene) and `provisional: true`. Keep identity boxes apart (Codex and Clawd never overlap each other or the human's crop) and keep the arch, gates and floor where the world contracts expect them unless the beat says otherwise. Render `PoseSheet`/`WorldSheet` with the beat's blocking for one beat per world as a staging still under `studies/`. The gate runs `probe-blocking.py`; quote its lines. Reply: Blocking (table: beat · actors placed · emitter start→end · card · derivedFrom), Stills, Deviations from the layouts (with why), Changed, Receipt.

---

## Inline Gates

### Checks

- **Animation Blocking Contract** — check: runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`
- **Animation Vocabulary** — check: runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json`

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
