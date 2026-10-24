# The story gate in the chains (plan row 9.4)

## 2026-10-19 - a chain run can now be refused because the world did not change where the screenplay says it does

What changed for the next run: both production chains end their blocking (poses, in the shot chain) and evidence steps by running the screenplay contract and the story-point probe. A story point that no key binds, a figure that acts over a world that does not change, or a state the screenplay promises that never shows up now stops the step with the failing story point named. The interview prompt also opens its situation line with the story point id, so an owner question says which moment it is about. On the film as it stands the gate refuses (24 of 29 story points fail); that is the target the restage (row 9.5) works toward, not a fault of the gate. Everything on the server side went through `workflow-client.mjs call` and `drive` (receipts under `media/showcase/evidence/`, payloads 221-238).

## The gate

| Part | What it is |
| --- | --- |
| Name | `animation-story`, blocking, check tier |
| Commands (both run, in `media/showcase`) | `python3 scripts/animation/probe-screenplay.py v3/screenplay.json`, then `python3 scripts/animation/probe-story.py v3/screenplay.json --frames out/animatic-seq --figure-frames out/animatic-fig-seq` |
| Why two criteria, not one `&&` line | The isolated server's allowlist (`python3 scripts/animation/*`) matches a prefix only for a command with no shell control character; `a && b` would have had to match exactly. Two criteria in one gate give the same order and the same refusal. |
| Attached to | `animation_animatic`: blocking, evidence. `showcase_shot`: poses, evidence (that chain has no blocking step; the poses step is where story points are bound to keys) |
| Cost | the story probe takes 55-76 s on the whole film; its timeout is 300 s |

## Payloads and receipts

| Payload | Receipt | What changed |
| --- | --- | --- |
| 221, 222, 223 (inspect, before) | call-lXOAKH, call-kRndxb, call-jSXBZj | The two chains and `animation_direction` before. Inspect lists a chain's steps but not each step's gates, so the gates were read from the prompt files: `blocking` had `animation-blocking-contract`, `animation-vocabulary`; `evidence` had `handoff-artifacts`, `animation-bible`, `animation-vocabulary` (animatic) and `animation-bible`, `animation-vocabulary` (shot). |
| 224 | call-e08gaR | Gate `animation-story` created. |
| 225 (inspect) | call-ZlKfdX | The gate loads: blocking enforcement, both commands, the guidance. |
| 226 | call-mmpRwz | `animation_animatic` update: `animation-story` appended to the blocking and evidence steps, +2 lines, nothing else changed. |
| 227 | call-k52FQc | `showcase_shot` update: `animation-story` appended to the poses and evidence steps, +2 lines. |
| 228 | call-LKb6Jy | `animation_direction`: the situation line of the interview form starts with the story point id (`sp-<beat>.<n>`), the prompt reads `screenplay.json`, the filed proposal's `text` starts with the id, the proposal's shape is unchanged. |
| 229, 230, 231 (inspect, after) | call-M1ewfC, call-vaX0Vd, call-utoCnW | The prompts after; `animation_direction` shows `sp-<beat>.<n>` in its system message and user message. The prompt files on disk show the two chains' diffs as exactly the four added `- animation-story` lines. |
| 232, 233 and 237, 238 | call-J3Bqi7, call-vW303S and call-NOCgtp, call-7spLgN | Two temporary control gates (same two commands narrowed to named story points) and their deletion. Neither exists on the server now. |

## The gate refuses in a run

A one-node workflow (`animation_direction` with the gate attached through `inlineGateIds`) answered once through the drive client. A single prompt does not run its shell checks, a workflow node (a chain step) does. The answer was sent alone; no gate verdict was sent, so each drive stops at the review and was ended by hand.

| Run | Gate | Result in the server's `Shell Verification Results` |
| --- | --- | --- |
| `evidence/drive-aYjdoK`, `mailbox/story-clean/02-step.md` | clean control: story points sp-1.1 and sp-4.1 on the real tree | screenplay probe PASSED exit 0 (122 ms); story probe PASSED exit 0 (673 ms) |
| `evidence/drive-9T8Lk4`, `mailbox/story-planted/02-step.md` | planted control: sp-1.1 read against copies of `v3/keys` and `v3/poses` with its `storyPoint` binding removed (a story point with no key or pose) | screenplay probe PASSED; story probe FAILED exit 1 (652 ms): `FAIL  s01/sp-1.1  SETTLED    f0-59` / `FAIL bound: no key or pose carries storyPoint sp-1.1 (bound otherwise: emitter arrival:box seam)` / `FAIL: story - 1 of 2 checks failed: s01/sp-1.1` |
| `evidence/drive-fvHMYu`, `mailbox/story-real/02-step.md` | the real gate on the real tree | screenplay probe PASSED (126 ms); story probe FAILED exit 1 (76 501 ms), ending `FAIL: story - 24 of 29 checks failed: s01/sp-1.2, s01/sp-1.3, s01/sp-2.1, ...` |

The same planted copy run by hand gives the same refusal (exit 1, `~/.cache/story-gate/planted-direct.txt`), and the unplanted keys give exit 0 with `ok bound: key 'rest-on-lid' at f0`: the refusal comes from the removed binding and nothing else.

