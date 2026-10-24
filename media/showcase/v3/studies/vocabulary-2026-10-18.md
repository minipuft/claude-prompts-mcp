# The direction vocabulary in the chains (plan rows 8.1 and 8.2, D96)

## 2026-10-18 - every intent word a step writes now has to be a word from one list

What changed for the next run: there is one controlled direction vocabulary (`v3/vocabulary.json`, 112 terms in 14 domains), the film's own words sit on top of it (`v3/vocabulary-overrides.json`), a gate named `animation-vocabulary` refuses any proposal, ruling, pose sheet or material that uses a word outside it, and the interview and the ruling now have one fixed form that a prompt (`animation_direction`) asks and writes. Every `animation_*` and `showcase_*` prompt points at the vocabulary in one line and never restates it. Everything on the server side went through `workflow-client.mjs call` (receipts under `media/showcase/evidence/`).

## What the files are

| File | What it is |
| --- | --- |
| `v3/vocabulary.json` | The terms by domain (shot size, angle, move; staging; timing; acting register and business; light role, quality, behaviour; material intent; transition; colour; feeling), each with a one-line definition and the bible lane, material property or pose-sheet facet it governs. A word that belongs to two domains (`low`, `high`, `pair`, `snap`, `float`, `soft`) has one entry that carries both senses. |
| `v3/vocabulary-overrides.json` | The film's words: eight register phrases mapped to base terms (`warm, inviting`, `playful tipping to overwhelm`, `gentle gag`, `reverent`, `playful`, `focused`, `playful, satisfied`, `reverent, content`), the four worlds (`home`, `crayon`, `line`, `shaded`) and the four hue pairs from `v3/light.json` (`Turrell blue`, `Styx steel`, `amber`, `Soup! coral`). |
| `scripts/animation/rulings.mjs` | The one parser of the ruling form `D<N>, <who>, <date>: <verb> <object> <value> because <intent word> (ref <card id>) (closes p<NNN>)`; `--test` parses D96-D99, `--parse` is what the probe calls. |
| `scripts/animation/probe-vocabulary.py` | The gate's probe. Control first, then seven plain-word checks. |

### Words shared with the inspiration board

`eagle_board.py` `FACET_VOCAB` and `v3/references/owner/card-schema.json` already name some of these words. The vocabulary carries a `facets` map for twelve of those facets and the probe reads both sources on every run: a facet word that is neither a vocabulary term, an alias nor declared unmapped is refused, so the two lists cannot drift.

| Board facet | Shared with the vocabulary | Aliased | Left unmapped on purpose |
| --- | --- | --- | --- |
| `camera.angle` | eye, low, high, overhead, pov, dutch | - | - |
| `camera.distance` | wide, medium, close, insert | - | - |
| `camera.move` | locked, push, pull, pan, tilt, orbit | - | unknown |
| `composition.placement` | centre, third-left, third-right, edge, low, high | - | - |
| `composition.framing` | doorway, window, body-gap, negative-space, radial, overhead, pair, tower | - | none |
| `acting.register` | warm, playful, inviting, reverent, comic, tense, neutral | - | - |
| `acting.timing` | snap, float, even, staggered | hold-heavy -> hold | - |
| `acting.contact` | weighted | - | light, none |
| `timing` | on-twos, on-ones | held -> hold, moving -> moving hold | unknown |
| `light.source` | flood, cone, window | single-emitter -> emitter, backlight -> rim | none |
| `light.contrast` | hard, soft | - | silhouette, flat |
| `light.pushes` | curiosity, delight, overwhelm, frustration, wonder, play, focus, satisfaction, contentment | - | none |

## Payloads and receipts

