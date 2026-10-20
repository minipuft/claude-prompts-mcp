> Use the animation-direction vocabulary (<episode_root>/vocabulary.json); an intent word outside it is refused by the animation-vocabulary gate.

## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: Animatic 10 of the 65 s eight-beat episode, the first run with the film reading story point by story point: every one of the 28 story points of v3/screenplay.json passes probe-story, the four themes p...
- **context**: 

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:


Read `timeline.json`, `shots.json` (`hue.radiance`/`hue.accent` per shot, beats mapped by each shot's `beat` list), the ledger's `effects` per beat (emitter, radiance, grain, boil), `worlds/*.json` (each world's radiance colour) and `rubric.md` C6, C15, C18, C24. Write `<episode_root>/light.json`: per beat the hue pair, the emitter (anchor, start→end position from blocking, intensity on ones, colour), radiance level, grain; per crossing window the hue path from the from-beat's pair to the to-beat's (monotonic in hue, through the line world's no-radiance hold, never grey); and every handoff (one emitter at a time: the frame where one goes out and the next comes on, 2–4 frames apart per C18). Keep one hue pair per beat; a beat that needs a second saturated hue outside identity pigments is a FAIL to name, not a third colour to add. The gate runs `probe-colour.py --contract light.json`; quote its lines. Reply: Light script (table: beat · pair · emitter · intensity · handoff frame), Crossings (hue path each), Fails named, Changed, Receipt.

---




---

## Inline Gates

### Checks

- **Animation Colour Script** — check: runs `python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json`

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

### Animation Colour Script — PASSED

**Command:** `python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json`
**Exit Code:** 0
**Duration:** 209ms


---

**Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "Animation Colour Script — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json` in the renderer root and passes only when every check it prints passes; its first printed line is its positive control and it refuses to report if the control does not trip. Reads the light track contract before any render: pairs, emitter handoffs and crossing hue paths. On FAIL quote the probe's own line naming the frame or beat and fix the contract or the render, never the probe. Control: two emitters on one frame is refused.: <recorded: python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json exit 0>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 3/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
