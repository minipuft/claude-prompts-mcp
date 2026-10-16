---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Showcase Board.

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

- **brief**: A silent ~40 s showcase film for Claude Prompts MCP: a box arrives with a radiant gadget (raw capability) that overwhelms; a companion holds up a frame whose interior is someplace else; through it the...
- **constraints**: ~40 s at 30 fps, 1280x720, silent, poster at frame 0; swangle renderer here, final render on the Windows host; drawn on twos, light on ones; one locked camera and one emitter per shot; no asset accept...
- **output_root**: media/showcase

Brief: A silent ~40 s showcase film for Claude Prompts MCP: a box arrives with a radiant gadget (raw capability) that overwhelms; a companion holds up a frame whose interior is someplace else; through it the human scaffolds one lit join at a time (category, prompt, chain, gate, framework, workspace); the trio settles. Audience: developers landing on the GitHub README; frame 0 is the poster. The bots are standardizing their own design process (D49), and this run is the trail. Clean slate on assets (D56): every object is mused from the board before it enters a shot.
Production root: media/showcase
Previous handoff:
Start of pre-production; no prior step.

The board is the bible at a glance. Read `v3/references/board.json` and `v3/creative-spec.md` (rulings list). Check, in order: every card has title, by, borrow, refuse and governs; every `src`/`poster` path exists; no card shows anything the project drew (D56: no study still, no muse sheet, no failing control); every ruling D41 and later is governed by at least one card or named in the laws block; every video card has a local study copy or an explicit external href. Run `npm run board` from the production root; it refuses on a missing path. Do not add references on your own: a new card needs an owner ruling or a filed provenance entry in `style-references.json` with bytes and sha256.

Return: Board Revision; Sections and Card Count; Rulings Without a Card; Paths Fixed; Build Output (html, png size); Concerns.

---




---

## Inline Gates

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

**Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-showcase_preproduction#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "reminders": {"satisfied": ["api-documentation", "creed-fidelity", "information-placement", "product-positioning-fidelity", "prose-hygiene", "semantic-discoverability", "framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-showcase_preproduction#1
→ Progress 1/4
Next: chain_id="chain-showcase_preproduction#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
