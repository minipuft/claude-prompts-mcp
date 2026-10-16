---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Animation Animatic Render.

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



## ⚠️ Retry Limit Reached

The following gates failed after 2 attempts: **animation-animatic-probes, animation-render-manifest, framework-compliance**

### Choose an action:

| Action | Description |
|--------|-------------|
| `gate_action: "retry"` | Reset retry count and try again with improvements |
| `gate_action: "skip"` | Skip this gate check and continue the chain |
| `gate_action: "abort"` | Stop chain execution entirely |

**To continue**, include one of the above in your next call.

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

### Animation Animatic Probes — PASSED

**Command:** `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq`
**Exit Code:** 0
**Duration:** 130404ms

### Animation Render Manifest — FAILED

**Command:** `python3 scripts/animation/probe-render-manifest.py --all out`
**Exit Code:** 1
**Duration:** 324ms

```
control: clean fixture -> passes; a camera value edited after the render -> refused, names camera only; the staging edited after the render -> refused, names figure and props, not camera; the light layer removed -> refused, names light; a layer whose inputsHash is not its inputs' hash -> refused, names world; a confirm frame over tolerance -> refused, names the frame and light; a composed frame deleted -> refused, names the missing frames
  FAIL s01-arrival-overwhelm: the figure layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the props layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the world layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the light layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the camera layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); confirm frame 252 is beyond the tolerance: 10726 pixels differ by more than 2 levels (allowance 92), largest in the light layer; confirm frame 254 is beyond the tolerance: 11292 pixels differ by more than 2 levels (allowance 92), largest in the props layer; confirm frame 195 is beyond the tolerance: 454 pixels differ by more than 2 levels (allowance 92), largest in the props layer
FAIL: render-manifest - 1 of 1 checks failed: s01-arrival-overwhelm
```

Chain: chain-animation_animatic#1
→ Progress 4/6
Next: chain_id="chain-animation_animatic#1", gate_action="retry" | gate_action="skip" | cancel: true
