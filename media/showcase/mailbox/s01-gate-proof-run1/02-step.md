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

Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings, the animation language, the Craft baseline and its timing-chart vocabulary), `script.md`, `shots.json` (the shot row), `layouts/<shot>.json` (D77: the camera, move, emitter and figure heights the chart must serve; the chart's camera row follows it, and a missing layout is BLOCKED until showcase_layout_sheet has run), `timeline.json` (the shot's frame range is the beat ranges it spans and its crossing windows, compiled from the ledger by the animatic chain; never the provisional numbers in shots.json) and `blocking/<beat>.json` for each beat the shot spans (where every actor and the emitter stand at the beat's start and end; the key list places actors there, and a key that moves an actor off its blocking says so) and `rubric.md` (C16–C18, C23, C25). They are the contract; this prompt does not restate them.

Write the timing chart, the pose-to-pose contract (D72), for the shot and each of its actors. First the key list: K1…Kn with the frame, the pose in words, its line of action and what changes from the previous key; this list is the brief the key sheet draws from, so a pose the shot needs that no breakdown can reach by inbetweening is a key here, never a rig trick. Then, per key pair, the chart: hold (8–20), anticipation (3–5, as its own key or a breakdown), the breakdowns with their favouring (1/3 or 2/3 by default; 1/2 only on a straight ease), the smear frame on a move longer than a quarter of the figure's height, overshoot (2–3) and settle (10–16), everything on twos. Then the stagger after the previous actor (3–5 frames), the boil rate and variant count, every seam-pulse frame, the light layer's lag (2–4 frames) and recovery, and the camera move along its leading line (D64).

The failing controls are the early-web explainer (linear tweens, everything at once, hinge-jointed cutouts) and puppet-proof-02 (a rotation-only lift with no keys). A chart whose motion comes from rotating parts about pivots instead of from drawn keys fails. Express timing in the `src/library/motion.ts` primitives (`move`, `stagger`, `boil`, `lag`, `seamPulse`, and the key-hold/inbetween primitive) and name any primitive the library lacks as a library change for the implementation step.

Deliver `v3/charts/<shot>.json` (keys and charts per actor), the timing fields merged into `beats.json`, and a short `motion.md` naming the per-beat rhythm. Return: Key List (per actor); Charts (per key pair); Staggers and Lag; Boil and Pulses; Camera; Library Changes Needed; Artifact Handoff; Concerns.

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

Chain: chain-showcase_shot#1
→ Progress 2/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>"
