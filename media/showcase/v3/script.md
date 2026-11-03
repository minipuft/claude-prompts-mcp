# Showcase script

Revision 1 · 2026-10-07 · silent · ~40 s at 30 fps · 1280x720 (poster 1280x640 from frame 0). Reads with [creative-spec v4](creative-spec.md), the [rubric](rubric.md) and the animation language. Rulings D41–D53 apply.

Thesis: raw capability is radiant and overwhelming; scaffolding is one lit join at a time. The companions are standardizing their own design process, which is what this project does (D49).

## Resource vocabulary

Every server resource is an object in the world, drawn in the Seuss contour language, and the vocabulary is fixed before any beat uses it. The mapping follows what each resource does in the server, not what sounds pretty.

| Resource | What it does in the server | Object in the world | Visible behavior |
| --- | --- | --- | --- |
| Prompt | one instruction that produces one output | a curling stalk with a flag leaf | planted on a patch; the leaf is its output and opens when it runs |
| Chain | prompts in order with handoffs between them | stalks joined by a beaded light string | one bead per handoff; a bead brightens as its step completes; the string sags between |
| Framework | the reasoning structure a run moves through (CAGEERF phases, ReACT, 5W1H) | the receding turned frames inside the tool | a run travels inward ring by ring; each ring is a phase; the rings are what give the interior its depth |
| Gate | a check a step must pass before the run advances; FAIL returns to the owning step | a pointed arch (Archbishop Katz) | a piece passes under it; PASS is a seam pulse at the keystone; FAIL leaves the arch dark and the piece slides back the way it came |
| Category | where prompts live and what defaults they inherit | a soft ground patch, one color per category | stalks are planted on it; patches join at soft seams (the reconfigurable kit from D40) |
| Style | the voice a response is written in | the light state bathing the scene | a style change is a light change, never a costume change (D44) |
| resource_manager | authoring: create, update, rollback | the human's hands placing or lifting a piece | a placed piece is a join; a lifted piece is a rollback |
| prompt_engine | resolving prompt, framework, gates into instructions | the tool: the frame held up | looking through it, everything is structured; what the frame shows is the resolved run |
| The box | the package arriving | a plain box, tape accent | opens into a bubble |
| The gadget | the model's raw capability | the hybrid machine (D43) | radiant, everything at once, bounded only by the frame |

The bubble (D45 extended): when the lid lifts, a glass bubble swells out of the box with the gadget inside it, drawn with the same transmissive material as the frame interior. Capability is always seen through glass. The bubble is unbounded and pops into beat 2; the frame is the same glass, bounded.

## Beats

Frame counts are provisional until the motion prompt emits the timing table; phases use the house vocabulary (hold 8–20, anticipation 3–5, action 4–8 on twos, overshoot 2–3, settle 10–16).

### 1. Arrival (0–180) · poster is frame 0

*2026-10-14, shot run s01-01: measured range 0–180 on the 65 s ledger (`v3/timeline.json`); the 0–150 above was the 40 s spine's provisional range. Study: `v3/studies/s01-01.md`. 2026-10-15, run s01-02: range unchanged (0–180); study `v3/studies/s01-02.md`.*

Settled state. Mark and title held top-left. Codex, the box, Clawd, and the human behind the box. One emitter: the box seam. Hold 60. The human lifts the lid (one move). The seam light lags, then a bubble swells from the box over 40 frames with the gadget dim inside; the companions lean in (staggered 4). Hold 20 on the bubble.

### 2. Everything at once (180–420)

*2026-10-14, shot run s01-01: measured range 180–420 on the 65 s ledger; the 150–330 above was provisional. The camera's widen runs 150–210 across the seam between the two beats. 2026-10-15, run s01-02: range unchanged (180–420); the widen now ends at zoom 0.6.*

The bubble pops: one frame of smear, then the overwhelm state arrives through the lag chain, light first, glass second. The gadget stands free, dial wide. It projects: stalks shoot up across the field, arches drop in, rings spin out, patches tile outward, beads scatter. Each arrives on twos, staggered 3, until nothing is staggered anymore and everything arrives at once (the one permitted violation of law 1, as the point of the beat). Codex's glyph flickers; Clawd's eyes narrow. The frame fills toward the maximalist painting. Hold 12 at full.

### 3. Can't build (330–480)

The human reaches for a stalk and a patch: anticipation, action, contact. The join fails: no pulse, the stalk slides back. Second try with an arch: the arch stays dark, the piece returns. A stack of patches collapses (three pieces, staggered 3, each a settle with no hold). The radiance goes noisy, grain up, the single emitter lost among projections. The companions wince (one boil variant held). Hold 16 on the mess.

### 4. The frame (480–600)

Clawd raises the frame (the pass-08 move, entering from the hand's side). Through it: the environment already assembled, rings, arches, stalks, patches, string, refracted and diffused, someplace else. Outside the frame the projections dim through the lag; inside, the emitter narrows to one piece. Hold 20 on the view through the frame. The human looks from the mess to the frame.

### 5. Scaffold (600–1020)

One join at a time, each a seam pulse, each staggered after the previous settle:

1. a patch lands (category);
2. a stalk is planted on it (prompt), leaf opens;
3. a second stalk, and a bead string joins them (chain);
4. an arch drops over the string (gate); the first piece passes it, pulse at the keystone;
5. a ring spins out around the whole (framework); the view gains a level of depth;
6. a second patch joins at a soft seam; the workspace reshapes (D40).

The light state shifts from overwhelm toward scaffold through the lag over the whole beat. The gadget's dial closes to a point; its light now rims the structure instead of flooding it.

### 6. Settle (1020–1200)

The structure stands. The gadget rests inside it, bright but bounded. The human sits on the patch. Codex and Clawd each take one idle boil. The frame is set down against the structure and keeps showing depth. Hold 40. Title held: Claude Prompts. Frame 1199 is the second poster.

## What this film does not do

No narration, no captions beyond the title and one held line per beat if the owner keeps them, no fabricated server output, no claim that the server draws, animates or judges images. The chain that made the film is the trail: every stage's prompt version and artifact are receipted under `studies/`.

## Open

- The human is the Swoop (D69, `studies/human-gen-16.png` middle), arriving in the heavy Cloak (left) and shedding it when the frame rises (beat 4, default) so the Swoop scaffolds beat 5. Beats 1, 3, 5 and 6 need the puppet; beat 4 carries the transition.
- Caption per beat: owner's call (study 09, question 1).
- Exact frame counts come from the motion prompt's timing table, not from this file. Since D60 (2026-10-13) each shot run writes its measured range back here with a dated note; `v3/shots.json` is the shot-level truth.
