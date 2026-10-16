═════════════════════════════════════════════════════════════════
EXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)
═════════════════════════════════════════════════════════════════

---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Showcase Key Sheet.

Apply the C.A.G.E.E.R.F framework systematically:

**Context**: Establish comprehensive situational awareness and environmental factors
**Analysis**: Apply structured, systematic examination of the problem or opportunity
**Goals**: Define specific, measurable, actionable objectives with clear success criteria
**Execution**: Develop practical, implementable approach with detailed action steps
**Evaluation**: Create robust success metrics and assessment methods
**Refinement**: Enable continuous improvement and iteration processes

Ensure each phase builds logically on the previous phases while maintaining focus on practical, actionable outcomes. Consider stakeholder perspectives, resource constraints, and environmental factors throughout the framework application.


Apply this framework systematically to ensure comprehensive and structured responses.

---


## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **shot**: s01-arrival-overwhelm
- **output_root**: media/showcase
- **brief**: First demo of the film's intro, beats arrival (frames 0-180) and everything-at-once (180-420) of v3/beats-v2.json, home world, 420 frames at 30 fps (v3/timeline.json wins over shots.json's older 0-330...
- **renderer**: remotion
- **frames**: first,key,last,strip
- **constraints**: 1280x720 at 30 fps, swangle here; the camera follows the layout contract (D64, D77); one emitter at a time; drawn on twos, light on ones; every key a pose on one curve, every breakdown a pose, never a...

Shot: s01-arrival-overwhelm
Actors: every actor with keys in the pose sheet
Production root: media/showcase
Pose sheet handoff:
Read the pose step's result from chain history (v3/poses/<shot>.json); a missing pose sheet is BLOCKED, run animation_poses.

Read `v3/creative-spec.md` (D65–D72, D74, D77, D83, D85, Craft baseline, clean-up standard), `v3/rubric.md` (C20–C22, C25, C31), `v3/poses/<shot>.json` (the contract: per key the moment, curve, weight, lead, silhouette kind, plate family and the solved joints; a missing or unsolved pose sheet is BLOCKED, run animation_poses and `npm run solve-poses -- <shot>`), `v3/layouts/<shot>.json` (a missing or unapproved layout is BLOCKED, run showcase_layout_sheet), each actor's `assets/<actor>/model.json` and plate families under `assets/<actor>/families/` (an actor with no approved model sheet is BLOCKED, run showcase_model_sheet), and `scripts/animation/README.md` §plates.

The plates are built here, not described to a generator (D85). Run `npm run plates -- <shot>`: every key is rendered from its solved joints through its plate family's mesh at the model sheet's scale and baseline on the black field (D71, D76), its joints written to `v3/keys/<shot>.json` with `source: solver`, and its measurements recorded per key: model-sheet overlay (C20: head count and limb ratios within 5 %), silhouette read (C21), contour ratio against the model sheet (C22, ±20 %), and the spine fit against the declaration (C31, `probe-poses.py --shot <shot> --joints keys`). A key the script reports as NEEDS FAMILY is a silhouette the rig cannot hold (a fold, crossed or overhead arms, a stoop): propose that family's plate once outside this step (the owner draws it, or `showcase_asset_muse` generates it from the model sheet, the approved pick, the cited pose cards and the solved joints drawn as a guide; this step binds no generator so its gate runs); cut it with `scripts/cutout.py --field black`, build its mesh and register its joints with the skeleton toolchain (or the documented fit, flagged `registration: fit`), never by eye; then re-run `npm run plates`. A family plate that fails C20 or C22 is regenerated once with the failing property named; a second failure stays NEEDS FAMILY on the sheet for the owner. Row 2 of the key sheet (the keys as frame thumbnails at the layout camera, C25) is rendered from the same plates through the `KeySheet` composition, with the measured curve drawn over each key. Companions are drawn from their official plates under `assets/codex` and `assets/clawd`; a garment transition (D69) is five flat roles, never cloth. The gate runs `probe-poses.py --joints keys` over the key sheet; quote its lines.

Return: Keys (actor, family, source solver|family-plate, id, frame, C20 head/limbs, C21, C22, C31 declared vs measured class/bow/sign/twinning, plate path, sha256); Families (new families proposed, how registered); Frame Keys (F1…Fn: figure height vs layout, emitter vs layout); Probe Lines; Sheet Paths; Generation Receipts (family plates only); Needs Family; Concerns.

---


### Chain History (prior step outputs)

#### Step 1: Showcase Cinematography Sheet

Layout sheet: numbering probe, no work done.

#### Step 2: Showcase Motion

Motion: noise probe, no work done.

### Quality Gates

---

## Inline Gates

### Checks

- **Animation Key Fit** — check: runs `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys`

### Reminders

### Framework Compliance
**CAGEERF Framework Guidelines:**
- Include Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework considerations
- Structure responses according to framework principles
- Include systematic thinking and framework awareness
- Show iterative improvement and refinement processes

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

### Result Contract

Return your complete work product as plain text — it becomes the chain’s step output verbatim.

You are the worker for this one step. Do not call `prompt_engine` or any other chain tool, and do not put chain metadata or tool calls in your reply — the orchestrating agent owns the run and resumes it with your text.

End your reply with this exact block — `node` is how the server matches your result back to this step, followed by a proposed self-review: PROPOSED only; the orchestrating agent reviews and may override before submitting the actual verdict:

```
HANDOFF RESULT
node: keys
Proposed Gate Review:
- [gate 1 name]: PASS|FAIL — <one-line rationale>
- [gate 2 name]: PASS|FAIL — <one-line rationale>
```

═════════════════════════════════════════════════════════════════
END EXECUTION BRIEF
═════════════════════════════════════════════════════════════════

⚡ HANDOFF: Execute Step 4 ("Showcase Key Sheet") via sub-agent for context isolation.

═════════════════════════════════════════════════════════════════
HANDOFF INSTRUCTIONS
═════════════════════════════════════════════════════════════════

→ Handoff: Use your client's sub-agent/handoff capability
→ Prompt: Pass the EXECUTION BRIEF above (everything between the BRIEF delimiters) as the agent's prompt
→ Result: Include the sub-agent's result in user_response along with your ratified gate_verdict to continue the chain
→ Review: the worker's "Proposed Gate Review" is INPUT to your gate_verdict — review it against the criteria, override what you disagree with, then submit

⚠️ CONSTRAINT: Use handed-off execution when available; do not answer inline if handoff exists.
⚠️ RESULT CONTRACT: Include handed-off output in user_response and then resume the chain.



---

## Inline Gates

### Checks

- **Animation Key Fit** — check: runs `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys`

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

**Inline Fix Guidance:**
- Ensure your response includes the required "## Context" section
- Ensure your response includes the required "## Analysis" section
- Ensure your response includes the required "## Goals" section

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



---

**Structural Review Required** (attempt 1/3)

phase guards

Review your output above against the gates, then submit:

```
chain_id="chain-showcase_shot#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "__phase_guard__: <why>"}
  ]
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-showcase_shot#1
→ Progress 4/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
