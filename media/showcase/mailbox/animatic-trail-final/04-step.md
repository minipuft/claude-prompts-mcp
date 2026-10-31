## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placehold...
- **context**: 

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:


Read `timeline.json`, the ledger's actions per beat, every `layouts/<shot>.json` (D77 cinematography sheets: camera, figure heights, emitter path), `blocking/test-scene.json` (the schema and the proven test staging) and board §8 composition cards. For each beat write `blocking/<beat-id>.json`: every actor the beat's actions name with position, scale and facing; props and gates; the emitter anchor at the beat's start and end; `card` (a composition card id, through the /inspiration skill, filed with provenance); `derivedFrom` (the layout or test-scene) and `provisional: true`. Keep identity boxes apart (Codex and Clawd never overlap each other or the human's crop) and keep the arch, gates and floor where the world contracts expect them unless the beat says otherwise. Render `PoseSheet`/`WorldSheet` with the beat's blocking for one beat per world as a staging still under `studies/`. The gate runs `probe-blocking.py`; quote its lines. Reply: Blocking (table: beat · actors placed · emitter start→end · card · derivedFrom), Stills, Deviations from the layouts (with why), Changed, Receipt.

---




---

## Inline Gates

### Checks

- **Animation Blocking Contract** — check: runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`

### Reminders

### Framework Compliance
**CAGEERF Framework Guidelines:**
- Include Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework considerations
- Structure responses according to framework principles
- Include systematic thinking and framework awareness
- Show iterative improvement and refinement processes

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

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


## Shell Verification Results

### Animation Blocking Contract — PASSED

**Command:** `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`
**Exit Code:** 0
**Duration:** 315ms


---

**Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "Animation Blocking Contract — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking` in the renderer root and passes only when every check it prints passes; its first printed line is its positive control and it refuses to report if the control does not trip. Checks one blocking file per beat against the timeline's beat list and each beat's actions. On FAIL quote the probe's own line naming the frame or beat and fix the contract or the render, never the probe. Control: an actor with no position is refused.: <recorded: python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking exit 0>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 2/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
