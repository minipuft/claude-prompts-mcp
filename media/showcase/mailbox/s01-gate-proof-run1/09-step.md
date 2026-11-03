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


## Review Context

Review the original task and your output above against the gate criteria.

---




---

## Inline Gates

### Checks

- **Animation Key Fit** — check: runs `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys`

### Reminders

### Materials Creed Fidelity
# Materials Creed Fidelity

The Materials Creed lives at the top of `docs/DESIGN_BIBLE.md` in the CloudySky repo
(`~/Applications/cloudySky`). It is eight numbered lines; each is a test a screenshot can
pass or fail. "Does it match the vibe" is unfalsifiable — naming the line you are closest
to BREAKING is the check that has teeth.

## Required statement (three fields, cite lines by number)

```
creed: serves line <n> (<short quote>) · risks line <m> (<short quote>) · check: <observable — tools/cdp probe, screenshot judgment, or measured delta>
```

One statement per design direction, plan tier, or calibration verdict — not per file.

## Escape hatch

If the work touches no CloudySky visual/aesthetic surface (pure infra, tests, docs,
tooling), state exactly: `creed: n/a — no visual surface` and pass. Do not force a
creed mapping onto non-visual work.

## Failure modes this gate catches

- **Glow relapse** — an additive term shaped by distance-to-edge (risks line 2: depth
  lives IN the medium, never ON the edge). Check: interior-vs-edge-band luma delta.
- **Painted bubble** — a card treatment that paints highlights instead of bending the
  backdrop (risks line 5). Check: lensing visible in an ab-diff against the field.
- **Luma-spending hue** — iridescence/film that brightens instead of rotating hue
  (risks line 6). Check: readability.mjs Lc delta ±2.
- **Scattered shore** — boundary effects sprinkled uniformly instead of composed
  (risks line 4). Check: owner-eye screenshot vs the raked-garden reading.
- **Wet art** — refraction/film reaching album art, buttons, or text (risks line 7).
  Check: reserved-dry surfaces crisp in golden --check.

## Verdict

PASS only when the statement is present, cites line numbers, and names an observable
check (or uses the n/a escape verbatim). FAIL with the missing field named.

### Framework Compliance
**CAGEERF Framework Guidelines:**
- Include Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework considerations
- Structure responses according to framework principles
- Include systematic thinking and framework awareness
- Show iterative improvement and refinement processes

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

**Inline Fix Guidance:**
- Section "## Context" is too short (84 chars). Expand to at least 100 characters.
- Section "## Goals" is too short (69 chars). Expand to at least 80 characters.

**Last Review:** The engine ran probe-poses.py --joints keys and it exited 1: key awe's spine reads straight where S was declared (planted for this proof), so the key sheet is restored and resubmitted.

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

### Animation Key Fit — FAILED

**Command:** `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys`
**Exit Code:** 1
**Duration:** 303ms

```
[...truncated...]
 (their keysHash 1f6d065bea5a is not the keys' a01ca0543fb2): author them again with author-breakdowns.mjs
  ok   s01-arrival-overwhelm: secondaries: 3 item(s) ok
  ok   s01-arrival-overwhelm: holds: 8 item(s) ok
  ok   s01-arrival-overwhelm: timing shape: rest-on-lid -> grip: 4 drawings [passing +0.25@26, passing +0.65@30, passing +0.75@34, settle +0.98@38]
  ok   s01-arrival-overwhelm: timing shape: grip -> lift: 3 drawings [passing +0.25@58, passing +0.65@62, settle +0.98@64]
  ok   s01-arrival-overwhelm: timing shape: lift -> awe: 3 drawings [passing +0.25@92, passing +0.65@96, settle +0.98@100]
  ok   s01-arrival-overwhelm: timing shape: awe -> brace: 6 drawings [anticipation -0.10@130, passing +0.25@134, passing +0.45@138, passing +0.60@142, passing +0.75@146, settle +0.98@150]
  ok   s01-arrival-overwhelm: timing shape: brace -> joy-a: 4 drawings [passing +0.25@178, passing +0.58@182, passing +0.74@186, settle +0.98@188]
  ok   s01-arrival-overwhelm: timing shape: joy-a -> joy-b: 3 drawings [passing +0.25@216, passing +0.65@220, settle +0.99@224]
  ok   s01-arrival-overwhelm: timing shape: joy-b -> shrink: 5 drawings [passing +0.25@254, passing +0.55@258, passing +0.65@262, passing +0.75@266, settle +0.98@268]
  ok   s01-arrival-overwhelm: lead arm: rest-on-lid -> grip: the lead arm is no lagging secondary on this move
  ok   s01-arrival-overwhelm: lead arm: grip -> lift: the lead arm is no lagging secondary on this move
  ok   s01-arrival-overwhelm: lead arm: lift -> awe: the lead arm is no lagging secondary on this move
  ok   s01-arrival-overwhelm: lead arm: awe -> brace: the lead arm is no lagging secondary on this move
  ok   s01-arrival-overwhelm: lead arm: brace -> joy-a: the lead arm is no lagging secondary on this move
  ok   s01-arrival-overwhelm: lead arm: joy-a -> joy-b: the lead arm is no lagging secondary on this move
FAIL: poses - 5 of 21 checks failed: keys awe, line of action awe, line of action awe/bow, twinning awe, breakdowns awe -> brace
```


---

**Structural + Gate Review Required** (attempt 2/2)



**Gates you marked FAIL:**

- `animation-key-fit` — probe-poses.py v3/poses v3/keys v3/charts --joints keys exited 1: 5 of 21 checks failed, all on key awe (keys, line of action, bow, twinning, breakdowns awe -> brace).

Review your output above against the gates, then submit:

```
chain_id="chain-showcase_shot#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 2, "passed": false, "rationale": "Animation Key Fit — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys` in the renderer root: the key sheet's registered joints, measured by the same spine fit as the pose gate, must read the declared class, side and bow (within 0.02) and put the root over the declared weight foot. Its first line is its control and it refuses to report if the control does not trip. On FAIL quote the probe's line naming the key and the property (class, sign, bow, twinning, weight) and regenerate or re-register that key; never the probe, never the declaration to match a plate. Control: a straight spine declared S is refused.: <recorded: python3 scripts/animation/probe-poses.py v3/poses v3/keys v3/charts --joints keys exit 1>"},
    {"index": 4, "passed": true, "rationale": "__phase_guard__: <why>"}
  ],
  "reminders": {"satisfied": ["creed-fidelity", "framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-showcase_shot#1
→ Progress 4/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
