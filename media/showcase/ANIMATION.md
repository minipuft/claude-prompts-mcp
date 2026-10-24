# The animation scaffold: one timeline, six tracks, one chain, probe gates

This page is for the next animation project, not only this one. It names what a project supplies, what it inherits, and how the quality gates decide.

## What a project supplies

| Input | Where | What it holds |
| --- | --- | --- |
| `episode_root` | e.g. `media/showcase/v3` | the beat ledger (`beats-v2.json`: per beat world, seconds, actions, effects, transitions, state flips, asks), `shots.json` with a hue pair per shot, `worlds/<id>.json` look contracts, `rubric.md`, `studies/` |
| `renderer` | e.g. `media/showcase` | a Remotion project that imports `src/library/animation/` and wires its own cast, worlds and props in `src/scenes/` |
| gate working directory | the gate's `shell_working_dir` | the one project-specific value in the gates: the renderer root, relative to the server's own directory |

Everything else is inherited: the chain, its four track prompts, the five gates, the probe toolkit under `scripts/animation/`, and the rendering primitives.

## The tracks

Six tracks sit on one timeline, each sampled per frame. Editing rhythm is the pacing track's own numbers. Texture is the look track through the world contracts.

| Track | Contract file | Quantised | Written by |
| --- | --- | --- | --- |
| pacing | `timeline.json` | frames | `animation_timeline` from the ledger (`npm run timeline`) |
| blocking | `blocking/<beat>.json` | per beat | `animation_blocking` from the layouts and the test scene |
| camera | inside the layouts and the exposure sheet | ones | the layout sheet per shot |
| keys | `keys/<shot>.json` | twos | the key sheet per shot |
| light | `light.json` | ones | `animation_light_script` from the hue pairs and the ledger's effects |
| look | `worlds/<id>.json` | per beat, crossings on twos | the world sheet per world |

The exposure sheet (`npm run xsheet`: `xsheet.html` and `xsheet.json`) is the per-frame projection of all six: beat, world, key or hold, breakdown, camera, emitter, crossing phase. The animatic (`npm run animatic`) is the whole timeline rendered holds-only in each beat's world. The owner watches the animatic; the probes read the exposure sheet and the frames.

## The chain

```
>>animation_animatic episode_root:"media/showcase/v3" renderer:"media/showcase" brief:"..."
```

| Step | Prompt | Gate | The gate decides |
| --- | --- | --- | --- |
| 1 | `animation_timeline` | `animation-timeline-contract` | beats contiguous and summing to the duration, crossing windows inside both beats, holds in the measured band |
| 2 | `animation_blocking` | `animation-blocking-contract` | every named actor placed, emitter inside the frame, a card cited, identity boxes apart |
| 3 | `animation_light_script` | `animation-colour-script` | one hue pair per beat, one emitter at a time, no hue detour across a crossing |
| 4 | `animation_animatic_render` | `animation-animatic-probes` | twos/ones split, hold band, screen time per beat, eye trace, loop closure in line phases, colour pair per beat, byte-identical double render |
| 5 | `showcase_review` | `animation-review` | advisory: acting, composition, story in its screen time; every taste mark asks one question with a default |
| 6 | `showcase_evidence` | `handoff-artifacts` | the study, receipts and strip exist |

The per-shot chain (`showcase_shot`) runs after the animatic and reads `timeline.json` and `blocking/<beat>.json` instead of guessing frames and positions.

## How a gate decides

A gate is a probe script. It prints its positive control first and refuses to report if the control does not trip. It exits 0 on pass, 1 naming the beat or frame that failed, 2 when it could not run. The server runs it as a shell check, so a pass is an exit code. The one advisory gate says so in its own description. The operator's allowlist bounds the gates to `python3 scripts/animation/*` and `node scripts/animation/*` inside the renderer root; a gate run without that allowlist is refused, not degraded.

Probes and their controls are documented in `scripts/animation/README.md`. Plate-conformance measurements (contour width, fill class, hatch direction, bloom width) run once at sheet acceptance and never on this loop.

## The pose pass: the timing shape is declared, and judged on one line

A shot's `v3/poses/<shot>.json` declares how the figure travels between keys. Every move (a key's hold end to the next key) has the same shape (rubric C28): 3-6 drawings, at most one `anticipation` (a drawing before the from-key along the chord, -0.15 to -0.05), any `passing` drawings at 0.25-0.75, at most one `overshoot` (1.05-1.15) and a `settle` at 0.9 or more, in that order by frame. `parsePoseSheet` refuses a sheet that breaks it and `probe-poses.py` prints one line per move. The arc probe reads the same kinds: a joint may step back along its chord only into a declared anticipation and out of a declared overshoot, so a shape that needs a reversal declares it and a zigzag cannot pass as one. The lead arm of a move is authored motion, not a lagging secondary: a hand names its `side` and does not lag on the moves that side leads, and a sheet that lags a lead-arm joint is refused.

