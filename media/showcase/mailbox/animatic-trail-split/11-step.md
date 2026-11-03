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


## Review Context

Review the original task and your output above against the gate criteria.

---




---

## Inline Gates

### Checks

- **Animation Animatic Probes** — check: runs `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq`
- **Animation Render Manifest** — check: runs `python3 scripts/animation/probe-render-manifest.py --all out`

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

### Animation Animatic Probes — PASSED

**Command:** `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq`
**Exit Code:** 0
**Duration:** 169655ms

### Animation Render Manifest — FAILED

**Command:** `python3 scripts/animation/probe-render-manifest.py --all out`
**Exit Code:** 1
**Duration:** 391ms

```
control: clean fixture -> passes; a camera value edited after the render -> refused, names camera only; the staging edited after the render -> refused, names figure and props, not camera; the light layer removed -> refused, names light; a layer whose inputsHash is not its inputs' hash -> refused, names world; a confirm frame over tolerance -> refused, names the frame and light; a composed frame deleted -> refused, names the missing frames
  FAIL s01-arrival-overwhelm: the figure layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the props layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the world layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the light layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); the camera layer is stale: the renderer's source changed after the render (codeVersion dea05b1ca9e0 is not the hash of the files on disk); confirm frame 252 is beyond the tolerance: 10726 pixels differ by more than 2 levels (allowance 92), largest in the light layer; confirm frame 254 is beyond the tolerance: 11292 pixels differ by more than 2 levels (allowance 92), largest in the props layer; confirm frame 195 is beyond the tolerance: 454 pixels differ by more than 2 levels (allowance 92), largest in the props layer
FAIL: render-manifest - 1 of 1 checks failed: s01-arrival-overwhelm
```


---

**Gate Review Required** (attempt 2/2)



**Gates you marked FAIL:**

- `animation-render-manifest` — Animation Render Manifest FAILED exit 1 in 298 ms: s01-arrival-overwhelm figure props world light and camera layers stale (codeVersion dea05b1ca9e0 is not the hash of the files on disk), confirm frames 252 254 195 beyond tolerance; the cache belongs to another live worker and is not touched here

Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "Animation Animatic Probes — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq` in the renderer root: twos, hold band, screen time, eye trace, loop closure (on the figure-only line-phase frames, because the floor grid merges with the outline on full frames), colour continuity and determinism (second render, tolerant within 2 levels on at most 0.01 % of pixels). Every probe prints its control first and refuses to report if it does not trip. On FAIL quote the probe's line naming the beat or frame and fix the contract or the render, never the probe.: <recorded: python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-l…>"},
    {"index": 2, "passed": false, "rationale": "Animation Render Manifest — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-render-manifest.py --all out` in the renderer root: for every out/<shot>/render-manifest.json it recomputes each layer's inputs hash from the files on disk (figure, props, world, light, camera), checks every composed frame exists with the hash the render recorded, and reads the confirm frames the browser drew whole against the composed ones (2 levels on at most 0.01 % of the pixels). Its first line is its control (a clean fixture passes; a contract edited after the render, a layer removed, a layer whose hash is not its inputs' hash, a missing frame and a confirm frame over tolerance are each named) and it refuses to report if a control does not trip. On FAIL quote the probe's line naming the stale layer and the input that changed, then run `npm run render -- <shot>` and quote the manifest's hit/miss table; never edit the manifest, the probe or a frame to make it pass, and never `--force` a render to hide a confirm refusal. Control: a camera value edited after the render is named as the stale camera layer.: <recorded: python3 scripts/animation/probe-render-manifest.py --all out exit 1>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 4/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
