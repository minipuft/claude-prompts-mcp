# Design Muse — {{challenge}}

{% if mode == "recommend" %}**Mode: RECOMMEND** — converge on one direction and the smallest controlled comparison needed to validate it.{% elif mode == "brainstorm" %}**Mode: BRAINSTORM** — form several genuinely different directions, then identify the comparison that would teach us most.{% else %}**Mode: BRAINSTORM** (default) — diverge, compare, and invite the next round.{% endif %}

## Challenge

{{challenge}}

## Binding constraints

{{constraints}}
{% if moodboard %}

## Supplied visual evidence

Inspect `{{moodboard}}` first. Treat it as evidence to decompose, not as a style label to imitate.
{% endif %}{% if seed_refs %}

## Seed references

{{seed_refs}}
Use these as goal-relative anchors. Resolve Practice Library keys or source pointers when available; do not invent missing provenance.
{% endif %}

Produce these sections in order:

### 1. FRAME

Restate the surface, the experience being sought, the constraints, and the uncertainty that another visual comparison could resolve.

### 2. GOAL-RELATIVE REFERENCE SET

Retrieve or curate **3-5** references that cover complementary roles rather than near-duplicates. Prefer Practice Library entries with stable semantic keys and clickable source pointers. Preserve a full source URL when the exact page, section, image, demo, or code artifact is the evidence. Include one counterexample or boundary reference.

| Pointer / source | Role for this goal | OBSERVATION | INTERPRETATION | TRANSFER | Confidence / caveat |
| ---------------- | ------------------ | ----------- | -------------- | -------- | ------------------- |

Keep provenance attached. A screenshot, board, or stitched page may support the pointer, but it does not replace the source URL when one exists.

### 3. CAPABILITY CONTRACT

Map the promising transfers to concrete operations available in this project.

| Desired property | Primitive / field / component | Control parameters | [we own] or [client limit] | Verification |
| ---------------- | ----------------------------- | ------------------ | -------------------------- | ------------ |

For shader or procedural work, translate appearance into fields and operators: silhouette or occupancy, depth/material cue, edge behavior, motion law, palette/luminance, and atmosphere/layering. Distinguish subject matter from medium behavior.

### 4. DISTINCT DIRECTIONS

{% if mode == "recommend" %}Propose 2-3{% else %}Propose 3-4{% endif %} directions that make materially different transfers. For each, state:

- references used and ignored;
- what is borrowed at the property or operation level;
- what remains original to this surface;
- cost, benefit, and primary failure mode;
- how the counterexample bounds the direction.

### 5. PAIRWISE CRITIQUE

Compare the strongest directions pairwise against the current goal and constraints. Name the deciding distinction; do not average everything into one score. Treat the preference as a goal-relative proposal, not a durable claim about the user's taste.

### 6. CONTROLLED VISUAL EVIDENCE

Define the smallest editable experiment that could change the decision. Choose one appropriate form: A/B direction pair, one-variable parameter strip, seeded contact sheet, scale matrix, or debug sheet.

State:

- the artifact and seed(s);
- the one variable that changes;
- what is held constant;
- views or states to capture;
- the observable comparison criteria;
- the feasibility or performance check;
- what result would reverse the recommendation.

Do not prescribe reinforcement learning as a default. Reuse only the transferable evaluation pattern: verified primitives, reproducible artifacts, and controlled comparative evidence.

### 7. SYNTHESIS

- **[CRITIQUE]** weakest point of the leading direction
- **[ALTERNATIVES]** what the nearest viable alternative costs and buys
- **[SYNTHESIS]** recommended direction and smallest next move
- **[COUNTER-VECTOR]** the assumption most worth breaking

### 8. CAPTURE PROPOSAL + BOUNCE

If this round reveals a new or materially refined preference, propose a compact capture containing the evidence pointer, goal-relative judgment, counterexample, and confidence. Name the destination: Practice Library entry, project note, taste-profile candidate, skill, or rule. **Do not write or publish it until the user explicitly confirms.** If no durable preference was learned, say `capture: none — goal-local evidence only`.

End with {% if mode == "recommend" %}1-2{% else %}2-3{% endif %} focused forks whose answers would change the artifact or comparison.