No probe is run alone on a shot. One command judges twos, holds and in-betweens together on the figure-only render, so a move cannot be made green on one probe by breaking another:

```
node scripts/s01-xsheet.mjs && node scripts/animation/joints.mjs s01-arrival-overwhelm
npx remotion render src/index.ts ShotS01Figure out/s01-arrival-overwhelm-figure-seq --sequence --image-format=png
python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out
```

It prints one line per probe per shot, skips (and says so) a shot with no frames, and exits 0 only when every probe on every shot passes.

## Props enter a shot through a muse sheet (C19)

A prop a shot names has `assets/props/<asset>/muse.json` (3+ generated variants, each citing owner-library cards by eagle id and facet and one existing cast property) before it is drawn into a scene; the gate `showcase-asset-muse` on the render step runs `python3 scripts/animation/probe-muse.py v3/shots.json assets/props`, which names a prop with no sheet, a sheet with two variants and a variant citing a card the library does not hold. A sheet is a proposal: `sheet_proposed` in `v3/shots.json` points at it, and `sheet_accepted` is the owner's pick, tracked and not gated.

## How a plate is made (D85)

A key plate is built in the project, not drawn by a generator. The pose sheet declares the key's line of action, weight, lead and plate family; `npm run solve-poses` turns that into joints (`solved`: every bone at the rest skeleton's length, checked to 1 % by `check:pose`; the legs from the weight foot, the wrists from the silhouette kind: a star's above the shoulders and 0.12 H off the spine, an open pose's 0.14 H off it, a closed or fold pose's near the torso), and `npm run plates` poses the plate family to those joints with ARAP, the solver the renderer runs, and draws it at the model sheet's measured scale (437 px, the figure on the model sheet without its numeral) on its baseline: role colours, soft alpha, the family plate's own contour. The solved joints are the key's registered joints, so the line of action the probe measures is the one the plate shows. A family is a mesh cut from one drawn plate with its own skeleton registration (`assets/<actor>/families/`); the home family is the approved model-sheet plate. The home family is a parts rig (`npm run parts`): the plate cut by the skeleton into hair, head, torso, poncho and a sleeve, forearm and hand, upper leg, lower leg and foot for each side, every part its own ARAP mesh pinned at its bone's joints and drawn in a per-key order (the lead arm and leg in front, a hand that crosses the body over it, the poncho behind the torso, the hair behind the head; a pose-sheet key's `order` overrides it). A crossed, folded or overhead limb is held by that order, not by tearing one sheet, and the tear metrics (inverted, strained, overlap) are measured on each part's own mesh. Where two parts meet each reaches into the other and the part in front fades out across the reach, so a joint is a soft overlap and not a hinge: the hinge measure (the disc one contour width about each shoulder, elbow and knee is drawn, and the overlap there is at least half a contour width) names a composite with its overlap removed. The film's `MeshFigure` draws the same parts with the same pins and the same order (`src/library/motion/partsRig.ts`). `measure-keys.py` compares each plate with the film rig's own picture of the key (`npm run film-keys`: the centroids of head, hands and feet within one contour width, the colour difference under a bar measured on the keys that agree) and `plates` exits non-zero when any key is rejected. A pose a family cannot hold (a part turned inside out, strained, or drawn over another) is not drawn: the key is reported `NEEDS FAMILY`, and only then is an image generator asked for a new silhouette, which is cut into its own mesh and registered by a toolchain or a stated fit that the plate must agree with, never placed by eye. Every plate is measured on what the prompts contract (C20 head and limbs, C21 silhouette, C22 contour, C31 line of action) into the key sheet and `out/<shot>-keys-table.txt`, and an authored breakdown carries the hash of the keys it was built on, so a moved key cannot leave a stale drawing behind.

## Rendering is hashed and cached, not repeated (D87)

`npm run render -- <shot>` draws a shot's layers (figure, props, world, light; the camera is the list of poses) once per distinct drawing, caches each under the hash of what the layer reads, composes every frame from the cache and draws a sample of frames whole through the browser to compare against. An unchanged layer is a HIT and is not drawn again; an edit to one key re-draws the figure layer and nothing else. `out/<shot>/render-manifest.json` records the hashes, the drawings, which frame shows which, and the comparison; the gate `animation-render-manifest` (`probe-render-manifest.py --all out`) recomputes the hashes from the files and refuses a frame set whose contracts moved after the render, naming the stale layer. The browser is still the compositor of record: the cache is faster where drawings repeat and where only one layer changed, not where every frame draws something new (the s01 widen and the pieces' flight), and its limits are measured in `scripts/animation/README.md` "Render cache".

## The boundary that keeps it portable

`npm run check:animation-boundary` fails if anything under `src/library/animation/` imports the cast, the worlds, the props, the tokens or the design. The primitives take scenes and renderers as parameters; `src/scenes/` wires them. A second project copies `src/library/animation/` and `scripts/animation/`, supplies its own `src/scenes/`, and runs the same chain.