| Payload | Receipt | What changed |
| --- | --- | --- |
| 157 (list), 158, 159 (inspect) | call-JmVGQ2, call-EHhn6g, call-nsD3jr | Before: the catalogue (six `animation_*` and fifteen `showcase_*` prompts) and the two chains' step lists. |
| 160-gate-animation-vocabulary | call-gAEnmQ | New blocking check-tier gate `animation-vocabulary`. It runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json` in `../media/showcase` (same shape as payload 100). Guidance: ground truth by exit code; the control line comes first; on a refusal quote the refused word and replace it with a vocabulary term; never edit the vocabulary, the overrides or the probe to pass. |
| 161-animation_direction-create | call-R2FwR9 | New prompt `animation_direction` in the `animation` category. The system message is the interview protocol (one question per turn: situation, options as vocabulary words, default, what it changes, one reference card) and the ruling form; it points at `<episode_root>/vocabulary.json` and never lists a term. The user message takes `episode_root`, `beat`, `frame` and `question` and produces an `owner-ask` proposal file. |
| 162-animation_animatic-vocabulary-gate | call-XMGt5o | `animation_animatic`: `animation-vocabulary` added to the blocking, grade and evidence steps (the chain has no poses step). Every existing gate kept. |
| 163-showcase_shot-vocabulary-gate | call-gM3kJE | `showcase_shot`: `animation-vocabulary` added to the poses, grade and evidence steps. Every existing gate kept. |
| 164-184 (one per prompt) | see below | One line added to the system message of each `animation_*` and `showcase_*` prompt: `Use the animation-direction vocabulary (<path>); an intent word outside it is refused by the animation-vocabulary gate.` The `animation_*` prompts say `<episode_root>/vocabulary.json`, the `showcase_*` prompts say `media/showcase/v3/vocabulary.json`. |
| 185, 188 | call-VBj0FW, call-79VtWt | A temporary gate `animation-vocabulary-planted` (the same probe pointed at a proposals directory under `~/.cache` that held one proposal with intent `vibey`) and its deletion, used only for the refusal proof below. It no longer exists on the server. |
| 186, 187 (drive) | evidence/drive-3bMce1, evidence/drive-mCoiEZ | The refusal proof (below). Mailboxes: `mailbox/vocabulary-real/`, `mailbox/vocabulary-planted/`. |
| 189, 190, 195-215 (inspect) | call-mLk5GU, call-WyTHcL, call-o1priK ... call-1wVWOF | After: the gate loads with blocking enforcement; `animation_direction` shows its system message; all twenty-one prompts show the line (receipts listed below). 193 and 194 repeat 195 and 212 for the chains; 191 and 192 are unused numbers. |

### The one-line prompt updates

Each prompt was updated twice when it had no system message before. Eighteen of the twenty-one had none, and the first update of each (the system message alone) wrote `system-message.md` but not the `systemMessageFile:` pointer in `prompt.yaml`, so the server answered `post-write verification FAILED (mismatched: systemMessage)` and left an orphan file. The second update repeats the same call with `category` set to the value the prompt already has: supplying a yaml-resident key makes the server rewrite `prompt.yaml`, which adds the pointer. The three prompts that already had a system message (`showcase_motion`, `showcase_review`, `showcase_story`) took the line on the first call.

| Prompt | Payload | Receipt that took | Earlier refused attempt |
| --- | --- | --- | --- |
| animation_animatic | 164 | call-LRcVle | call-qjLsO7 |
| animation_animatic_render | 165 | call-3OgBJp | call-bSv3Lx |
| animation_blocking | 166 | call-Gfp5WW | call-I1LN63 |
| animation_light_script | 167 | call-qqjb8d | call-2i3BUX |
| animation_poses | 168 | call-GQX8hZ | call-VVmNZI |
| animation_timeline | 169 | call-1VKKcC | call-PKxCam, call-mtYdCI |
| showcase_asset_muse | 170 | call-oU5qAP | call-XsJTiI |
| showcase_asset_sheet | 171 | call-sAbxIs | call-KkP3Cb |
| showcase_board | 172 | call-HdPP0f | call-AfV1S0 |
| showcase_evidence | 173 | call-VaNJ71 | call-FN2wit |
| showcase_key_sheet | 174 | call-8llzCd | call-YTP08u |
| showcase_layout_sheet | 175 | call-H8zlHd | call-pWXjsD |
| showcase_model_sheet | 176 | call-cW6oLz | call-XNOykm |
| showcase_motion | 177 | call-5d3yB9 | - |
| showcase_preproduction | 178 | call-gPABES | call-Esp38U |
| showcase_render_study | 179 | call-mckv3r | call-voxXoV |
| showcase_review | 180 | call-E9x0BH | - |
| showcase_shot | 181 | call-knweIc | call-lnja4X |
| showcase_shotlist | 182 | call-wpb8cO | call-5q4pWa |
| showcase_story | 183 | call-wNIvsg | - |
| showcase_world_sheet | 184 | call-uxhkcK | call-n42SGV |

After-receipts (payloads 195-215, same order): call-o1priK, call-wkd5lU, call-SmpSdl, call-YFuNGk, call-BdflU7, call-rerrw4, call-95xWiH, call-BRC1OB, call-n7qQHL, call-QYlfqX, call-2PSiHr, call-OXHQsU, call-pPQgN3, call-xu7Lu9, call-YD0mJW, call-6STm0s, call-4Dq9l1, call-Ms5ef7, call-2QpBW0, call-Qu5P1h, call-1wVWOF. Each shows the line in its System Message. No prompt that binds a tool (`imagegen`) was unset: none of those steps carries an inline gate, so the tool bindings are untouched (`git diff` of the prompt files shows only the pointer, the line and the gate ids).

## The gate refuses in a run

A one-node workflow (`animation_direction`, the gate attached with `inlineGateIds`) answered once through the drive client. A single prompt does not run its shell checks (the server renders the gate as advisory), so the proof uses a workflow node, which is a chain step.

| Run | Gate | Result in the server's `Shell Verification Results` |
| --- | --- | --- |
| `evidence/drive-3bMce1`, `mailbox/vocabulary-real/02-step.md` | `animation-vocabulary` on the real tree | PASSED, exit 0, 75 ms |
| `evidence/drive-mCoiEZ`, `mailbox/vocabulary-planted/02-step.md` | the temporary control gate, proposals directory with intent `vibey` | FAILED, exit 1, 82 ms; the quoted output starts with the control line and ends `refused: proposals: proposal p900 intent 'vibey' is not in the vocabulary - replace a refused word with a term of the vocabulary; do not edit the vocabulary to pass` |

What this shows: the gate's command is allowed by the isolated server's allowlist, `node` resolves inside the server's environment (the probe parses rulings through it), and the refusal reaches the model with the refused word quoted. What it does not show: the gate firing inside `animation_animatic` or `showcase_shot`; that waits for the animatic 04 drive (row 8.7).

## Where the skill went

`skills-sync` exported `animation_direction` for Claude Code at user scope: `~/.claude/skills/animation_direction/SKILL.md` (6.4 KB, front matter `managed-by: claude-prompts-skills-sync`). The directory is named by the prompt id, with an underscore, not `animation-direction`. It carries the system message as `## Instructions`, the arguments, and the user message as `## Usage`. **No reference file shipped with it.** The exporter only bundles what a prompt's directory holds under `docs/` (markdown only), gate files for gates the prompt references, and script tools; it has no `references/` for prompts (that directory is written only for frameworks). `resource_manager` has no argument that writes a `docs/` file, and hand-writing under `server/resources/prompts` is forbidden, so `vocabulary.json` lives at `media/showcase/v3/vocabulary.json` and the exported skill names it by path.

The registration is one line, `- prompt:animation/animation_direction`, under `registrations.claude-code.user` in `server/skills-sync.yaml`. That file is gitignored and this worktree had none, so it was copied from the main checkout's and the line appended here. The main checkout's copy still lacks the line.

## Checks run (by hand)

- `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json`: control line (sixteen planted and clean cases, all as expected), seven `ok` lines, `pass:`, exit 0.
- Planted proposal (`intent: vibey`, in a temporary directory): `refused: proposals: proposal p900 intent 'vibey' ...`, exit 1. Planted ruling (`because vibey`, appended in a temporary copy of `rulings.json`): `refused: rulings: D100 because 'vibey' ...`, exit 1. Missing vocabulary file: exit 2.
- `node scripts/animation/rulings.mjs --test`: D96-D99 parse in the form; a free-prose ruling (D41) stays prose; a planted ruling keeps `vibey` as its intent word; exit 0.
