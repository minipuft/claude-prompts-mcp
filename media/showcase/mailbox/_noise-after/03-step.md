### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **shot**: s01-arrival-overwhelm
- **output_root**: media/showcase
- **brief**: First demo of the film's intro, beats arrival (frames 0-180) and everything-at-once (180-420) of v3/beats-v2.json, home world, 420 frames at 30 fps (v3/timeline.json wins over shots.json's older 0-330...
- **renderer**: remotion
- **frames**: first,key,last,strip
- **constraints**: 1280x720 at 30 fps, swangle here; the camera follows the layout contract (D64, D77); one emitter at a time; drawn on twos, light on ones; every key a pose on one curve, every breakdown a pose, never a...

Episode root: media/showcase/v3
Shot: s01-arrival-overwhelm
Renderer: remotion
Production root: media/showcase
Previous handoff:
Motion: noise probe, no work done.

Read `charts/<shot>.json` (the key list: name, frame, hold, pose in words, line of action in words, what changes), `layouts/<shot>.json` (camera and figure height), `blocking/<beat>.json` for the beats the shot spans, the actor's `assets/<actor>/model.json` (height, reach and limb ratios), `references/owner/picks.json` (the reference cards: each with its why and its schema facets, pose.lineOfAction, pose.weight, pose.lead, pose.silhouette, camera.angle, light.contrast and the rest; cite ids as eagle://item/<ID>; a card with missing facets is filled with `pick <ID> --facet …` before it is cited) and `rubric.md` (C16, C21, C31–C33). The contract schema is `src/library/animation/pose.ts` in the renderer; this prompt does not restate it.

Write `poses/<shot>.json`, the pose sheet, for each rig actor: the same keys as the chart, in the same frames, and for every key the script moment it carries (one sentence), the line of action as a curve the solver can build (class C, S or straight; bow as a fraction of height, 0.06 or more unless the moment asks for stiffness; which side it bows; the inflection for an S), the weight foot and how far the root sits over it, the lead arm and lead leg (a twinned pose must say why), the silhouette kind, the face state when it changes, and the plate family the key is cut from (two keys share a family only when one can inbetween to the other without a limb crossing the torso or the figure turning). Then, for every key pair, at least one breakdown that is a pose, not a favour: a passing position that goes somewhere else en route (an arc offset on the lead wrist, the head or the root, signed and in pixels), an anticipation before a fast move, an overshoot past a snap and the settle after it. Then the secondaries (poncho, hair, each hand) with the drawings they lag the body by (one to three), and a moving hold for every hold longer than eleven frames (a drift of a few pixels, or a face change). Every pose is dynamic by construction: the body on one curve, weight on one foot, one side leading; the cards are the bar, and a key borrows its curve class, weight and lead from a named card's facets rather than inventing them. For every card a key or breakdown borrows from, record the use in the same step: `python3 ~/.claude/skills/inspiration/scripts/eagle_board.py apply <ID> --to poses/<shot>.json#<key> --note "<what the key took: curve, weight, lead, angle>" --receipt <this step's receipt or study path> --out references/owner`, so the ledger can say which reference led to which change. Generate each key's joints with `solvePose` and write them to the sheet as `solved` beside the declaration so the key sheet can draw from them; the key sheet may correct them by hand on the plate, the declaration stays the contract.

The gate runs `probe-poses.py` on the poses, keys and charts directories; quote its lines. When the current key sheet exists, run it now and report which keys it refuses and why: that list is the re-key brief for the key sheet step.

Reply: Poses (table: key · frame · moment · curve class/bow/sign · weight · lead · silhouette · family · card), Breakdowns (table: between · frame · kind · arc), Secondaries and Moving Holds, Cards Applied (id · to · note, as recorded), Probe Lines, Re-key Brief (keys the probe refuses on the current sheet), Changed, Receipt.

---

## Inline Gates

### Checks

- **Animation Pose Contract** — check: runs `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints solved`

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

⚡ Note: Step 4 ("Showcase Key Sheet") is delegated. Resume with your step output; the response will carry an EXECUTION BRIEF and handoff instructions for the sub-agent.

Chain: chain-showcase_shot#1
→ Progress 3/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
