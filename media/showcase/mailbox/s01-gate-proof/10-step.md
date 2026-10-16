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
**Summary**: The joints dump `out/s01-arrival-overwhelm-joints.json` is submitted as it stands on disk, byte-identical to the pre-drive backup (`cmp` clean). No render was run this drive; the dump and frames are the ones run 5 produced.

## Context
Read `v3/poses/s01-arrival-overwhelm.json` and `out/s01-arrival-overwhelm-joints.json`.

## Analysis
By hand, `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out` exits 0 (3 of 3 probe runs passed, about 63 s).

## Goals
Have the `animation-inbetween-probes` check run on the dump as it stands.

## Execution
No edits and no render.

## Evaluation
Done: the probe passes by hand. Not done: nothing was rendered this drive.

**GATE_REVIEW: PASS - the dump reads as arcs that ease.**

Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings D41–D72, medium, palette law, animation language, Craft baseline), `script.md` (resource vocabulary and beats), `rubric.md` (criteria C1–C23 and the receipt shape). They are the contract; this prompt does not restate them.

Grade the actual rendered artifact against `rubric.md` by criterion id; do not grade anything you have not viewed. Use only the four marks: HOLDS, FAILS, UNPROVEN, TASTE. Each mark cites its evidence at or above the criterion's minimum tier (still, 3x crop, consecutive frames, moving render, owner viewing) and names the failing control it beats. Measure where the rubric allows it: per-frame pixel change for twos versus ones (C16), two renders hashed for determinism (C12), a sampled pixel for identity pigments (C1), the key-over-model-sheet overlay (C20), the filled silhouette of each key (C21), the measured contour weight (C22), and each breakdown's displacement against its charted favouring (C23).

Motion contract:
**Summary**: Gate-proof drive of s01-arrival-overwhelm. The layout contract `v3/layouts/s01-arrival-overwhelm.json` is unchanged (last written 2026-10-15 11:40, before run 5); no sheet was regenerated and nothing was generated.

## Context
Read `v3/layouts/s01-arrival-overwhelm.json`, `v3/timeline.json`, `v3/blocking/arrival.json`, `v3/blocking/everything-at-once.json`, `assets/human/model.json`. `probe-timeline.py v3/timeline.json` passes (8 beats, 1950 frames).

## Analysis
- **Camera**: start locked medium-wide, end the full field at zoom 0.6 over frames 150-210; move: widen; led by the bubble and then the first stalk's curl.
- **Emitter**: box lid seam to the gadget's dial.
- **Figure Heights**: as in the contract (panel 1, panel 2, 8.0 heads); unchanged.
- **Hue**: D74 pair radiance #0a51fb, accent #fad204.
- **Cards Used**: unchanged from the contract.
- **Sheet Path**: `assets/layouts/s01-layout-02.png`, sha256 66445f7f..., identical to the copy in `public/assets/layouts/` (checked).
- **layout.json Path**: `v3/layouts/s01-arrival-overwhelm.json` (provisional: true).
- **Generation Receipt**: `evidence/s01/imagegen-layout-s01-02.json` (nothing generated this step).
- **Rejected Generations**: `out/s01-layout-01.png` (run 1).

## Goals
Keep the contract so the later steps run against it.

## Execution
No edits.

## Evaluation
Done: timeline probe exit 0; sheet hashes match. Concerns: panel 2 of the sheet still draws the older framing and the contract's camera pose supersedes it.

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