What this shows: the commands are allowed by the isolated server, both run in order, a refusal reaches the model with the story point named, and the real film is refused today. What it does not show: the gate firing inside `animation_animatic` or `showcase_shot` (waits for animatic 05, row 9.5), and the gate when the model sends a gate verdict. The server truncated the real run's output to its tail (`[...truncated...]`), so the head of the failure list is in the probe's own output (run it by hand), not in the step text.

## The shot list now follows the 65 s timeline

`v3/shots.json` had the 40 s film's ranges (s01 0-420, s02 330-600, s03 600-1020, s04 1020-1200) and beat names (`scaffold`, `settle`) that exist on no timeline; `compile-screenplay` carried a `shot_beat_aliases` workaround. Now:

| Shot | Frames | Beats | `beat` list (hue wiring) |
| --- | --- | --- | --- |
| s01-arrival-overwhelm | 0-420 | 1-2 arrival, everything-at-once | same |
| s02-cant-build-frame | 420-930 | 3-4 cant-build, the-frame | same |
| s03-scaffold | 930-1650 | 5-7 art-world, crossing, programming-world | art-world, crossing |
| s04-settle | 1650-1950 | 8 home-settle | home-settle |

The ranges tile 0-1950. `compile-screenplay.mjs` takes a story point's shot from the range alone, the alias key is gone from `screenplay.json`, and `probe-screenplay.py` checks the tiling and reads the ranges (control: ranges that overlap and ranges that end inside a beat are each refused). All 28 story points kept their shot.

Why s03's `beat` list stops at crossing: the beat list is what `lightPlan.ts`, `compile-light.mjs` and `probe-colour.py` read as "beats wearing this shot's hue pair". The timeline gives programming-world s02's pair ("s02 accent as the world's hue"). Listing it under s03 makes `probe-colour --contract` refuse (`beats whose pair differs from shots.json: ['programming-world']`, measured with the variant) or, after a recompile, changes the colour script. The shot of a frame therefore comes from `frames`, and the hue wiring keeps its own list.

| Reader of `shots.json` | Probe | Before | After |
| --- | --- | --- | --- |
| `probe-screenplay.py` | `python3 scripts/animation/probe-screenplay.py v3/screenplay.json` | pass, 28 story points (10 controls) | pass, 28 story points (12 controls, the two new ones among them) |
| `compile-screenplay.mjs` | `node scripts/animation/compile-screenplay.mjs` | not run before the change | 28 resolved to a shot, renders re-stamped (`screenplay.md`, `screenplay.fountain`); the json differs from before only by the removed alias key, so no story point changed shot |
| `lightPlan.ts` and `compile-light.mjs` | `node scripts/animation/compile-light.mjs --out <tmp>`, `diff` with `v3/light.json` | - | identical bytes |
| `probe-colour.py` | `--contract v3/light.json --timeline v3/timeline.json --shots v3/shots.json` | pass | pass (`pair equals the shot's D74 pair: 7 shot-covered beats agree`) |
| `probe-muse.py` | `python3 scripts/animation/probe-muse.py v3/shots.json assets/props` | pass, 9 props | pass, 9 props |
| `probe_common.shot_beat_ids` (every probe's `--shot`) | called for the four shots | s03 gave `['scaffold']` and s04 `['settle']`, ids on no timeline, so `--shot s03-scaffold` died | s03 gives art-world and crossing, s04 home-settle; s01 and s02 unchanged |
| `src` (type check) | `npx tsc --noEmit` | not measured | 2 errors, both `cameraPose.span` of the layouts (`Root.tsx`, `animaticPlan.ts`); none names shots or lightPlan |

## The bible page keeps the story point on an action

`beats-v2.json` actions are `{actor, does, storyPoint}`; the page edits them as text and sent back `{actor, does}`, and the server refused any action with a third key. Now an action may carry `storyPoint` (an id of its own beat, `null` to unbind), and an action that arrives without one keeps the one it had (same actor and words, else same actor in the same slot). Controls on the restarted server (PID 548002), each reading `v3/beats-v2.json` back:

| Edit | Answer | File afterwards |
| --- | --- | --- |
| before the fix, the arrival actions as they stand | 400 `action 1 must be exactly {actor, does}` | untouched |
| arrival actions with their story points | 200 | byte-identical to the backup |
| arrival actions as the page sends them (no story point) | 200 | byte-identical; story points `sp-1.2, sp-1.2, sp-1.3, sp-1.3` kept |
| first action reworded | 200 | `{"actor":"human","does":"opens the box lid slowly","storyPoint":"sp-1.2"}`; reworded back, byte-identical |
| story point of another beat (`sp-2.1` on arrival) | 400 `... is not a story point of beat arrival (sp-1.1, sp-1.2, sp-1.3)` | untouched |
| `storyPoint: null` on the first action | 200 | binding removed; restored in the next call, byte-identical |

## Checks run (by hand)

- `python3 scripts/animation/probe-screenplay.py v3/screenplay.json`: 12-control line, seven `ok` lines, `pass: screenplay - 28 story points hold the contract`, exit 0.
- `python3 scripts/animation/probe-story.py v3/screenplay.json --frames out/animatic-seq --figure-frames out/animatic-fig-seq`: exit 1, `24 of 29 checks failed` (the restage's list); with `--story sp-1.1,sp-4.1`: exit 0.
- The planted copy: exit 1 naming sp-1.1.
