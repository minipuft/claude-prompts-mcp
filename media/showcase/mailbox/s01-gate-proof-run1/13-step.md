## Review Context

Review the original task and your output above against the gate criteria.

---




---

## Inline Gates

### Checks

- **Animation Inbetween Probes** — check: runs `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out`

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

### API Documentation Standards
**API Documentation Standards:**

- Include endpoint description and HTTP method
- Document all request parameters with types and examples
- Provide complete request/response examples
- Document all error codes and messages
- Include authentication requirements
- Add rate limiting information if applicable

### Information Placement
## Information Placement

Review whether the information belongs on the target surface and serves one reader need.

### Pass criteria

- Root README content serves acquisition or activation: what the product does, who it is for, proof, installation, first use, and routes to deeper documentation.
- Tutorials teach through a guided learning sequence; how-to guides solve a named task; reference supports lookup; explanation builds understanding.
- A section answers one primary reader question and links to another document when the need changes.
- Detailed configuration, troubleshooting, exhaustive syntax, and internal architecture do not expand the root README.
- Diátaxis names may remain in hidden maintainer metadata, but reader-facing navigation uses the task the reader wants to accomplish.

Fail with the target document and the better destination.

- **Product Positioning Fidelity** — Blocks public documentation that misstates the boundary between the AI client and Claude Prompts.

- **Prose Hygiene** — Guides public documentation away from formulaic AI cadence while preserving a direct technical voice.

- **Semantic Discoverability** — Guides documentation toward consistent reader terminology and factual search semantics without keyword stuffing.

- **Framework Compliance** — Ensures responses follow the active framework (CAGEERF, ReACT, 5W1H, SCAMPER). Requires BOTH a matching framework context AND a relevant prompt category to activate. This prevents framework gates from applying to simple prompts like greetings.

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

**Inline Fix Guidance:**
- Section "## Context" is too short (87 chars). Expand to at least 100 characters.
- Section "## Goals" is too short (73 chars). Expand to at least 80 characters.

**Last Review:** The engine ran probe-all.py and it exited 1: the joints dump was planted with linear lerp for this proof, so arcs, spacing and overlap are refused. The dump is restored and resubmitted.

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

### Animation Inbetween Probes — FAILED

**Command:** `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out`
**Exit Code:** 1
**Duration:** 59707ms

```
[...truncated...]
me 228, handL on frame 228; it should trail by 4 frames (snapped to the body)
    FAIL overlap joy-b -> shrink (frames 248-272) poncho: secondary poncho in the move joy-b -> shrink: the body is within 10% of its end pose on frame 272, poncho on frame 272; it should trail by 4 frames (snapped to the body)
    FAIL overlap joy-b -> shrink (frames 248-272) handL: secondary handL in the move joy-b -> shrink: the body is within 10% of its end pose on frame 272, handL on frame 272; it should trail by 4 frames (snapped to the body)
    FAIL overlap joy-b -> shrink (frames 248-272) handR: secondary handR in the move joy-b -> shrink: the body is within 10% of its end pose on frame 272, handR on frame 272; it should trail by 4 frames (snapped to the body)
    FAIL: inbetweens - 25 of 27 checks failed: arcs rest-on-lid -> grip (frames 26-42) wristR, arcs grip -> lift (frames 58-66) wristR, arcs grip -> lift (frames 58-66) head, arcs lift -> awe (frames 92-104) wristR, arcs awe -> brace (frames 130-154) wristL, arcs awe -> brace (frames 130-154) head, arcs brace -> joy-a (frames 178-190) wristL, arcs joy-a -> joy-b (frames 212-228) wristR, arcs joy-a -> joy-b (frames 212-228) root, arcs joy-b -> shrink (frames 248-272) wristL, arcs joy-b -> shrink (frames 248-272) head, arcs joy-b -> shrink (frames 248-272) root, spacing lift -> awe (frames 92-104) wristR, spacing joy-a -> joy-b (frames 212-228) wristR, overlap rest-on-lid -> grip (frames 26-42) handL, overlap grip -> lift (frames 58-66) handL, overlap lift -> awe (frames 92-104) handL, overlap awe -> brace (frames 130-154) handR, overlap brace -> joy-a (frames 178-190) poncho, overlap brace -> joy-a (frames 178-190) handR, overlap joy-a -> joy-b (frames 212-228) poncho, overlap joy-a -> joy-b (frames 212-228) handL, overlap joy-b -> shrink (frames 248-272) poncho, overlap joy-b -> shrink (frames 248-272) handL, overlap joy-b -> shrink (frames 248-272) handR
FAIL: probe-all --shots - 2 of 3 probe runs passed, 0 shot(s) skipped
```


---

**Structural + Gate Review Required** (attempt 2/2)



**Gates you marked FAIL:**

- `animation-inbetween-probes` — probe-all.py --shots v3/poses --frames-root out --joints-root out exited 1: 25 of 27 inbetween checks failed on arcs, spacing and overlap.

Review your output above against the gates, then submit:

```
chain_id="chain-showcase_shot#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 8, "passed": false, "rationale": "Animation Inbetween Probes — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out` in the renderer root: for every pose sheet it reads `out/<shot>-figure-seq/`, `out/<shot>-joints.json` (`npm run joints -- <shot>`) and `out/<shot>-xsheet.json`, prints one line per probe per shot (twos, holds, inbetweens), skips a shot with no frames and fails when none ran. Controls print first. On FAIL quote the line naming the joint, move or frames (a straight path, an undeclared reversal, even spacing, a snapped secondary, a frozen hold, a move outside 3–6 drawings) and fix the pose sheet's declared shape or the mechanics, never the probe. Control: a linear lerp and a zigzag are each refused.: <recorded: python3 scripts/animation/probe-all.py --shots v3/poses --frames-root out --joints-root out exit 1>"},
    {"index": 9, "passed": true, "rationale": "__phase_guard__: <why>"}
  ],
  "reminders": {"satisfied": ["api-documentation", "creed-fidelity", "information-placement", "product-positioning-fidelity", "prose-hygiene", "semantic-discoverability", "framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-showcase_shot#1
→ Progress 5/7
Next: chain_id="chain-showcase_shot#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
