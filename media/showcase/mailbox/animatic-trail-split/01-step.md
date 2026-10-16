---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Animation Timeline.

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

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placehold...
- **context**: 

## Task Context

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:


Read the ledger in the episode root (`beats-v2.json`, else `beats.json`) and its revision note, the hold band in `studies/craft-ref-01.md` (11–27 frames, 3–6 drawings per move) and `creative-spec.md` for the episode's duration ruling. Run `node scripts/animation/compile-timeline.mjs` in the renderer to write `<episode_root>/timeline.json`; never hand-type frame numbers. Report, as a table per beat: id · world · start–end · seconds · transition in/out · crossing window · state flips with scope. Name every ask the ledger leaves open with its default, and every beat whose actions cannot fit its seconds at the hold band (a beat with N drawn actions needs at least N × 11 frames of holds plus 3–6 drawings per move). Pacing is the timeline's own data: propose seconds changes as a diff to the ledger, not as prose, and apply only what the notes authorize. The gate runs `probe-timeline.py`; quote its lines. Reply: Timeline (the table), Pacing (fits / does not, per beat), Asks (each with default), Changed (files), Receipt.

---




---

## Inline Gates

### Checks

- **Animation Timeline Contract** — check: runs `python3 scripts/animation/probe-timeline.py v3/timeline.json`

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

### Animation Timeline Contract — PASSED

**Command:** `python3 scripts/animation/probe-timeline.py v3/timeline.json`
**Exit Code:** 0
**Duration:** 365ms


---

**Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "Animation Timeline Contract — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-timeline.py v3/timeline.json` in the renderer root and passes only when every check it prints passes; its first printed line is its positive control and it refuses to report if the control does not trip. Checks: beats contiguous and summing to the duration; crossing windows inside both beats; worlds named in the world registry; holds 11–27 frames unless marked intentional. On FAIL quote the probe's own line naming the frame or beat and fix the contract or the render, never the probe. Control: a planted 0-frame beat is refused.: <recorded: python3 scripts/animation/probe-timeline.py v3/timeline.json exit 0>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 1/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
